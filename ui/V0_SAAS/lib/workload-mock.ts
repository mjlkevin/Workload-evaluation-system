import type {
  AssessmentItem,
  DevAssessmentItem,
  InviteCodeItem,
  PlanRow,
  RequirementItem,
  ResourceCostItem,
  ReviewItem,
  TeamPlanBinding,
  UserItem,
  WbsItem,
} from "@/lib/workload-types"

export const mockPlans: PlanRow[] = [
  {
    id: 1,
    projectName: "华北制造集团 ERP 升级",
    globalVersion: "GLOBAL-20260329-01",
    assessmentVersion: "ASM-20260329-07",
    resourceVersion: "RES-20260329-04",
    requirementVersion: "REQ-20260329-03",
    devVersion: "DEV-20260329-02",
    createdAt: "2026-03-29 09:18",
    updatedAt: "今天 10:12",
    reviewedAt: "—",
    status: "进行中",
  },
  {
    id: 2,
    projectName: "零售连锁门店系统改造",
    globalVersion: "GLOBAL-20260328-02",
    assessmentVersion: "ASM-20260328-09",
    resourceVersion: "RES-20260328-06",
    requirementVersion: "REQ-20260328-05",
    devVersion: "DEV-20260328-03",
    createdAt: "2026-03-28 10:25",
    updatedAt: "昨天 18:43",
    reviewedAt: "2026-03-28 19:30",
    status: "待评审",
  },
]

export const mockRequirements: RequirementItem[] = [
  { id: "req-1", domain: "采购", category: "流程优化", title: "供应商准入审批流", owner: "李华", customDev: "是" },
  { id: "req-2", domain: "财务", category: "报表", title: "经营月报看板", owner: "王敏", customDev: "否" },
]

export const mockAssessments: AssessmentItem[] = [
  { id: "asm-1", moduleName: "采购管理", difficulty: "高", users: 230, days: 86 },
  { id: "asm-2", moduleName: "财务共享", difficulty: "中", users: 120, days: 54 },
]

export const mockResourceCosts: ResourceCostItem[] = [
  { id: "res-1", role: "项目经理", name: "张凯", unitCost: 2200, plannedDays: 32, travelCost: 6800 },
  { id: "res-2", role: "实施顾问", name: "赵玲", unitCost: 1600, plannedDays: 56, travelCost: 10200 },
]

export const mockDevAssessments: DevAssessmentItem[] = [
  { id: "dev-1", moduleName: "订单同步接口", devType: "集成开发", codingDays: 18, basis: "历史同类项目对标" },
  { id: "dev-2", moduleName: "库存预警报表", devType: "报表开发", codingDays: 8, basis: "复杂度中等，单源数据" },
]

export const mockWbs: WbsItem[] = [
  { id: "wbs-1", taskName: "蓝图调研", owner: "李华", start: "2026-04-01", end: "2026-04-10", status: "进行中" },
  { id: "wbs-2", taskName: "系统联调", owner: "张凯", start: "2026-04-11", end: "2026-04-22", status: "未开始" },
]

export const mockReviews: ReviewItem[] = [
  { id: "rv-1", versionCode: "GLOBAL-20260329-01", reviewer: "王总", status: "待评审", updatedAt: "今天 11:02" },
  { id: "rv-2", versionCode: "GLOBAL-20260328-02", reviewer: "刘总监", status: "通过", updatedAt: "昨天 19:20" },
]

export const mockTeamBindings: TeamPlanBinding[] = [
  { teamName: "华北交付一组", globalVersion: "GLOBAL-20260329-01", owner: "李华", memberCount: 8 },
  { teamName: "零售专项组", globalVersion: "GLOBAL-20260328-02", owner: "张凯", memberCount: 6 },
]

export const mockUsers: UserItem[] = [
  { id: "u-1", username: "admin", role: "admin", status: "active", lastLoginAt: "2026-03-30 09:10" },
  { id: "u-2", username: "lilei", role: "sub_admin", status: "active", lastLoginAt: "2026-03-30 10:42" },
  { id: "u-3", username: "hanmeimei", role: "user", status: "disabled", lastLoginAt: "2026-03-29 19:33" },
]

export const mockInviteCodes: InviteCodeItem[] = [
  { code: "INVITE-8Q2H-3M", status: "active", createdAt: "2026-03-29 14:20" },
  { code: "INVITE-7A1K-9P", status: "used", createdAt: "2026-03-28 09:03" },
]
