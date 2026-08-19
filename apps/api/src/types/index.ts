// ============================================================
// 统一类型定义 - 从 main.ts 提取
// ============================================================

// -------------------- 模板相关 --------------------

export type TemplateItem = {
  templateItemId: string;
  groupId: string;
  itemName: string;
  standardDays: number;
  sheetName?: string;
  cloudProduct?: string;
  skuName?: string;
  appGroup?: string;
  deliveryModule?: string;
  deliveryPoint?: string;
  deliveryDesc?: string;
  evalDesc?: string;
  defaultIncluded?: boolean;
};

export type Template = {
  templateId: string;
  templateVersion: string;
  templateName: string;
  groups: Array<{ groupId: string; groupName: string }>;
  items: TemplateItem[];
  sheets?: Array<{ sheetId: string; sheetName: string }>;
};

// -------------------- 规则相关 --------------------

export type RuleSet = {
  ruleSetId: string;
  ruleVersion: string;
  pipelineVersion: string;
  pipeline: string[];
  baseRule: {
    userCountTiers: Array<{ min: number; max: number; factor: number }>;
    difficultyFactorList: number[];
    userIncrementRounding?: "none" | "ceil_int";
  };
  orgIncrementRule: {
    enabled: boolean;
    factor?: number;
  };
};

export type RuleSetMeta = {
  grouping: string[];
  itemRule: string[];
  baseRule: RuleSet["baseRule"];
  orgIncrementRule: RuleSet["orgIncrementRule"];
  pipeline: RuleSet["pipeline"];
};

// -------------------- 计算请求与结果 --------------------

export type CalculateRequest = {
  templateId: string;
  ruleSetId: string;
  userCount: number;
  difficultyFactor: number;
  orgCount: number;
  orgSimilarityFactor: number;
  selectedSheet?: string;
  /** 实施评估工作台当前选中的云产品；导出 Excel 时仅输出这些云产品下已勾选的行（不传或空数组则不按云产品过滤） */
  selectedCloudNames?: string[];
  exportProjectName?: string;
  exportAssessmentVersionCode?: string;
  items: Array<{
    templateItemId: string;
    included: boolean;
    customStandardDays?: number;
  }>;
};

export type EstimateResult = {
  templateId: string;
  ruleSetId: string;
  templateVersion: string;
  ruleVersion: string;
  pipelineVersion: string;
  baseDays: number;
  userIncrementDays: number;
  difficultyIncrementDays: number;
  orgIncrementDays: number;
  totalDays: number;
  calculationBreakdown: {
    userCountTier: { hitRange: string; factor: number; incrementDays: number };
    difficulty: { factor: number; incrementDays: number };
    organization: { orgCount: number; similarityFactor: number; incrementDays: number };
  };
  groupSubtotals: Array<{ groupId: string; groupName: string; subtotalDays: number }>;
  itemResults: Array<{
    templateItemId: string;
    included: boolean;
    standardDays: number;
    itemSubtotalDays: number;
    effectiveStandardDays?: number;
  }>;
};

// -------------------- 需求相关 --------------------

export type BasicProjectInfo = {
  customerName: string;
  location: string;
  projectName: string;
  opportunityNo: string;
  productLines?: string[];
  customerIndustry: string;
  enterpriseRevenue: string;
  itStatus: string;
  expectedGoLive: string;
  enterpriseProfile: string;
  projectBackgroundNeeds: string;
  projectGoals: string;
};

export type RequirementValuePropositionRow = {
  summary: string;
  refinedContent: string;
  originalDemand: string;
  interviewOutline: string;
};

export type RequirementBusinessNeedRow = {
  businessDomain: string;
  category: string;
  businessNeed: string;
  proposer: string;
  title: string;
  preSalesIncluded: string;
  standardImplemented: string;
  solutionSuggestion: string;
  requiresCustomDev: string;
};

