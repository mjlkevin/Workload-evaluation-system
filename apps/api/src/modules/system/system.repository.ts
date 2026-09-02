import { createHash } from "node:crypto";

import {
  BusinessRole,
  ImplementationDependencyRuleItem,
  ImplementationDependencyRulesConfig,
  ImplementationDependencyRulesStore,
  KnowledgeBaseConfig,
  KnowledgeBaseConfigStore,
  KnowledgeBaseCredentialsConfig,
  KnowledgeBaseProfile,
  KnowledgeBaseProbeRecord,
  KnowledgeRetrievalParams,
  KnowledgePromptProfile,
  RequirementKimiCredentialsConfig,
  RequirementSystemConfig,
  RequirementSystemConfigStore,
  VersionCodeRule,
  VersionCodeRulesStore,
} from "../../types";
import { config } from "../../config/env";
import { applyVersionCodeFormat } from "../../utils/version-code-format";
// S3（2026-08-30）：四个 *StorePath 导入随 JSON 读写路径删除。注意
// config/system/{requirement-settings,implementation-dependency-rules,knowledge-base-config}.json
// 与 config/versions/version-code-rules.json 仍是 db/seed.ts 的播种来源（阶段 2
// D17「零数据迁移」口径），文件保留，只是运行时不再读写。
// setCachedApiKey / importApiKeyIfAbsent 同批摘除：前者仅被两个 *Json 函数调用
// （PG 路径在 system-pg.repository.ts 内自行填充凭据缓存）；后者是「文件密钥
// 一次性导入 DB」补偿链的唯一调用点，该补偿链随 JSON 读路径一并下线——PG 早已
// 是权威源，且 2026-08-29 实测文件与 PG 密钥非同值，项目侧已裁决「密钥重新
// 配置，不做保全」。
import {
  KIMI_SCOPE,
  getCachedApiKey,
  setApiKey as dbSetApiKey,
  clearApiKey as dbClearApiKey,
} from "./credentials.store";
import { normalizeModelProviders, normalizeScenarioBindings } from "./model-providers";
import { createSystemPgRepository, type SystemStoreRepository } from "./system-pg.repository";

const EMPTY_TIME = "--";
const DEFAULT_KIMI_EVALUATION_MODEL = "kimi-k2.5";
const DEFAULT_KIMI_FILE_PARSING_MODEL = "kimi-k2.6";
const DEFAULT_KIMI_GENERATION_MODEL = "kimi-k2.5";

/** 与生成真实版本号同一套占位符，固定参考时间便于示例列展示 */
function buildSample(format: string, prefix: string, moduleCode: string): string {
  return applyVersionCodeFormat(format, {
    prefix,
    moduleCode,
    globalCode: "GL001",
    seq: 1,
    now: new Date("2026-04-06T08:00:00.000Z"),
  });
}

function createDefaultRules(): VersionCodeRule[] {
  const now = new Date().toISOString();
  const defaultRules: Array<Omit<VersionCodeRule, "sample" | "updatedAt">> = [
    {
      id: "rule-global",
      moduleKey: "global",
      moduleName: "总方案",
      moduleCode: "GL",
      prefix: "GL",
      format: "{PREFIX}-{YYYYMMDD}-{NNN}",
      status: "active",
      effectiveAt: now,
    },
    {
      id: "rule-requirement",
      moduleKey: "requirement",
      moduleName: "需求",
      moduleCode: "RQ",
      prefix: "RQ",
      format: "{PREFIX}-{GL}-{NN}",
      status: "active",
      effectiveAt: now,
    },
    {
      id: "rule-implementation",
      moduleKey: "implementation",
      moduleName: "实施评估",
      moduleCode: "IA",
      prefix: "IA",
      format: "{PREFIX}-{GL}-{NN}",
      status: "draft",
      effectiveAt: EMPTY_TIME,
    },
    {
      id: "rule-dev",
      moduleKey: "dev",
      moduleName: "开发评估",
      moduleCode: "DV",
      prefix: "DV",
      format: "{PREFIX}-{YYYY}-{NNN}",
      status: "disabled",
      effectiveAt: EMPTY_TIME,
    },
    {
      id: "rule-resource",
      moduleKey: "resource",
      moduleName: "资源人天及成本",
      moduleCode: "RS",
      prefix: "RS",
      format: "{PREFIX}-{YYYYMM}-{NNN}",
      status: "active",
      effectiveAt: now,
    },
    {
      id: "rule-wbs",
      moduleKey: "wbs",
      moduleName: "WBS",
      moduleCode: "WBS",
      prefix: "WBS",
      format: "{PREFIX}-{YYYYMM}-{NNN}",
      status: "draft",
      effectiveAt: EMPTY_TIME,
    },
  ];
  return defaultRules.map((item) => ({
    ...item,
    sample: buildSample(item.format, item.prefix, item.moduleCode),
    updatedAt: now,
  }));
}

function normalizeStore(input: unknown): VersionCodeRulesStore {
  const now = new Date().toISOString();
  const data = input as Partial<VersionCodeRulesStore>;
  if (!data || !Array.isArray(data.rules)) {
    return { rules: createDefaultRules() };
  }
  const normalized = data.rules
    .filter((item): item is VersionCodeRule => Boolean(item && typeof item.id === "string"))
    .map((item) => ({
      ...item,
      sample: buildSample(item.format, item.prefix, item.moduleCode),
      updatedAt: item.updatedAt || now,
      effectiveAt: item.effectiveAt || EMPTY_TIME,
    }));
  if (!normalized.length) return { rules: createDefaultRules() };
  return { rules: normalized };
}

export function buildVersionCodeSample(format: string, prefix: string, moduleCode: string): string {
  return buildSample(format, prefix, moduleCode);
}

