import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

import {
  ImplementationDependencyRulesConfig,
  KnowledgeBaseConfigPublic,
  KnowledgeBaseConfigStore,
  KnowledgeBaseCredentialsPublic,
  RequirementKimiCredentialsPublic,
  RequirementSystemConfig,
  RequirementSystemConfigPublic,
  VersionCodeRule,
  VersionCodeRuleModuleKey,
  VersionCodeRuleStatus,
} from "../../types";
import { config } from "../../config/env";
import { requireAuth, isAdminUser } from "../../middleware/auth";
import { fail, ok } from "../../utils/response";
import { KimiPingFailure, pingKimiChatCompletion } from "../../utils/kimi-ping";
import {
  buildVersionCodeSample,
  loadImplementationDependencyRulesStore,
  loadKnowledgeBaseConfigStore,
  loadVersionCodeRulesStore,
  loadRequirementSystemConfigStore,
  mergeKimiCredentialsPatch,
  mergeKnowledgeBaseCredentialsPatch,
  normalizeImplementationDependencyRulesConfig,
  normalizeKnowledgeBaseConfig,
  normalizeRequirementSystemConfig,
  resolveActiveKnowledgeBaseConfig,
  resolveDraftKimiApiKeyForTest,
  resolveDraftKnowledgeBaseConfigForTest,
  saveImplementationDependencyRulesStore,
  saveKnowledgeBaseConfigStore,
  saveRequirementSystemConfigStore,
  saveVersionCodeRulesStore,
} from "./system.repository";
import { queryZhipuKnowledgeBase } from "../../services/ai/knowledge-tool.service";
import { ROLE_CAPABILITIES } from "../../rbac/permissions";
import { legacyRoleToV2Roles, V2_ROLES } from "../../rbac/roles";

function maskKimiApiKeyHint(key: string): string | null {
  const t = key.trim();
  if (!t) return null;
  if (t.length <= 4) return "····";
  return `····${t.slice(-4)}`;
}

function toPublicKimiCredentials(storedKey: string): RequirementKimiCredentialsPublic {
  const trimmed = storedKey.trim();
  const envOk = Boolean(config.kimi.apiKey?.trim());
  return {
    apiKey: "",
    hint: maskKimiApiKeyHint(trimmed),
    envFallbackAvailable: envOk,
    resolvedFrom: trimmed ? "store" : envOk ? "env" : "none",
  };
}

function toPublicRequirementConfig(cfg: RequirementSystemConfig): RequirementSystemConfigPublic {
  return {
    ...cfg,
    kimiCredentials: toPublicKimiCredentials(cfg.kimiCredentials.apiKey),
  };
}

const MODULE_KEYS: VersionCodeRuleModuleKey[] = [
  "global",
  "requirement",
  "implementation",
  "dev",
  "resource",
  "wbs",
];

function isValidModuleKey(value: string): value is VersionCodeRuleModuleKey {
  return MODULE_KEYS.includes(value as VersionCodeRuleModuleKey);
}

function isValidStatus(value: string): value is VersionCodeRuleStatus {
  return ["active", "draft", "disabled"].includes(value);
}

function requireAdmin(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return null;
  if (!isAdminUser(auth.user)) {
    fail(res, 40301, "权限不足", [{ field: "role", reason: "admin_required" }]);
    return null;
  }
  return auth;
}

function sanitizeRule(rule: VersionCodeRule): VersionCodeRule {
  const nextPrefix = rule.prefix.trim().toUpperCase();
  const nextFormat = rule.format.trim();
  return {
    ...rule,
    prefix: nextPrefix,
    format: nextFormat,
    sample: buildVersionCodeSample(nextFormat, nextPrefix, rule.moduleCode),
  };
}

export function listVersionCodeRules(req: Request, res: Response) {
  if (!requireAdmin(req, res)) return;

  const moduleKey = String(req.query.moduleKey || "").trim();
  const keyword = String(req.query.keyword || "").trim().toLowerCase();
  const status = String(req.query.status || "").trim();

  if (moduleKey && !isValidModuleKey(moduleKey)) {
    return fail(res, 40001, "参数错误", [{ field: "moduleKey", reason: "invalid_module_key" }]);
  }
  if (status && !isValidStatus(status)) {
    return fail(res, 40001, "参数错误", [{ field: "status", reason: "invalid_status" }]);
  }

  const store = loadVersionCodeRulesStore();
  const items = store.rules
    .map(sanitizeRule)
    .filter((item) => {
      if (moduleKey && item.moduleKey !== moduleKey) return false;
      if (status && item.status !== status) return false;
      if (!keyword) return true;
      return (
        item.moduleName.toLowerCase().includes(keyword) ||
        item.moduleCode.toLowerCase().includes(keyword) ||
        item.prefix.toLowerCase().includes(keyword) ||
        item.format.toLowerCase().includes(keyword)
      );
    })
    .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)));

  return res.json(ok({ items }, randomUUID()));
}

