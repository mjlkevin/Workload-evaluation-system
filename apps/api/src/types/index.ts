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

// -------------------- 需求导入相关 --------------------

export type BasicProjectInfo = {
  customerName: string;
  projectName: string;
  opportunityNo: string;
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
  role: "admin" | "user";
  status: "active" | "disabled";
  createdAt: string;
  lastLoginAt: string;
};

export type PublicUser = Omit<AuthUser, "passwordHash">;

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

export type InviteCodesStore = {
  codes: InviteCodeRecord[];
};

export type AuthJwtPayload = {
  sub: string;
  username: string;
  role: AuthUser["role"];
};

// -------------------- 版本管理相关 --------------------

export type VersionType = "assessment" | "resource" | "requirementImport" | "dev" | "global";
export type VersionStatus = "draft" | "reviewed" | "published" | "archived";

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
  reviewedAt?: string;
  reviewedByUserId?: string;
};

export type VersionsStore = {
  records: VersionRecord[];
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