function createDefaultRequirementConfig(): RequirementSystemConfig {
  return {
    kimiEvaluation: {
      enabled: true,
      model: DEFAULT_KIMI_EVALUATION_MODEL,
      temperature: 0.3,
      maxTokens: 4000,
      timeoutMs: 120000,
      fallbackToRule: true,
      promptProfile: "default",
      promptTemplate:
        "你是资深项目经理 + 资深实施顾问。你不是做简单 SKU 对照，而是要基于需求全量信息做综合实施评估。必须只返回 JSON。字段固定：assessmentDraft.quoteMode/productLines/userCount/orgCount/orgSimilarity/difficultyFactor/moduleItems/risks/assumptions。moduleItems 每项字段：cloudProduct/skuName/moduleName/standardDays/suggestedDays/reason。所有数值字段必须为非负数，orgSimilarity 和 difficultyFactor 范围 0-1。评估时必须综合：basicInfo（行业、规模、上线目标）、businessNeedRows（业务复杂度）、devOverviewRows（开发基线）、implementationScopeRows（组织范围与地域）、meetingNotes（隐性约束）、keyPointRows（重点风险）。reason 必须体现增加/减少人天的业务原因与实施原因，不能仅写“按模板匹配”。禁止把产品名/版本名/平台名（如金蝶AI星空、旗舰版）直接当成 SKU，必须下钻到可实施功能项。财务云、供应链云等是实施域级云产品，不得填入 skuName 并挂在金蝶AI星空下冒充 SKU；域级人天归 cloudProduct=该域名，skuName 仅写子模块。若信息不足，给出审慎估算并在 risks/assumptions 明确不确定性来源。严禁仅凭业务需求正文中出现与 SKU 同名的词、或「总账、报表、出纳」类标准功能并列枚举，就认定 suggestedDays 必须高于 standardDays；须结合该条需求完整语义与实施顾问角色做专业判断，只有存在相对标准产品交付的明确增量（如二开、深度集成、多组织推广、性能/迁移、额外培训与方案等）时才上调，并在 reason 中写清增量内容而非复述关键词。",
    },
    fileParsing: {
      enabled: true,
      model: DEFAULT_KIMI_FILE_PARSING_MODEL,
      allowedExtensions: [".xlsx", ".xls", ".csv"],
      maxFileSizeMb: 20,
      maxSheetCount: 20,
      strictMode: false,
      ocrEnabled: false,
    },
    kimiGeneration: {
      enabled: true,
      model: DEFAULT_KIMI_GENERATION_MODEL,
      temperature: 0.5,
      maxTokens: 6000,
      outputStyle: "balanced",
      includeRiskHints: true,
      includeAssumptions: true,
    },
    kimiCredentials: {
      apiKey: "",
    },
  };
}

function normalizeStringArray(input: unknown, fallback: string[]): string[] {
  if (!Array.isArray(input)) return fallback;
  const values = input
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((item) => item.length > 0)
    .map((item) => (item.startsWith(".") ? item : `.${item}`));
  return values.length ? Array.from(new Set(values)) : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function normalizeRequirementConfig(input: unknown): RequirementSystemConfig {
  const base = createDefaultRequirementConfig();
  const source = (input || {}) as Partial<RequirementSystemConfig>;

  const kimiEvaluation = (source.kimiEvaluation || {}) as Partial<RequirementSystemConfig["kimiEvaluation"]>;
  const fileParsing = (source.fileParsing || {}) as Partial<RequirementSystemConfig["fileParsing"]>;
  const kimiGeneration = (source.kimiGeneration || {}) as Partial<RequirementSystemConfig["kimiGeneration"]>;
  const kimiCredentials = (source.kimiCredentials || {}) as Partial<RequirementKimiCredentialsConfig>;

  return {
    kimiEvaluation: {
      enabled: Boolean(kimiEvaluation.enabled ?? base.kimiEvaluation.enabled),
      model: normalizeKimiConfiguredModel(kimiEvaluation.model, base.kimiEvaluation.model),
      temperature: clampNumber(kimiEvaluation.temperature, 0, 1, base.kimiEvaluation.temperature),
      maxTokens: clampNumber(kimiEvaluation.maxTokens, 256, 32000, base.kimiEvaluation.maxTokens),
      timeoutMs: clampNumber(kimiEvaluation.timeoutMs, 3000, 120000, base.kimiEvaluation.timeoutMs),
      fallbackToRule: Boolean(kimiEvaluation.fallbackToRule ?? base.kimiEvaluation.fallbackToRule),
      promptProfile: String(kimiEvaluation.promptProfile || base.kimiEvaluation.promptProfile).trim(),
      promptTemplate: String(kimiEvaluation.promptTemplate || base.kimiEvaluation.promptTemplate).trim(),
    },
    fileParsing: {
      enabled: Boolean(fileParsing.enabled ?? base.fileParsing.enabled),
      model: normalizeKimiConfiguredModel(fileParsing.model, base.fileParsing.model),
      allowedExtensions: normalizeStringArray(fileParsing.allowedExtensions, base.fileParsing.allowedExtensions),
      maxFileSizeMb: clampNumber(fileParsing.maxFileSizeMb, 1, 200, base.fileParsing.maxFileSizeMb),
      maxSheetCount: clampNumber(fileParsing.maxSheetCount, 1, 200, base.fileParsing.maxSheetCount),
      strictMode: Boolean(fileParsing.strictMode ?? base.fileParsing.strictMode),
      ocrEnabled: Boolean(fileParsing.ocrEnabled ?? base.fileParsing.ocrEnabled),
    },
    kimiGeneration: {
      enabled: Boolean(kimiGeneration.enabled ?? base.kimiGeneration.enabled),
      model: normalizeKimiConfiguredModel(kimiGeneration.model, base.kimiGeneration.model),
      temperature: clampNumber(kimiGeneration.temperature, 0, 1, base.kimiGeneration.temperature),
      maxTokens: clampNumber(kimiGeneration.maxTokens, 256, 32000, base.kimiGeneration.maxTokens),
      outputStyle: ["concise", "balanced", "detailed"].includes(String(kimiGeneration.outputStyle))
        ? (kimiGeneration.outputStyle as RequirementSystemConfig["kimiGeneration"]["outputStyle"])
        : base.kimiGeneration.outputStyle,
      includeRiskHints: Boolean(kimiGeneration.includeRiskHints ?? base.kimiGeneration.includeRiskHints),
      includeAssumptions: Boolean(kimiGeneration.includeAssumptions ?? base.kimiGeneration.includeAssumptions),
    },
    kimiCredentials: {
      apiKey: String(kimiCredentials.apiKey ?? base.kimiCredentials.apiKey ?? "").trim(),
    },
    // RP-055：多供应商目录 + 场景绑定（旧配置自动迁移：合成内置 moonshot 供应商 + 从 kimi* 字段推导绑定）
    ...buildProviderAndBindingFields(source, {
      assessmentModel: normalizeKimiConfiguredModel(kimiEvaluation.model, base.kimiEvaluation.model),
      fileParsingModel: normalizeKimiConfiguredModel(fileParsing.model, base.fileParsing.model),
      generationModel: normalizeKimiConfiguredModel(kimiGeneration.model, base.kimiGeneration.model),
    }),
  };
}

/** RP-055：归一化供应商目录与场景绑定；seed 模型 ID 取三场景旧字段（迁移收集用） */
function buildProviderAndBindingFields(
  source: Partial<RequirementSystemConfig>,
  legacyModels: { assessmentModel: string; fileParsingModel: string; generationModel: string },
): Pick<RequirementSystemConfig, "modelProviders" | "scenarioBindings"> {
  const legacyIds = [legacyModels.assessmentModel, legacyModels.fileParsingModel, legacyModels.generationModel].filter(
    (m) => m && m.trim(),
  );
  const modelProviders = normalizeModelProviders(source.modelProviders, {
    baseUrl: config.kimi.apiBaseUrl,
    modelIds: legacyIds,
  });
  const scenarioBindings = normalizeScenarioBindings(source.scenarioBindings, legacyModels, modelProviders);
  return { modelProviders, scenarioBindings };
}

function normalizeKimiConfiguredModel(value: unknown, fallback: string): string {
  const model = String(value || fallback).trim();
  if (!model) return fallback;
  const id = model.toLowerCase();
  if (id === "kimi-k2-turbo-preview") return fallback;
  if (id.startsWith("moonshot-v1-")) return fallback;
  return model;
}

function normalizeRequirementStore(input: unknown): RequirementSystemConfigStore {
  const data = (input || {}) as Partial<RequirementSystemConfigStore>;
  const now = new Date().toISOString();
  const draft = normalizeRequirementConfig(data.draft);
  const active = normalizeRequirementConfig(data.active || data.draft);
  return {
    version: Number.isFinite(Number(data.version)) ? Math.max(1, Number(data.version)) : 1,
    draft,
    active,
    updatedAt: String(data.updatedAt || now),
    effectiveAt: String(data.effectiveAt || now),
  };
}

export function normalizeRequirementSystemConfig(input: unknown): RequirementSystemConfig {
  return normalizeRequirementConfig(input);
}

/** 合并 PATCH：null 表示清除仓库密钥；空字符串表示不修改；非空则写入 */
export function mergeKimiCredentialsPatch(
  prev: RequirementKimiCredentialsConfig,
  incoming: Partial<{ apiKey: string | null }> | undefined,
): RequirementKimiCredentialsConfig {
  if (!incoming) return prev;
  if (incoming.apiKey === null) return { apiKey: "" };
  if (typeof incoming.apiKey === "string") {
    const t = incoming.apiKey.trim();
    if (!t) return prev;
    return { apiKey: t };
  }
  return prev;
}

/** 需求侧 KIMI 实际调用：DB 缓存优先，否则环境变量 */
export function resolveActiveRequirementKimiApiKey(): {
  apiKey: string;
  source: "store" | "env" | "none";
} {
  return resolveActiveApiKeyForScope(KIMI_SCOPE);
}

/** RP-055：按凭据 scope 的同步取密钥（业务链路用）：缓存优先，仅内置 kimi scope 回落 env */
export function resolveActiveApiKeyForScope(scope: string): {
  apiKey: string;
  source: "store" | "env" | "none";
} {
  const fromCache = getCachedApiKey(scope);
  if (fromCache) return { apiKey: fromCache, source: "store" };
  if (scope === KIMI_SCOPE) {
    const env = config.kimi.apiKey.trim();
    if (env) return { apiKey: env, source: "env" };
  }
  return { apiKey: "", source: "none" };
}

/** 测试连接：显式传入优先；DB 缓存密钥；再否则环境变量 */
export function resolveDraftKimiApiKeyForTest(override?: string): {
  apiKey: string;
  source: "override" | "draft" | "env" | "none";
} {
  const o = override?.trim() || "";
  if (o) return { apiKey: o, source: "override" };
  const fromCache = getCachedApiKey(KIMI_SCOPE);
  if (fromCache) return { apiKey: fromCache, source: "draft" };
  const env = config.kimi.apiKey.trim();
  if (env) return { apiKey: env, source: "env" };
  return { apiKey: "", source: "none" };
}

/** 写入 KIMI API 密钥到 DB（加密 + 审计） */
export async function persistKimiApiKey(plaintext: string, actor: string): Promise<void> {
  await dbSetApiKey(KIMI_SCOPE, plaintext, actor);
}

/** 清除 KIMI API 密钥（DB + 审计） */
export async function clearKimiApiKey(actor: string): Promise<void> {
  await dbClearApiKey(KIMI_SCOPE, actor);
}

function normalizeStringList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input.map((item) => String(item || "").trim()).filter(Boolean)));
}

