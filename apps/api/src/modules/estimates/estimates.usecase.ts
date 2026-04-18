import { createHash, randomUUID } from "node:crypto";

import { config } from "../../config/env";
import { calculateEstimate, validateCalculateRequest } from "../../engine";
import { CalculateRequest, ImplementationDependencyRulesConfig, RuleSet, Template } from "../../types";
import { loadJsonFile } from "../../utils/file";
import { asString } from "../../utils/helpers";
import { writeExportFile } from "../../services/export.service";
import { loadImplementationDependencyRulesStore } from "../system/system.repository";
import {
  buildOwnedExportFileName,
  deleteIdempotencyRecord,
  getExportHistoryList,
  getIdempotencyRecord,
  setIdempotencyRecord
} from "./estimates.repository";

type FailedResult = {
  ok: false;
  code: number;
  message: string;
  details?: Array<{ field: string; reason: string }>;
};

type SuccessResult<T> = {
  ok: true;
  data: T;
  requestId?: string;
};

type EstimateValidationResult = FailedResult | SuccessResult<ReturnType<typeof calculateEstimate>>;

export type EstimateUsecaseResult<T> = FailedResult | SuccessResult<T>;

type DependencyIssue = {
  ruleId: string;
  subject: string;
  trigger: string;
  missing: string[];
};

function loadEstimateContext(): { template: Template; ruleSet: RuleSet } {
  return {
    template: loadJsonFile<Template>("config/templates/example-template.json"),
    ruleSet: loadJsonFile<RuleSet>("config/rules/example-rule-set.json")
  };
}

function normalizeToken(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()（）]/g, "");
}

function hasSelectedLabel(tokens: Set<string>, target: string): boolean {
  const normalizedTarget = normalizeToken(target);
  if (!normalizedTarget) return false;
  for (const token of tokens) {
    if (!token) continue;
    if (token === normalizedTarget) return true;
    if (normalizedTarget.length >= 2 && token.includes(normalizedTarget)) return true;
    if (token.length >= 4 && normalizedTarget.includes(token)) return true;
  }
  return false;
}

function collectSelectedLabels(body: CalculateRequest, template: Template): Set<string> {
  const selectedIds = new Set(
    (body.items || [])
      .filter((item) => Boolean(item?.included))
      .map((item) => String(item.templateItemId || "").trim())
      .filter(Boolean),
  );
  const labels = new Set<string>();
  const selectedCloudNames = Array.isArray(body.selectedCloudNames) ? body.selectedCloudNames : [];
  for (const cloudName of selectedCloudNames) {
    labels.add(normalizeToken(cloudName));
  }
  for (const item of template.items || []) {
    if (!selectedIds.has(item.templateItemId)) continue;
    const candidates = [item.skuName, item.itemName, item.deliveryModule, item.appGroup, item.cloudProduct];
    for (const candidate of candidates) {
      const token = normalizeToken(candidate);
      if (token) labels.add(token);
    }
  }
  return labels;
}

function validateImplementationDependencies(body: CalculateRequest, template: Template): FailedResult | null {
  const store = loadImplementationDependencyRulesStore();
  const activeRules: ImplementationDependencyRulesConfig | null = store.active || null;
  if (!activeRules || !Array.isArray(activeRules.rules) || activeRules.rules.length === 0) return null;

  const selectedTokens = collectSelectedLabels(body, template);
  if (selectedTokens.size === 0) return null;

  const issues: DependencyIssue[] = [];
  for (const rule of activeRules.rules) {
    if (!rule?.enabled) continue;
    if (!hasSelectedLabel(selectedTokens, rule.subject)) continue;

    const missingDependencies = (rule.dependencies || []).filter((dep) => !hasSelectedLabel(selectedTokens, dep));
    if (rule.logic === "requires_all") {
      if (missingDependencies.length > 0) {
        issues.push({
          ruleId: rule.id,
          subject: rule.subject,
          trigger: rule.trigger,
          missing: missingDependencies,
        });
      }
      continue;
    }

    if (rule.logic === "requires_any") {
      const anyGroups = Array.isArray(rule.anyOfGroups) ? rule.anyOfGroups : [];
      const missingAny = anyGroups
        .map((group) => group.filter((item) => String(item || "").trim()))
        .filter((group) => group.length > 0)
        .filter((group) => !group.some((candidate) => hasSelectedLabel(selectedTokens, candidate)));
      if (missingDependencies.length > 0 || missingAny.length > 0) {
        const anyMissingFlat = missingAny.map((group) => `(${group.join(" / ")})至少一项`).join("、");
        issues.push({
          ruleId: rule.id,
          subject: rule.subject,
          trigger: rule.trigger,
          missing: [...missingDependencies, ...(anyMissingFlat ? [anyMissingFlat] : [])],
        });
      }
      continue;
    }

    if (rule.logic === "combo") {
      const comboDependencies = (rule.comboDependencies || []).filter((item) => String(item || "").trim());
      const comboSatisfied = comboDependencies.length === 0 || comboDependencies.some((dep) => hasSelectedLabel(selectedTokens, dep));
      if (missingDependencies.length > 0 || !comboSatisfied) {
        issues.push({
          ruleId: rule.id,
          subject: rule.subject,
          trigger: rule.trigger,
          missing: [
            ...missingDependencies,
            ...(!comboSatisfied ? [`(${comboDependencies.join(" / ")})至少一项`] : []),
          ],
        });
      }
    }
  }

  const mutexRules = Array.isArray(activeRules.mutualExclusionRules) ? activeRules.mutualExclusionRules : [];
  for (const pair of mutexRules) {
    if (hasSelectedLabel(selectedTokens, pair.left) && hasSelectedLabel(selectedTokens, pair.right)) {
      issues.push({
        ruleId: `mutex-${pair.left}-${pair.right}`,
        subject: `${pair.left} / ${pair.right}`,
        trigger: "互斥规则",
        missing: [pair.reason || "不可同时选择"],
      });
    }
  }

  if (!issues.length) return null;
  return {
    ok: false,
    code: 40001,
    message: "实施评估 SKU 依赖校验失败",
    details: issues.map((issue) => ({
      field: `dependency:${issue.ruleId}`,
      reason: `${issue.subject}(${issue.trigger})缺少：${issue.missing.join("、")}`,
    })),
  };
}

