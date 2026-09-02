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
  computeKnowledgeBaseConfigHash,
  computeKnowledgeBaseProfileHash,
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
  resolveActiveRequirementKimiApiKey,
  resolveDraftKimiApiKeyForTest,
  resolveDraftKnowledgeBaseConfigForTest,
  saveImplementationDependencyRulesStore,
  saveKnowledgeBaseConfigStore,
  saveRequirementSystemConfigStore,
  saveVersionCodeRulesStore,
  validateKnowledgeBaseProfiles,
  persistKimiApiKey,
  clearKimiApiKey,
} from "./system.repository";
import { probeKnowledgeBaseAccess } from "./knowledge-base-access-probe";
import { getAuditLog, resolveKek, KIMI_SCOPE, getCachedApiKey, setApiKey as dbSetProviderApiKey, clearApiKey as dbClearProviderApiKey } from "./credentials.store";
import {
  BUILTIN_MOONSHOT_PROVIDER_ID,
  credentialScopeForProvider,
  resolveScenarioConfig,
} from "./model-providers";
import {
  buildEffectiveModelConfig,
  loadModelVerifyStatus,
  resolveScenarioModel,
  saveScenarioVerifyRecord,
  type CredentialsHealth,
  type ModelScenarioKey,
} from "./system-effective";
import { ROLE_CAPABILITIES } from "../../rbac/permissions";
import { legacyRoleToV2Roles, V2_ROLES } from "../../rbac/roles";

function maskKimiApiKeyHint(key: string): string | null {
  const t = key.trim();
  if (!t) return null;
  if (t.length <= 4) return "····";
  return `····${t.slice(-4)}`;
}

function responseRequestId(res: Response): string {
  const value = res.locals?.requestId;
  return typeof value === "string" && value ? value : randomUUID();
}

function toPublicKimiCredentials(): RequirementKimiCredentialsPublic {
  const { apiKey, source } = resolveActiveRequirementKimiApiKey();
  return {
    apiKey: "",
    hint: maskKimiApiKeyHint(apiKey),
    envFallbackAvailable: Boolean(config.kimi.apiKey?.trim()),
    resolvedFrom: source,
  };
}