export type RequirementDevOverviewRow = {
  businessDomain: string;
  moduleName: string;
  moduleBrief: string;
  functionDesc: string;
  solutionSuggestion: string;
  codingDays: number;
  estimateBasis: string;
};

export type RequirementProductModuleRow = {
  productDomain: string;
  moduleName: string;
  subModule: string;
  userCount: string;
  implementationOrgCount: string;
  pilotOrgCount: string;
  partyBLead: string;
  partyALead: string;
};

export type RequirementImplementationScopeRow = {
  companyName: string;
  companyType: string;
  moduleScope: string;
  location: string;
  implementationMode: string;
  note: string;
};

export type RequirementKeyPointRow = {
  analysisCategory: string;
  subItem: string;
  detail: string;
  note: string;
};

export type RequirementImportData = {
  valuePropositionRows: RequirementValuePropositionRow[];
  businessNeedRows: RequirementBusinessNeedRow[];
  devOverviewRows: RequirementDevOverviewRow[];
  productModuleRows: RequirementProductModuleRow[];
  implementationScopeRows: RequirementImplementationScopeRow[];
  meetingNotes: string;
  keyPointRows: RequirementKeyPointRow[];
};

// -------------------- 用户认证相关 --------------------

export type AuthUser = {
  id: string;
  username: string;
  passwordHash: string;
  /** admin：全权限；sub_admin：用户管理（不可动超级管理员/不可授 admin）；user：普通 */
  role: "admin" | "sub_admin" | "user";
  /** 业务身份：驱动首页 AI 提示词与工作流，不参与系统权限放行 */
  businessRole?: BusinessRole;
  status: "active" | "disabled";
  createdAt: string;
  lastLoginAt: string;
};

export type PublicUser = Omit<AuthUser, "passwordHash">;

export type BusinessRole =
  | "sales"
  | "pre_sales"
  | "delivery"
  | "pm"
  | "pmo"
  | "dev"
  | "admin";

export type UsersStore = {
  users: AuthUser[];
};

export type InviteCodeRecord = {
  code: string;
  status: "active" | "used";
  createdAt: string;
  usedAt?: string;
  usedByUserId?: string;
  usedByUsername?: string;
};

// 阶段 2 批 1 第 4 步：InviteCodesStore / PasswordResetTokensStore 整存结构
// 已随 JSON 读写路径删除（邀请码与重置令牌切 PG，行级记录类型保留）。

export type PasswordResetTokenRecord = {
  id: string;
  userId: string;
  username: string;
  tokenHash: string;
  status: "active" | "used";
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
};

export type AuthJwtPayload = {
  sub: string;
  username: string;
  role: AuthUser["role"];
  businessRole: BusinessRole;
};

// -------------------- 版本管理相关 --------------------

export type VersionType = "assessment" | "resource" | "requirementImport" | "dev" | "global";
export type VersionStatus = "draft" | "reviewed" | "published" | "archived";

/** 检出状态：已检入 | 已检出 */
export type CheckoutStatus = "checked_in" | "checked_out";

/** 版本文档状态：修订中 | 已审核 */
export type VersionDocStatus = "drafting" | "reviewed";

export type VersionRecord = {
  id: string;
  type: VersionType;
  versionCode: string;
  templateId: string;
  ownerUserId: string;
  status: VersionStatus;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  createdByUsername: string;
  /** 最近一次写入该版本记录的用户（新建时与创建人相同） */
  updatedByUserId: string;
  updatedByUsername: string;
  reviewedAt?: string;
  reviewedByUserId?: string;
  // --- 检入检出字段 ---
  /** 检出状态，默认 checked_in */
  checkoutStatus: CheckoutStatus;
  /** 版本文档状态，默认 drafting */
  versionDocStatus: VersionDocStatus;
  /** 检出人 ID */
  checkedOutByUserId?: string;
  /** 检出人用户名 */
  checkedOutByUsername?: string;
  /** 检出时间 */
  checkoutAt?: string;
  /** 升版字母（A/B/C…），首版为 A */
  majorLetter: string;
  /** 检入轮次（首次检入为 1，每次检入 +1） */
  minorNumber: number;
  /** 单据基础码（不含 -Vxx 后缀） */
  baseCode: string;
  /** 是否历史归档版本（升版后旧版本为 true） */
  isHistoricalArchive: boolean;
  /** 归档时间 */
  archivedAt?: string;
  /** 升版前保留的最后检入 payload 快照（用于撤销检出恢复） */
  lastCheckinPayload?: Record<string, unknown>;
};