export function updateVersionCodeRuleConfig(req: Request, res: Response) {
  if (!requireAdmin(req, res)) return;

  const ruleId = String(req.params.ruleId || "").trim();
  const prefix = String(req.body?.prefix || "").trim().toUpperCase();
  const rawFormat = String(req.body?.format || "").trim();

  if (!ruleId) return fail(res, 40001, "参数错误", [{ field: "ruleId", reason: "required" }]);
  if (!prefix) return fail(res, 40001, "参数错误", [{ field: "prefix", reason: "required" }]);
  if (!/^[A-Z0-9-]{1,12}$/.test(prefix)) {
    return fail(res, 40001, "参数错误", [{ field: "prefix", reason: "invalid_prefix" }]);
  }
  if (!rawFormat || rawFormat.length > 80) {
    return fail(res, 40001, "参数错误", [{ field: "format", reason: "invalid_format" }]);
  }
  const format = rawFormat.includes("{PREFIX}") ? rawFormat : `{PREFIX}${rawFormat}`;
  if (format.length > 128) {
    return fail(res, 40001, "参数错误", [{ field: "format", reason: "invalid_format" }]);
  }

  const now = new Date().toISOString();
  const store = loadVersionCodeRulesStore();
  const target = store.rules.find((item) => item.id === ruleId);
  if (!target) {
    return fail(res, 40401, "资源不存在", [{ field: "ruleId", reason: "not_found" }]);
  }

  target.prefix = prefix;
  target.format = format;
  target.status = target.status === "disabled" ? "draft" : target.status;
  target.updatedAt = now;
  target.sample = buildVersionCodeSample(target.format, target.prefix, target.moduleCode);
  saveVersionCodeRulesStore(store);

  return res.json(ok({ item: sanitizeRule(target) }, randomUUID()));
}

export function activateVersionCodeRule(req: Request, res: Response) {
  if (!requireAdmin(req, res)) return;

  const ruleId = String(req.params.ruleId || "").trim();
  if (!ruleId) return fail(res, 40001, "参数错误", [{ field: "ruleId", reason: "required" }]);

  const now = new Date().toISOString();
  const store = loadVersionCodeRulesStore();
  const target = store.rules.find((item) => item.id === ruleId);
  if (!target) {
    return fail(res, 40401, "资源不存在", [{ field: "ruleId", reason: "not_found" }]);
  }

  target.status = "active";
  target.effectiveAt = now;
  target.updatedAt = now;
  target.sample = buildVersionCodeSample(target.format, target.prefix, target.moduleCode);
  saveVersionCodeRulesStore(store);

  return res.json(ok({ item: sanitizeRule(target) }, randomUUID()));
}

export function disableVersionCodeRule(req: Request, res: Response) {
  if (!requireAdmin(req, res)) return;

  const ruleId = String(req.params.ruleId || "").trim();
  if (!ruleId) return fail(res, 40001, "参数错误", [{ field: "ruleId", reason: "required" }]);

  const now = new Date().toISOString();
  const store = loadVersionCodeRulesStore();
  const target = store.rules.find((item) => item.id === ruleId);
  if (!target) {
    return fail(res, 40401, "资源不存在", [{ field: "ruleId", reason: "not_found" }]);
  }

  target.status = "disabled";
  target.updatedAt = now;
  target.sample = buildVersionCodeSample(target.format, target.prefix, target.moduleCode);
  saveVersionCodeRulesStore(store);

  return res.json(ok({ item: sanitizeRule(target) }, randomUUID()));
}

export function getRequirementSystemConfig(req: Request, res: Response) {
  if (!requireAdmin(req, res)) return;
  const store = loadRequirementSystemConfigStore();
  return res.json(
    ok(
      {
        version: store.version,
        draft: toPublicRequirementConfig(store.draft),
        active: toPublicRequirementConfig(store.active),
        updatedAt: store.updatedAt,
        effectiveAt: store.effectiveAt,
      },
      randomUUID(),
    ),
  );
}