function normalizeDependencyRuleItem(input: unknown, index: number): ImplementationDependencyRuleItem | null {
  const item = (input || {}) as Partial<ImplementationDependencyRuleItem>;
  const id = String(item.id || `rule-${index + 1}`).trim();
  const subject = String(item.subject || "").trim();
  const trigger = String(item.trigger || "").trim();
  const scope = ["feature", "scenario", "data_source"].includes(String(item.scope))
    ? (item.scope as ImplementationDependencyRuleItem["scope"])
    : "scenario";
  const logic = ["requires_all", "requires_any", "combo"].includes(String(item.logic))
    ? (item.logic as ImplementationDependencyRuleItem["logic"])
    : "requires_all";
  const dependencies = normalizeStringList(item.dependencies);
  const anyOfGroups = Array.isArray(item.anyOfGroups)
    ? item.anyOfGroups
        .map((group) => normalizeStringList(group))
        .filter((group) => group.length > 0)
    : undefined;
  const comboDependencies = normalizeStringList(item.comboDependencies);
  const enabled = Boolean(item.enabled ?? true);
  const note = String(item.note || "").trim();
  if (!subject || !trigger) return null;
  return {
    id,
    subject,
    scope,
    logic,
    trigger,
    dependencies,
    ...(anyOfGroups && anyOfGroups.length ? { anyOfGroups } : {}),
    ...(comboDependencies.length ? { comboDependencies } : {}),
    ...(note ? { note } : {}),
    enabled,
  };
}