export type VersionsStore = {
  records: VersionRecord[];
};

// -------------------- 系统管理：版本号编码规则 --------------------

export type VersionCodeRuleStatus = "active" | "draft" | "disabled";

export type VersionCodeRuleModuleKey =
  | "global"
  | "requirement"
  | "implementation"
  | "dev"
  | "resource"
  | "wbs";

export type VersionCodeRule = {
  id: string;
  moduleKey: VersionCodeRuleModuleKey;
  moduleName: string;
  moduleCode: string;
  prefix: string;
  format: string;
  sample: string;
  status: VersionCodeRuleStatus;
  effectiveAt: string;
  updatedAt: string;
};

export type VersionCodeRulesStore = {
  rules: VersionCodeRule[];
};

// -------------------- 系统管理：需求模块配置 --------------------

export type RequirementKimiEvaluationConfig = {
  enabled: boolean;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  fallbackToRule: boolean;
  promptProfile: string;
  promptTemplate: string;
};

export type RequirementFileParsingConfig = {
  enabled: boolean;
  /** Excel/需求智能解析（parse-basic-info）使用的 Kimi 模型标识 */
  model: string;
  allowedExtensions: string[];
  maxFileSizeMb: number;
  maxSheetCount: number;
  strictMode: boolean;
  ocrEnabled: boolean;
};

export type RequirementKimiGenerationConfig = {
  enabled: boolean;
  model: string;
  temperature: number;
  maxTokens: number;
  outputStyle: "concise" | "balanced" | "detailed";
  includeRiskHints: boolean;
  includeAssumptions: boolean;
};

/** 需求模块 KIMI 调用密钥；非空时优先于环境变量 KIMI_API_KEY */
export type RequirementKimiCredentialsConfig = {
  apiKey: string;
};

// -------------------- RP-055：多供应商模型配置（Provider × 模型目录 × 场景绑定） --------------------

/** 首期仅支持 OpenAI 兼容协议（Moonshot/DeepSeek/GLM/OpenAI/vLLM 等均可接入） */
export type ModelProviderProtocol = "openai-compatible";

export type ModelProviderModel = {
  /** 模型 ID（供应商侧真实标识，如 kimi-k3、deepseek-chat） */
  id: string;
  /** 展示名（空则回退 id） */
  label: string;
  /** 能力标签，首期固定 ["chat"] */
  capabilities: string[];
  /** 参数支持矩阵（批 3 动态渲染用，如 ["temperature","maxTokens","timeoutMs"]） */
  supportedParams: string[];
};

export type ModelProvider = {
  /** 稳定 ID：内置为 "moonshot"，自定义为可读 slug */
  id: string;
  /** 用户自定义名称 */
  name: string;
  protocol: ModelProviderProtocol;
  baseUrl: string;
  enabled: boolean;
  models: ModelProviderModel[];
  createdAt: string;
  updatedAt: string;
};

export type ScenarioModelBinding = {
  providerId: string;
  modelId: string;
};

export type ScenarioModelBindings = {
  assessment: ScenarioModelBinding;
  fileParsing: ScenarioModelBinding;
  generation: ScenarioModelBinding;
};

export type RequirementSystemConfig = {
  kimiEvaluation: RequirementKimiEvaluationConfig;
  fileParsing: RequirementFileParsingConfig;
  kimiGeneration: RequirementKimiGenerationConfig;
  kimiCredentials: RequirementKimiCredentialsConfig;
  /** RP-055：供应商目录；normalize 保证落库后恒存在（旧配置自动迁移出内置 moonshot） */
  modelProviders?: ModelProvider[];
  /** RP-055：场景绑定；normalize 保证落库后恒存在（旧配置自动从 kimi* 字段推导） */
  scenarioBindings?: ScenarioModelBindings;
};