export function updateRequirementSystemConfigDraft(req: Request, res: Response) {
  if (!requireAdmin(req, res)) return;
  const payload = (req.body || {}) as Partial<RequirementSystemConfig> & {
    kimiCredentials?: { apiKey?: string | null };
  };
  const {
    kimiCredentials: credsPatch,
    kimiEvaluation: kimiEvaluationPatch,
    fileParsing: fileParsingPatch,
    kimiGeneration: kimiGenerationPatch,
  } = payload;
  const now = new Date().toISOString();
  const store = loadRequirementSystemConfigStore();
  const nextCreds = mergeKimiCredentialsPatch(store.draft.kimiCredentials, credsPatch);
  store.draft = normalizeRequirementSystemConfig({
    ...store.draft,
    kimiEvaluation: { ...store.draft.kimiEvaluation, ...(kimiEvaluationPatch || {}) },
    fileParsing: { ...store.draft.fileParsing, ...(fileParsingPatch || {}) },
    kimiGeneration: { ...store.draft.kimiGeneration, ...(kimiGenerationPatch || {}) },
    kimiCredentials: nextCreds,
  });
  store.updatedAt = now;
  saveRequirementSystemConfigStore(store);
  return res.json(
    ok(
      {
        version: store.version,
        draft: toPublicRequirementConfig(store.draft),
        updatedAt: store.updatedAt,
      },
      randomUUID(),
    ),
  );
}

export function activateRequirementSystemConfig(req: Request, res: Response) {
  if (!requireAdmin(req, res)) return;
  const now = new Date().toISOString();
  const store = loadRequirementSystemConfigStore();
  store.active = normalizeRequirementSystemConfig(store.draft);
  store.version = Number(store.version || 1) + 1;
  store.effectiveAt = now;
  store.updatedAt = now;
  saveRequirementSystemConfigStore(store);
  return res.json(
    ok(
      {
        version: store.version,
        active: toPublicRequirementConfig(store.active),
        effectiveAt: store.effectiveAt,
      },
      randomUUID(),
    ),
  );
}

export async function testRequirementKimiApiKey(req: Request, res: Response) {
  if (!requireAdmin(req, res)) return;
  const body = (req.body || {}) as { apiKey?: string; model?: string };
  const explicit = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const explicitModel = typeof body.model === "string" ? body.model.trim() : "";
  const { apiKey, source } = resolveDraftKimiApiKeyForTest(explicit || undefined);
  if (!apiKey) {
    return fail(res, 40001, "未配置可用的 API Key", [{ field: "apiKey", reason: "missing_in_store_and_env" }]);
  }
  const store = loadRequirementSystemConfigStore();
  const model =
    explicitModel || store.draft.kimiEvaluation?.model?.trim() || config.kimi.model;
  try {
    await pingKimiChatCompletion({
      apiUrl: config.kimi.apiBaseUrl,
      apiKey,
      model,
    });
    const testedSource =
      source === "override" ? "request_body" : source === "draft" ? "draft_store" : "environment";
    return res.json(ok({ ok: true, testedSource, model }, randomUUID()));
  } catch (e) {
    if (e instanceof KimiPingFailure) {
      if (e.kind === "overload") {
        return fail(res, 50301, "KIMI 服务端繁忙，请稍后重试（多由官方引擎限流/过载引起，不代表 API Key 一定错误）", [
          { field: "provider", reason: e.message },
        ]);
      }
      if (e.kind === "rate_limited") {
        return fail(res, 42901, "请求过于频繁，请稍后再试", [{ field: "provider", reason: e.message }]);
      }
      if (e.kind === "auth") {
        return fail(res, 40001, "API Key 无效或未授权", [{ field: "apiKey", reason: e.message }]);
      }
      if (e.kind === "model_not_found") {
        return fail(res, 40001, "模型不可用或名称错误", [{ field: "model", reason: e.message }]);
      }
    }
    const msg = e instanceof Error ? e.message : "ping_failed";
    return fail(res, 40001, "调用 KIMI 失败", [{ field: "apiKey", reason: msg }]);
  }
}

export function getImplementationDependencyRules(req: Request, res: Response) {
  if (!requireAdmin(req, res)) return;
  const store = loadImplementationDependencyRulesStore();
  return res.json(
    ok(
      {
        version: store.version,
        draft: store.draft,
        active: store.active,
        updatedAt: store.updatedAt,
        effectiveAt: store.effectiveAt,
      },
      randomUUID(),
    ),
  );
}