function createDefaultImplementationDependencyConfig(): ImplementationDependencyRulesConfig {
  return {
    schemaVersion: "1.0.0",
    source: "01_需求管理/原始需求/实施评估RR/依赖管理/depent.md",
    updatedFrom: "2026-04-10",
    mutualExclusionRules: [],
    rules: [
      {
        id: "dep-rd-doc-read",
        subject: "研发文档查阅",
        scope: "scenario",
        logic: "requires_all",
        trigger: "使用研发文档查阅场景",
        dependencies: ["研发文档管理", "研发物料管理"],
        note: "未购买任一依赖时不可使用该功能",
        enabled: true,
      },
      {
        id: "dep-project-accounting",
        subject: "项目会计",
        scope: "scenario",
        logic: "requires_any",
        trigger: "使用项目余额表、项目明细账",
        dependencies: [],
        anyOfGroups: [["总账", "基础财务包"]],
        enabled: true,
      },
      {
        id: "dep-receivable-cashier",
        subject: "应收款管理",
        scope: "scenario",
        logic: "requires_all",
        trigger: "使用收款单、付款单场景",
        dependencies: ["出纳管理"],
        enabled: true,
      },
      {
        id: "dep-payable-cashier",
        subject: "应付款管理",
        scope: "scenario",
        logic: "requires_all",
        trigger: "使用收款单、付款单场景",
        dependencies: ["出纳管理"],
        enabled: true,
      },
      {
        id: "dep-budget-mrp",
        subject: "预算管理",
        scope: "scenario",
        logic: "requires_all",
        trigger: "使用预算MRP功能",
        dependencies: ["物料需求计划"],
        note: "含费用预算应用",
        enabled: true,
      },
      {
        id: "dep-sales-contract",
        subject: "销售管理",
        scope: "scenario",
        logic: "requires_all",
        trigger: "使用销售合同场景",
        dependencies: ["合同管理"],
        enabled: true,
      },
      {
        id: "dep-rolling-sales",
        subject: "滚动销售管理",
        scope: "scenario",
        logic: "requires_any",
        trigger: "支持寄售",
        dependencies: [],
        anyOfGroups: [["销售管理", "基础供应链包"]],
        enabled: true,
      },
      {
        id: "dep-purchase-contract",
        subject: "采购管理",
        scope: "scenario",
        logic: "requires_all",
        trigger: "使用采购合同场景",
        dependencies: ["合同管理"],
        enabled: true,
      },
      {
        id: "dep-rolling-purchase",
        subject: "滚动采购管理",
        scope: "scenario",
        logic: "requires_any",
        trigger: "支持VMI",
        dependencies: [],
        anyOfGroups: [["VMI采购", "基础供应链包"]],
        enabled: true,
      },
      {
        id: "dep-contract-ocr",
        subject: "合同管理",
        scope: "feature",
        logic: "requires_all",
        trigger: "使用文本比对功能",
        dependencies: ["视觉识别服务 流量版"],
        enabled: true,
      },
      {
        id: "dep-rolling-prod-plan",
        subject: "滚动生产计划",
        scope: "scenario",
        logic: "requires_all",
        trigger: "使用计划订单作为生产线需求源",
        dependencies: ["物料需求计划"],
        enabled: true,
      },
      {
        id: "dep-quality-inspection",
        subject: "质量检验",
        scope: "scenario",
        logic: "requires_any",
        trigger: "采购/库存/销售检验场景",
        dependencies: ["生产管理"],
        anyOfGroups: [
          ["采购管理", "基础供应链包"],
          ["库存管理", "基础供应链包"],
          ["销售管理", "基础供应链包"],
        ],
        note: "生产检验单独依赖生产管理",
        enabled: true,
      },
      {
        id: "dep-project-cost",
        subject: "项目成本",
        scope: "scenario",
        logic: "requires_all",
        trigger: "核算到WBS任务/阶段成本",
        dependencies: ["项目管理"],
        enabled: true,
      },
      {
        id: "dep-rental-assets",
        subject: "租赁资产",
        scope: "scenario",
        logic: "requires_all",
        trigger: "从租赁资产发起租金支付",
        dependencies: ["对公费用"],
        enabled: true,
      },
      {
        id: "dep-sim-quote",
        subject: "模拟报价",
        scope: "scenario",
        logic: "requires_all",
        trigger: "从工程数据管理获取BOM",
        dependencies: ["工程数据管理"],
        enabled: true,
      },
      {
        id: "dep-simple-production",
        subject: "简单生产",
        scope: "scenario",
        logic: "requires_all",
        trigger: "根据BOM生成简单生产领料单据",
        dependencies: ["工程数据管理"],
        enabled: true,
      },
      {
        id: "dep-design-change",
        subject: "设计变更管理",
        scope: "scenario",
        logic: "requires_all",
        trigger: "使用研发文档/研发物料/产品BOM变更场景",
        dependencies: ["研发文档管理", "研发物料管理", "产品BOM管理"],
        enabled: true,
      },
      {
        id: "dep-tax-direct-connect",
        subject: "税务直连报税",
        scope: "scenario",
        logic: "combo",
        trigger: "直连税局报税场景",
        dependencies: ["税企直连"],
        comboDependencies: ["ISV伙伴直连通道接口"],
        note: "适用于增值税/企业所得税/财产和行为税/其他税费/税务报表报告",
        enabled: true,
      },
      {
        id: "dep-tax-workbench",
        subject: "报税工作台",
        scope: "scenario",
        logic: "combo",
        trigger: "批量直连报税场景",
        dependencies: ["税企直连", "ISV伙伴直连通道接口"],
        comboDependencies: ["增值税", "企业所得税", "财产和行为税", "其他税费", "税务报表报告"],
        note: "税种应用至少选择一项",
        enabled: true,
      },
      {
        id: "dep-tax-analytics",
        subject: "税务统计分析",
        scope: "scenario",
        logic: "requires_any",
        trigger: "统计税金场景",
        dependencies: [],
        anyOfGroups: [["增值税", "企业所得税", "财产和行为税", "其他税费"]],
        enabled: true,
      },
      {
        id: "dep-contract-center",
        subject: "合同中心(CM)",
        scope: "feature",
        logic: "requires_all",
        trigger: "使用合同电子归档",
        dependencies: ["电子档案管理"],
        enabled: true,
      },
      {
        id: "dep-earchive-ocr",
        subject: "电子档案管理",
        scope: "feature",
        logic: "requires_all",
        trigger: "银行回单离线采集识别",
        dependencies: ["视觉识别服务-流量版"],
        enabled: true,
      },
      {
        id: "dep-mobile-sales",
        subject: "移动销售",
        scope: "feature",
        logic: "requires_any",
        trigger: "实时回填客户企业信息",
        dependencies: [],
        anyOfGroups: [["企业工商信息查询", "企业工商信息查询（包年）"]],
        enabled: true,
      },
      {
        id: "dep-mobile-quality",
        subject: "移动质检",
        scope: "feature",
        logic: "requires_all",
        trigger: "启用条码管理场景",
        dependencies: ["条码管理"],
        enabled: true,
      },
      {
        id: "dep-enterprise-bigscreen",
        subject: "企业智能决策大屏",
        scope: "data_source",
        logic: "requires_all",
        trigger: "使用企业智能决策大屏",
        dependencies: ["销售管理", "采购管理", "库存管理", "生产管理", "存货核算", "应收款管理", "总账"],
        enabled: true,
      },
      {
        id: "dep-finance-bigscreen",
        subject: "财务智能决策大屏",
        scope: "data_source",
        logic: "requires_all",
        trigger: "使用财务智能决策大屏",
        dependencies: ["总账", "出纳管理", "存货核算"],
        enabled: true,
      },
      {
        id: "dep-scm-bigscreen",
        subject: "供应链智能决策大屏",
        scope: "data_source",
        logic: "requires_all",
        trigger: "使用供应链智能决策大屏",
        dependencies: ["销售管理", "采购管理", "库存管理", "存货核算"],
        enabled: true,
      },
      {
        id: "dep-online-banking",
        subject: "网上银行",
        scope: "scenario",
        logic: "combo",
        trigger: "银企付款/流水/回单场景",
        dependencies: ["查询与支付接口"],
        comboDependencies: ["电子回单接口"],
        note: "付款与流水依赖查询与支付接口；电子回单依赖电子回单接口",
        enabled: true,
      },
      {
        id: "dep-cashier-ticket",
        subject: "出纳管理",
        scope: "scenario",
        logic: "requires_all",
        trigger: "结算方式使用票据业务",
        dependencies: ["票据管理"],
        enabled: true,
      },
    ],
  };
}

