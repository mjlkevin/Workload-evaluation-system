"use client"

import { apiRequest, ApiError, downloadWithAuth } from "@/lib/api-client"
import {
  mockAssessments,
  mockDevAssessments,
  mockInviteCodes,
  mockPlans,
  mockRequirements,
  mockResourceCosts,
  mockReviews,
  mockTeamBindings,
  mockUsers,
  mockWbs,
} from "@/lib/workload-mock"
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

type VersionType = "assessment" | "resource" | "requirementImport" | "dev" | "global"

type VersionRecordDto = {
  id: string
  type: VersionType
  versionCode: string
  templateId: string
  status: "draft" | "reviewed" | "published" | "archived"
  payload: Record<string, unknown>
  createdAt: string
  updatedAt: string
  reviewedAt?: string
  checkoutStatus?: "checked_in" | "checked_out"
  versionDocStatus?: "drafting" | "reviewed"
  checkedOutByUserId?: string
  checkedOutByUsername?: string
  checkoutAt?: string
  majorLetter?: string
  minorNumber?: number
  baseCode?: string
  isHistoricalArchive?: boolean
  archivedAt?: string
}

export type CoreModuleVersionType = Exclude<VersionType, "global">

export type ModuleVersionRecord = {
  id: string
  type: CoreModuleVersionType
  versionCode: string
  status: "draft" | "reviewed" | "published" | "archived"
  payload: Record<string, unknown>
  createdAt: string
  updatedAt: string
  checkoutStatus: "checked_in" | "checked_out"
  versionDocStatus: "drafting" | "reviewed"
  checkedOutByUserId?: string
  checkedOutByUsername?: string
  checkoutAt?: string
  majorLetter: string
  minorNumber: number
  baseCode: string
  isHistoricalArchive: boolean
  archivedAt?: string
}

export type ModuleDocListType = CoreModuleVersionType | "wbs" | "review"

export type ModuleDocListItem = {
  docKey: string
  moduleType: ModuleDocListType
  title: string
  latestVersionCode: string
  globalVersionCode: string
  projectName: string
  updatedAt: string
  statusText: string
  recordId?: string
  historySupported: boolean
  latestRecord?: ModuleVersionRecord
  historyRecords?: ModuleVersionRecord[]
}

export type GlobalVersionRecord = {
  id: string
  type: "global"
  versionCode: string
  status: "draft" | "reviewed" | "published" | "archived"
  payload: Record<string, unknown>
  createdAt: string
  updatedAt: string
  checkoutStatus: "checked_in" | "checked_out"
  versionDocStatus: "drafting" | "reviewed"
  checkedOutByUserId?: string
  checkedOutByUsername?: string
  checkoutAt?: string
  majorLetter: string
  minorNumber: number
  baseCode: string
  isHistoricalArchive: boolean
  archivedAt?: string
}

type TeamRecordDto = {
  teamId: string
  name: string
  ownerUserId: string
  members: Array<{ userId: string; role: string; joinedAt: string }>
  createdAt: string
  updatedAt: string
}

type TeamPlanListDto = {
  items: Array<{
    globalVersionCode: string
    projectName: string
    status: "draft" | "reviewed" | "published" | "archived"
    ownerUserId: string
    updatedAt: string
    reviewStatus: "none" | "open" | "closed"
  }>
}

type TeamReviewsDto = {
  items: Array<{
    reviewId: string
    teamId: string
    globalVersionCode: string
    title: string
    status: "open" | "closed"
    createdBy: string
    createdAt: string
    updatedAt: string
  }>
}

export type TemplateSummary = {
  templateId: string
  templateVersion: string
  templateName: string
}

export type TemplateItemOption = {
  templateItemId: string
  groupId: string
  itemName: string
  standardDays: number
  sheetName?: string
  cloudProduct?: string
  skuName?: string
  appGroup?: string
  deliveryModule?: string
  deliveryPoint?: string
  deliveryDesc?: string
  evalDesc?: string
  defaultIncluded?: boolean
}

export type TemplateDetail = {
  templateId: string
  templateVersion: string
  templateName: string
  groups: Array<{ groupId: string; groupName: string }>
  items: TemplateItemOption[]
  sheets?: Array<{ sheetId: string; sheetName: string }>
}

export type RuleSetMeta = {
  ruleSetId: string
  ruleVersion: string
  pipelineVersion: string
  pipeline: string[]
  baseRule: {
    userCountTiers: Array<{ min: number; max: number; factor: number }>
    difficultyFactorList: number[]
    userIncrementRounding?: "none" | "ceil_int"
  }
  orgIncrementRule: {
    enabled: boolean
    factor?: number
  }
}