export function updateImplementationDependencyRulesDraft(req: Request, res: Response) {
  if (!requireAdmin(req, res)) return;
  const payload = (req.body || {}) as Partial<ImplementationDependencyRulesConfig>;
  const now = new Date().toISOString();
  const store = loadImplementationDependencyRulesStore();
  store.draft = normalizeImplementationDependencyRulesConfig({
    ...store.draft,
    ...payload,
  });
  store.updatedAt = now;
  saveImplementationDependencyRulesStore(store);
  return res.json(ok({ version: store.version, draft: store.draft, updatedAt: store.updatedAt }, randomUUID()));
}

export function activateImplementationDependencyRules(req: Request, res: Response) {
  if (!requireAdmin(req, res)) return;
  const now = new Date().toISOString();
  const store = loadImplementationDependencyRulesStore();
  store.active = normalizeImplementationDependencyRulesConfig(store.draft);
  store.version = Number(store.version || 1) + 1;
  store.effectiveAt = now;
  store.updatedAt = now;
  saveImplementationDependencyRulesStore(store);
  return res.json(
    ok(
      {
        version: store.version,
        active: store.active,
        effectiveAt: store.effectiveAt,
      },
      randomUUID(),
    ),
  );
}

// -------------------- 知识库配置 --------------------

function maskKnowledgeBaseApiKeyHint(key: string): string | null {
  const t = key.trim();
  if (!t) return null;
  if (t.length <= 4) return "····";
  return `····${t.slice(-4)}`;
}

function toPublicKnowledgeBaseCredentials(store: KnowledgeBaseConfigStore): KnowledgeBaseCredentialsPublic {
  const trimmedKey = store.active.credentials.apiKey.trim();
  const trimmedKid = store.active.credentials.knowledgeId.trim();
  const envOk = Boolean(config.zhipu.apiKey?.trim() && config.zhipu.knowledgeId?.trim());
  return {
    apiKey: "",
    apiHint: maskKnowledgeBaseApiKeyHint(trimmedKey),
    knowledgeId: trimmedKid || "",
    envFallbackAvailable: envOk,
    resolvedFrom: trimmedKey && trimmedKid ? "store" : envOk ? "env" : "none",
  };
}

function toPublicKnowledgeBaseConfig(store: KnowledgeBaseConfigStore): KnowledgeBaseConfigPublic {
  return {
    model: store.active.model,
    apiBaseUrl: store.active.apiBaseUrl,
    credentials: toPublicKnowledgeBaseCredentials(store),
  };
}

export function getKnowledgeBaseConfig(req: Request, res: Response) {
  if (!requireAdmin(req, res)) return;
  const store = loadKnowledgeBaseConfigStore();
  return res.json(
    ok(
      {
        version: store.version,
        draft: {
          model: store.draft.model,
          apiBaseUrl: store.draft.apiBaseUrl,
          credentials: {
            apiKey: "",
            apiHint: maskKnowledgeBaseApiKeyHint(store.draft.credentials.apiKey),
            knowledgeId: store.draft.credentials.knowledgeId,
          },
        },
        active: toPublicKnowledgeBaseConfig(store),
        updatedAt: store.updatedAt,
        effectiveAt: store.effectiveAt,
      },
      randomUUID(),
    ),
  );
}

export function updateKnowledgeBaseConfigDraft(req: Request, res: Response) {
  if (!requireAdmin(req, res)) return;
  const payload = (req.body || {}) as {
    model?: string;
    apiBaseUrl?: string;
    credentials?: { apiKey?: string | null; knowledgeId?: string | null };
  };
  const now = new Date().toISOString();
  const store = loadKnowledgeBaseConfigStore();
  const nextCreds = mergeKnowledgeBaseCredentialsPatch(store.draft.credentials, payload.credentials);
  store.draft = normalizeKnowledgeBaseConfig({
    ...store.draft,
    model: payload.model ?? store.draft.model,
    apiBaseUrl: payload.apiBaseUrl ?? store.draft.apiBaseUrl,
    credentials: nextCreds,
  });
  store.updatedAt = now;
  saveKnowledgeBaseConfigStore(store);
  return res.json(
    ok(
      {
        version: store.version,
        draft: {
          model: store.draft.model,
          apiBaseUrl: store.draft.apiBaseUrl,
          credentials: {
            apiKey: "",
            apiHint: maskKnowledgeBaseApiKeyHint(store.draft.credentials.apiKey),
            knowledgeId: store.draft.credentials.knowledgeId,
          },
        },
        updatedAt: store.updatedAt,
      },
      randomUUID(),
    ),
  );
}