function normalizeImplementationDependencyConfig(input: unknown): ImplementationDependencyRulesConfig {
  const base = createDefaultImplementationDependencyConfig();
  const source = (input || {}) as Partial<ImplementationDependencyRulesConfig>;
  const schemaVersion = String(source.schemaVersion || base.schemaVersion).trim() || base.schemaVersion;
  const sourcePath = String(source.source || base.source).trim() || base.source;
  const updatedFrom = String(source.updatedFrom || base.updatedFrom).trim() || base.updatedFrom;
  const mutualExclusionRules = Array.isArray(source.mutualExclusionRules)
    ? source.mutualExclusionRules
        .map((item) => ({
          left: String(item?.left || "").trim(),
          right: String(item?.right || "").trim(),
          reason: String(item?.reason || "").trim(),
        }))
        .filter((item) => item.left && item.right)
    : base.mutualExclusionRules;
  const rules = Array.isArray(source.rules)
    ? source.rules
        .map((item, index) => normalizeDependencyRuleItem(item, index))
        .filter((item): item is ImplementationDependencyRuleItem => Boolean(item))
    : base.rules;
  return {
    schemaVersion,
    source: sourcePath,
    updatedFrom,
    mutualExclusionRules,
    rules: rules.length ? rules : base.rules,
  };
}

function normalizeImplementationDependencyStore(input: unknown): ImplementationDependencyRulesStore {
  const data = (input || {}) as Partial<ImplementationDependencyRulesStore>;
  const now = new Date().toISOString();
  const draft = normalizeImplementationDependencyConfig(data.draft);
  const active = normalizeImplementationDependencyConfig(data.active || data.draft);
  return {
    version: Number.isFinite(Number(data.version)) ? Math.max(1, Number(data.version)) : 1,
    draft,
    active,
    updatedAt: String(data.updatedAt || now),
    effectiveAt: String(data.effectiveAt || now),
  };
}

export function normalizeImplementationDependencyRulesConfig(input: unknown): ImplementationDependencyRulesConfig {
  return normalizeImplementationDependencyConfig(input);
}

// -------------------- 知识库配置 --------------------

export const DEFAULT_KNOWLEDGE_RETRIEVAL_PARAMS: KnowledgeRetrievalParams = {
  topK: 8,
  topN: 20,
  recallMethod: "mixed",
  rerankStatus: 0,
  rerankModel: "rerank",
  fractionalThreshold: 0.2,
};

export const DEFAULT_KNOWLEDGE_PROMPT_PROFILE: KnowledgePromptProfile = {
  id: "rag-answer",
  version: 1,
};

const KNOWLEDGE_BASE_BUSINESS_ROLES: BusinessRole[] = [
  "sales",
  "pre_sales",
  "delivery",
  "pm",
  "pmo",
  "dev",
  "admin",
];

export function normalizeKnowledgeRetrievalParams(input: unknown): KnowledgeRetrievalParams {
  const source = (input || {}) as Partial<KnowledgeRetrievalParams>;
  const topK = Math.trunc(clampNumber(source.topK, 1, 50, DEFAULT_KNOWLEDGE_RETRIEVAL_PARAMS.topK));
  const topN = Math.max(
    topK,
    Math.trunc(clampNumber(source.topN, 1, 100, DEFAULT_KNOWLEDGE_RETRIEVAL_PARAMS.topN)),
  );
  const recallMethod = source.recallMethod === "vector" || source.recallMethod === "keyword"
    ? source.recallMethod
    : "mixed";
  return {
    topK,
    topN,
    recallMethod,
    // DEF-2026-09-02-001：rerank_status: 1 会触发智谱供应商裸 code:500（无 msg），
    // 默认必须关闭；仅显式保存过的 0/1 视为用户取值，其余（含缺失/非法）回落默认 0。
    rerankStatus: source.rerankStatus === 0 || source.rerankStatus === 1
      ? source.rerankStatus
      : DEFAULT_KNOWLEDGE_RETRIEVAL_PARAMS.rerankStatus,
    rerankModel: typeof source.rerankModel === "string" && source.rerankModel.trim()
      ? source.rerankModel.trim()
      : DEFAULT_KNOWLEDGE_RETRIEVAL_PARAMS.rerankModel,
    fractionalThreshold: clampNumber(
      source.fractionalThreshold,
      0,
      1,
      DEFAULT_KNOWLEDGE_RETRIEVAL_PARAMS.fractionalThreshold,
    ),
  };
}

export function normalizeKnowledgePromptProfile(input: unknown): KnowledgePromptProfile {
  const source = (input || {}) as Partial<KnowledgePromptProfile>;
  const id = typeof source.id === "string" && source.id.trim()
    ? source.id.trim().slice(0, 64)
    : DEFAULT_KNOWLEDGE_PROMPT_PROFILE.id;
  const version = Number.isInteger(Number(source.version)) && Number(source.version) > 0
    ? Math.trunc(Number(source.version))
    : DEFAULT_KNOWLEDGE_PROMPT_PROFILE.version;
  return { id, version };
}

function createDefaultKnowledgeBaseConfig(): KnowledgeBaseConfig {
  return {
    model: "glm-4.6",
    apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    credentials: { apiKey: "", knowledgeId: "" },
    knowledgeBases: [],
    retrievalParams: { ...DEFAULT_KNOWLEDGE_RETRIEVAL_PARAMS },
    promptProfile: { ...DEFAULT_KNOWLEDGE_PROMPT_PROFILE },
  };
}

function normalizeKnowledgeBaseProfile(input: unknown, index: number): KnowledgeBaseProfile {
  const source = (input || {}) as Partial<KnowledgeBaseProfile>;
  const rawId = String(source.id || `knowledge-base-${index + 1}`).trim().toLowerCase();
  const id = rawId
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || `knowledge-base-${index + 1}`;
  const routingKeywords = Array.isArray(source.routingKeywords)
    ? Array.from(new Set(source.routingKeywords
      .map((item) => String(item || "").trim())
      .filter(Boolean)))
      .slice(0, 30)
    : [];
  const allowedBusinessRoles = Array.isArray(source.allowedBusinessRoles)
    ? Array.from(new Set(source.allowedBusinessRoles.filter(
      (item): item is BusinessRole => KNOWLEDGE_BASE_BUSINESS_ROLES.includes(item as BusinessRole),
    )))
    : [];
  return {
    id,
    name: String(source.name || "").trim().slice(0, 80),
    description: String(source.description || "").trim().slice(0, 500),
    knowledgeId: String(source.knowledgeId || "").trim().slice(0, 160),
    routingKeywords,
    allowedBusinessRoles,
    enabled: source.enabled !== false,
    isDefault: source.isDefault === true,
    priority: Math.trunc(clampNumber(source.priority, 0, 999, 100)),
  };
}

