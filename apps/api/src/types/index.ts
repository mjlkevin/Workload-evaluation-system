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
