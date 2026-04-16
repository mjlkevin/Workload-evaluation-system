import fs from "node:fs";
import path from "node:path";

import {
  ImplementationDependencyRuleItem,
  ImplementationDependencyRulesConfig,
  ImplementationDependencyRulesStore,
  RequirementSystemConfig,
  RequirementSystemConfigStore,
  VersionCodeRule,
  VersionCodeRulesStore,
} from "../../types";
import {
  implementationDependencyRulesStorePath,
  requirementSystemConfigStorePath,
  versionCodeRulesStorePath,
} from "../../utils";

const EMPTY_TIME = "--";

function buildSample(format: string, prefix: string, moduleCode: string): string {
  const replacements: Array<[string, string]> = [
    ["{PREFIX}", prefix],
    ["{MODULE}", moduleCode],
    ["{YYYYMMDD}", "20260406"],
    ["{YYYYMM}", "202604"],
    ["{YYYY}", "2026"],
    ["{GL}", "GL001"],
    ["{NNN}", "001"],
    ["{NN}", "01"],
  ];
  return replacements.reduce((result, [token, value]) => result.split(token).join(value), format);
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
      moduleCode: "WB",
      prefix: "WB",
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

export function loadVersionCodeRulesStore(): VersionCodeRulesStore {
  const filePath = versionCodeRulesStorePath();
  if (!fs.existsSync(filePath)) {
    const initStore: VersionCodeRulesStore = { rules: createDefaultRules() };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(initStore, null, 2), "utf-8");
    return initStore;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    const normalized = normalizeStore(parsed);
    fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), "utf-8");
    return normalized;
  } catch {
    const fallback: VersionCodeRulesStore = { rules: createDefaultRules() };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), "utf-8");
    return fallback;
  }
}

export function saveVersionCodeRulesStore(store: VersionCodeRulesStore): void {
  const filePath = versionCodeRulesStorePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const normalized = normalizeStore(store);
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), "utf-8");
}

export function buildVersionCodeSample(format: string, prefix: string, moduleCode: string): string {
  return buildSample(format, prefix, moduleCode);
}