function legacyKnowledgeBaseProfile(knowledgeId: string): KnowledgeBaseProfile {
  return {
    id: "legacy-default",
    name: "默认知识库",
    description: "由旧版单知识库配置自动迁移",
    knowledgeId,
    routingKeywords: [],
    allowedBusinessRoles: [],
    enabled: true,
    isDefault: true,
    priority: 100,
  };
}

export type KnowledgeBaseProfileValidationIssue = {
  field: string;
  reason: string;
  profileId?: string;
};

export function validateKnowledgeBaseProfiles(
  profiles: KnowledgeBaseProfile[],
): KnowledgeBaseProfileValidationIssue[] {
  const issues: KnowledgeBaseProfileValidationIssue[] = [];
  const ids = new Set<string>();
  const knowledgeIds = new Set<string>();
  for (const profile of profiles) {
    if (!profile.id) issues.push({ field: "knowledgeBases.id", reason: "profile_id_required" });
    else if (ids.has(profile.id)) issues.push({ field: "knowledgeBases.id", reason: "duplicate_profile_id", profileId: profile.id });
    else ids.add(profile.id);
    if (profile.enabled && !profile.name) {
      issues.push({ field: "knowledgeBases.name", reason: "profile_name_required", profileId: profile.id });
    }
    if (profile.enabled && !profile.knowledgeId) {
      issues.push({ field: "knowledgeBases.knowledgeId", reason: "knowledge_id_required", profileId: profile.id });
    } else if (profile.knowledgeId && knowledgeIds.has(profile.knowledgeId)) {
      issues.push({ field: "knowledgeBases.knowledgeId", reason: "duplicate_knowledge_id", profileId: profile.id });
    } else if (profile.knowledgeId) {
      knowledgeIds.add(profile.knowledgeId);
    }
  }
  if (profiles.filter((profile) => profile.enabled && profile.isDefault).length > 1) {
    issues.push({ field: "knowledgeBases.isDefault", reason: "multiple_default_profiles" });
  }
  return issues;
}