/** 返回给前端的密钥展示（永不下发明文） */
export type RequirementKimiCredentialsPublic = {
  apiKey: "";
  hint: string | null;
  envFallbackAvailable: boolean;
  resolvedFrom: "store" | "env" | "none";
};

export type RequirementSystemConfigPublic = Omit<RequirementSystemConfig, "kimiCredentials"> & {
  kimiCredentials: RequirementKimiCredentialsPublic;
};

export type RequirementSystemConfigStore = {
  version: number;
  draft: RequirementSystemConfig;
  active: RequirementSystemConfig;
  updatedAt: string;
  effectiveAt: string;
};

// -------------------- 系统管理：实施评估-依赖规则 --------------------

export type ImplementationDependencyRuleScope = "feature" | "scenario" | "data_source";

export type ImplementationDependencyRuleLogic = "requires_all" | "requires_any" | "combo";

export type ImplementationDependencyRuleItem = {
  id: string;
  subject: string;
  scope: ImplementationDependencyRuleScope;
  logic: ImplementationDependencyRuleLogic;
  trigger: string;
  dependencies: string[];
  anyOfGroups?: string[][];
  comboDependencies?: string[];
  note?: string;
  enabled: boolean;
};

export type ImplementationDependencyRulesConfig = {
  schemaVersion: string;
  source: string;
  updatedFrom: string;
  mutualExclusionRules: Array<{ left: string; right: string; reason: string }>;
  rules: ImplementationDependencyRuleItem[];
};

export type ImplementationDependencyRulesStore = {
  version: number;
  draft: ImplementationDependencyRulesConfig;
  active: ImplementationDependencyRulesConfig;
  updatedAt: string;
  effectiveAt: string;
};

// -------------------- 系统管理：知识库配置 --------------------

/** 智谱知识库凭证配置 */
export type KnowledgeBaseCredentialsConfig = {
  apiKey: string;
  /** @deprecated 旧版单知识库字段；读取时迁移到 knowledgeBases。 */
  knowledgeId: string;
};

export type KnowledgeBaseProfile = {
  /** WES 内部稳定标识，不等同供应商 Knowledge ID。 */
  id: string;
  name: string;
  description: string;
  knowledgeId: string;
  routingKeywords: string[];
  /** 空数组表示所有已认证业务角色均可访问。 */
  allowedBusinessRoles: BusinessRole[];
  enabled: boolean;
  isDefault: boolean;
  /** 数值越小，路由同分与回退时越优先。 */
  priority: number;
};

export type KnowledgeRetrievalParams = {
  topK: number;
  topN: number;
  recallMethod: "mixed" | "vector" | "keyword";
  rerankStatus: 0 | 1;
  rerankModel: string;
  fractionalThreshold: number;
};

export type KnowledgePromptProfile = {
  id: string;
  version: number;
};

/** 知识库配置（含模型与 API 地址） */
export type KnowledgeBaseConfig = {
  model: string;
  apiBaseUrl: string;
  credentials: KnowledgeBaseCredentialsConfig;
  knowledgeBases: KnowledgeBaseProfile[];
  retrievalParams: KnowledgeRetrievalParams;
  /** 旧版持久化数据可缺省，读取时由 repository 补齐。 */
  promptProfile?: KnowledgePromptProfile;
};

/** 返回给前端的密钥展示 */
export type KnowledgeBaseCredentialsPublic = {
  apiKey: "";
  apiHint: string | null;
  knowledgeId: string;
  envFallbackAvailable: boolean;
  resolvedFrom: "store" | "env" | "none";
};

export type KnowledgeBaseConfigPublic = Omit<KnowledgeBaseConfig, "credentials"> & {
  credentials: KnowledgeBaseCredentialsPublic;
};