export function calculateEstimateOnly(body: CalculateRequest): EstimateValidationResult {
  const { template, ruleSet } = loadEstimateContext();
  const dependencyValidation = validateImplementationDependencies(body, template);
  if (dependencyValidation) return dependencyValidation;
  const validation = validateCalculateRequest(body, template, ruleSet);
  if (!validation.ok) {
    return {
      ok: false,
      code: validation.code,
      message: validation.message,
      details: validation.details
    };
  }

  return {
    ok: true,
    data: calculateEstimate(body, template, ruleSet),
    requestId: randomUUID()
  };
}

export async function calculateAndExportEstimate(
  body: CalculateRequest & { exportType?: "excel" | "pdf" },
  ownerUserId: string,
  idempotencyKey?: string
): Promise<EstimateUsecaseResult<{ totalDays: number; downloadUrl: string; expireAt: string }>> {
  const { template, ruleSet } = loadEstimateContext();
  const dependencyValidation = validateImplementationDependencies(body, template);
  if (dependencyValidation) return dependencyValidation;
  const validation = validateCalculateRequest(body, template, ruleSet);
  if (!validation.ok) {
    return {
      ok: false,
      code: validation.code,
      message: validation.message,
      details: validation.details
    };
  }

  const exportType = body.exportType === "pdf" ? "pdf" : "excel";
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ ...body, exportType }))
    .digest("hex");

  if (idempotencyKey) {
    const existing = getIdempotencyRecord(idempotencyKey);
    if (existing) {
      const expired = Date.now() - existing.createdAt > config.constants.EXPORT_IDEMPOTENCY_TTL_MS;
      if (expired) {
        deleteIdempotencyRecord(idempotencyKey);
      } else if (existing.ownerUserId !== ownerUserId) {
        return {
          ok: false,
          code: 40001,
          message: "参数错误",
          details: [{ field: "Idempotency-Key", reason: "cross_user_conflict" }]
        };
      } else if (existing.payloadHash !== payloadHash) {
        return {
          ok: false,
          code: 40001,
          message: "参数错误",
          details: [{ field: "Idempotency-Key", reason: "payload_conflict" }]
        };
      } else {
        return { ok: true, data: existing.data, requestId: existing.requestId };
      }
    }
  }

  const result = calculateEstimate(body, template, ruleSet);
  const extension = exportType === "pdf" ? "pdf" : "xlsx";
  const fileName = buildOwnedExportFileName(
    ownerUserId,
    extension,
    asString(body.exportProjectName) || "未命名项目",
    asString(body.exportAssessmentVersionCode) || "V00"
  );

  await writeExportFile(fileName, exportType, result, body, template, ruleSet);
  const responseData = {
    totalDays: result.totalDays,
    downloadUrl: `/downloads/${fileName}`,
    expireAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  };
  const requestId = randomUUID();

  if (idempotencyKey) {
    setIdempotencyRecord(idempotencyKey, {
      ownerUserId,
      payloadHash,
      data: responseData,
      requestId,
      createdAt: Date.now()
    });
  }

  return { ok: true, data: responseData, requestId };
}

export function listExportHistoryByOwner(ownerUserId: string, page: number, pageSize: number) {
  return getExportHistoryList(ownerUserId, page, pageSize);
}

export function getActiveImplementationDependencyRules() {
  const store = loadImplementationDependencyRulesStore();
  return {
    version: store.version,
    effectiveAt: store.effectiveAt,
    active: store.active,
  };
}