export function normalizeKnowledgeBaseConfig(input: unknown): KnowledgeBaseConfig {
  const base = createDefaultKnowledgeBaseConfig();
  const source = (input || {}) as Partial<KnowledgeBaseConfig>;
  const credentials = (source.credentials || {}) as Partial<KnowledgeBaseCredentialsConfig>;
  const legacyKnowledgeId = String(credentials.knowledgeId ?? base.credentials.knowledgeId).trim();
  const knowledgeBases = Array.isArray(source.knowledgeBases)
    ? source.knowledgeBases.slice(0, 50).map(normalizeKnowledgeBaseProfile)
    : legacyKnowledgeId
      ? [legacyKnowledgeBaseProfile(legacyKnowledgeId)]
      : [];
  return {
    model: String(source.model || base.model).trim(),
    apiBaseUrl: String(source.apiBaseUrl || base.apiBaseUrl).trim(),
    credentials: {
      apiKey: String(credentials.apiKey ?? base.credentials.apiKey).trim(),
      knowledgeId: legacyKnowledgeId,
    },
    knowledgeBases,
    retrievalParams: normalizeKnowledgeRetrievalParams(source.retrievalParams),
    promptProfile: normalizeKnowledgePromptProfile(source.promptProfile),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function computeKnowledgeBaseConfigHash(input: KnowledgeBaseConfig): string {
  const normalized = normalizeKnowledgeBaseConfig(input);
  return sha256(JSON.stringify({
    model: normalized.model,
    apiBaseUrl: normalized.apiBaseUrl,
    credentials: {
      apiKeyHash: sha256(normalized.credentials.apiKey),
      knowledgeId: normalized.credentials.knowledgeId,
    },
    knowledgeBases: normalized.knowledgeBases,
    retrievalParams: normalized.retrievalParams,
    promptProfile: normalized.promptProfile,
  }));
}

export function computeKnowledgeBaseProfileHash(
  input: KnowledgeBaseConfig,
  profile: KnowledgeBaseProfile,
): string {
  const normalized = normalizeKnowledgeBaseConfig(input);
  const normalizedProfile = normalizeKnowledgeBaseProfile(profile, 0);
  return sha256(JSON.stringify({
    model: normalized.model,
    apiBaseUrl: normalized.apiBaseUrl,
    apiKeyHash: sha256(normalized.credentials.apiKey),
    retrievalParams: normalized.retrievalParams,
    promptProfile: normalized.promptProfile,
    profile: normalizedProfile,
  }));
}

function normalizeKnowledgeBaseProbe(input: unknown): KnowledgeBaseProbeRecord | undefined {
  const source = (input || {}) as Partial<KnowledgeBaseProbeRecord>;
  const checkedAt = String(source.checkedAt || "");
  const configHash = String(source.configHash || "");
  if (
    (source.status !== "success" && source.status !== "failure")
    || !/^[0-9a-f]{64}$/i.test(configHash)
    || !Number.isFinite(Date.parse(checkedAt))
  ) return undefined;
  const providerRequestId = String(source.providerRequestId || "").trim();
  const errorCode = String(source.errorCode || "").trim();
  const providerMessage = String(source.providerMessage || "").trim();
  const rawProviderCode = source.providerCode;
  const providerCode = typeof rawProviderCode === "number" && Number.isFinite(rawProviderCode)
    ? Math.trunc(rawProviderCode)
    : undefined;
  const profileId = String(source.profileId || "").trim();
  return {
    status: source.status,
    configHash,
    checkedAt,
    latencyMs: Math.max(0, Number(source.latencyMs) || 0),
    ...(profileId ? { profileId: profileId.slice(0, 64) } : {}),
    ...(source.warning === "retrieval_empty" ? { warning: source.warning } : {}),
    ...(providerRequestId ? { providerRequestId: providerRequestId.slice(0, 128) } : {}),
    ...(errorCode ? { errorCode: errorCode.slice(0, 64) } : {}),
    ...(providerCode !== undefined ? { providerCode } : {}),
    ...(providerMessage ? { providerMessage: providerMessage.slice(0, 200) } : {}),
  };
}

function normalizeKnowledgeBaseStore(input: unknown): KnowledgeBaseConfigStore {
  const data = (input || {}) as Partial<KnowledgeBaseConfigStore>;
  const now = new Date().toISOString();
  const draft = normalizeKnowledgeBaseConfig(data.draft);
  const active = normalizeKnowledgeBaseConfig(data.active || data.draft);
  const probe = normalizeKnowledgeBaseProbe(data.probe);
  const rawProbes = data.probes && typeof data.probes === "object" && !Array.isArray(data.probes)
    ? data.probes
    : {};
  const probes = Object.fromEntries(Object.entries(rawProbes)
    .map(([profileId, value]) => [profileId, normalizeKnowledgeBaseProbe(value)] as const)
    .filter((entry): entry is [string, KnowledgeBaseProbeRecord] => Boolean(entry[1])));
  return {
    version: Number.isFinite(Number(data.version)) ? Math.max(1, Number(data.version)) : 1,
    draft,
    active,
    ...(Object.keys(probes).length ? { probes } : {}),
    ...(probe ? { probe } : {}),
    updatedAt: String(data.updatedAt || now),
    effectiveAt: String(data.effectiveAt || now),
  };
}

/** 合并知识库凭证 PATCH：null 表示清除；空字符串表示不修改；非空则写入 */
export function mergeKnowledgeBaseCredentialsPatch(
  prev: KnowledgeBaseCredentialsConfig,
  incoming: Partial<{ apiKey: string | null; knowledgeId: string | null }> | undefined,
): KnowledgeBaseCredentialsConfig {
  if (!incoming) return prev;
  let apiKey = prev.apiKey;
  let knowledgeId = prev.knowledgeId;
  if (incoming.apiKey === null) apiKey = "";
  else if (typeof incoming.apiKey === "string" && incoming.apiKey.trim()) apiKey = incoming.apiKey.trim();
  if (incoming.knowledgeId === null) knowledgeId = "";
  else if (typeof incoming.knowledgeId === "string" && incoming.knowledgeId.trim()) knowledgeId = incoming.knowledgeId.trim();
  return { apiKey, knowledgeId };
}

/**
 * 知识库实际调用：已生效配置中的凭证优先，否则环境变量
 * 阶段 1 批 5：因内部调用 loadKnowledgeBaseConfigStore（已异步化）级联改 async，实现不动。
 */
export async function resolveActiveKnowledgeBaseConfig(): Promise<{
  apiKey: string;
  knowledgeId: string;
  model: string;
  apiBaseUrl: string;
  retrievalParams: KnowledgeRetrievalParams;
  promptProfile: KnowledgePromptProfile;
  configVersion: number;
  source: "store" | "env" | "none";
}> {
  const store = await loadKnowledgeBaseConfigStore();
  const storeApiKey = store.active.credentials.apiKey.trim();
  const activeProfile = store.active.knowledgeBases.find((profile) => profile.enabled && profile.isDefault)
    || store.active.knowledgeBases.find((profile) => profile.enabled);
  const storeKnowledgeId = activeProfile?.knowledgeId.trim() || store.active.credentials.knowledgeId.trim();
  if (storeApiKey && storeKnowledgeId) {
    return {
      apiKey: storeApiKey,
      knowledgeId: storeKnowledgeId,
      model: store.active.model,
      apiBaseUrl: store.active.apiBaseUrl,
      retrievalParams: store.active.retrievalParams,
      promptProfile: normalizeKnowledgePromptProfile(store.active.promptProfile),
      configVersion: store.version,
      source: "store",
    };
  }
  const envApiKey = config.zhipu.apiKey.trim();
  const envKnowledgeId = config.zhipu.knowledgeId.trim();
  if (envApiKey && envKnowledgeId) {
    return {
      apiKey: envApiKey,
      knowledgeId: envKnowledgeId,
      model: config.zhipu.model,
      apiBaseUrl: config.zhipu.apiBaseUrl,
      retrievalParams: { ...DEFAULT_KNOWLEDGE_RETRIEVAL_PARAMS },
      promptProfile: { ...DEFAULT_KNOWLEDGE_PROMPT_PROFILE },
      configVersion: store.version,
      source: "env",
    };
  }
  return { apiKey: "", knowledgeId: "", model: config.zhipu.model, apiBaseUrl: config.zhipu.apiBaseUrl, retrievalParams: { ...DEFAULT_KNOWLEDGE_RETRIEVAL_PARAMS }, promptProfile: { ...DEFAULT_KNOWLEDGE_PROMPT_PROFILE }, configVersion: store.version, source: "none" };
}

export type ResolvedActiveKnowledgeBaseCatalog = {
  apiKey: string;
  model: string;
  apiBaseUrl: string;
  retrievalParams: KnowledgeRetrievalParams;
  promptProfile: KnowledgePromptProfile;
  configVersion: number;
  profiles: KnowledgeBaseProfile[];
  source: "store" | "env" | "none";
};

/**
 * 运行时多知识库目录：共享同一智谱账号与检索参数。
 * 阶段 1 批 5：因内部调用 loadKnowledgeBaseConfigStore（已异步化）级联改 async，实现不动。
 */
export async function resolveActiveKnowledgeBaseCatalog(): Promise<ResolvedActiveKnowledgeBaseCatalog> {
  const store = await loadKnowledgeBaseConfigStore();
  const storeApiKey = store.active.credentials.apiKey.trim();
  const envApiKey = config.zhipu.apiKey.trim();
  const profiles = store.active.knowledgeBases.filter((profile) => profile.enabled);
  if (profiles.length && (storeApiKey || envApiKey)) {
    return {
      apiKey: storeApiKey || envApiKey,
      model: store.active.model,
      apiBaseUrl: store.active.apiBaseUrl,
      retrievalParams: store.active.retrievalParams,
      promptProfile: normalizeKnowledgePromptProfile(store.active.promptProfile),
      configVersion: store.version,
      profiles,
      source: storeApiKey ? "store" : "env",
    };
  }
  const envKnowledgeId = config.zhipu.knowledgeId.trim();
  if (envApiKey && envKnowledgeId) {
    return {
      apiKey: envApiKey,
      model: config.zhipu.model,
      apiBaseUrl: config.zhipu.apiBaseUrl,
      retrievalParams: { ...DEFAULT_KNOWLEDGE_RETRIEVAL_PARAMS },
      promptProfile: { ...DEFAULT_KNOWLEDGE_PROMPT_PROFILE },
      configVersion: store.version,
      profiles: [{
        id: "environment-default",
        name: "环境变量知识库",
        description: "由环境变量提供的兼容知识库",
        knowledgeId: envKnowledgeId,
        routingKeywords: [],
        allowedBusinessRoles: [],
        enabled: true,
        isDefault: true,
        priority: 100,
      }],
      source: "env",
    };
  }
  return {
    apiKey: "",
    model: config.zhipu.model,
    apiBaseUrl: config.zhipu.apiBaseUrl,
    retrievalParams: { ...DEFAULT_KNOWLEDGE_RETRIEVAL_PARAMS },
    promptProfile: { ...DEFAULT_KNOWLEDGE_PROMPT_PROFILE },
    configVersion: store.version,
    profiles: [],
    source: "none",
  };
}

/**
 * 测试连接：显式传入优先；否则草稿仓库；再否则环境变量
 * 阶段 1 批 5：因内部调用 loadKnowledgeBaseConfigStore（已异步化）级联改 async，实现不动。
 */
export async function resolveDraftKnowledgeBaseConfigForTest(
  overrideApiKey?: string,
  overrideKnowledgeId?: string,
  profileId?: string,
): Promise<{
  apiKey: string;
  knowledgeId: string;
  model: string;
  apiBaseUrl: string;
  retrievalParams: KnowledgeRetrievalParams;
  promptProfile: KnowledgePromptProfile;
  source: "override" | "draft" | "env" | "none";
}> {
  const oKey = overrideApiKey?.trim() || "";
  const oKid = overrideKnowledgeId?.trim() || "";
  const store = await loadKnowledgeBaseConfigStore();
  if (oKey && oKid) return { apiKey: oKey, knowledgeId: oKid, model: store.draft.model, apiBaseUrl: store.draft.apiBaseUrl, retrievalParams: store.draft.retrievalParams, promptProfile: normalizeKnowledgePromptProfile(store.draft.promptProfile), source: "override" };
  const draftKey = store.draft.credentials.apiKey.trim();
  const selectedProfile = profileId
    ? store.draft.knowledgeBases.find((profile) => profile.id === profileId)
    : store.draft.knowledgeBases.find((profile) => profile.enabled && profile.isDefault)
      || store.draft.knowledgeBases.find((profile) => profile.enabled);
  const draftKid = selectedProfile?.knowledgeId.trim() || store.draft.credentials.knowledgeId.trim();
  if (draftKey && draftKid) {
    return { apiKey: oKey || draftKey, knowledgeId: oKid || draftKid, model: store.draft.model, apiBaseUrl: store.draft.apiBaseUrl, retrievalParams: store.draft.retrievalParams, promptProfile: normalizeKnowledgePromptProfile(store.draft.promptProfile), source: "draft" };
  }
  const envKey = config.zhipu.apiKey.trim();
  const envKid = config.zhipu.knowledgeId.trim();
  if (envKey && envKid) {
    return { apiKey: oKey || envKey, knowledgeId: oKid || envKid, model: config.zhipu.model, apiBaseUrl: config.zhipu.apiBaseUrl, retrievalParams: { ...DEFAULT_KNOWLEDGE_RETRIEVAL_PARAMS }, promptProfile: { ...DEFAULT_KNOWLEDGE_PROMPT_PROFILE }, source: "env" };
  }
  return { apiKey: oKey || envKey, knowledgeId: oKid || envKid, model: config.zhipu.model, apiBaseUrl: config.zhipu.apiBaseUrl, retrievalParams: { ...DEFAULT_KNOWLEDGE_RETRIEVAL_PARAMS }, promptProfile: { ...DEFAULT_KNOWLEDGE_PROMPT_PROFILE }, source: "none" };
}

// ============================================================
// 选择器（阶段 2 S3 终态：恒 PG，无开关分流）
// ============================================================
// S3（2026-08-30）删除四组 *Json 实现与 createSystemJsonRepository，并
// 退役 WES_STORE_SYSTEM_PG（commit C）——选择器恒装配 PG，与本阶段其余
// 「第 4 步已完成」域（templates/rule_sets/knowledge S6）同形态。
// 约束（架构侧批 4 指令，仍生效）：system.repository.ts 是阶段 3 拆分对象，
// 本批只做存储切换——不抽取公共逻辑。
// 8 个公开 accessor 保持原签名与原导出名（调用点零改动），内部经
// getSystemRepository() 取用；路由层契约不变：
//  1. save 前用既有私有 normalize 统一契约（PG 仓储是纯存储层，不做归一）；
//  2. load 缺行/空表时用既有私有默认工厂兜底（对齐旧 JSON「缺文件建默认」，
//     PG 路径不在读路径写回）。

export type { SystemStoreRepository };

let defaultRepo: SystemStoreRepository | null = null;

/** 进程内默认 repository 单例（生产路由使用）；S3 后恒 PG 实现 */
export function getSystemRepository(): SystemStoreRepository {
  if (!defaultRepo) defaultRepo = createSystemPgRepository();
  return defaultRepo;
}

/** 测试专用：重置单例 */
export function _resetSystemRepositoryForTest(): void {
  defaultRepo = null;
}

// ── 公开 accessor（原签名原导出名，调用点零改动） ──

export async function loadVersionCodeRulesStore(): Promise<VersionCodeRulesStore> {
  const store = await getSystemRepository().loadVersionCodeRulesStore();
  // PG 空表（未 seed）时用默认规则兜底（S3 后恒 PG；旧 JSON 路径自建文件、
  // 永不为空，兜底分支只在未播种空库生效，语义与当时等价）
  return store.rules.length > 0 ? store : { rules: createDefaultRules() };
}

export async function saveVersionCodeRulesStore(store: VersionCodeRulesStore): Promise<void> {
  await getSystemRepository().saveVersionCodeRulesStore(normalizeStore(store));
}

export async function loadRequirementSystemConfigStore(): Promise<RequirementSystemConfigStore> {
  const store = await getSystemRepository().loadRequirementSystemConfigStore();
  if (store) return store;
  const now = new Date().toISOString();
  const initial = createDefaultRequirementConfig();
  return { version: 1, draft: initial, active: initial, updatedAt: now, effectiveAt: now };
}

export async function saveRequirementSystemConfigStore(store: RequirementSystemConfigStore): Promise<void> {
  await getSystemRepository().saveRequirementSystemConfigStore(normalizeRequirementStore(store));
}

export async function loadImplementationDependencyRulesStore(): Promise<ImplementationDependencyRulesStore> {
  const store = await getSystemRepository().loadImplementationDependencyRulesStore();
  if (store) return store;
  const now = new Date().toISOString();
  const initial = createDefaultImplementationDependencyConfig();
  return { version: 1, draft: initial, active: initial, updatedAt: now, effectiveAt: now };
}

export async function saveImplementationDependencyRulesStore(store: ImplementationDependencyRulesStore): Promise<void> {
  await getSystemRepository().saveImplementationDependencyRulesStore(normalizeImplementationDependencyStore(store));
}

export async function loadKnowledgeBaseConfigStore(): Promise<KnowledgeBaseConfigStore> {
  const store = await getSystemRepository().loadKnowledgeBaseConfigStore();
  if (store) return store;
  const now = new Date().toISOString();
  const initial = createDefaultKnowledgeBaseConfig();
  return { version: 1, draft: initial, active: initial, updatedAt: now, effectiveAt: now };
}

export async function saveKnowledgeBaseConfigStore(store: KnowledgeBaseConfigStore): Promise<void> {
  await getSystemRepository().saveKnowledgeBaseConfigStore(normalizeKnowledgeBaseStore(store));
}