export type VersionCodeRuleStatus = "active" | "draft" | "disabled"

export type VersionCodeRuleItem = {
  id: string
  moduleKey: "global" | "requirement" | "implementation" | "dev" | "resource" | "wbs"
  moduleName: string
  moduleCode: string
  prefix: string
  format: string
  sample: string
  status: VersionCodeRuleStatus
  effectiveAt: string
  updatedAt: string
}

export type EstimateItemSelection = {
  templateItemId: string
  included: boolean
  customStandardDays?: number
}

export type EstimateCalculatePayload = {
  templateId: string
  ruleSetId: string
  userCount: number
  difficultyFactor: number
  orgCount: number
  orgSimilarityFactor: number
  selectedSheet?: string
  exportProjectName?: string
  exportAssessmentVersionCode?: string
  items: EstimateItemSelection[]
}

export type EstimateResult = {
  templateId: string
  ruleSetId: string
  templateVersion: string
  ruleVersion: string
  pipelineVersion: string
  baseDays: number
  userIncrementDays: number
  difficultyIncrementDays: number
  orgIncrementDays: number
  totalDays: number
  calculationBreakdown: {
    userCountTier: { hitRange: string; factor: number; incrementDays: number }
    difficulty: { factor: number; incrementDays: number }
    organization: { orgCount: number; similarityFactor: number; incrementDays: number }
  }
  groupSubtotals: Array<{ groupId: string; groupName: string; subtotalDays: number }>
  itemResults: Array<{
    templateItemId: string
    included: boolean
    standardDays: number
    itemSubtotalDays: number
    effectiveStandardDays?: number
  }>
}

export type EstimateExportResult = {
  totalDays: number
  downloadUrl: string
  expireAt: string
}

export type ExportHistoryItem = {
  fileName: string
  size: number
  modifiedAt: string
  downloadUrl: string
}

const TEAM_ID_STORAGE_KEY = "workload-team-id-v1"

export type TeamRecordSummary = TeamRecordDto

export type TeamReviewComment = {
  commentId: string
  authorUserId: string
  content: string
  createdAt: string
}

export function getActiveTeamId(): string {
  if (typeof window === "undefined") return ""
  return window.localStorage.getItem(TEAM_ID_STORAGE_KEY) || ""
}

export function setActiveTeamId(teamId: string): void {
  if (typeof window === "undefined") return
  const id = teamId.trim()
  if (!id) {
    window.localStorage.removeItem(TEAM_ID_STORAGE_KEY)
    return
  }
  window.localStorage.setItem(TEAM_ID_STORAGE_KEY, id)
}

export async function fetchTeamDetail(teamId: string): Promise<TeamRecordDto> {
  const id = teamId.trim()
  if (!id) throw new Error("teamId 不能为空")
  return apiRequest<TeamRecordDto>(`/api/v1/teams/${encodeURIComponent(id)}`)
}

export async function addTeamMemberToTeam(teamId: string, userId: string, role: string): Promise<TeamRecordDto> {
  return apiRequest<TeamRecordDto>(`/api/v1/teams/${encodeURIComponent(teamId)}/members`, {
    method: "POST",
    body: { userId: userId.trim(), role: role.trim() },
  })
}

export async function fetchReviewComments(teamId: string, reviewId: string): Promise<TeamReviewComment[]> {
  const data = await apiRequest<{ items: TeamReviewComment[] }>(
    `/api/v1/teams/${encodeURIComponent(teamId)}/reviews/${encodeURIComponent(reviewId)}/comments`,
  )
  return data.items || []
}

export async function postTeamReviewComment(
  teamId: string,
  reviewId: string,
  content: string,
): Promise<TeamReviewComment> {
  return apiRequest<TeamReviewComment>(
    `/api/v1/teams/${encodeURIComponent(teamId)}/reviews/${encodeURIComponent(reviewId)}/comments`,
    {
      method: "POST",
      body: { content: content.trim() },
    },
  )
}

export async function createTeamReviewForPlan(
  teamId: string,
  globalVersionCode: string,
  title?: string,
): Promise<{ reviewId: string }> {
  const data = await apiRequest<{ reviewId: string }>(`/api/v1/teams/${encodeURIComponent(teamId)}/reviews`, {
    method: "POST",
    body: {
      globalVersionCode: globalVersionCode.trim(),
      ...(title?.trim() ? { title: title.trim() } : {}),
    },
  })
  return { reviewId: data.reviewId }
}