function toPublicRequirementConfig(cfg: RequirementSystemConfig): RequirementSystemConfigPublic {
  return {
    ...cfg,
    kimiCredentials: toPublicKimiCredentials(),
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

// 阶段 1 批 2：签名改 async；内部 await requireAuth（requireAuth 本身仍同步读 users.json，await 同步值不改变行为）。
async function requireAdmin(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
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

export async function listVersionCodeRules(req: Request, res: Response) {
  if (!(await requireAdmin(req, res))) return;

  const moduleKey = String(req.query.moduleKey || "").trim();
  const keyword = String(req.query.keyword || "").trim().toLowerCase();
  const status = String(req.query.status || "").trim();

  if (moduleKey && !isValidModuleKey(moduleKey)) {
    return fail(res, 40001, "参数错误", [{ field: "moduleKey", reason: "invalid_module_key" }]);
  }
  if (status && !isValidStatus(status)) {
    return fail(res, 40001, "参数错误", [{ field: "status", reason: "invalid_status" }]);
  }

  const store = await loadVersionCodeRulesStore();
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

export async function updateVersionCodeRuleConfig(req: Request, res: Response) {
  if (!(await requireAdmin(req, res))) return;

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
  const store = await loadVersionCodeRulesStore();
  const target = store.rules.find((item) => item.id === ruleId);
  if (!target) {
    return fail(res, 40401, "资源不存在", [{ field: "ruleId", reason: "not_found" }]);
  }

  target.prefix = prefix;
  target.format = format;
  target.status = target.status === "disabled" ? "draft" : target.status;
  target.updatedAt = now;
  target.sample = buildVersionCodeSample(target.format, target.prefix, target.moduleCode);
  await saveVersionCodeRulesStore(store);

  return res.json(ok({ item: sanitizeRule(target) }, randomUUID()));
}

export async function activateVersionCodeRule(req: Request, res: Response) {
  if (!(await requireAdmin(req, res))) return;

  const ruleId = String(req.params.ruleId || "").trim();
  if (!ruleId) return fail(res, 40001, "参数错误", [{ field: "ruleId", reason: "required" }]);

  const now = new Date().toISOString();
  const store = await loadVersionCodeRulesStore();
  const target = store.rules.find((item) => item.id === ruleId);
  if (!target) {
    return fail(res, 40401, "资源不存在", [{ field: "ruleId", reason: "not_found" }]);
  }

  target.status = "active";
  target.effectiveAt = now;
  target.updatedAt = now;
  target.sample = buildVersionCodeSample(target.format, target.prefix, target.moduleCode);
  await saveVersionCodeRulesStore(store);

  return res.json(ok({ item: sanitizeRule(target) }, randomUUID()));
}

export async function disableVersionCodeRule(req: Request, res: Response) {
  if (!(await requireAdmin(req, res))) return;

  const ruleId = String(req.params.ruleId || "").trim();
  if (!ruleId) return fail(res, 40001, "参数错误", [{ field: "ruleId", reason: "required" }]);

  const now = new Date().toISOString();
  const store = await loadVersionCodeRulesStore();
  const target = store.rules.find((item) => item.id === ruleId);
  if (!target) {
    return fail(res, 40401, "资源不存在", [{ field: "ruleId", reason: "not_found" }]);
  }

  target.status = "disabled";
  target.updatedAt = now;
  target.sample = buildVersionCodeSample(target.format, target.prefix, target.moduleCode);
  await saveVersionCodeRulesStore(store);

  return res.json(ok({ item: sanitizeRule(target) }, randomUUID()));
}

export async function getRequirementSystemConfig(req: Request, res: Response) {
  if (!(await requireAdmin(req, res))) return;
  const store = await loadRequirementSystemConfigStore();
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

export async function updateRequirementSystemConfigDraft(req: Request, res: Response) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const actor = auth.user.username;
  const payload = (req.body || {}) as Partial<RequirementSystemConfig> & {
    kimiCredentials?: { apiKey?: string | null };
  };
  const {
    kimiCredentials: credsPatch,
    kimiEvaluation: kimiEvaluationPatch,
    fileParsing: fileParsingPatch,
    kimiGeneration: kimiGenerationPatch,
    modelProviders: modelProvidersPatch,
    scenarioBindings: scenarioBindingsPatch,
  } = payload;
  const now = new Date().toISOString();
  const store = await loadRequirementSystemConfigStore();
  const nextCreds = mergeKimiCredentialsPatch(store.draft.kimiCredentials, credsPatch);

  // 密钥写入 DB（加密 + 审计）
  try {
    if (credsPatch?.apiKey === null) {
      await clearKimiApiKey(actor);
    } else if (typeof credsPatch?.apiKey === "string" && credsPatch.apiKey.trim()) {
      await persistKimiApiKey(credsPatch.apiKey.trim(), actor);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "credential_store_error";
    return fail(res, 50001, "密钥存储失败", [{ field: "apiKey", reason: msg }]);
  }

  store.draft = normalizeRequirementSystemConfig({
    ...store.draft,
    kimiEvaluation: { ...store.draft.kimiEvaluation, ...(kimiEvaluationPatch || {}) },
    fileParsing: { ...store.draft.fileParsing, ...(fileParsingPatch || {}) },
    kimiGeneration: { ...store.draft.kimiGeneration, ...(kimiGenerationPatch || {}) },
    kimiCredentials: nextCreds,
    // RP-055：供应商目录与场景绑定支持草稿 PATCH（未传则保留现值）
    ...(modelProvidersPatch !== undefined ? { modelProviders: modelProvidersPatch } : {}),
    ...(scenarioBindingsPatch !== undefined
      ? { scenarioBindings: scenarioBindingsPatch }
      : { scenarioBindings: syncBindingsWithLegacyPatch(store.draft, { kimiEvaluationPatch, fileParsingPatch, kimiGenerationPatch }) }),
  });
  store.updatedAt = now;
  await saveRequirementSystemConfigStore(store);
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

export async function activateRequirementSystemConfig(req: Request, res: Response) {
  if (!(await requireAdmin(req, res))) return;
  const now = new Date().toISOString();
  const store = await loadRequirementSystemConfigStore();
  store.active = normalizeRequirementSystemConfig(store.draft);
  store.version = Number(store.version || 1) + 1;
  store.effectiveAt = now;
  store.updatedAt = now;
  await saveRequirementSystemConfigStore(store);
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
  if (!(await requireAdmin(req, res))) return;
  const body = (req.body || {}) as { apiKey?: string; model?: string };
  const explicit = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const explicitModel = typeof body.model === "string" ? body.model.trim() : "";
  const { apiKey, source } = resolveDraftKimiApiKeyForTest(explicit || undefined);
  if (!apiKey) {
    return fail(res, 40001, "未配置可用的 API Key", [{ field: "apiKey", reason: "missing_in_store_and_env" }]);
  }
  const store = await loadRequirementSystemConfigStore();
  const model =
    explicitModel || store.draft.kimiEvaluation?.model?.trim() || config.kimi.model;
  try {
    const pingResult = await pingKimiChatCompletion({
      apiUrl: config.kimi.apiBaseUrl,
      apiKey,
      model,
    });
    const testedSource =
      source === "override" ? "request_body" : source === "draft" ? "draft_store" : "environment";
    const modelMatch = pingResult.respondedModel
      ? pingResult.respondedModel.toLowerCase() === model.toLowerCase()
      : null;
    return res.json(ok({
      ok: true,
      testedSource,
      requestedModel: model,
      respondedModel: pingResult.respondedModel || null,
      modelMatch,
      latencyMs: pingResult.latencyMs,
      httpStatus: pingResult.httpStatus,
    }, randomUUID()));
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
      if (e.kind === "timeout") {
        return fail(res, 50401, "连接测试超时：KIMI 服务长时间无响应，请检查网络或稍后重试", [
          { field: "apiKey", reason: e.message },
        ]);
      }
    }
    const msg = e instanceof Error ? e.message : "ping_failed";
    return fail(res, 40001, "调用 KIMI 失败", [{ field: "apiKey", reason: msg }]);
  }
}

// -------------------- T2：生效状态（Effective State） --------------------

async function buildCredentialsHealth(): Promise<CredentialsHealth> {
  const { apiKey, source } = resolveActiveRequirementKimiApiKey();
  const kekReady = resolveKek() !== null;
  let lastAudit: CredentialsHealth["lastAudit"] = null;
  try {
    const logs = await getAuditLog(KIMI_SCOPE, undefined, 1);
    const latest = logs[0];
    if (latest) {
      lastAudit = { action: String(latest.action), actor: String(latest.actor), at: String(latest.at) };
    }
  } catch {
    // DB 不可用时审计为空，不影响生效状态主信息
    lastAudit = null;
  }
  return { configured: Boolean(apiKey), source, kekReady, lastAudit };
}

/** GET /requirement-settings/effective：每场景生效模型/来源/接线参数 + 凭据健康（T2） + 供应商目录摘要（RP-055） */
export async function getRequirementSettingsEffective(req: Request, res: Response) {
  if (!(await requireAdmin(req, res))) return;
  const active = (await loadRequirementSystemConfigStore()).active;
  const credentials = await buildCredentialsHealth();
  const lastVerified = await loadModelVerifyStatus();
  const effective = buildEffectiveModelConfig(active, config.kimi.model, credentials, lastVerified, config.kimi.apiBaseUrl);
  return res.json(ok({ ...effective, providers: buildProvidersSummary(active) }, randomUUID()));
}

/** RP-055：供应商目录摘要（永不下发明文，hint 只留尾 4 位） */
function buildProvidersSummary(active: RequirementSystemConfig) {
  return (active.modelProviders || []).map((p) => {
    const scope = credentialScopeForProvider(p.id);
    const cached = getCachedApiKey(scope);
    const envAvailable = p.id === BUILTIN_MOONSHOT_PROVIDER_ID && Boolean(config.kimi.apiKey.trim());
    return {
      id: p.id,
      name: p.name,
      protocol: p.protocol,
      baseUrl: p.baseUrl,
      enabled: p.enabled,
      models: p.models.map((m) => m.id),
      credentialScope: scope,
      keyConfigured: Boolean(cached) || envAvailable,
      keySource: cached ? "store" : envAvailable ? "env" : "none",
      keyHint: cached ? maskKimiApiKeyHint(cached) : null,
    };
  });
}

const MODEL_SCENARIO_KEYS: ModelScenarioKey[] = ["assessment", "fileParsing", "generation"];

/**
 * RP-055：旧场景字段补丁联动同步场景绑定——仅当绑定仍指向内置供应商时跟随旧字段，
 * 已指向自定义供应商的绑定不受旧字段补丁影响（单一权威源 = 绑定）。
 */
function syncBindingsWithLegacyPatch(
  draft: RequirementSystemConfig,
  patches: {
    kimiEvaluationPatch?: Partial<RequirementSystemConfig["kimiEvaluation"]>;
    fileParsingPatch?: Partial<RequirementSystemConfig["fileParsing"]>;
    kimiGenerationPatch?: Partial<RequirementSystemConfig["kimiGeneration"]>;
  },
): RequirementSystemConfig["scenarioBindings"] {
  const current = draft.scenarioBindings;
  if (!current) return current;
  const follow = (
    scenario: ModelScenarioKey,
    patchModel: string | undefined,
  ) => {
    const binding = current[scenario];
    if (patchModel === undefined) return binding;
    if (binding.providerId !== BUILTIN_MOONSHOT_PROVIDER_ID) return binding;
    return { providerId: binding.providerId, modelId: String(patchModel || "").trim() };
  };
  return {
    assessment: follow("assessment", patches.kimiEvaluationPatch?.model),
    fileParsing: follow("fileParsing", patches.fileParsingPatch?.model),
    generation: follow("generation", patches.kimiGenerationPatch?.model),
  };
}

/** RP-055：按凭据 scope 解析测试密钥：显式传入 → scope 缓存 →（仅内置 kimi scope）env 兜底 */
function resolveScenarioApiKeyForTest(
  scope: string,
  override?: string,
): { apiKey: string; source: "override" | "store" | "env" | "none" } {
  const o = override?.trim() || "";
  if (o) return { apiKey: o, source: "override" };
  const cached = getCachedApiKey(scope);
  if (cached) return { apiKey: cached, source: "store" };
  if (scope === KIMI_SCOPE) {
    const env = config.kimi.apiKey.trim();
    if (env) return { apiKey: env, source: "env" };
  }
  return { apiKey: "", source: "none" };
}

// -------------------- T4：验证此场景（用生效模型发最小真实请求） --------------------

/** POST /requirement-settings/scenario-test { scenario, apiKey? }（RP-055：走场景绑定解析供应商/模型/凭据 scope） */
export async function testScenarioModel(req: Request, res: Response) {
  if (!(await requireAdmin(req, res))) return;
  const body = (req.body || {}) as { scenario?: string; apiKey?: string };
  const scenario = String(body.scenario || "").trim() as ModelScenarioKey;
  if (!MODEL_SCENARIO_KEYS.includes(scenario)) {
    return fail(res, 40001, "参数错误", [{ field: "scenario", reason: "unknown_scenario" }]);
  }
  if (scenario === "generation") {
    return fail(res, 40001, "该场景尚未接入业务链路（规划中），暂不支持验证", [
      { field: "scenario", reason: "scenario_not_wired" },
    ]);
  }

  const active = (await loadRequirementSystemConfigStore()).active;
  const resolution = resolveScenarioConfig(active, scenario, {
    model: config.kimi.model,
    baseUrl: config.kimi.apiBaseUrl,
  });
  const explicit = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const { apiKey, source } = resolveScenarioApiKeyForTest(resolution.credentialScope, explicit || undefined);
  if (!apiKey) {
    return fail(res, 40001, "未配置可用的 API Key", [{ field: "apiKey", reason: "missing_in_store_and_env" }]);
  }

  const startedAt = Date.now();
  /** 阶段 1 批 7：因 saveScenarioVerifyRecord 异步化级联改 async，实现不动。 */
  const recordFailure = async (reason: string) => {
    await saveScenarioVerifyRecord(scenario, {
      at: new Date().toISOString(),
      ok: false,
      model: resolution.model,
      elapsedMs: Date.now() - startedAt,
      reason,
    });
  };

  try {
    const pingResult = await pingKimiChatCompletion({
      apiUrl: resolution.baseUrl,
      apiKey,
      model: resolution.model,
    });
    const respondedModel = pingResult.respondedModel || null;
    await saveScenarioVerifyRecord(scenario, {
      at: new Date().toISOString(),
      ok: true,
      model: respondedModel || resolution.model,
      elapsedMs: pingResult.latencyMs,
    });
    const modelMatch = respondedModel
      ? respondedModel.toLowerCase() === resolution.model.toLowerCase()
      : null;
    return res.json(ok({
      ok: true,
      scenario,
      resolvedModel: resolution.model,
      modelSource: resolution.modelSource,
      providerId: resolution.providerId,
      providerName: resolution.providerName,
      baseUrl: resolution.baseUrl,
      keySource: source === "override" ? "request_body" : source === "store" ? "credential_store" : "environment",
      respondedModel,
      modelMatch,
      latencyMs: pingResult.latencyMs,
      httpStatus: pingResult.httpStatus,
    }, randomUUID()));
  } catch (e) {
    if (e instanceof KimiPingFailure) {
      await recordFailure(e.kind);
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
      if (e.kind === "timeout") {
        return fail(res, 50401, "连接测试超时：KIMI 服务长时间无响应，请检查网络或稍后重试", [
          { field: "apiKey", reason: e.message },
        ]);
      }
    }
    await recordFailure("unknown");
    const msg = e instanceof Error ? e.message : "ping_failed";
    return fail(res, 40001, "调用 KIMI 失败", [{ field: "apiKey", reason: msg }]);
  }
}

// -------------------- RP-055：供应商级 API Key 管理（凭据域多 scope） --------------------

/** 在 draft/active 目录中查找供应商；找不到返回 null 并已响应 404。阶段 1 批 5：因内部调用 loadRequirementSystemConfigStore（已异步化）级联改 async，实现不动。 */
async function findProviderOr404(res: Response, providerIdRaw: string) {
  const providerId = String(providerIdRaw || "").trim().toLowerCase();
  const store = await loadRequirementSystemConfigStore();
  const provider =
    (store.draft.modelProviders || []).find((p) => p.id === providerId) ||
    (store.active.modelProviders || []).find((p) => p.id === providerId);
  if (!provider) {
    fail(res, 40401, "供应商不存在", [{ field: "providerId", reason: "not_found" }]);
    return null;
  }
  return { providerId, provider };
}

/** PUT /requirement-settings/providers/:providerId/api-key { apiKey }：写入该供应商密钥（加密落库 + 审计） */
export async function setProviderApiKey(req: Request, res: Response) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const found = await findProviderOr404(res, String(req.params.providerId || ""));
  if (!found) return;
  const apiKey = String((req.body || {}).apiKey || "").trim();
  if (!apiKey) {
    return fail(res, 40001, "apiKey 不能为空", [{ field: "apiKey", reason: "required" }]);
  }
  const scope = credentialScopeForProvider(found.providerId);
  try {
    await dbSetProviderApiKey(scope, apiKey, auth.user.username);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "credential_store_error";
    return fail(res, 50001, "密钥存储失败", [{ field: "apiKey", reason: msg }]);
  }
  return res.json(ok({
    providerId: found.providerId,
    credentialScope: scope,
    keyHint: maskKimiApiKeyHint(apiKey),
  }, randomUUID()));
}

/** DELETE /requirement-settings/providers/:providerId/api-key：清除该供应商密钥（DB + 审计） */
export async function clearProviderApiKey(req: Request, res: Response) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const found = await findProviderOr404(res, String(req.params.providerId || ""));
  if (!found) return;
  const scope = credentialScopeForProvider(found.providerId);
  try {
    await dbClearProviderApiKey(scope, auth.user.username);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "credential_store_error";
    return fail(res, 50001, "密钥清除失败", [{ field: "apiKey", reason: msg }]);
  }
  return res.json(ok({ providerId: found.providerId, credentialScope: scope, cleared: true }, randomUUID()));
}

/** POST /requirement-settings/providers/:providerId/api-key/test { apiKey?, model? }：用该供应商 baseUrl 发最小真实请求 */
export async function testProviderApiKey(req: Request, res: Response) {
  if (!(await requireAdmin(req, res))) return;
  const found = await findProviderOr404(res, String(req.params.providerId || ""));
  if (!found) return;
  const body = (req.body || {}) as { apiKey?: string; model?: string };
  const explicit = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const scope = credentialScopeForProvider(found.providerId);
  const { apiKey, source } = resolveScenarioApiKeyForTest(scope, explicit || undefined);
  if (!apiKey) {
    return fail(res, 40001, "未配置可用的 API Key", [{ field: "apiKey", reason: "missing_in_store_and_env" }]);
  }
  const explicitModel = typeof body.model === "string" ? body.model.trim() : "";
  const model = explicitModel || found.provider.models[0]?.id || "";
  if (!model) {
    return fail(res, 40001, "该供应商目录下暂无模型，请先添加模型后再测试", [{ field: "model", reason: "no_model_in_catalog" }]);
  }
  try {
    const pingResult = await pingKimiChatCompletion({
      apiUrl: found.provider.baseUrl,
      apiKey,
      model,
    });
    const respondedModel = pingResult.respondedModel || null;
    const modelMatch = respondedModel
      ? respondedModel.toLowerCase() === model.toLowerCase()
      : null;
    return res.json(ok({
      ok: true,
      providerId: found.providerId,
      baseUrl: found.provider.baseUrl,
      requestedModel: model,
      respondedModel,
      modelMatch,
      keySource: source === "override" ? "request_body" : source === "store" ? "credential_store" : "environment",
      latencyMs: pingResult.latencyMs,
      httpStatus: pingResult.httpStatus,
    }, randomUUID()));
  } catch (e) {
    if (e instanceof KimiPingFailure) {
      if (e.kind === "overload") {
        return fail(res, 50301, "供应商服务繁忙，请稍后重试（多由官方引擎限流/过载引起，不代表 API Key 一定错误）", [
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
      if (e.kind === "timeout") {
        return fail(res, 50401, "连接测试超时：供应商服务长时间无响应，请检查网络或稍后重试", [
          { field: "apiKey", reason: e.message },
        ]);
      }
    }
    const msg = e instanceof Error ? e.message : "ping_failed";
    return fail(res, 40001, "调用供应商接口失败", [{ field: "apiKey", reason: msg }]);
  }
}

export async function getImplementationDependencyRules(req: Request, res: Response) {
  if (!(await requireAdmin(req, res))) return;
  const store = await loadImplementationDependencyRulesStore();
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

export async function updateImplementationDependencyRulesDraft(req: Request, res: Response) {
  if (!(await requireAdmin(req, res))) return;
  const payload = (req.body || {}) as Partial<ImplementationDependencyRulesConfig>;
  const now = new Date().toISOString();
  const store = await loadImplementationDependencyRulesStore();
  store.draft = normalizeImplementationDependencyRulesConfig({
    ...store.draft,
    ...payload,
  });
  store.updatedAt = now;
  await saveImplementationDependencyRulesStore(store);
  return res.json(ok({ version: store.version, draft: store.draft, updatedAt: store.updatedAt }, randomUUID()));
}

export async function activateImplementationDependencyRules(req: Request, res: Response) {
  if (!(await requireAdmin(req, res))) return;
  const now = new Date().toISOString();
  const store = await loadImplementationDependencyRulesStore();
  store.active = normalizeImplementationDependencyRulesConfig(store.draft);
  store.version = Number(store.version || 1) + 1;
  store.effectiveAt = now;
  store.updatedAt = now;
  await saveImplementationDependencyRulesStore(store);
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
  const activeProfile = store.active.knowledgeBases.find((profile) => profile.enabled && profile.isDefault)
    || store.active.knowledgeBases.find((profile) => profile.enabled);
  const trimmedKid = activeProfile?.knowledgeId.trim() || store.active.credentials.knowledgeId.trim();
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
    retrievalParams: store.active.retrievalParams,
    promptProfile: store.active.promptProfile,
    knowledgeBases: store.active.knowledgeBases,
    credentials: toPublicKnowledgeBaseCredentials(store),
  };
}

export async function getKnowledgeBaseConfig(req: Request, res: Response) {
  if (!(await requireAdmin(req, res))) return;
  const store = await loadKnowledgeBaseConfigStore();
  return res.json(
    ok(
      {
        version: store.version,
        draft: {
          model: store.draft.model,
          apiBaseUrl: store.draft.apiBaseUrl,
          retrievalParams: store.draft.retrievalParams,
          promptProfile: store.draft.promptProfile,
          knowledgeBases: store.draft.knowledgeBases,
          credentials: {
            apiKey: "",
            apiHint: maskKnowledgeBaseApiKeyHint(store.draft.credentials.apiKey),
            knowledgeId: store.draft.credentials.knowledgeId,
          },
        },
        active: toPublicKnowledgeBaseConfig(store),
        probe: store.probe,
        probes: store.probes || {},
        updatedAt: store.updatedAt,
        effectiveAt: store.effectiveAt,
      },
      responseRequestId(res),
    ),
  );
}

export async function updateKnowledgeBaseConfigDraft(req: Request, res: Response) {
  if (!(await requireAdmin(req, res))) return;
  const payload = (req.body || {}) as {
    model?: string;
    apiBaseUrl?: string;
    credentials?: { apiKey?: string | null; knowledgeId?: string | null };
    retrievalParams?: Record<string, unknown>;
    promptProfile?: Record<string, unknown>;
    knowledgeBases?: unknown[];
  };
  const now = new Date().toISOString();
  const store = await loadKnowledgeBaseConfigStore();
  const nextCreds = mergeKnowledgeBaseCredentialsPatch(store.draft.credentials, payload.credentials);
  const nextDraft = normalizeKnowledgeBaseConfig({
    ...store.draft,
    model: payload.model ?? store.draft.model,
    apiBaseUrl: payload.apiBaseUrl ?? store.draft.apiBaseUrl,
    credentials: nextCreds,
    retrievalParams: payload.retrievalParams ?? store.draft.retrievalParams,
    promptProfile: payload.promptProfile ?? store.draft.promptProfile,
    knowledgeBases: payload.knowledgeBases
      ?? (store.draft.knowledgeBases.length ? store.draft.knowledgeBases : undefined),
  });
  const validationIssues = validateKnowledgeBaseProfiles(nextDraft.knowledgeBases);
  if (validationIssues.length) {
    return fail(res, 40001, "知识库档案配置无效", validationIssues);
  }
  store.draft = nextDraft;
  store.updatedAt = now;
  await saveKnowledgeBaseConfigStore(store);
  return res.json(
    ok(
      {
        version: store.version,
        draft: {
          model: store.draft.model,
          apiBaseUrl: store.draft.apiBaseUrl,
          retrievalParams: store.draft.retrievalParams,
          promptProfile: store.draft.promptProfile,
          knowledgeBases: store.draft.knowledgeBases,
          credentials: {
            apiKey: "",
            apiHint: maskKnowledgeBaseApiKeyHint(store.draft.credentials.apiKey),
            knowledgeId: store.draft.credentials.knowledgeId,
          },
        },
        updatedAt: store.updatedAt,
      },
      responseRequestId(res),
    ),
  );
}

export async function activateKnowledgeBaseConfig(req: Request, res: Response) {
  if (!(await requireAdmin(req, res))) return;
  const now = new Date().toISOString();
  const store = await loadKnowledgeBaseConfigStore();
  const validationIssues = validateKnowledgeBaseProfiles(store.draft.knowledgeBases);
  if (validationIssues.length) {
    return fail(res, 40001, "知识库档案配置无效", validationIssues);
  }
  const enabledProfiles = store.draft.knowledgeBases.filter((profile) => profile.enabled);
  if (!enabledProfiles.length) {
    return fail(res, 40001, "至少需要启用一个知识库档案", [
      { field: "knowledgeBases", reason: "no_enabled_profile" },
    ]);
  }
  const effectiveDraft = await resolveDraftKnowledgeBaseConfigForTest();
  const effectiveConfig = normalizeKnowledgeBaseConfig({
    ...store.draft,
    credentials: { apiKey: effectiveDraft.apiKey, knowledgeId: "" },
    knowledgeBases: store.draft.knowledgeBases,
  });
  const probeIssues = enabledProfiles.flatMap((profile) => {
    const isLegacySingle = enabledProfiles.length === 1 && profile.id === "legacy-default";
    const probe = isLegacySingle ? store.probe || store.probes?.[profile.id] : store.probes?.[profile.id];
    const expectedHash = computeKnowledgeBaseProfileHash(effectiveConfig, profile);
    const probeAgeMs = probe
      ? Date.now() - Date.parse(probe.checkedAt)
      : Number.POSITIVE_INFINITY;
    const reason = !probe
      ? "probe_missing"
      : probe.status !== "success"
        ? "probe_failed"
        : probe.configHash !== expectedHash
          ? "config_changed_after_probe"
          : probeAgeMs < 0 || probeAgeMs > 24 * 60 * 60 * 1000
            ? "probe_expired"
            : "";
    return reason ? [{
      field: enabledProfiles.length === 1 && profile.id === "legacy-default"
        ? "probe"
        : `knowledgeBases.${profile.id}.probe`,
      reason,
      ...(enabledProfiles.length > 1 ? { profileId: profile.id } : {}),
    }] : [];
  });
  if (probeIssues.length) {
    return fail(res, 40901, "知识库配置尚未通过有效连通性验证", probeIssues);
  }
  store.active = normalizeKnowledgeBaseConfig(store.draft);
  store.version = Number(store.version || 1) + 1;
  store.effectiveAt = now;
  store.updatedAt = now;
  await saveKnowledgeBaseConfigStore(store);
  return res.json(
    ok(
      {
        version: store.version,
        active: toPublicKnowledgeBaseConfig(store),
        effectiveAt: store.effectiveAt,
      },
      responseRequestId(res),
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

export async function getRoleCapabilitiesMatrix(req: Request, res: Response) {
  if (!(await requireAdmin(req, res))) return;

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

export async function testKnowledgeBaseConnectivityWithFetcher(
  req: Request,
  res: Response,
  fetcher: typeof fetch = globalThis.fetch,
) {
  if (!(await requireAdmin(req, res))) return;
  const body = (req.body || {}) as { apiKey?: string; knowledgeId?: string; profileId?: string };
  const explicitApiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const explicitKnowledgeId = typeof body.knowledgeId === "string" ? body.knowledgeId.trim() : "";
  const profileId = typeof body.profileId === "string" ? body.profileId.trim() : "";
  const store = await loadKnowledgeBaseConfigStore();
  const selectedProfile = profileId
    ? store.draft.knowledgeBases.find((profile) => profile.id === profileId)
    : store.draft.knowledgeBases.find((profile) => profile.enabled && profile.isDefault)
      || store.draft.knowledgeBases.find((profile) => profile.enabled);
  if (profileId && !selectedProfile) {
    return fail(res, 40401, "知识库档案不存在", [
      { field: "profileId", reason: "profile_not_found" },
    ]);
  }
  const { apiKey, knowledgeId, model, apiBaseUrl, retrievalParams, promptProfile, source } = await resolveDraftKnowledgeBaseConfigForTest(
    explicitApiKey || undefined,
    explicitKnowledgeId || selectedProfile?.knowledgeId || undefined,
    selectedProfile?.id,
  );
  if (!apiKey || !knowledgeId) {
    return fail(res, 40001, "未配置可用的 API Key 或知识库 ID", [
      { field: "credentials", reason: "missing_in_store_and_env" },
    ]);
  }
  const candidate = normalizeKnowledgeBaseConfig({
    model,
    apiBaseUrl,
    credentials: { apiKey, knowledgeId },
    retrievalParams,
    promptProfile,
    knowledgeBases: selectedProfile ? [selectedProfile] : undefined,
  });
  const result = await probeKnowledgeBaseAccess(candidate, responseRequestId(res), fetcher);
  const resolvedProfile = selectedProfile || candidate.knowledgeBases[0];
  const probeRecord = {
    ...result,
    ...(resolvedProfile ? { profileId: resolvedProfile.id } : {}),
    configHash: resolvedProfile
      ? computeKnowledgeBaseProfileHash(candidate, resolvedProfile)
      : computeKnowledgeBaseConfigHash(candidate),
    checkedAt: new Date().toISOString(),
  };
  if (resolvedProfile) {
    store.probes = { ...(store.probes || {}), [resolvedProfile.id]: probeRecord };
  }
  if (!resolvedProfile || (store.draft.knowledgeBases.length === 1 && resolvedProfile.id === "legacy-default")) {
    store.probe = probeRecord;
  }
  store.updatedAt = probeRecord.checkedAt;
  await saveKnowledgeBaseConfigStore(store);

  const testedSource =
    source === "override" ? "request_body" : source === "draft" ? "draft_store" : "environment";
  if (result.status === "success") {
    return res.json(ok({
      ok: true,
      testedSource,
      model,
      knowledgeId,
      ...(resolvedProfile ? { profileId: resolvedProfile.id } : {}),
      latencyMs: result.latencyMs,
      retrievalTriggered: result.warning !== "retrieval_empty",
      ...(result.warning ? { warning: result.warning } : {}),
      ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}),
    }, responseRequestId(res)));
  }
  // DEF-2026-09-02-001：失败详情透传供应商原始 code/msg（仅业务拒绝分支有值），
  // 前端据此显示人话原因；msg 已在 probe 侧截断 200 字符。
  return fail(res, 40001, "知识库连通性测试未通过", [
    {
      field: "knowledgeBase",
      reason: result.errorCode || "test_failed",
      ...(result.providerCode !== undefined ? { providerCode: result.providerCode } : {}),
      ...(result.providerMessage ? { providerMessage: result.providerMessage } : {}),
    },
  ]);
}

export async function testKnowledgeBaseConnectivity(req: Request, res: Response) {
  return testKnowledgeBaseConnectivityWithFetcher(req, res);
}