function createDefaultRequirementConfig(): RequirementSystemConfig {
  return {
    kimiEvaluation: {
      enabled: true,
      model: "moonshot-v1-128k",
      temperature: 0.3,
      maxTokens: 4000,
      timeoutMs: 45000,
      fallbackToRule: true,
      promptProfile: "default",
      promptTemplate:
        "你是资深项目经理 + 资深实施顾问。你不是做简单 SKU 对照，而是要基于需求全量信息做综合实施评估。必须只返回 JSON。字段固定：assessmentDraft.quoteMode/productLines/userCount/orgCount/orgSimilarity/difficultyFactor/moduleItems/risks/assumptions。moduleItems 每项字段：cloudProduct/skuName/moduleName/standardDays/suggestedDays/reason。所有数值字段必须为非负数，orgSimilarity 和 difficultyFactor 范围 0-1。评估时必须综合：basicInfo（行业、规模、上线目标）、businessNeedRows（业务复杂度）、devOverviewRows（开发基线）、implementationScopeRows（组织范围与地域）、meetingNotes（隐性约束）、keyPointRows（重点风险）。reason 必须体现增加/减少人天的业务原因与实施原因，不能仅写“按模板匹配”。禁止把产品名/版本名/平台名（如金蝶AI星空、旗舰版）直接当成 SKU，必须下钻到可实施功能项。财务云、供应链云等是实施域级云产品，不得填入 skuName 并挂在金蝶AI星空下冒充 SKU；域级人天归 cloudProduct=该域名，skuName 仅写子模块。若信息不足，给出审慎估算并在 risks/assumptions 明确不确定性来源。严禁仅凭业务需求正文中出现与 SKU 同名的词、或「总账、报表、出纳」类标准功能并列枚举，就认定 suggestedDays 必须高于 standardDays；须结合该条需求完整语义与实施顾问角色做专业判断，只有存在相对标准产品交付的明确增量（如二开、深度集成、多组织推广、性能/迁移、额外培训与方案等）时才上调，并在 reason 中写清增量内容而非复述关键词。",
    },
    fileParsing: {
      enabled: true,
      allowedExtensions: [".xlsx", ".xls", ".csv"],
      maxFileSizeMb: 20,
      maxSheetCount: 20,
      strictMode: false,
      ocrEnabled: false,
    },
    kimiGeneration: {
      enabled: true,
      model: "moonshot-v1-128k",
      temperature: 0.5,
      maxTokens: 6000,
      outputStyle: "balanced",
      includeRiskHints: true,
      includeAssumptions: true,
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

  return {
    kimiEvaluation: {
      enabled: Boolean(kimiEvaluation.enabled ?? base.kimiEvaluation.enabled),
      model: String(kimiEvaluation.model || base.kimiEvaluation.model).trim(),
      temperature: clampNumber(kimiEvaluation.temperature, 0, 1, base.kimiEvaluation.temperature),
      maxTokens: clampNumber(kimiEvaluation.maxTokens, 256, 32000, base.kimiEvaluation.maxTokens),
      timeoutMs: clampNumber(kimiEvaluation.timeoutMs, 3000, 120000, base.kimiEvaluation.timeoutMs),
      fallbackToRule: Boolean(kimiEvaluation.fallbackToRule ?? base.kimiEvaluation.fallbackToRule),
      promptProfile: String(kimiEvaluation.promptProfile || base.kimiEvaluation.promptProfile).trim(),
      promptTemplate: String(kimiEvaluation.promptTemplate || base.kimiEvaluation.promptTemplate).trim(),
    },
    fileParsing: {
      enabled: Boolean(fileParsing.enabled ?? base.fileParsing.enabled),
      allowedExtensions: normalizeStringArray(fileParsing.allowedExtensions, base.fileParsing.allowedExtensions),
      maxFileSizeMb: clampNumber(fileParsing.maxFileSizeMb, 1, 200, base.fileParsing.maxFileSizeMb),
      maxSheetCount: clampNumber(fileParsing.maxSheetCount, 1, 200, base.fileParsing.maxSheetCount),
      strictMode: Boolean(fileParsing.strictMode ?? base.fileParsing.strictMode),
      ocrEnabled: Boolean(fileParsing.ocrEnabled ?? base.fileParsing.ocrEnabled),
    },
    kimiGeneration: {
      enabled: Boolean(kimiGeneration.enabled ?? base.kimiGeneration.enabled),
      model: String(kimiGeneration.model || base.kimiGeneration.model).trim(),
      temperature: clampNumber(kimiGeneration.temperature, 0, 1, base.kimiGeneration.temperature),
      maxTokens: clampNumber(kimiGeneration.maxTokens, 256, 32000, base.kimiGeneration.maxTokens),
      outputStyle: ["concise", "balanced", "detailed"].includes(String(kimiGeneration.outputStyle))
        ? (kimiGeneration.outputStyle as RequirementSystemConfig["kimiGeneration"]["outputStyle"])
        : base.kimiGeneration.outputStyle,
      includeRiskHints: Boolean(kimiGeneration.includeRiskHints ?? base.kimiGeneration.includeRiskHints),
      includeAssumptions: Boolean(kimiGeneration.includeAssumptions ?? base.kimiGeneration.includeAssumptions),
    },
  };
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

export function loadRequirementSystemConfigStore(): RequirementSystemConfigStore {
  const filePath = requirementSystemConfigStorePath();
  if (!fs.existsSync(filePath)) {
    const now = new Date().toISOString();
    const initial = createDefaultRequirementConfig();
    const initStore: RequirementSystemConfigStore = {
      version: 1,
      draft: initial,
      active: initial,
      updatedAt: now,
      effectiveAt: now,
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(initStore, null, 2), "utf-8");
    return initStore;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    const normalized = normalizeRequirementStore(parsed);
    fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), "utf-8");
    return normalized;
  } catch {
    const now = new Date().toISOString();
    const fallbackConfig = createDefaultRequirementConfig();
    const fallback: RequirementSystemConfigStore = {
      version: 1,
      draft: fallbackConfig,
      active: fallbackConfig,
      updatedAt: now,
      effectiveAt: now,
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), "utf-8");
    return fallback;
  }
}

export function saveRequirementSystemConfigStore(store: RequirementSystemConfigStore): void {
  const filePath = requirementSystemConfigStorePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const normalized = normalizeRequirementStore(store);
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), "utf-8");
}

export function normalizeRequirementSystemConfig(input: unknown): RequirementSystemConfig {
  return normalizeRequirementConfig(input);
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

export function loadImplementationDependencyRulesStore(): ImplementationDependencyRulesStore {
  const filePath = implementationDependencyRulesStorePath();
  if (!fs.existsSync(filePath)) {
    const now = new Date().toISOString();
    const initial = createDefaultImplementationDependencyConfig();
    const initStore: ImplementationDependencyRulesStore = {
      version: 1,
      draft: initial,
      active: initial,
      updatedAt: now,
      effectiveAt: now,
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(initStore, null, 2), "utf-8");
    return initStore;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    const normalized = normalizeImplementationDependencyStore(parsed);
    fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), "utf-8");
    return normalized;
  } catch {
    const now = new Date().toISOString();
    const fallbackRules = createDefaultImplementationDependencyConfig();
    const fallback: ImplementationDependencyRulesStore = {
      version: 1,
      draft: fallbackRules,
      active: fallbackRules,
      updatedAt: now,
      effectiveAt: now,
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), "utf-8");
    return fallback;
  }
}

export function saveImplementationDependencyRulesStore(store: ImplementationDependencyRulesStore): void {
  const filePath = implementationDependencyRulesStorePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const normalized = normalizeImplementationDependencyStore(store);
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), "utf-8");
}

export function normalizeImplementationDependencyRulesConfig(input: unknown): ImplementationDependencyRulesConfig {
  return normalizeImplementationDependencyConfig(input);
}