export async function closeTeamReview(teamId: string, reviewId: string): Promise<void> {
  await apiRequest(`/api/v1/teams/${encodeURIComponent(teamId)}/reviews/${encodeURIComponent(reviewId)}/status`, {
    method: "PATCH",
    body: { status: "closed" },
  })
}

async function withFallback<T>(task: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await task()
  } catch (error) {
    if (error instanceof ApiError) return fallback
    return fallback
  }
}

async function listVersions(type: VersionType): Promise<VersionRecordDto[]> {
  const params = new URLSearchParams({
    type,
    templateId: "default",
  })
  const data = await apiRequest<{ items: VersionRecordDto[] }>(`/api/v1/versions?${params.toString()}`)
  return data.items || []
}

export async function listModuleVersions(type: CoreModuleVersionType): Promise<ModuleVersionRecord[]> {
  const records = await listVersions(type)
  return records.map((x) => ({
    id: x.id,
    type: x.type as CoreModuleVersionType,
    versionCode: x.versionCode,
    status: x.status,
    payload: (x.payload || {}) as Record<string, unknown>,
    createdAt: x.createdAt,
    updatedAt: x.updatedAt,
    checkoutStatus: x.checkoutStatus ?? "checked_in",
    versionDocStatus: x.versionDocStatus ?? "drafting",
    checkedOutByUserId: x.checkedOutByUserId,
    checkedOutByUsername: x.checkedOutByUsername,
    checkoutAt: x.checkoutAt,
    majorLetter: x.majorLetter || "A",
    minorNumber: Number(x.minorNumber ?? 0),
    baseCode: x.baseCode || x.versionCode,
    isHistoricalArchive: Boolean(x.isHistoricalArchive),
    archivedAt: x.archivedAt,
  }))
}

export async function listGlobalVersions(): Promise<GlobalVersionRecord[]> {
  const records = await listVersions("global")
  return records.map((x) => ({
    id: x.id,
    type: "global",
    versionCode: x.versionCode,
    status: x.status,
    payload: (x.payload || {}) as Record<string, unknown>,
    createdAt: x.createdAt,
    updatedAt: x.updatedAt,
    checkoutStatus: x.checkoutStatus ?? "checked_in",
    versionDocStatus: x.versionDocStatus ?? "drafting",
    checkedOutByUserId: x.checkedOutByUserId,
    checkedOutByUsername: x.checkedOutByUsername,
    checkoutAt: x.checkoutAt,
    majorLetter: x.majorLetter || "A",
    minorNumber: Number(x.minorNumber ?? 0),
    baseCode: x.baseCode || x.versionCode,
    isHistoricalArchive: Boolean(x.isHistoricalArchive),
    archivedAt: x.archivedAt,
  }))
}

export async function checkoutVersionById(recordId: string): Promise<VersionRecordDto> {
  const data = await apiRequest<{ record: VersionRecordDto }>(`/api/v1/versions/${encodeURIComponent(recordId)}/checkout`, {
    method: "POST",
  })
  return data.record
}

export async function checkinVersionById(recordId: string, payload: Record<string, unknown>): Promise<{ record: VersionRecordDto; versionCode: string }> {
  const data = await apiRequest<{ record: VersionRecordDto; versionCode: string }>(
    `/api/v1/versions/${encodeURIComponent(recordId)}/checkin`,
    {
      method: "POST",
      body: { payload },
    },
  )
  return data
}

export async function undoCheckoutById(recordId: string): Promise<VersionRecordDto> {
  const data = await apiRequest<{ record: VersionRecordDto }>(`/api/v1/versions/${encodeURIComponent(recordId)}/undo-checkout`, {
    method: "POST",
  })
  return data.record
}

export async function promoteVersionById(recordId: string): Promise<{ archived: VersionRecordDto; newRecord: VersionRecordDto }> {
  return apiRequest<{ archived: VersionRecordDto; newRecord: VersionRecordDto }>(
    `/api/v1/versions/${encodeURIComponent(recordId)}/promote`,
    { method: "POST" },
  )
}

export async function forceUnlockById(recordId: string): Promise<VersionRecordDto> {
  const data = await apiRequest<{ record: VersionRecordDto }>(`/api/v1/versions/${encodeURIComponent(recordId)}/force-unlock`, {
    method: "PATCH",
  })
  return data.record
}

/** 按版本号删除当前用户的总方案（global）记录；需 operator/admin 权限 */
export async function deleteGlobalPlanVersion(versionCode: string): Promise<void> {
  const code = versionCode.trim()
  if (!code) throw new Error("版本号不能为空")
  const params = new URLSearchParams({ templateId: "default" })
  await apiRequest(`/api/v1/versions/global/${encodeURIComponent(code)}?${params.toString()}`, {
    method: "DELETE",
  })
}

