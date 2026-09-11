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

// S7（2026-08-31，台账 B10①）：`VersionsStore`（records.json 整存形状）已删除
// ——S4 后 versions 域行级 PG 仓储零引用，保留它会误导「还存在整份快照结构」。

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
  /** 供应商业务码（HTTP 200 时智谱将错误码放响应体；仅业务失败分支透传）。 */
  providerCode?: number;
  /** 供应商原始 msg（截断 200 字符；仅业务失败分支透传）。 */
  providerMessage?: string;
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

// -------------------- 批次 6b：工具策略（system_configs 第五配置区） --------------------
//
// 代码/数据边界（要害）：落库的只有**策略**——启用、角色可见、审批要求、注入模式。
// 工具的 execute、参数 schema、实现**留在代码**；清单仍从运行时 ToolRegistry 派生
// （批次 6a 裁决）：策略是挂在清单上的决定，不是清单的副本。
// 策略层只做减法：capability/角色/启用三层全部通过才注入，缺省即不额外限制。

/**
 * 注入模式（策略侧）。刻意只有降档词汇：
 * - "default"   跟随代码注册（常驻 or 按需发现由代码 discoverable 决定）
 * - "on-demand" 强制按需发现——全量注入通道不再主动注入该工具
 * 不存在「强制常驻」：把代码标记为按需发现的工具提升为常驻属于**加法**，
 * 与「策略只做减法、不得成为提权入口」的裁决冲突。
 */
export const TOOL_POLICY_INJECTION_MODES = ["default", "on-demand"] as const;
export type ToolPolicyInjectionMode = (typeof TOOL_POLICY_INJECTION_MODES)[number];

/**
 * 审批策略（策略侧）。同样只有收紧方向：
 * - "default"      按代码口径（mutates / exfiltrates 决定）
 * - "user-confirm" 强制逐次用户确认（即使代码标记 mutates=false 的只读工具）
 * 「免审批」不在词汇表内：只读工具本就走 allow 档，无需策略再放行；
 * 而写/外发工具的审批是代码侧下限，策略不得解除。外发类工具（exfiltrates=true）
 * 永远强制 user-confirm，不适用任何「记住本次选择」豁免——每次外发的内容都不同。
 */
export const TOOL_POLICY_APPROVAL_STRATEGIES = ["default", "user-confirm"] as const;
export type ToolPolicyApprovalStrategy = (typeof TOOL_POLICY_APPROVAL_STRATEGIES)[number];

/** 单个工具的策略决定（稀疏覆盖：未列出的工具全部走代码默认） */
export type ToolPolicyEntry = {
  /** 是否启用；false → 任何通道都不注入、不可执行 */
  enabled: boolean;
  /** 可见角色（v2 角色名）。空数组 = 不额外限制，仅由 capability 过滤决定 */
  visibleRoles: string[];
  /** 审批策略 */
  approvalStrategy: ToolPolicyApprovalStrategy;
  /** 注入模式 */
  injectionMode: ToolPolicyInjectionMode;
};

/** 工具策略配置（draft / active 同形状） */
export type ToolPolicyConfig = {
  schemaVersion: number;
  /** 按工具名的策略覆盖；未列出的工具走代码默认（启用 + 无角色限制 + 代码审批口径） */
  policies: Record<string, ToolPolicyEntry>;
};

/** 变更轨迹单条改动（字段级，供审计页呈现「改了什么」） */
export type ToolPolicyRevisionChange = {
  tool: string;
  field: "enabled" | "visibleRoles" | "approvalStrategy" | "injectionMode";
  from: string;
  to: string;
};

/** 变更轨迹条目：谁、何时、改了什么，绑定当时的 version */
export type ToolPolicyRevision = {
  seq: number;
  /** 该条落库时 store 的 version（draft-update 不改 version，activate 改后记新值） */
  version: number;
  action: "draft-update" | "activate";
  /** 操作者用户名（JWT 可信身份） */
  actor: string;
  at: string;
  changes: ToolPolicyRevisionChange[];
};

/** 工具策略 store：与其余配置区同构的 draft→生效 + version，外加轨迹数组 */
export type ToolPolicyStore = {
  version: number;
  draft: ToolPolicyConfig;
  active: ToolPolicyConfig;
  updatedAt: string;
  effectiveAt: string;
  /** 有界轨迹（最近 TOOL_POLICY_REVISION_LIMIT 条，新→旧或旧→新由 normalize 统一为旧→新） */
  revisions: ToolPolicyRevision[];
};

/** 轨迹上限：配置区是 jsonb 单行，不封顶会让高频改草稿无限撑大行 */
export const TOOL_POLICY_REVISION_LIMIT = 50;