export type KnowledgeBaseProbeRecord = {
  status: "success" | "failure";
  configHash: string;
  checkedAt: string;
  latencyMs: number;
  profileId?: string;
  warning?: "retrieval_empty";
  providerRequestId?: string;
  errorCode?: string;
};

export type KnowledgeBaseConfigStore = {
  version: number;
  draft: KnowledgeBaseConfig;
  active: KnowledgeBaseConfig;
  probes?: Record<string, KnowledgeBaseProbeRecord>;
  /** @deprecated 旧版单知识库 probe，读取后仅用于迁移兼容。 */
  probe?: KnowledgeBaseProbeRecord;
  updatedAt: string;
  effectiveAt: string;
};

// -------------------- 会话与幂等 --------------------

export type SessionEstimateContext = {
  sessionId: string;
  templateId: string;
  ruleSetId: string;
  ownerUserId: string;
  createdAt: number;
  expiresAt: number;
};

export type IdempotencyRecord = {
  ownerUserId: string;
  payloadHash: string;
  data: {
    totalDays: number;
    downloadUrl: string;
    expireAt: string;
  };
  requestId: string;
  createdAt: number;
};

// -------------------- 导出相关 --------------------

export type ExportHistoryItem = {
  fileName: string;
  size: number;
  modifiedAt: string;
  downloadUrl: string;
};

// -------------------- 类型守卫 --------------------

export function isVersionType(value: string): value is VersionType {
  return ["assessment", "resource", "requirementImport", "dev", "global"].includes(value);
}

export function isVersionStatus(value: string): value is VersionStatus {
  return ["draft", "reviewed", "published", "archived"].includes(value);
}

export function isCheckoutStatus(value: string): value is CheckoutStatus {
  return ["checked_in", "checked_out"].includes(value);
}

export function isVersionDocStatus(value: string): value is VersionDocStatus {
  return ["drafting", "reviewed"].includes(value);
}

/**
 * 迁移补全旧版本记录缺失的检入检出字段
 */
export function migrateVersionRecord(record: VersionRecord): VersionRecord {
  if (record.checkoutStatus === undefined) {
    record.checkoutStatus = "checked_in";
  }
  if (record.versionDocStatus === undefined) {
    record.versionDocStatus = "drafting";
  }
  if (record.majorLetter === undefined) {
    record.majorLetter = "A";
  }
  if (record.minorNumber === undefined) {
    record.minorNumber = 1;
  }
  if (record.baseCode === undefined) {
    record.baseCode = record.versionCode;
  }
  if (record.isHistoricalArchive === undefined) {
    record.isHistoricalArchive = false;
  }
  if (!record.createdByUserId) {
    record.createdByUserId = record.ownerUserId;
  }
  if (!record.createdByUsername) {
    record.createdByUsername = "—";
  }
  if (!record.updatedByUserId) {
    record.updatedByUserId = record.createdByUserId;
    record.updatedByUsername = record.createdByUsername;
  }
  return record;
}

export function isTemplateLike(input: unknown): input is Template {
  const t = input as Partial<Template>;
  return Boolean(
    t &&
      typeof t.templateId === "string" &&
      typeof t.templateVersion === "string" &&
      typeof t.templateName === "string" &&
      Array.isArray(t.groups) &&
      Array.isArray(t.items)
  );
}

export function isRuleSetLike(input: unknown): input is RuleSet {
  const r = input as Partial<RuleSet>;
  return Boolean(
    r &&
      typeof r.ruleSetId === "string" &&
      typeof r.ruleVersion === "string" &&
      typeof r.pipelineVersion === "string" &&
      Array.isArray(r.pipeline) &&
      r.baseRule &&
      Array.isArray(r.baseRule.userCountTiers) &&
      Array.isArray(r.baseRule.difficultyFactorList) &&
      r.orgIncrementRule &&
      typeof r.orgIncrementRule.enabled === "boolean"
  );
}
