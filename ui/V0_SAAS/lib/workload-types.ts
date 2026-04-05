export type PlanRow = {
  id: number
  projectName: string
  globalVersion: string
  assessmentVersion: string
  resourceVersion: string
  requirementVersion: string
  devVersion: string
  createdAt: string
  updatedAt: string
  reviewedAt: string
  status: "进行中" | "待评审" | "已归档"
}

export type RequirementItem = {
  id: string
  domain: string
  category: string
  title: string
  owner: string
  customDev: "是" | "否"
}

export type AssessmentItem = {
  id: string
  moduleName: string
  difficulty: "低" | "中" | "高"
  users: number
  days: number
}

export type ResourceCostItem = {
  id: string
  role: string
  name: string
  unitCost: number
  plannedDays: number
  travelCost: number
}

export type DevAssessmentItem = {
  id: string
  moduleName: string
  devType: "功能开发" | "报表开发" | "集成开发"
  codingDays: number
  basis: string
}

export type WbsItem = {
  id: string
  moduleKey?: "requirementImport" | "assessment" | "dev" | "resource"
  taskName: string
  owner: string
  linkedVersionCode?: string
  sourceGlobalVersionCode?: string
  sourceGlobalRecordId?: string
  isDerived?: boolean
  start: string
  end: string
  status: "未开始" | "进行中" | "已完成"
}

export type ReviewItem = {
  id: string
  reviewId?: string
  versionCode: string
  reviewer: string
  status: "待评审" | "通过" | "驳回"
  updatedAt: string
}

export type TeamPlanBinding = {
  teamName: string
  globalVersion: string
  owner: string
  memberCount: number
}

export type UserItem = {
  id: string
  username: string
  role: "admin" | "user"
  status: "active" | "disabled"
  lastLoginAt: string
}

export type InviteCodeItem = {
  code: string
  status: "active" | "used"
  createdAt: string
}