/** 删除当前用户指定模块版本（非 global）；若被总方案引用，后端会返回业务错误。 */
export async function deleteModuleVersion(type: CoreModuleVersionType, versionCode: string): Promise<void> {
  const code = versionCode.trim()
  if (!code) throw new Error("版本号不能为空")
  const params = new URLSearchParams({ templateId: "default" })
  await apiRequest(`/api/v1/versions/${encodeURIComponent(type)}/${encodeURIComponent(code)}?${params.toString()}`, {
    method: "DELETE",
  })
}

export async function createModuleVersion(
  type: CoreModuleVersionType,
  payload: Record<string, unknown>,
  _prefix?: string,
): Promise<ModuleVersionRecord> {
  const data = await apiRequest<{ record: VersionRecordDto }>("/api/v1/versions", {
    method: "POST",
    body: {
      type,
      templateId: "default",
      status: "draft",
      payload,
    },
  })
  return {
    id: data.record.id,
    type: data.record.type as CoreModuleVersionType,
    versionCode: data.record.versionCode,
    status: data.record.status,
    payload: (data.record.payload || {}) as Record<string, unknown>,
    createdAt: data.record.createdAt,
    updatedAt: data.record.updatedAt,
  }
}

async function getTeamDetail(teamId: string): Promise<TeamRecordDto> {
  return apiRequest<TeamRecordDto>(`/api/v1/teams/${encodeURIComponent(teamId)}`)
}

async function getOrCreateDefaultTeam(): Promise<TeamRecordDto> {
  const storedTeamId =
    typeof window !== "undefined" ? window.localStorage.getItem(TEAM_ID_STORAGE_KEY) || "" : ""
  if (storedTeamId) {
    try {
      return await getTeamDetail(storedTeamId)
    } catch {
      // ignore and create a new team
    }
  }

  const created = await apiRequest<TeamRecordDto>("/api/v1/teams", {
    method: "POST",
    body: { name: "默认协同组" },
  })
  if (typeof window !== "undefined") {
    window.localStorage.setItem(TEAM_ID_STORAGE_KEY, created.teamId)
  }
  return created
}

async function listTeamPlans(teamId: string): Promise<TeamPlanListDto["items"]> {
  const data = await apiRequest<TeamPlanListDto>(`/api/v1/teams/${encodeURIComponent(teamId)}/plans`)
  return data.items || []
}

export async function listTeamReviews(teamId: string): Promise<TeamReviewsDto["items"]> {
  const data = await apiRequest<TeamReviewsDto>(`/api/v1/teams/${encodeURIComponent(teamId)}/reviews`)
  return data.items || []
}

export async function getTeamPlanOptions(): Promise<Array<{ globalVersionCode: string; projectName: string }>> {
  return withFallback(async () => {
    const team = await getOrCreateDefaultTeam()
    const plans = await listTeamPlans(team.teamId)
    return plans.map((x) => ({
      globalVersionCode: x.globalVersionCode,
      projectName: x.projectName || x.globalVersionCode,
    }))
  }, [])
}

export async function createReviewForVersion(globalVersionCode: string, title?: string): Promise<{ reviewId?: string }> {
  const code = globalVersionCode.trim()
  if (!code) throw new Error("请先输入总方案版本号")
  const team = await getOrCreateDefaultTeam()
  const data = await apiRequest<{ reviewId?: string }>(`/api/v1/teams/${encodeURIComponent(team.teamId)}/reviews`, {
    method: "POST",
    body: {
      globalVersionCode: code,
      title: title || `Review for ${code}`,
    },
  })
  return data
}