export function activateKnowledgeBaseConfig(req: Request, res: Response) {
  if (!requireAdmin(req, res)) return;
  const now = new Date().toISOString();
  const store = loadKnowledgeBaseConfigStore();
  store.active = normalizeKnowledgeBaseConfig(store.draft);
  store.version = Number(store.version || 1) + 1;
  store.effectiveAt = now;
  store.updatedAt = now;
  saveKnowledgeBaseConfigStore(store);
  return res.json(
    ok(
      {
        version: store.version,
        active: toPublicKnowledgeBaseConfig(store),
        effectiveAt: store.effectiveAt,
      },
      randomUUID(),
    ),
  );
}

// ------------------------------------------------------------------
// RP-026: 角色能力矩阵（只读可视化）
// ------------------------------------------------------------------

/** 能力位业务含义摘要（用于前端展示） */
const CAPABILITY_LABELS: Record<string, string> = {
  "estimates:create": "创建评估包",
  "estimates:read": "查看评估包",
  "estimates:write": "编辑评估包",
  "contract:initiate": "发起合同",
  "requirement:upload": "上传需求文件",
  "extractor:trigger": "触发智能抽取",
  "requirement:maintain": "维护需求",
  "assessment:create": "创建实施评估",
  "dev:assign": "分配开发任务",
  "assumption:write": "编辑假设条件",
  "assessment:handoff": "交接评估包",
  "man-day:adjust": "调整人天",
  "dev:read": "查看开发评估",
  "dev:write": "编辑开发评估",
  "deliverable:generate": "生成交付物",
  "deliverable:review": "审核交付物",
  "deliverable:reject": "驳回交付物",
  "evidence:read": "查看证据链",
  "evidence:write": "编辑证据链",
  "dsl:manage": "管理 DSL 规则",
  "template:manage": "管理评估模板",
  "rate-card:manage": "管理费率卡",
  "methodology:manage": "管理方法论",
  "rule:manage": "管理评估规则",
  "user:manage": "管理用户",
  "system:manage": "系统管理",
};

/** 旧系统角色 → V2 角色显示名 */
const LEGACY_ROLE_LABELS: Record<string, string> = {
  admin: "超级管理员",
  sub_admin: "管理员",
  user: "普通用户",
};

export function getRoleCapabilitiesMatrix(req: Request, res: Response) {
  if (!requireAdmin(req, res)) return;

  const matrix = V2_ROLES.map((role) => ({
    role,
    capabilities: ROLE_CAPABILITIES[role],
  }));

  const legacyMapping = Object.entries(LEGACY_ROLE_LABELS).map(
    ([legacyKey, label]) => ({
      legacyRole: legacyKey,
      label,
      v2Roles: legacyRoleToV2Roles(legacyKey),
    }),
  );

  return res.json(
    ok(
      {
        roles: matrix,
        legacyMapping,
        capabilityLabels: CAPABILITY_LABELS,
      },
      randomUUID(),
    ),
  );
}

export async function testKnowledgeBaseConnectivity(req: Request, res: Response) {
  if (!requireAdmin(req, res)) return;
  const body = (req.body || {}) as { apiKey?: string; knowledgeId?: string };
  const explicitApiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const explicitKnowledgeId = typeof body.knowledgeId === "string" ? body.knowledgeId.trim() : "";
  const { apiKey, knowledgeId, model, apiBaseUrl, source } = resolveDraftKnowledgeBaseConfigForTest(
    explicitApiKey || undefined,
    explicitKnowledgeId || undefined,
  );
  if (!apiKey || !knowledgeId) {
    return fail(res, 40001, "未配置可用的 API Key 或知识库 ID", [
      { field: "credentials", reason: "missing_in_store_and_env" },
    ]);
  }
  try {
    const trace = await queryZhipuKnowledgeBase("知识库连通性测试", {
      apiKey,
      knowledgeId,
      model,
      apiBaseUrl,
    });
    const testedSource =
      source === "override" ? "request_body" : source === "draft" ? "draft_store" : "environment";
    if (trace.confidence === "high" || (trace.confidence === "low" && !trace.fallbackReason)) {
      return res.json(
        ok(
          {
            ok: true,
            testedSource,
            model,
            knowledgeId,
            latencyMs: trace.latencyMs,
            retrievalTriggered: trace.retrievalTriggered,
          },
          randomUUID(),
        ),
      );
    }
    return fail(
      res,
      40001,
      `知识库连通性测试未通过：${trace.fallbackReason || "unknown_reason"}`,
      [{ field: "knowledgeBase", reason: trace.errorMessage || trace.fallbackReason || "test_failed" }],
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "test_failed";
    return fail(res, 40001, "调用智谱知识库失败", [{ field: "knowledgeBase", reason: msg }]);
  }
}
