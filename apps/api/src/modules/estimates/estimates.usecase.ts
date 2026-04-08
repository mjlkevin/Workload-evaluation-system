import { createHash, randomUUID } from "node:crypto";

import { config } from "../../config/env";
import { calculateEstimate, validateCalculateRequest } from "../../engine";
import { CalculateRequest, RuleSet, Template } from "../../types";
import { loadJsonFile } from "../../utils/file";
import { asString } from "../../utils/helpers";
import { writeExportFile } from "../../services/export.service";
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

function loadEstimateContext(): { template: Template; ruleSet: RuleSet } {
  return {
    template: loadJsonFile<Template>("config/templates/example-template.json"),
    ruleSet: loadJsonFile<RuleSet>("config/rules/example-rule-set.json")
  };
}

export function calculateEstimateOnly(body: CalculateRequest): EstimateValidationResult {
  const { template, ruleSet } = loadEstimateContext();
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