export async function closeReviewById(reviewId: string): Promise<void> {
  const id = reviewId.trim()
  if (!id) throw new Error("reviewId 不能为空")
  const team = await getOrCreateDefaultTeam()
  await apiRequest(`/api/v1/teams/${encodeURIComponent(team.teamId)}/reviews/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: { status: "closed" },
  })
}

export async function createTeamAndBindPlan(
  globalVersionCode: string,
  teamName: string,
): Promise<{ teamId: string; globalVersionCode: string }> {
  const code = globalVersionCode.trim()
  const name = teamName.trim()
  if (!code) throw new Error("请先输入总方案版本号")
  if (!name) throw new Error("请先输入新团队名称")

  const sourceTeam = await getOrCreateDefaultTeam()
  const targetTeam = await apiRequest<TeamRecordDto>("/api/v1/teams", {
    method: "POST",
    body: { name },
  })
  await apiRequest<{ updated: boolean }>(
    `/api/v1/teams/${encodeURIComponent(sourceTeam.teamId)}/plans/${encodeURIComponent(code)}/binding`,
    {
      method: "PATCH",
      body: { targetTeamId: targetTeam.teamId },
    },
  )

  return {
    teamId: targetTeam.teamId,
    globalVersionCode: code,
  }
}

export async function createGlobalPlanVersion(projectName?: string): Promise<{ versionCode: string }> {
  const payload = {
    projectName: projectName || "未命名项目",
    basicInfo: {
      projectName: projectName || "未命名项目",
    },
  }
  const data = await apiRequest<{ record: VersionRecordDto }>("/api/v1/versions", {
    method: "POST",
    body: {
      type: "global",
      templateId: "default",
      status: "draft",
      payload,
    },
  })
  return { versionCode: data.record.versionCode }
}

export async function listTemplateSummaries(): Promise<TemplateSummary[]> {
  return withFallback(async () => {
    const data = await apiRequest<{ list: TemplateSummary[] }>("/api/v1/templates")
    return data.list || []
  }, [])
}

export async function getTemplateDetail(templateId: string): Promise<TemplateDetail> {
  const id = templateId.trim()
  if (!id) {
    throw new Error("templateId 不能为空")
  }
  return apiRequest<TemplateDetail>(`/api/v1/templates/${encodeURIComponent(id)}`)
}

export async function getActiveRuleSet(): Promise<RuleSetMeta> {
  return apiRequest<RuleSetMeta>("/api/v1/rule-sets/active")
}

export async function calculateEstimate(payload: EstimateCalculatePayload): Promise<EstimateResult> {
  return apiRequest<EstimateResult>("/api/v1/estimates/calculate", {
    method: "POST",
    body: payload,
  })
}

export async function calculateAndExportEstimate(
  payload: EstimateCalculatePayload & { exportType: "excel" | "pdf" },
): Promise<EstimateExportResult> {
  return apiRequest<EstimateExportResult>("/api/v1/estimates/calculate-and-export", {
    method: "POST",
    body: payload,
  })
}

export async function downloadOwnedExportFile(downloadUrl: string, fileNameHint?: string): Promise<void> {
  const safeUrl = downloadUrl.trim()
  if (!safeUrl) throw new Error("下载链接为空")
  const normalized = safeUrl.startsWith("http")
    ? safeUrl
    : `${window.location.origin}${safeUrl.startsWith("/") ? "" : "/"}${safeUrl}`
  await downloadWithAuth(normalized, fileNameHint)
}

export async function listEstimateExportHistory(page = 1, pageSize = 8): Promise<{
  total: number
  items: ExportHistoryItem[]
}> {
  const safePage = Math.max(1, Number(page || 1))
  const safePageSize = Math.min(200, Math.max(1, Number(pageSize || 8)))
  return withFallback(
    async () => {
      const params = new URLSearchParams({
        page: String(safePage),
        pageSize: String(safePageSize),
      })
      const data = await apiRequest<{ total: number; items: ExportHistoryItem[] }>(`/api/v1/exports/history?${params.toString()}`)
      return { total: Number(data.total || 0), items: data.items || [] }
    },
    { total: 0, items: [] },
  )
}

function mapRecordStatusText(record: ModuleVersionRecord): string {
  if (record.checkoutStatus === "checked_out") return "已检出"
  if (record.versionDocStatus === "reviewed") return "已审核"
  if (record.isHistoricalArchive) return "历史归档"
  return "已检入"
}

function pickProjectNameFromPayload(payload: Record<string, unknown>): string {
  const fromRoot = String(payload.projectName || "").trim()
  if (fromRoot) return fromRoot
  const fromBasicInfo = String((payload.basicInfo as { projectName?: string } | undefined)?.projectName || "").trim()
  if (fromBasicInfo) return fromBasicInfo
  return "未命名项目"
}

/**
 * 聚合当前用户某模块“最新单据”：
 * - 有 globalVersionCode：按 globalVersionCode 取最新一条，其他作为历史
 * - 无 globalVersionCode：按 versionCode 作为独立单据
 */
export async function listLatestModuleDocuments(type: CoreModuleVersionType): Promise<ModuleDocListItem[]> {
  const records = await listModuleVersions(type)
  const grouped = new Map<string, ModuleVersionRecord[]>()
  for (const record of records) {
    const globalVersionCode = String(record.payload?.globalVersionCode || "").trim()
    const key = globalVersionCode || `standalone:${record.versionCode}`
    const list = grouped.get(key) || []
    list.push(record)
    grouped.set(key, list)
  }
  const items: ModuleDocListItem[] = []
  for (const [key, list] of grouped.entries()) {
    const sorted = [...list].sort(
      (a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)) || b.versionCode.localeCompare(a.versionCode),
    )
    const latest = sorted[0]
    if (!latest) continue
    const globalVersionCode = String(latest.payload?.globalVersionCode || "").trim() || "—"
    const projectName = pickProjectNameFromPayload(latest.payload || {})
    const latestVersionCode = latest.versionCode
    const title = projectName
    items.push({
      docKey: key,
      moduleType: type,
      title,
      latestVersionCode,
      globalVersionCode,
      projectName,
      updatedAt: latest.updatedAt,
      statusText: mapRecordStatusText(latest),
      recordId: latest.id,
      historySupported: true,
      latestRecord: latest,
      historyRecords: sorted,
    })
  }
  return items.sort(
    (a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)) || b.latestVersionCode.localeCompare(a.latestVersionCode),
  )
}

export async function getDashboardPlans(): Promise<PlanRow[]> {
  return withFallback(
    async () => {
      const [globals, assessments, resources, requirements, devs] = await Promise.all([
        listVersions("global"),
        listVersions("assessment"),
        listVersions("resource"),
        listVersions("requirementImport"),
        listVersions("dev"),
      ])

      const latestByGlobal = (records: VersionRecordDto[]) => {
        const map = new Map<string, { versionCode: string; updatedAtMs: number }>()
        for (const record of records) {
          const globalCode = String(record.payload?.globalVersionCode || "").trim()
          if (!globalCode) continue
          const currentMs = Number(new Date(record.updatedAt || 0))
          const existed = map.get(globalCode)
          if (!existed || currentMs >= existed.updatedAtMs) {
            map.set(globalCode, { versionCode: record.versionCode, updatedAtMs: currentMs })
          }
        }
        return map
      }

      const assessmentMap = latestByGlobal(assessments)
      const resourceMap = latestByGlobal(resources)
      const requirementMap = latestByGlobal(requirements)
      const devMap = latestByGlobal(devs)

      return globals
        .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)))
        .map((item, index) => ({
        id: index + 1,
        projectName:
          (item.payload?.basicInfo as { projectName?: string } | undefined)?.projectName || `未命名项目-${index + 1}`,
        globalVersion: item.versionCode,
        assessmentVersion:
          assessmentMap.get(item.versionCode)?.versionCode || (item.payload?.assessmentVersionCode as string) || "—",
        resourceVersion:
          resourceMap.get(item.versionCode)?.versionCode || (item.payload?.resourceVersionCode as string) || "—",
        requirementVersion:
          requirementMap.get(item.versionCode)?.versionCode || (item.payload?.requirementImportVersionCode as string) || "—",
        devVersion: devMap.get(item.versionCode)?.versionCode || (item.payload?.devAssessmentVersionCode as string) || "—",
        createdAt: item.createdAt || "—",
        updatedAt: item.updatedAt,
        reviewedAt: item.reviewedAt || "—",
        status: item.status === "archived" ? "已归档" : item.status === "reviewed" ? "待评审" : "进行中",
      }))
    },
    mockPlans,
  )
}

export async function getRequirementItems(): Promise<RequirementItem[]> {
  return withFallback(async () => {
    const records = await listVersions("requirementImport")
    const items: RequirementItem[] = []
    for (const record of records) {
      const payload = record.payload || {}
      const data = payload.requirementImportData as
        | {
            businessNeedRows?: Array<{
              rowId?: string
              businessDomain?: string
              category?: string
              title?: string
              proposer?: string
              requiresCustomDev?: string
            }>
          }
        | undefined
      const rows = data?.businessNeedRows || []
      for (const row of rows) {
        items.push({
          id: row.rowId || `req-${items.length + 1}`,
          domain: row.businessDomain || "未分类",
          category: row.category || "未分类",
          title: row.title || "未命名需求",
          owner: row.proposer || "未指派",
          customDev: row.requiresCustomDev === "是" ? "是" : "否",
        })
      }
    }
    return items.length > 0 ? items : mockRequirements
  }, mockRequirements)
}

export async function getAssessmentItems(): Promise<AssessmentItem[]> {
  return withFallback(async () => {
    const records = await listVersions("assessment")
    const items: AssessmentItem[] = records.slice(0, 12).map((record, idx) => {
      const payload = record.payload || {}
      const selectedTemplateItems = payload.selectedTemplateItems as Array<{ itemName?: string; standardDays?: number }> | undefined
      const first = selectedTemplateItems?.[0]
      return {
        id: record.id || `asm-${idx + 1}`,
        moduleName: first?.itemName || record.versionCode,
        difficulty: "中",
        users: Number(payload.userCount || 100 + idx * 20),
        days: Number(payload.totalDays || first?.standardDays || 20 + idx * 6),
      }
    })
    return items.length > 0 ? items : mockAssessments
  }, mockAssessments)
}

export async function getResourceCostItems(): Promise<ResourceCostItem[]> {
  return withFallback(async () => {
    const records = await listVersions("resource")
    const items: ResourceCostItem[] = []
    for (const record of records) {
      const rows =
        (record.payload?.rows as Array<{
          rowId?: string
          role?: string
          name?: string
          unitCost?: number
          plannedDays?: number
          travelCostTotal?: number
        }>) || []
      for (const row of rows) {
        items.push({
          id: row.rowId || `res-${items.length + 1}`,
          role: row.role || "顾问",
          name: row.name || "未命名",
          unitCost: Number(row.unitCost || 0),
          plannedDays: Number(row.plannedDays || 0),
          travelCost: Number(row.travelCostTotal || 0),
        })
      }
    }
    return items.length > 0 ? items : mockResourceCosts
  }, mockResourceCosts)
}

export async function getDevAssessmentItems(): Promise<DevAssessmentItem[]> {
  return withFallback(async () => {
    const records = await listVersions("dev")
    const items: DevAssessmentItem[] = []
    for (const record of records) {
      const rows =
        (record.payload?.rows as Array<{
          rowId?: string
          moduleName?: string
          devType?: "功能开发" | "报表开发" | "集成开发"
          codingDays?: number
          estimateBasis?: string
        }>) || []
      for (const row of rows) {
        items.push({
          id: row.rowId || `dev-${items.length + 1}`,
          moduleName: row.moduleName || record.versionCode,
          devType: row.devType || "功能开发",
          codingDays: Number(row.codingDays || 0),
          basis: row.estimateBasis || "历史项目对标",
        })
      }
    }
    return items.length > 0 ? items : mockDevAssessments
  }, mockDevAssessments)
}

export async function getWbsItems(): Promise<WbsItem[]> {
  return withFallback(async () => apiRequest<WbsItem[]>("/api/v1/wbs"), mockWbs)
}

/** 与后端 WBS 派生逻辑一致：按 `updatedAt` 取最新一条 `type=global` 总方案（用于 UI 说明）。 */
export async function getLatestGlobalVersionLabel(): Promise<{ versionCode: string; projectName: string } | null> {
  return withFallback(async () => {
    const records = await listVersions("global")
    if (!records.length) return null
    const sorted = [...records].sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)))
    const latest = sorted[0]
    const projectName =
      (latest.payload?.basicInfo as { projectName?: string } | undefined)?.projectName ||
      String(latest.payload?.projectName || "") ||
      ""
    return { versionCode: latest.versionCode, projectName: projectName || "未命名项目" }
  }, null)
}

export async function getReviewItems(): Promise<ReviewItem[]> {
  return withFallback(async () => {
    const team = await getOrCreateDefaultTeam()
    const reviews = await listTeamReviews(team.teamId)
    const items: ReviewItem[] = reviews.map((review) => ({
      id: review.reviewId,
      reviewId: review.reviewId,
      versionCode: review.globalVersionCode,
      reviewer: team.ownerUserId || "team-owner",
      status: review.status === "closed" ? "通过" : "待评审",
      updatedAt: review.updatedAt || "—",
    }))
    return items.length > 0 ? items : mockReviews
  }, mockReviews)
}

export async function getTeamBindings(): Promise<TeamPlanBinding[]> {
  return withFallback(async () => {
    const team = await getOrCreateDefaultTeam()
    const plans = await listTeamPlans(team.teamId)
    const items: TeamPlanBinding[] = plans.map((plan) => ({
      teamName: team.name,
      globalVersion: plan.globalVersionCode,
      owner: plan.ownerUserId || "unknown",
      memberCount: team.members.length,
    }))
    return items.length > 0 ? items : mockTeamBindings
  }, mockTeamBindings)
}

export async function getUsers(): Promise<UserItem[]> {
  return withFallback(async () => {
    const data = await apiRequest<{ users: UserItem[] }>("/api/v1/auth/users")
    return data.users || []
  }, mockUsers)
}

export async function updateUserStatus(userId: string, status: "active" | "disabled"): Promise<UserItem> {
  if (!userId) throw new Error("用户 ID 不能为空")
  const data = await apiRequest<{ user: UserItem }>(`/api/v1/auth/users/${encodeURIComponent(userId)}/status`, {
    method: "PATCH",
    body: { status },
  })
  return data.user
}

export async function getInviteCodes(): Promise<InviteCodeItem[]> {
  return withFallback(async () => {
    const data = await apiRequest<{ codes: InviteCodeItem[] }>("/api/v1/auth/invite-codes")
    return data.codes || []
  }, mockInviteCodes)
}

export async function generateInviteCode(): Promise<InviteCodeItem> {
  const data = await apiRequest<{ code: InviteCodeItem }>("/api/v1/auth/invite-codes/generate", {
    method: "POST",
    body: {},
  })
  return data.code
}

export async function listVersionCodeRules(params?: {
  moduleKey?: VersionCodeRuleItem["moduleKey"] | "all"
  keyword?: string
  status?: VersionCodeRuleStatus | "all"
}): Promise<VersionCodeRuleItem[]> {
  const search = new URLSearchParams()
  if (params?.moduleKey && params.moduleKey !== "all") search.set("moduleKey", params.moduleKey)
  if (params?.keyword?.trim()) search.set("keyword", params.keyword.trim())
  if (params?.status && params.status !== "all") search.set("status", params.status)
  const query = search.toString()
  const data = await apiRequest<{ items: VersionCodeRuleItem[] }>(
    `/api/v1/system/version-code-rules${query ? `?${query}` : ""}`,
  )
  return data.items || []
}

export async function updateVersionCodeRuleConfig(
  ruleId: string,
  payload: { prefix: string; format: string },
): Promise<VersionCodeRuleItem> {
  const id = ruleId.trim()
  if (!id) throw new Error("ruleId 不能为空")
  const data = await apiRequest<{ item: VersionCodeRuleItem }>(
    `/api/v1/system/version-code-rules/${encodeURIComponent(id)}/config`,
    {
      method: "PATCH",
      body: payload,
    },
  )
  return data.item
}

export async function activateVersionCodeRule(ruleId: string): Promise<VersionCodeRuleItem> {
  const id = ruleId.trim()
  if (!id) throw new Error("ruleId 不能为空")
  const data = await apiRequest<{ item: VersionCodeRuleItem }>(
    `/api/v1/system/version-code-rules/${encodeURIComponent(id)}/activate`,
    {
      method: "POST",
      body: {},
    },
  )
  return data.item
}

export async function disableVersionCodeRule(ruleId: string): Promise<VersionCodeRuleItem> {
  const id = ruleId.trim()
  if (!id) throw new Error("ruleId 不能为空")
  const data = await apiRequest<{ item: VersionCodeRuleItem }>(
    `/api/v1/system/version-code-rules/${encodeURIComponent(id)}/disable`,
    {
      method: "POST",
      body: {},
    },
  )
  return data.item
}

export const KIMI_ASSESSMENT_PREFILL_STORAGE_KEY = "wes-kimi-assessment-prefill-v1"

export type KimiAssessmentPreviewPayload = {
  source: {
    globalVersionCode?: string
    requirementVersionCode?: string
  }
  requirementSnapshot: {
    basicInfo: Record<string, unknown>
    valuePropositionRows: Array<Record<string, unknown>>
    businessNeedRows: Array<Record<string, unknown>>
    devOverviewRows: Array<Record<string, unknown>>
    productModuleRows: Array<Record<string, unknown>>
    implementationScopeRows: Array<Record<string, unknown>>
    meetingNotes: string
    keyPointRows: Array<Record<string, unknown>>
  }
  ruleContext?: {
    promptProfile?: string
  }
}

export type KimiAssessmentDraftModuleItem = {
  cloudProduct?: string
  skuName?: string
  moduleName: string
  standardDays: number
  suggestedDays: number
  reason: string
}

export type KimiAssessmentPreviewResult = {
  meta: {
    model: string
    generatedAt: string
    confidence: number
    promptVersion: string
    ruleSetId: string
    mode: "model" | "rule_fallback"
    fallbackReason?: string
    elapsedMs?: number
    rawContent?: string
  }
  source: {
    globalVersionCode: string
    requirementVersionCode: string
  }
  assessmentDraft: {
    quoteMode: string
    productLines: string[]
    userCount: number
    orgCount: number
    orgSimilarity: number
    difficultyFactor: number
    moduleItems: KimiAssessmentDraftModuleItem[]
    risks: string[]
    assumptions: string[]
  }
}

export async function generateKimiAssessmentPreview(
  payload: KimiAssessmentPreviewPayload,
): Promise<KimiAssessmentPreviewResult> {
  return apiRequest<KimiAssessmentPreviewResult>("/api/v1/ai/kimi-assessment/preview", {
    method: "POST",
    body: payload,
  })
}