// -------------------- 批次 7：MCP 服务接入（system_configs 第六配置区） --------------------
//
// 落库边界（裁决一，要害）：这里存的只有两样——
//  ① 接了哪些服务（名称、地址、传输方式、凭据**引用**、超时）；
//  ② 每个服务下**被人工放行**的工具名单（上报名 + 放行时看到的定义摘要）。
// 服务提供哪些工具、参数 schema、description **绝不落库**——每次回合现问（tools/list），
// 定义摘要对不上即自动回落未放行（裁决二第三条）。任何「把 tools/list 结果存下来下次
// 直接用」的形态都是清单副本，且是第三方可变而我方不可见的副本，属本批失败。

/** 传输方式：stdio（本机拉起子进程）与 streamable HTTP。不提供发现即可用形态——配了才连。 */
export const MCP_TRANSPORTS = ["stdio", "http"] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

/** 单个 MCP 工具的人工放行条目：摘要 = sha256(稳定序列化(上报名+description+inputSchema)) 前 32 位 */
export type McpToolApproval = {
  /** 放行时观察到的定义摘要；运行时每回合复算，不等即回落未放行 */
  digest: string;
  /** 放行人（JWT 可信身份 username） */
  approvedBy: string;
  approvedAt: string;
};

/** 一个 MCP 服务条目（显式允许清单的成员；凭据只存 credentials 域的 scope 引用，裁决六） */
export type McpServerEntry = {
  /** 内部稳定标识：^[a-z0-9][a-z0-9_-]{0,31}$，参与工具稳定名 mcp__<id>__<tool>；改 id 即新服务 */
  id: string;
  /** 展示名 */
  name: string;
  transport: McpTransport;
  /** transport=http 时必填；仅 http(s):// */
  url: string;
  /** transport=http：携带凭据的方式（bearer = Authorization 头，值从 credentialScope 现取） */
  authType: "none" | "bearer";
  /** transport=stdio 时必填：白名单命令或绝对路径 */
  command: string;
  /** transport=stdio：固定参数 */
  args: string[];
  /** transport=stdio：额外环境变量（非敏感；敏感值一律走 credentialScope 注入固定键） */
  env: Record<string, string>;
  /** credentials 域 scope 引用；空 = 无凭据。真实密钥永不进本配置区 */
  credentialScope: string;
  /** 回合级显式超时（连接+列工具+调用共用）；缺省回落 MCP_SERVER_DEFAULT_TIMEOUT_MS，不允许无限等 */
  timeoutMs: number;
  /** 被人工放行的工具：键为服务**上报**的工具名（非稳定名），值为放行条目 */
  approvedTools: Record<string, McpToolApproval>;
};

/** MCP 服务配置（draft / active 同形状） */
export type McpConfig = {
  schemaVersion: number;
  servers: McpServerEntry[];
};

/** 变更轨迹单条（target 形如 server:<id> 或 server:<id>#<tool>） */
export type McpRevisionChange = {
  target: string;
  field: string;
  from: string;
  to: string;
};

export type McpRevision = {
  seq: number;
  version: number;
  action: "draft-update" | "activate";
  actor: string;
  at: string;
  changes: McpRevisionChange[];
};

/** 第六配置区 store：与第五区同构的 draft→生效 + version + 有界轨迹 */
export type McpConfigStore = {
  version: number;
  draft: McpConfig;
  active: McpConfig;
  updatedAt: string;
  effectiveAt: string;
  revisions: McpRevision[];
};

export const MCP_REVISION_LIMIT = 50;
/** 服务数上限：单回合要逐个建连，无封顶会让配置页把工作台拖成串行动物园 */
export const MCP_SERVER_LIMIT = 20;
/** 超时缺省值：显式设置而非依赖 SDK 默认（裁决五「超时值要显式设置并可配」） */
export const MCP_SERVER_DEFAULT_TIMEOUT_MS = 8000;
export const MCP_SERVER_TIMEOUT_BOUNDS = { min: 500, max: 60000 } as const;
/** stdio 命令白名单：PATH 内 node/npx/tsx 或绝对路径脚本；防配置页变成任意命令执行器 */
export const MCP_STDIO_COMMAND_ALLOWLIST = ["node", "npx", "tsx"] as const;
/** stdio 子进程可见凭据的固定环境变量名（值来自 credentials 域，绝不进配置区） */
export const MCP_CREDENTIAL_ENV_KEY = "WES_MCP_CREDENTIAL";

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

// S7（2026-08-31，台账 B10①）：原 migrateVersionRecord() 已删除——它专为旧
// records.json 缺字段补全而存在，S4 删除 JSON 读路径后零调用方（PG 写入恒为
// 完整字段，见 versions.usecase.ts 头注）。

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
