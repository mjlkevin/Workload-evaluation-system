"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { shouldSuppressUnsavedPrompt, useSetUnsavedDirty } from "@/hooks/use-unsaved-changes"
import { ModuleShell } from "@/components/workload/module-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { VersionVcsToolbar } from "@/components/workload/version-vcs-toolbar"
import { recordsToVersionHistoryRows, VersionHistoryDialog } from "@/components/workload/version-history-dialog"
import { TableTemplate } from "@/components/table-template"
import { useAuth } from "@/hooks/use-auth"
import { apiRequest } from "@/lib/api-client"
import { cn } from "@/lib/utils"
import {
  checkinVersionById,
  checkoutVersionById,
  createModuleVersion,
  forceUnlockById,
  generateKimiAssessmentPreview,
  getDashboardPlans,
  KIMI_ASSESSMENT_PREFILL_STORAGE_KEY,
  listModuleVersions,
  type KimiAssessmentPreviewResult,
  type ModuleVersionRecord,
  promoteVersionById,
  undoCheckoutById,
} from "@/lib/workload-service"
import { toast } from "sonner"

type BasicInfo = {
  customerName: string
  projectName: string
  opportunityNo: string
  productLines: string[]
  customerIndustry: string
  enterpriseRevenue: string
  itStatus: string
  expectedGoLive: string
  enterpriseProfile: string
  projectBackgroundNeeds: string
  projectGoals: string
}

type BusinessNeedRow = {
  id: string
  businessDomain: string
  category: string
  businessNeed: string
  proposer: string
  title: string
  requiresCustomDev: "是" | "否"
}

type DevOverviewRow = {
  id: string
  businessDomain: string
  moduleName: string
  moduleBrief: string
  functionDesc: string
  solutionSuggestion: string
  codingDays: number
  estimateBasis: string
}

type ValuePropositionRow = {
  id: string
  summary: string
  refinedContent: string
  originalDemand: string
  interviewOutline: string
}

type ProductModuleRow = {
  id: string
  productDomain: string
  moduleName: string
  subModule: string
  userCount: string
  implementationOrgCount: string
  pilotOrgCount: string
  partyBLead: string
  partyALead: string
}

type ImplementationScopeRow = {
  id: string
  companyName: string
  companyType: string
  moduleScope: string
  location: string
  implementationMode: string
  note: string
}

type KeyPointRow = {
  id: string
  analysisCategory: string
  subItem: string
  detail: string
  note: string
}

type ParseBasicInfoResponse = {
  basicInfo: Partial<BasicInfo>
  requirementImportData?: {
    valuePropositionRows?: Array<Partial<ValuePropositionRow>>
    businessNeedRows?: Array<Partial<BusinessNeedRow>>
    devOverviewRows?: Array<Partial<DevOverviewRow>>
    productModuleRows?: Array<Partial<ProductModuleRow>>
    implementationScopeRows?: Array<Partial<ImplementationScopeRow>>
    meetingNotes?: string
    keyPointRows?: Array<Partial<KeyPointRow>>
  }
  model: string
  mode?: "model" | "rule_fallback"
  fallbackReason?: string
}

type CompanyProfileSummaryResponse = {
  enterpriseProfile: string
  customerIndustry: string
  enterpriseRevenue: string
  itStatus: string
  model: string
  mode?: "model" | "rule_fallback"
  fallbackReason?: string
}

function createEmptyBusinessNeedRow(): BusinessNeedRow {
  return {
    id: crypto.randomUUID(),
    businessDomain: "",
    category: "",
    businessNeed: "",
    proposer: "",
    title: "",
    requiresCustomDev: "否",
  }
}

function createEmptyDevOverviewRow(): DevOverviewRow {
  return {
    id: crypto.randomUUID(),
    businessDomain: "",
    moduleName: "",
    moduleBrief: "",
    functionDesc: "",
    solutionSuggestion: "",
    codingDays: 0,
    estimateBasis: "",
  }
}

function createEmptyValuePropositionRow(): ValuePropositionRow {
  return {
    id: crypto.randomUUID(),
    summary: "",
    refinedContent: "",
    originalDemand: "",
    interviewOutline: "",
  }
}

function createEmptyProductModuleRow(): ProductModuleRow {
  return {
    id: crypto.randomUUID(),
    productDomain: "",
    moduleName: "",
    subModule: "",
    userCount: "",
    implementationOrgCount: "",
    pilotOrgCount: "",
    partyBLead: "",
    partyALead: "",
  }
}

function createEmptyImplementationScopeRow(): ImplementationScopeRow {
  return {
    id: crypto.randomUUID(),
    companyName: "",
    companyType: "",
    moduleScope: "",
    location: "",
    implementationMode: "",
    note: "",
  }
}

function createEmptyKeyPointRow(): KeyPointRow {
  return {
    id: crypto.randomUUID(),
    analysisCategory: "",
    subItem: "",
    detail: "",
    note: "",
  }
}

function isUncertainRevenue(value: string): boolean {
  const text = value.trim()
  if (!text) return true
  if (/未公开|未知|不详|待补充|暂缺|无法判断|n\/a|暂无|行业估计|区间估计/i.test(text)) return true
  // 没有任何数字通常表示缺少可落地的营收量化信息
  if (!/\d/.test(text)) return true
  return false
}

function isUncertainItStatus(value: string): boolean {
  const text = value.trim()
  if (!text) return true
  if (/未知|不详|待补充|暂缺|无法判断|信息不足|暂无|较弱|一般|初级|基础薄弱/i.test(text)) return true
  // 没有具体系统/平台线索时，认为不够明确
  const systemKeyword =
    /erp|crm|mes|oa|wms|bi|srm|plm|sap|oracle|salesforce|金蝶|用友|泛微|钉钉|企业微信|系统|平台|中台|数据仓库|主数据|集成/i
  if (!systemKeyword.test(text)) return true
  return false
}

function parseIndustryTags(value: string): string[] {
  const text = (value || "").trim()
  if (!text) return []
  return text
    .replace(/[／/\\|]+/g, " > ")
    .replace(/[＞>]+/g, " > ")
    .replace(/[，、;；]+/g, " > ")
    .replace(/\s*-\s*/g, " > ")
    .split(">")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 4)
}

function normalizeProductLines(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const line of value) {
    const text = String(line || "").trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
  }
  return result
}

function buildVersionOptions(records: ModuleVersionRecord[]) {
  return records.map((x) => ({ value: x.versionCode, label: `${x.versionCode}（${x.updatedAt}）` }))
}

const EMPTY_BASIC_INFO: BasicInfo = {
  customerName: "",
  projectName: "",
  opportunityNo: "",
  productLines: [],
  customerIndustry: "",
  enterpriseRevenue: "",
  itStatus: "",
  expectedGoLive: "",
  enterpriseProfile: "",
  projectBackgroundNeeds: "",
  projectGoals: "",
}

const PRODUCT_LINE_OPTIONS = ["金蝶AI星空", "金蝶AI星瀚", "云之家", "发票云"] as const

type RequirementSectionKey =
  | "basicInfo"
  | "valueProposition"
  | "businessNeed"
  | "devOverview"
  | "productModule"
  | "implementationScope"
  | "meetingNotes"
  | "keyPoints"

function createInitialSectionCollapsed(): Record<RequirementSectionKey, boolean> {
  return {
    basicInfo: true,
    valueProposition: true,
    businessNeed: true,
    devOverview: true,
    productModule: true,
    implementationScope: true,
    meetingNotes: true,
    keyPoints: true,
  }
}

export default function RequirementImportPage() {
  const router = useRouter()
  const { isAdmin } = useAuth()
  const [keyword, setKeyword] = useState("")
  const [businessNeedViewMode, setBusinessNeedViewMode] = useState<"list" | "grid">("list")
  const [globalVersionCode, setGlobalVersionCode] = useState("")
  const [globalOptions, setGlobalOptions] = useState<Array<{ value: string; label: string }>>([])
  const [versionOptions, setVersionOptions] = useState<Array<{ value: string; label: string }>>([])
  const [versionRecords, setVersionRecords] = useState<ModuleVersionRecord[]>([])
  const [selectedVersionCode, setSelectedVersionCode] = useState("")
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false)
  const [basicInfo, setBasicInfo] = useState<BasicInfo>(EMPTY_BASIC_INFO)
  const [valuePropositionRows, setValuePropositionRows] = useState<ValuePropositionRow[]>([createEmptyValuePropositionRow()])
  const [businessNeedRows, setBusinessNeedRows] = useState<BusinessNeedRow[]>([createEmptyBusinessNeedRow()])
  const [devOverviewRows, setDevOverviewRows] = useState<DevOverviewRow[]>([createEmptyDevOverviewRow()])
  const [productModuleRows, setProductModuleRows] = useState<ProductModuleRow[]>([createEmptyProductModuleRow()])
  const [implementationScopeRows, setImplementationScopeRows] = useState<ImplementationScopeRow[]>([
    createEmptyImplementationScopeRow(),
  ])
  const [meetingNotes, setMeetingNotes] = useState("")
  const [keyPointRows, setKeyPointRows] = useState<KeyPointRow[]>([createEmptyKeyPointRow()])
  const [saving, setSaving] = useState(false)
  const [createNewConfirmOpen, setCreateNewConfirmOpen] = useState(false)
  const [createNewSubmitting, setCreateNewSubmitting] = useState(false)
  const [hasLocalChanges, setHasLocalChanges] = useState(false)
  const [basicInfoModelName, setBasicInfoModelName] = useState("kimi-k2.5")
  const [basicInfoImportVisible, setBasicInfoImportVisible] = useState(false)
  const [basicInfoImportFile, setBasicInfoImportFile] = useState<File | null>(null)
  const [basicInfoImporting, setBasicInfoImporting] = useState(false)
  const [basicInfoImportError, setBasicInfoImportError] = useState("")
  const [enterpriseProfileGenerating, setEnterpriseProfileGenerating] = useState(false)
  const [kimiHelpOpen, setKimiHelpOpen] = useState(false)
  const kimiHelpCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [enterpriseProfilePreviewVisible, setEnterpriseProfilePreviewVisible] = useState(false)
  const [enterpriseProfileGeneratedText, setEnterpriseProfileGeneratedText] = useState("")
  const [enterpriseProfileGeneratedFields, setEnterpriseProfileGeneratedFields] = useState({
    customerIndustry: "",
    enterpriseRevenue: "",
    itStatus: "",
  })
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [sectionCollapsed, setSectionCollapsed] = useState<Record<RequirementSectionKey, boolean>>(
    createInitialSectionCollapsed(),
  )
  const [valuePropositionViewMode, setValuePropositionViewMode] = useState<"list" | "grid">("list")
  const enterpriseProfileRef = useRef<HTMLTextAreaElement | null>(null)
  const projectBackgroundNeedsRef = useRef<HTMLTextAreaElement | null>(null)
  const projectGoalsRef = useRef<HTMLTextAreaElement | null>(null)

  const setDirty = useSetUnsavedDirty()
  const dirtyEnabled = useRef(false)
  const initialEmbedQueryRef = useRef<{ globalVersion: string; version: string } | null>(null)
  const initialEmbedAppliedRef = useRef(false)
  const suppressUnsavedPrompt = shouldSuppressUnsavedPrompt(
    versionRecords.find((x) => x.versionCode === selectedVersionCode),
  )

  function showGlobalNotice(text: string) {
    setMessage(text)
    toast(text)
  }

  function clearKimiHelpCloseTimer() {
    if (kimiHelpCloseTimerRef.current) {
      clearTimeout(kimiHelpCloseTimerRef.current)
      kimiHelpCloseTimerRef.current = null
    }
  }

  function openKimiHelpByHover() {
    clearKimiHelpCloseTimer()
    setKimiHelpOpen(true)
  }

  function scheduleCloseKimiHelpByHover() {
    clearKimiHelpCloseTimer()
    kimiHelpCloseTimerRef.current = setTimeout(() => {
      setKimiHelpOpen(false)
    }, 120)
  }

  function autoResizeTextarea(el: HTMLTextAreaElement | null, minHeight = 72) {
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.max(el.scrollHeight, minHeight)}px`
  }

  useEffect(() => {
    return () => {
      clearKimiHelpCloseTimer()
    }
  }, [])

  useEffect(() => {
    autoResizeTextarea(enterpriseProfileRef.current, 72)
  }, [basicInfo.enterpriseProfile])

  useEffect(() => {
    autoResizeTextarea(projectBackgroundNeedsRef.current, 72)
  }, [basicInfo.projectBackgroundNeeds])

  useEffect(() => {
    autoResizeTextarea(projectGoalsRef.current, 72)
  }, [basicInfo.projectGoals])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    initialEmbedQueryRef.current = {
      globalVersion: params.get("globalVersion") || "",
      version: params.get("version") || "",
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const [plans, records] = await Promise.all([getDashboardPlans(), listModuleVersions("requirementImport")])
        setGlobalOptions(
          plans.map((x) => ({
            value: x.globalVersion,
            label: `${x.globalVersion}（${x.projectName}）`,
          })),
        )
        setVersionRecords(records)
        setVersionOptions(buildVersionOptions(records))
        const initialQuery = initialEmbedQueryRef.current
        if (!initialEmbedAppliedRef.current && initialQuery) {
          if (initialQuery.globalVersion) setGlobalVersionCode(initialQuery.globalVersion)
          if (initialQuery.version) await onLoadVersion(initialQuery.version)
          initialEmbedAppliedRef.current = true
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "初始化失败")
      } finally {
        dirtyEnabled.current = true
      }
    })()
  }, [])

  // 卸载时重置 dirty 状态
  useEffect(() => {
    return () => { setDirty(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 数据变化时标记脏状态
  useEffect(() => {
    if (!dirtyEnabled.current) return
    if (suppressUnsavedPrompt) {
      setDirty(false)
      setHasLocalChanges(false)
      return
    }
    setDirty(true)
    setHasLocalChanges(true)
  }, [basicInfo, valuePropositionRows, businessNeedRows, devOverviewRows, productModuleRows, implementationScopeRows, meetingNotes, keyPointRows, suppressUnsavedPrompt])

  useEffect(() => {
    // 未选择需求版本号时，子卡片恢复默认折叠状态，减少视觉噪音。
    if (!selectedVersionCode) {
      setSectionCollapsed(createInitialSectionCollapsed())
    }
  }, [selectedVersionCode])

  const filteredRows = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return businessNeedRows
    return businessNeedRows.filter(
      (item) =>
        item.businessNeed.toLowerCase().includes(q) ||
        item.businessDomain.toLowerCase().includes(q) ||
        item.proposer.toLowerCase().includes(q),
    )
  }, [businessNeedRows, keyword])

  const devSummary = useMemo(() => {
    return devOverviewRows.reduce(
      (acc, row) => {
        const coding = Number(row.codingDays || 0)
        acc.coding += coding
        acc.analysis += coding * 0.2
        acc.testing += coding * 0.4
        acc.total += coding * 1.6
        return acc
      },
      { coding: 0, analysis: 0, testing: 0, total: 0 },
    )
  }, [devOverviewRows])
  const customerIndustryTags = useMemo(() => parseIndustryTags(basicInfo.customerIndustry), [basicInfo.customerIndustry])
  const selectedVersionRecord = useMemo(
    () => versionRecords.find((x) => x.versionCode === selectedVersionCode),
    [versionRecords, selectedVersionCode],
  )
  const checkoutStatusText = useMemo(() => {
    if (!selectedVersionRecord) return "未选择版本"
    const base =
      selectedVersionRecord.checkoutStatus === "checked_out"
        ? `已检出（${selectedVersionRecord.checkedOutByUsername || "未知"}）`
        : "已检入"
    return selectedVersionRecord.versionDocStatus === "reviewed" ? `${base} · 已审核` : base
  }, [selectedVersionRecord])
  const isReadonly = Boolean(
    selectedVersionRecord &&
      (selectedVersionRecord.checkoutStatus === "checked_in" || selectedVersionRecord.versionDocStatus === "reviewed"),
  )

  async function reloadVersions(nextSelected?: string) {
    const records = await listModuleVersions("requirementImport")
    setVersionRecords(records)
    const nextOptions = buildVersionOptions(records)
    setVersionOptions(nextOptions)
    if (nextSelected) {
      setSelectedVersionCode(nextSelected)
    }
  }

  async function onLoadVersion(code: string) {
    setSelectedVersionCode(code)
    if (!code) return
    setError("")
    try {
      const records = await listModuleVersions("requirementImport")
      const target = records.find((x) => x.versionCode === code)
      if (!target) return
      const payload = target.payload || {}
      const nextBasic = (payload.basicInfo || {}) as Partial<BasicInfo>
      const nextValueRows = Array.isArray(payload.valuePropositionRows)
        ? (payload.valuePropositionRows as ValuePropositionRow[])
        : []
      const nextRows = Array.isArray(payload.businessNeedRows) ? (payload.businessNeedRows as BusinessNeedRow[]) : []
      const nextDevRows = Array.isArray(payload.devOverviewRows) ? (payload.devOverviewRows as DevOverviewRow[]) : []
      const nextProductRows = Array.isArray(payload.productModuleRows)
        ? (payload.productModuleRows as ProductModuleRow[])
        : []
      const nextScopeRows = Array.isArray(payload.implementationScopeRows)
        ? (payload.implementationScopeRows as ImplementationScopeRow[])
        : []
      const nextKeyPointRows = Array.isArray(payload.keyPointRows) ? (payload.keyPointRows as KeyPointRow[]) : []
      setGlobalVersionCode((payload.globalVersionCode as string) || "")
      setBasicInfo({
        ...EMPTY_BASIC_INFO,
        ...nextBasic,
        productLines: normalizeProductLines(nextBasic.productLines),
      })
      setValuePropositionRows(
        nextValueRows.length
          ? nextValueRows.map((row) => ({ ...row, id: row.id || crypto.randomUUID() }))
          : [createEmptyValuePropositionRow()],
      )
      setBusinessNeedRows(
        nextRows.length
          ? nextRows.map((row) => ({ ...row, id: row.id || crypto.randomUUID(), requiresCustomDev: row.requiresCustomDev || "否" }))
          : [createEmptyBusinessNeedRow()],
      )
      setDevOverviewRows(
        nextDevRows.length
          ? nextDevRows.map((row) => ({ ...row, id: row.id || crypto.randomUUID(), codingDays: Number(row.codingDays || 0) }))
          : [createEmptyDevOverviewRow()],
      )
      setProductModuleRows(
        nextProductRows.length
          ? nextProductRows.map((row) => ({ ...row, id: row.id || crypto.randomUUID() }))
          : [createEmptyProductModuleRow()],
      )
      setImplementationScopeRows(
        nextScopeRows.length
          ? nextScopeRows.map((row) => ({ ...row, id: row.id || crypto.randomUUID() }))
          : [createEmptyImplementationScopeRow()],
      )
      dirtyEnabled.current = false
      setMeetingNotes((payload.meetingNotes as string) || "")
      setKeyPointRows(
        nextKeyPointRows.length
          ? nextKeyPointRows.map((row) => ({ ...row, id: row.id || crypto.randomUUID() }))
          : [createEmptyKeyPointRow()],
      )
      showGlobalNotice(`已回读版本：${code}`)
      setDirty(false)
      setHasLocalChanges(false)
      setTimeout(() => { dirtyEnabled.current = true }, 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : "版本回读失败")
    }
  }

  async function onCheckout() {
    if (!selectedVersionRecord) return
    if (selectedVersionRecord.versionDocStatus === "reviewed") {
      showGlobalWarning("已审核版本不可检出，请先升版")
      return
    }
    try {
      await checkoutVersionById(selectedVersionRecord.id)
      await reloadVersions(selectedVersionRecord.versionCode)
      showGlobalNotice("检出成功")
    } catch (err) {
      showGlobalWarning(err instanceof Error ? err.message : "检出失败")
    }
  }

  function currentPayload(checkinNote?: string) {
    return {
      globalVersionCode: globalVersionCode.trim(),
      basicInfo,
      valuePropositionRows,
      businessNeedRows,
      devOverviewRows,
      productModuleRows,
      implementationScopeRows,
      meetingNotes,
      keyPointRows,
      ...(checkinNote ? { checkinNote } : {}),
    }
  }

  async function onCheckin(checkinNote: string) {
    if (!selectedVersionRecord) return
    try {
      const data = await checkinVersionById(selectedVersionRecord.id, currentPayload(checkinNote))
      await reloadVersions(data.versionCode || selectedVersionRecord.versionCode)
      showGlobalNotice(`检入成功：${data.versionCode}`)
      setDirty(false)
      setHasLocalChanges(false)
    } catch (err) {
      showGlobalWarning(err instanceof Error ? err.message : "检入失败")
    }
  }

  async function onUndoCheckout() {
    if (!selectedVersionRecord) return
    try {
      await undoCheckoutById(selectedVersionRecord.id)
      await reloadVersions(selectedVersionRecord.versionCode)
      showGlobalNotice("已撤销检出")
    } catch (err) {
      showGlobalWarning(err instanceof Error ? err.message : "撤销检出失败")
    }
  }

  async function onPromote() {
    if (!selectedVersionRecord) return
    if (selectedVersionRecord.versionDocStatus !== "drafting") {
      showGlobalWarning("当前版本状态不允许升版")
      return
    }
    try {
      const data = await promoteVersionById(selectedVersionRecord.id)
      await reloadVersions(data.newRecord.versionCode)
      showGlobalNotice(`升版成功：${data.newRecord.versionCode}`)
    } catch (err) {
      showGlobalWarning(err instanceof Error ? err.message : "升版失败")
    }
  }

  async function onForceUnlock() {
    if (!selectedVersionRecord || !isAdmin) return
    try {
      await forceUnlockById(selectedVersionRecord.id)
      await reloadVersions(selectedVersionRecord.versionCode)
      showGlobalNotice("强制解锁成功")
    } catch (err) {
      showGlobalWarning(err instanceof Error ? err.message : "强制解锁失败")
    }
  }

  async function onSave(): Promise<boolean> {
    if (!globalVersionCode.trim()) {
      setError("请先选择总方案版本号")
      return false
    }
    if (!basicInfo.projectName.trim()) {
      setError("请填写项目名称")
      return false
    }
    setSaving(true)
    setMessage("")
    setError("")
    try {
      const created = await createModuleVersion(
        "requirementImport",
        {
          globalVersionCode: globalVersionCode.trim(),
          basicInfo,
          valuePropositionRows,
          businessNeedRows,
          devOverviewRows,
          productModuleRows,
          implementationScopeRows,
          meetingNotes,
          keyPointRows,
        },
        "RI",
      )
      await reloadVersions(created.versionCode)
      showGlobalNotice(`已保存需求版本：${created.versionCode}`)
      setDirty(false)
      setHasLocalChanges(false)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败")
      return false
    } finally {
      setSaving(false)
    }
  }

  function resetToNewRequirementDraft() {
    setGlobalVersionCode("")
    setSelectedVersionCode("")
    setVersionOptions([])
    setBasicInfo(EMPTY_BASIC_INFO)
    setValuePropositionRows([createEmptyValuePropositionRow()])
    setBusinessNeedRows([createEmptyBusinessNeedRow()])
    setDevOverviewRows([createEmptyDevOverviewRow()])
    setProductModuleRows([createEmptyProductModuleRow()])
    setImplementationScopeRows([createEmptyImplementationScopeRow()])
    setMeetingNotes("")
    setKeyPointRows([createEmptyKeyPointRow()])
    setSectionCollapsed(createInitialSectionCollapsed())
    setMessage("")
    setError("")
    setDirty(false)
    setHasLocalChanges(false)
    dirtyEnabled.current = true
  }

  function onCreateNewRequirement() {
    if (saving) return
    const isCheckedOut = selectedVersionRecord?.checkoutStatus === "checked_out"
    if (isCheckedOut && hasLocalChanges) {
      setCreateNewConfirmOpen(true)
      return
    }
    resetToNewRequirementDraft()
    showGlobalNotice("已进入新建需求")
  }

  async function onSaveAndCreateNewRequirement() {
    if (createNewSubmitting) return
    setCreateNewSubmitting(true)
    try {
      const saved = await onSave()
      if (!saved) return
      setCreateNewConfirmOpen(false)
      resetToNewRequirementDraft()
      showGlobalNotice("已保存并新建需求")
    } finally {
      setCreateNewSubmitting(false)
    }
  }

  function applyRequirementImportData(data?: ParseBasicInfoResponse["requirementImportData"]) {
    if (!data) return
    if (Array.isArray(data.valuePropositionRows) && data.valuePropositionRows.length > 0) {
      setValuePropositionRows(
        data.valuePropositionRows.map((row) => ({
          id: crypto.randomUUID(),
          summary: String(row.summary || ""),
          refinedContent: String(row.refinedContent || ""),
          originalDemand: String(row.originalDemand || ""),
          interviewOutline: String(row.interviewOutline || ""),
        })),
      )
    }
    if (Array.isArray(data.businessNeedRows) && data.businessNeedRows.length > 0) {
      setBusinessNeedRows(
        data.businessNeedRows.map((row) => ({
          id: crypto.randomUUID(),
          businessDomain: String(row.businessDomain || ""),
          category: String(row.category || ""),
          businessNeed: String(row.businessNeed || ""),
          proposer: String(row.proposer || ""),
          title: String(row.title || ""),
          requiresCustomDev: row.requiresCustomDev === "是" ? "是" : "否",
        })),
      )
    }
    if (Array.isArray(data.devOverviewRows) && data.devOverviewRows.length > 0) {
      setDevOverviewRows(
        data.devOverviewRows.map((row) => ({
          id: crypto.randomUUID(),
          businessDomain: String(row.businessDomain || ""),
          moduleName: String(row.moduleName || ""),
          moduleBrief: String(row.moduleBrief || ""),
          functionDesc: String(row.functionDesc || ""),
          solutionSuggestion: String(row.solutionSuggestion || ""),
          codingDays: Number(row.codingDays || 0),
          estimateBasis: String(row.estimateBasis || ""),
        })),
      )
    }
    if (Array.isArray(data.productModuleRows) && data.productModuleRows.length > 0) {
      setProductModuleRows(
        data.productModuleRows.map((row) => ({
          id: crypto.randomUUID(),
          productDomain: String(row.productDomain || ""),
          moduleName: String(row.moduleName || ""),
          subModule: String(row.subModule || ""),
          userCount: String(row.userCount || ""),
          implementationOrgCount: String(row.implementationOrgCount || ""),
          pilotOrgCount: String(row.pilotOrgCount || ""),
          partyBLead: String(row.partyBLead || ""),
          partyALead: String(row.partyALead || ""),
        })),
      )
    }
    if (Array.isArray(data.implementationScopeRows) && data.implementationScopeRows.length > 0) {
      setImplementationScopeRows(
        data.implementationScopeRows.map((row) => ({
          id: crypto.randomUUID(),
          companyName: String(row.companyName || ""),
          companyType: String(row.companyType || ""),
          moduleScope: String(row.moduleScope || ""),
          location: String(row.location || ""),
          implementationMode: String(row.implementationMode || ""),
          note: String(row.note || ""),
        })),
      )
    }
    if (typeof data.meetingNotes === "string" && data.meetingNotes.trim()) {
      setMeetingNotes(data.meetingNotes)
    }
    if (Array.isArray(data.keyPointRows) && data.keyPointRows.length > 0) {
      setKeyPointRows(
        data.keyPointRows.map((row) => ({
          id: crypto.randomUUID(),
          analysisCategory: String(row.analysisCategory || ""),
          subItem: String(row.subItem || ""),
          detail: String(row.detail || ""),
          note: String(row.note || ""),
        })),
      )
    }
  }

  async function onImportBasicInfoByExcel() {
    setBasicInfoImportError("")
    setError("")
    if (!basicInfoImportFile) {
      setBasicInfoImportError("请先选择 Excel 文件")
      return
    }
    setBasicInfoImporting(true)
    setMessage("")
    try {
      const formData = new FormData()
      formData.append("file", basicInfoImportFile)
      const data = await apiRequest<ParseBasicInfoResponse>("/api/v1/ai/parse-basic-info", {
        method: "POST",
        body: formData,
      })
      setBasicInfo((prev) => ({ ...prev, ...data.basicInfo }))
      applyRequirementImportData(data.requirementImportData)
      if (data.model) setBasicInfoModelName(data.model)
      setBasicInfoImportVisible(false)
      setBasicInfoImportFile(null)
      if (data.mode === "rule_fallback") {
        const fallbackHint = data.fallbackReason ? `（${data.fallbackReason}）` : ""
        showGlobalNotice(`Excel 已按规则回填${fallbackHint}`)
      } else {
        showGlobalNotice("Excel 解析完成，已回填需求内容")
      }
    } catch (err) {
      setBasicInfoImportError(err instanceof Error ? err.message : "解析失败")
    } finally {
      setBasicInfoImporting(false)
    }
  }

  async function onGenerateEnterpriseProfileByKimi() {
    const customerName = (basicInfo.customerName || "").trim()
    if (!customerName) {
      setError("请先填写客户名称")
      return
    }
    setEnterpriseProfileGenerating(true)
    setError("")
    setMessage("")
    try {
      const data = await apiRequest<CompanyProfileSummaryResponse>("/api/v1/ai/company-profile-summary", {
        method: "POST",
        body: {
          customerName,
          customerIndustry: basicInfo.customerIndustry || "",
          enterpriseRevenue: basicInfo.enterpriseRevenue || "",
          itStatus: basicInfo.itStatus || "",
        },
      })
      setEnterpriseProfileGeneratedText(data.enterpriseProfile)
      setEnterpriseProfileGeneratedFields({
        customerIndustry: data.customerIndustry || "",
        enterpriseRevenue: data.enterpriseRevenue || "",
        itStatus: data.itStatus || "",
      })
      setEnterpriseProfilePreviewVisible(true)
      if (data.model) setBasicInfoModelName(data.model)
      if (data.mode === "rule_fallback") {
        const fallbackHint = data.fallbackReason ? `（${data.fallbackReason}）` : ""
        showGlobalNotice(`企业简介已按规则生成${fallbackHint}，请确认是否插入`)
      } else {
        showGlobalNotice("企业简介已生成，请确认是否插入")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "企业简介生成失败")
    } finally {
      setEnterpriseProfileGenerating(false)
    }
  }

  async function onGenerateAssessmentPreviewByKimi() {
    if (kimiAssessing) return
    if (!basicInfo.projectName.trim()) {
      setError("请先填写项目名称，再进行 Kimi 评估")
      return
    }
    setKimiAssessing(true)
    setError("")
    setMessage("")
    try {
      const data = await generateKimiAssessmentPreview({
        source: {
          globalVersionCode: globalVersionCode.trim(),
          requirementVersionCode: selectedVersionCode.trim(),
        },
        requirementSnapshot: {
          basicInfo: basicInfo as unknown as Record<string, unknown>,
          valuePropositionRows: valuePropositionRows as unknown as Array<Record<string, unknown>>,
          businessNeedRows: businessNeedRows as unknown as Array<Record<string, unknown>>,
          devOverviewRows: devOverviewRows as unknown as Array<Record<string, unknown>>,
          productModuleRows: productModuleRows as unknown as Array<Record<string, unknown>>,
          implementationScopeRows: implementationScopeRows as unknown as Array<Record<string, unknown>>,
          meetingNotes,
          keyPointRows: keyPointRows as unknown as Array<Record<string, unknown>>,
        },
        ruleContext: {
          promptProfile: "assessment_default_v1",
        },
      })
      setKimiAssessmentPreview(data)
      setKimiAssessmentPreviewOpen(true)
      if (data.meta.mode === "rule_fallback") {
        const hint = data.meta.fallbackReason ? `（${data.meta.fallbackReason}）` : ""
        showGlobalNotice(`Kimi 评估已生成（规则兜底）${hint}`)
      } else {
        showGlobalNotice("Kimi 评估预览已生成")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kimi 评估生成失败")
    } finally {
      setKimiAssessing(false)
      setKimiHelpOpen(false)
    }
  }

  function onApplyKimiAssessmentToAssessmentPage() {
    if (!kimiAssessmentPreview || kimiApplying) return
    setKimiApplying(true)
    try {
      const payload = {
        source: kimiAssessmentPreview.source,
        draft: kimiAssessmentPreview.assessmentDraft,
        generatedMeta: kimiAssessmentPreview.meta,
        projectName: basicInfo.projectName.trim(),
      }
      window.sessionStorage.setItem(KIMI_ASSESSMENT_PREFILL_STORAGE_KEY, JSON.stringify(payload))
      setKimiAssessmentPreviewOpen(false)
      router.push("/dashboard/assessment")
    } finally {
      setKimiApplying(false)
    }
  }

  function applyGeneratedEnterpriseProfile() {
    const generatedIndustry = enterpriseProfileGeneratedFields.customerIndustry.trim()
    const generatedRevenue = enterpriseProfileGeneratedFields.enterpriseRevenue.trim()
    const generatedItStatus = enterpriseProfileGeneratedFields.itStatus.trim()
    if (!generatedIndustry) {
      setError("生成内容缺少客户行业，暂不可插入")
      return
    }
    const skipRevenue = isUncertainRevenue(generatedRevenue)
    const skipItStatus = isUncertainItStatus(generatedItStatus)
    setBasicInfo((prev) => ({
      ...prev,
      enterpriseProfile: enterpriseProfileGeneratedText,
      customerIndustry: generatedIndustry,
      enterpriseRevenue: skipRevenue ? prev.enterpriseRevenue : generatedRevenue,
      itStatus: skipItStatus ? prev.itStatus : generatedItStatus,
    }))
    setEnterpriseProfilePreviewVisible(false)
    const skipped: string[] = []
    if (skipRevenue) skipped.push("企业营收")
    if (skipItStatus) skipped.push("信息化现状")
    if (skipped.length > 0) {
      showGlobalNotice(`已插入企业简介并回填明确字段，已跳过：${skipped.join("、")}`)
    } else {
      showGlobalNotice("已插入企业简介并同步回填客户行业/企业营收/信息化现状")
    }
  }

  const revenueUncertainPreview = isUncertainRevenue(enterpriseProfileGeneratedFields.enterpriseRevenue)
  const itStatusUncertainPreview = isUncertainItStatus(enterpriseProfileGeneratedFields.itStatus)
  const [devOverviewViewMode, setDevOverviewViewMode] = useState<"list" | "grid">("list")
  const [productModuleViewMode, setProductModuleViewMode] = useState<"list" | "grid">("list")
  const [implementationScopeViewMode, setImplementationScopeViewMode] = useState<"list" | "grid">("list")
  const [keyPointViewMode, setKeyPointViewMode] = useState<"list" | "grid">("list")
  const [kimiAssessmentPreviewOpen, setKimiAssessmentPreviewOpen] = useState(false)
  const [kimiAssessing, setKimiAssessing] = useState(false)
  const [kimiApplying, setKimiApplying] = useState(false)
  const [kimiAssessmentPreview, setKimiAssessmentPreview] = useState<KimiAssessmentPreviewResult | null>(null)

  return (
    <ModuleShell
      title="需求"
      description="需求结构化导入、条目编辑、版本保存与回读。"
      breadcrumbs={[{ label: "需求" }]}
    >
      <div className="space-y-6 [&_input]:border-border/70 [&_input]:bg-background/95 [&_input]:shadow-sm [&_select]:border-border/70 [&_select]:bg-background/95 [&_select]:shadow-sm [&_textarea]:border-border/70 [&_textarea]:bg-background/95 [&_textarea]:shadow-sm [&_td:has(>input)]:h-11 [&_td:has(>input)]:p-0 [&_td:has(>input)]:align-middle [&_td>input]:block [&_td>input]:w-full [&_td>input]:h-full [&_td>input]:min-h-9 [&_td>input]:rounded-none [&_td>input]:border-0 [&_td>input]:py-0 [&_td>input]:shadow-none">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/40 bg-card/50 p-3 shadow-sm backdrop-blur-sm transition-all duration-300 md:flex-nowrap">
          <Button className="rounded-xl" variant="outline" onClick={() => void onCreateNewRequirement()} disabled={saving || createNewSubmitting}>
            新建需求
          </Button>
          <Button className="rounded-xl" onClick={() => void onSave()} disabled={saving}>
            {saving ? "保存中..." : "保存版本"}
          </Button>
          <VersionVcsToolbar
            state={
              selectedVersionRecord
                ? {
                    recordId: selectedVersionRecord.id,
                    checkoutStatus: selectedVersionRecord.checkoutStatus,
                    versionDocStatus: selectedVersionRecord.versionDocStatus,
                    checkedOutByUsername: selectedVersionRecord.checkedOutByUsername,
                  }
                : undefined
            }
            alwaysShowActions
            showStatusField={false}
            onVersionHistory={() => setVersionHistoryOpen(true)}
            onCheckout={() => void onCheckout()}
            onCheckin={(checkinNote) => void onCheckin(checkinNote)}
            onUndoCheckout={() => void onUndoCheckout()}
            onPromote={() => void onPromote()}
            onForceUnlock={() => void onForceUnlock()}
            forceUnlockVisible={isAdmin}
          />
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">模型：{basicInfoModelName}</span>
            <Popover open={kimiHelpOpen} onOpenChange={setKimiHelpOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl"
                  onMouseEnter={openKimiHelpByHover}
                  onMouseLeave={scheduleCloseKimiHelpByHover}
                >
                  Kimi-help
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={8}
                className="w-44 p-2"
                onMouseEnter={openKimiHelpByHover}
                onMouseLeave={scheduleCloseKimiHelpByHover}
              >
                <div className="flex flex-col gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 justify-start rounded-md px-2 text-xs"
                    onClick={() => {
                      void onGenerateAssessmentPreviewByKimi()
                    }}
                    disabled={kimiAssessing}
                  >
                    {kimiAssessing ? "Kimi评估中..." : "Kimi评估"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 justify-start rounded-md px-2 text-xs"
                    onClick={() => {
                      setKimiHelpOpen(false)
                      void onGenerateEnterpriseProfileByKimi()
                    }}
                    disabled={enterpriseProfileGenerating}
                  >
                    <span className="inline-flex items-center gap-1">
                      {enterpriseProfileGenerating ? "Kimi生成中..." : "Kimi生成"}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-muted-foreground/50 text-[10px] leading-none text-muted-foreground"
                            onClick={(e) => e.stopPropagation()}
                          >
                            ?
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={6} className="max-w-64 text-xs leading-5">
                          维护好客户名称后，通过kimi生成回填企业简介、企业营收、信息化现状等信息
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 justify-start rounded-md px-2 text-xs"
                    onClick={() => {
                      setKimiHelpOpen(false)
                      setBasicInfoImportVisible(true)
                    }}
                  >
                    Kimi解析文件
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <Card collapsed={false} collapsible={false} className="gap-4 py-4 border-border/40 bg-card/50 backdrop-blur-sm">
          <CardHeader className="space-y-2">
            <CardTitle className="text-base">版本与上下文</CardTitle>
            <div className="grid gap-x-3 gap-y-2 md:grid-cols-3">
              <p className="text-xs text-muted-foreground">总方案版本号</p>
              <p className="text-xs text-muted-foreground">需求版本号</p>
              <p className="text-xs text-muted-foreground">检出状态</p>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={globalVersionCode}
                onChange={(e) => setGlobalVersionCode(e.target.value)}
              >
                <option value="">请选择总方案版本</option>
                {globalOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={selectedVersionCode}
                onChange={(e) => void onLoadVersion(e.target.value)}
              >
                <option value="">请选择历史版本回读</option>
                {versionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <div className="h-9 w-full rounded-md border border-border/70 bg-background/95 px-3 text-sm leading-9 shadow-sm">
                {checkoutStatusText}
              </div>
            </div>
            <div className="min-h-4">
              {message ? <span className="text-xs text-emerald-600">{message}</span> : null}
              {error ? <span className="text-xs text-destructive">{error}</span> : null}
            </div>
            {isReadonly ? (
              <p className="text-xs text-muted-foreground">当前版本为只读状态，请先检出后编辑。</p>
            ) : null}
          </CardHeader>
        </Card>
      </div>

      <fieldset
        disabled={isReadonly}
        className="space-y-3 [&>[data-slot=card][data-collapsed=true]]:h-14 [&>[data-slot=card][data-collapsed=true]]:min-h-14 [&>[data-slot=card][data-collapsed=true]]:overflow-hidden"
      >
      <Card
        collapsed={sectionCollapsed.basicInfo}
        onCollapsedChange={(collapsed) => setSectionCollapsed((prev) => ({ ...prev, basicInfo: collapsed }))}
        className="border-border/40 bg-card/50 backdrop-blur-sm"
      >
        <CardHeader className="pb-1">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">基本情况</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs text-[#D97706]">客户名称</span>
              <Input value={basicInfo.customerName} onChange={(e) => setBasicInfo((s) => ({ ...s, customerName: e.target.value }))} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">项目名称（必填）</span>
              <Input value={basicInfo.projectName} onChange={(e) => setBasicInfo((s) => ({ ...s, projectName: e.target.value }))} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">商机号</span>
              <Input value={basicInfo.opportunityNo} onChange={(e) => setBasicInfo((s) => ({ ...s, opportunityNo: e.target.value }))} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">产品线</span>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="h-9 w-full rounded-md border border-border/70 bg-background/95 px-3 text-left text-sm leading-9 shadow-sm"
                  >
                    {basicInfo.productLines.length ? (
                      <span className="block truncate">{basicInfo.productLines.join(" / ")}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">请选择产品线（可多选）</span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-2">
                  <div className="flex flex-wrap gap-1.5">
                    {PRODUCT_LINE_OPTIONS.map((line) => {
                      const active = basicInfo.productLines.includes(line)
                      return (
                        <button
                          key={line}
                          type="button"
                          className={cn(
                            "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                            active
                              ? "border-primary/30 bg-primary/10 text-primary"
                              : "border-border/70 bg-background text-muted-foreground hover:text-foreground",
                          )}
                          onClick={() =>
                            setBasicInfo((prev) => ({
                              ...prev,
                              productLines: prev.productLines.includes(line)
                                ? prev.productLines.filter((x) => x !== line)
                                : [...prev.productLines, line],
                            }))
                          }
                        >
                          {line}
                        </button>
                      )
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </label>
            <label className="space-y-1">
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                客户行业
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-muted-foreground/50 text-[10px] leading-none text-muted-foreground"
                      onClick={(e) => e.stopPropagation()}
                    >
                      ?
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={6} className="max-w-72 text-xs leading-5">
                    <p>等待 Kimi 返回 GB/T 4754 四级分类标签（编码+名称）。</p>
                    <p>客户行业字段已改为标签显示，不再展示文本输入。</p>
                  </TooltipContent>
                </Tooltip>
              </span>
              <div className="min-h-9 rounded-md border border-border/70 bg-background/95 px-2 py-2 shadow-sm">
                <div className="flex flex-wrap gap-1.5">
                  {customerIndustryTags.length > 0 ? (
                    customerIndustryTags.map((tag, idx) => (
                      <Badge
                        key={`${tag}-${idx}`}
                        variant={idx === customerIndustryTags.length - 1 ? "default" : "secondary"}
                        className="rounded-full px-2.5 py-0.5 text-xs"
                      >
                        {tag}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-[10px] text-muted-foreground">暂无标签</span>
                  )}
                </div>
              </div>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">企业营收</span>
              <Input value={basicInfo.enterpriseRevenue} onChange={(e) => setBasicInfo((s) => ({ ...s, enterpriseRevenue: e.target.value }))} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">信息化现状</span>
              <Input value={basicInfo.itStatus} onChange={(e) => setBasicInfo((s) => ({ ...s, itStatus: e.target.value }))} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">预期上线时间</span>
              <Input type="month" value={basicInfo.expectedGoLive} onChange={(e) => setBasicInfo((s) => ({ ...s, expectedGoLive: e.target.value }))} />
            </label>
          </div>

          <div className="space-y-3 rounded-lg border border-border/50 bg-secondary/20 p-3">
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">企业简介</span>
              <textarea
                ref={enterpriseProfileRef}
                className="w-full resize-none overflow-hidden rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="请输入企业简介"
                value={basicInfo.enterpriseProfile}
                onChange={(e) => setBasicInfo((s) => ({ ...s, enterpriseProfile: e.target.value }))}
                onInput={(e) => autoResizeTextarea(e.currentTarget, 72)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">项目背景和需求</span>
              <textarea
                ref={projectBackgroundNeedsRef}
                className="w-full resize-none overflow-hidden rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="请输入项目背景和需求"
                value={basicInfo.projectBackgroundNeeds}
                onChange={(e) => setBasicInfo((s) => ({ ...s, projectBackgroundNeeds: e.target.value }))}
                onInput={(e) => autoResizeTextarea(e.currentTarget, 72)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">项目目标</span>
              <textarea
                ref={projectGoalsRef}
                className="w-full resize-none overflow-hidden rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="请输入项目目标"
                value={basicInfo.projectGoals}
                onChange={(e) => setBasicInfo((s) => ({ ...s, projectGoals: e.target.value }))}
                onInput={(e) => autoResizeTextarea(e.currentTarget, 72)}
              />
            </label>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={basicInfoImportVisible}
        onOpenChange={(open) => {
          if (basicInfoImporting) return
          setBasicInfoImportVisible(open)
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>导入 Excel 并解析基本情况</DialogTitle>
            <DialogDescription>优先使用 KIMI {basicInfoModelName} 模型，失败时自动规则回填。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="file"
              accept=".xlsx,.xls"
              disabled={basicInfoImporting}
              className="cursor-pointer transition-colors hover:bg-amber-50/70 dark:hover:bg-amber-900/20"
              onChange={(e) => setBasicInfoImportFile(e.target.files?.[0] || null)}
            />
            {basicInfoImportError ? <p className="text-xs text-destructive">{basicInfoImportError}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => setBasicInfoImportVisible(false)} disabled={basicInfoImporting}>
              取消
            </Button>
            <Button type="button" className="rounded-xl" onClick={() => void onImportBasicInfoByExcel()} disabled={basicInfoImporting}>
              {basicInfoImporting ? "解析中..." : "开始解析并回填"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={createNewConfirmOpen} onOpenChange={setCreateNewConfirmOpen}>
        <AlertDialogContent className="sm:max-w-lg rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>检测到未保存修改</AlertDialogTitle>
            <AlertDialogDescription>
              当前需求版本处于已检出状态，且存在未保存修改。请先保存当前修改，再进入新建空白界面。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={createNewSubmitting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={createNewSubmitting || saving}
              onClick={(event) => {
                event.preventDefault()
                void onSaveAndCreateNewRequirement()
              }}
            >
              {createNewSubmitting ? "处理中..." : "保存并新建"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={enterpriseProfilePreviewVisible}
        onOpenChange={(open) => {
          setEnterpriseProfilePreviewVisible(open)
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>KIMI 生成企业信息</DialogTitle>
            <DialogDescription>Kimi不一定能够获取到准确的企业信息，如信息可信度低，系统会自动忽略</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <Input value={enterpriseProfileGeneratedFields.customerIndustry} readOnly />
              <Input
                value={enterpriseProfileGeneratedFields.enterpriseRevenue}
                readOnly
                className={revenueUncertainPreview ? "text-muted-foreground" : ""}
              />
              <Input
                value={enterpriseProfileGeneratedFields.itStatus}
                readOnly
                className={itStatusUncertainPreview ? "text-muted-foreground" : ""}
              />
            </div>
            {revenueUncertainPreview || itStatusUncertainPreview ? (
              <p className="text-xs text-muted-foreground">
                灰色字段表示信息不够明确，点击“插入并回填字段”时将自动跳过这些字段，仅回填可确认内容。
              </p>
            ) : null}
            <textarea
              className="min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={enterpriseProfileGeneratedText}
              onChange={(e) => setEnterpriseProfileGeneratedText(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => setEnterpriseProfilePreviewVisible(false)}>
              暂不插入
            </Button>
            <Button type="button" className="rounded-xl" onClick={applyGeneratedEnterpriseProfile}>
              插入并回填字段
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={kimiAssessmentPreviewOpen} onOpenChange={setKimiAssessmentPreviewOpen}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Kimi 评估预览（实施评估草稿）</DialogTitle>
            <DialogDescription>
              该结果为 AI 草稿，请确认后再应用到实施评估页面。
            </DialogDescription>
          </DialogHeader>
          {kimiAssessmentPreview ? (
            <div className="space-y-4">
              <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                <div className="rounded-md border border-border/60 bg-secondary/20 px-3 py-2">
                  模型：{kimiAssessmentPreview.meta.model}
                </div>
                <div className="rounded-md border border-border/60 bg-secondary/20 px-3 py-2">
                  模式：{kimiAssessmentPreview.meta.mode === "model" ? "模型生成" : "规则兜底"}
                </div>
                <div className="rounded-md border border-border/60 bg-secondary/20 px-3 py-2">
                  置信度：{Math.round((Number(kimiAssessmentPreview.meta.confidence) || 0) * 100)}%
                </div>
                <div className="rounded-md border border-border/60 bg-secondary/20 px-3 py-2">
                  规则集：{kimiAssessmentPreview.meta.ruleSetId}
                </div>
              </div>
              <div className="grid gap-3 rounded-lg border border-border/60 bg-secondary/10 p-3 text-sm sm:grid-cols-3">
                <div>报价模式：<span className="font-medium">{kimiAssessmentPreview.assessmentDraft.quoteMode || "—"}</span></div>
                <div>用户数：<span className="font-medium">{kimiAssessmentPreview.assessmentDraft.userCount}</span></div>
                <div>组织数：<span className="font-medium">{kimiAssessmentPreview.assessmentDraft.orgCount}</span></div>
                <div>组织相似度：<span className="font-medium">{kimiAssessmentPreview.assessmentDraft.orgSimilarity}</span></div>
                <div>难度系数：<span className="font-medium">{kimiAssessmentPreview.assessmentDraft.difficultyFactor}</span></div>
                <div>
                  总人天：
                  <span className="font-medium">
                    {kimiAssessmentPreview.assessmentDraft.moduleItems.reduce(
                      (sum, item) => sum + Number(item.suggestedDays || 0),
                      0,
                    )}
                  </span>
                </div>
                <div className="sm:col-span-3">
                  产品线：
                  <span className="font-medium">
                    {kimiAssessmentPreview.assessmentDraft.productLines.length
                      ? kimiAssessmentPreview.assessmentDraft.productLines.join(" / ")
                      : "—"}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">模块估算建议</p>
                <div className="max-h-64 overflow-auto rounded-lg border border-border/60">
                  {kimiAssessmentPreview.assessmentDraft.moduleItems.length ? (
                    <div className="divide-y divide-border/50">
                      <div className="grid gap-2 bg-secondary/20 px-3 py-2 text-xs font-semibold text-foreground sm:grid-cols-[1fr_1fr_0.7fr_0.7fr_2fr]">
                        <span>云产品</span>
                        <span>SKU</span>
                        <span>标准人天</span>
                        <span>建议人天</span>
                        <span>原因</span>
                      </div>
                      {kimiAssessmentPreview.assessmentDraft.moduleItems.map((item, index) => (
                        <div key={`${item.cloudProduct || "cloud"}-${item.skuName || item.moduleName}-${index}`} className="grid gap-2 px-3 py-2 text-sm sm:grid-cols-[1fr_1fr_0.7fr_0.7fr_2fr]">
                          <span className="font-medium">{item.cloudProduct || "未分类云产品"}</span>
                          <span className="font-medium">{item.skuName || item.moduleName || "未命名SKU"}</span>
                          <span>标准：{item.standardDays}</span>
                          <span>建议：{item.suggestedDays}</span>
                          <span className="text-muted-foreground">{item.reason}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-3 py-5 text-sm text-muted-foreground">暂无模块估算建议</div>
                  )}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/60 p-3">
                  <p className="mb-2 text-sm font-medium">风险提示</p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {kimiAssessmentPreview.assessmentDraft.risks.map((risk, idx) => (
                      <li key={`risk-${idx}`}>- {risk}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg border border-border/60 p-3">
                  <p className="mb-2 text-sm font-medium">前提假设</p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {kimiAssessmentPreview.assessmentDraft.assumptions.map((assumption, idx) => (
                      <li key={`assumption-${idx}`}>- {assumption}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => setKimiAssessmentPreviewOpen(false)}>
              关闭
            </Button>
            <Button
              type="button"
              className="rounded-xl"
              onClick={onApplyKimiAssessmentToAssessmentPage}
              disabled={!kimiAssessmentPreview || kimiApplying}
            >
              {kimiApplying ? "处理中..." : "应用到实施评估"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card
        collapsed={sectionCollapsed.valueProposition}
        onCollapsedChange={(collapsed) => setSectionCollapsed((prev) => ({ ...prev, valueProposition: collapsed }))}
        contentClassName="gap-1"
        className="gap-3 py-4 border-border/40 bg-card/50 backdrop-blur-sm"
      >
        <CardHeader className="gap-0 pb-0">
          <CardTitle className="text-base">价值主张</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="[&>div]:p-0">
            <TableTemplate
              rows={valuePropositionRows}
              columns={[
                { key: "summary", label: "简要内容", className: "whitespace-nowrap" },
                { key: "refinedContent", label: "具体内容（提炼）", className: "whitespace-nowrap" },
                { key: "originalDemand", label: "访谈原始诉求", className: "whitespace-nowrap" },
                { key: "interviewOutline", label: "访谈提纲", className: "whitespace-nowrap" },
              ]}
              emptyState="暂无价值主张行，请点击“新增行”"
              showSearch={false}
              showFilter={false}
              viewMode={valuePropositionViewMode}
              onViewModeChange={setValuePropositionViewMode}
              createButtonLabel="新增行"
              onCreate={() => setValuePropositionRows((rows) => [...rows, createEmptyValuePropositionRow()])}
              toolbarActions={
                <Button
                  className="h-10 rounded-xl"
                  variant="outline"
                  onClick={() => setValuePropositionRows((rows) => (rows.length > 1 ? rows.slice(0, -1) : rows))}
                >
                  删除末行
                </Button>
              }
              renderRow={(row) => (
                <TableRow key={row.id}>
                  <TableCell className="h-11 p-0 align-middle">
                    <Input
                      className="h-full rounded-none border-0 py-0 shadow-none"
                      value={row.summary}
                      onChange={(e) => setValuePropositionRows((items) => items.map((x) => (x.id === row.id ? { ...x, summary: e.target.value } : x)))}
                    />
                  </TableCell>
                  <TableCell className="h-11 p-0 align-middle">
                    <Input
                      className="h-full rounded-none border-0 py-0 shadow-none"
                      value={row.refinedContent}
                      onChange={(e) => setValuePropositionRows((items) => items.map((x) => (x.id === row.id ? { ...x, refinedContent: e.target.value } : x)))}
                    />
                  </TableCell>
                  <TableCell className="h-11 p-0 align-middle">
                    <Input
                      className="h-full rounded-none border-0 py-0 shadow-none"
                      value={row.originalDemand}
                      onChange={(e) => setValuePropositionRows((items) => items.map((x) => (x.id === row.id ? { ...x, originalDemand: e.target.value } : x)))}
                    />
                  </TableCell>
                  <TableCell className="h-11 p-0 align-middle">
                    <Input
                      className="h-full rounded-none border-0 py-0 shadow-none"
                      value={row.interviewOutline}
                      onChange={(e) => setValuePropositionRows((items) => items.map((x) => (x.id === row.id ? { ...x, interviewOutline: e.target.value } : x)))}
                    />
                  </TableCell>
                </TableRow>
              )}
            />
          </div>
        </CardContent>
      </Card>

      <Card
        collapsed={sectionCollapsed.businessNeed}
        onCollapsedChange={(collapsed) => setSectionCollapsed((prev) => ({ ...prev, businessNeed: collapsed }))}
        contentClassName="gap-1"
        className="gap-3 py-4 border-border/40 bg-card/50 backdrop-blur-sm"
      >
        <CardHeader className="gap-0 pb-0">
          <CardTitle className="text-base">业务需求及问题一览</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="[&>div]:p-0">
            <TableTemplate
              rows={filteredRows}
              columns={[
                { key: "businessDomain", label: "业务领域", className: "whitespace-nowrap" },
                { key: "category", label: "分类", className: "whitespace-nowrap" },
                { key: "businessNeed", label: "业务需求及问题", className: "whitespace-nowrap" },
                { key: "proposer", label: "提出人", className: "whitespace-nowrap" },
                { key: "title", label: "职务", className: "whitespace-nowrap" },
                { key: "requiresCustomDev", label: "是否定开", className: "whitespace-nowrap" },
              ]}
              emptyState="暂无业务需求行，请点击“新增行”"
              showSearch
              searchValue={keyword}
              onSearchValueChange={setKeyword}
              searchPlaceholder="搜索业务需求/领域/提出人"
              showFilter={false}
              viewMode={businessNeedViewMode}
              onViewModeChange={setBusinessNeedViewMode}
              createButtonLabel="新增行"
              onCreate={() => setBusinessNeedRows((rows) => [...rows, createEmptyBusinessNeedRow()])}
              toolbarActions={
                <Button
                  className="h-10 rounded-xl"
                  variant="outline"
                  onClick={() => setBusinessNeedRows((rows) => (rows.length > 1 ? rows.slice(0, -1) : rows))}
                >
                  删除末行
                </Button>
              }
              renderRow={(row) => (
                <TableRow key={row.id}>
                  <TableCell className="h-11 p-0 align-middle">
                    <Input
                      className="h-full rounded-none border-0 py-0 shadow-none"
                      value={row.businessDomain}
                      onChange={(e) =>
                        setBusinessNeedRows((items) => items.map((x) => (x.id === row.id ? { ...x, businessDomain: e.target.value } : x)))
                      }
                    />
                  </TableCell>
                  <TableCell className="h-11 p-0 align-middle">
                    <Input
                      className="h-full rounded-none border-0 py-0 shadow-none"
                      value={row.category}
                      onChange={(e) => setBusinessNeedRows((items) => items.map((x) => (x.id === row.id ? { ...x, category: e.target.value } : x)))}
                    />
                  </TableCell>
                  <TableCell className="h-11 p-0 align-middle">
                    <Input
                      className="h-full rounded-none border-0 py-0 shadow-none"
                      value={row.businessNeed}
                      onChange={(e) =>
                        setBusinessNeedRows((items) => items.map((x) => (x.id === row.id ? { ...x, businessNeed: e.target.value } : x)))
                      }
                    />
                  </TableCell>
                  <TableCell className="h-11 p-0 align-middle">
                    <Input
                      className="h-full rounded-none border-0 py-0 shadow-none"
                      value={row.proposer}
                      onChange={(e) => setBusinessNeedRows((items) => items.map((x) => (x.id === row.id ? { ...x, proposer: e.target.value } : x)))}
                    />
                  </TableCell>
                  <TableCell className="h-11 p-0 align-middle">
                    <Input
                      className="h-full rounded-none border-0 py-0 shadow-none"
                      value={row.title}
                      onChange={(e) => setBusinessNeedRows((items) => items.map((x) => (x.id === row.id ? { ...x, title: e.target.value } : x)))}
                    />
                  </TableCell>
                  <TableCell className="h-11 p-0 align-middle">
                    <button
                      type="button"
                      className="h-full w-full rounded-none border-0 bg-background px-2 py-0 text-xs"
                      onClick={() =>
                        setBusinessNeedRows((items) =>
                          items.map((x) =>
                            x.id === row.id ? { ...x, requiresCustomDev: x.requiresCustomDev === "是" ? "否" : "是" } : x,
                          ),
                        )
                      }
                    >
                      <Badge variant={row.requiresCustomDev === "是" ? "default" : "outline"}>{row.requiresCustomDev}</Badge>
                    </button>
                  </TableCell>
                </TableRow>
              )}
            />
          </div>
        </CardContent>
      </Card>

      <Card
        collapsed={sectionCollapsed.devOverview}
        onCollapsedChange={(collapsed) => setSectionCollapsed((prev) => ({ ...prev, devOverview: collapsed }))}
        contentClassName="gap-1"
        className="gap-3 py-4 border-border/40 bg-card/50 backdrop-blur-sm"
      >
        <CardHeader className="gap-0 pb-0">
          <CardTitle className="text-base">开发需求概要</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-0">
          <div className="[&>div]:p-0">
            <TableTemplate
              rows={devOverviewRows}
              columns={[
                { key: "businessDomain", label: "业务领域", className: "whitespace-nowrap" },
                { key: "moduleName", label: "模块名称", className: "whitespace-nowrap" },
                { key: "functionDesc", label: "功能说明", className: "whitespace-nowrap" },
                { key: "codingDays", label: "基准编码人天", className: "whitespace-nowrap" },
                { key: "analysis", label: "需求分析(20%)", className: "whitespace-nowrap" },
                { key: "testing", label: "系统测试(40%)", className: "whitespace-nowrap" },
                { key: "total", label: "合计", className: "whitespace-nowrap" },
              ]}
              emptyState="暂无开发需求行，请点击“新增行”"
              showSearch={false}
              showFilter={false}
              viewMode={devOverviewViewMode}
              onViewModeChange={setDevOverviewViewMode}
              createButtonLabel="新增行"
              onCreate={() => setDevOverviewRows((rows) => [...rows, createEmptyDevOverviewRow()])}
              toolbarActions={
                <Button className="h-10 rounded-xl" variant="outline" onClick={() => setDevOverviewRows((rows) => (rows.length > 1 ? rows.slice(0, -1) : rows))}>
                  删除末行
                </Button>
              }
              renderRow={(row) => {
                const analysis = row.codingDays * 0.2
                const testing = row.codingDays * 0.4
                const total = row.codingDays * 1.6
                return (
                  <TableRow key={row.id}>
                    <TableCell className="h-11 p-0 align-middle">
                      <Input className="h-full rounded-none border-0 py-0 shadow-none" value={row.businessDomain} onChange={(e) => setDevOverviewRows((items) => items.map((x) => (x.id === row.id ? { ...x, businessDomain: e.target.value } : x)))} />
                    </TableCell>
                    <TableCell className="h-11 p-0 align-middle">
                      <Input className="h-full rounded-none border-0 py-0 shadow-none" value={row.moduleName} onChange={(e) => setDevOverviewRows((items) => items.map((x) => (x.id === row.id ? { ...x, moduleName: e.target.value } : x)))} />
                    </TableCell>
                    <TableCell className="h-11 p-0 align-middle">
                      <Input className="h-full rounded-none border-0 py-0 shadow-none" value={row.functionDesc} onChange={(e) => setDevOverviewRows((items) => items.map((x) => (x.id === row.id ? { ...x, functionDesc: e.target.value } : x)))} />
                    </TableCell>
                    <TableCell className="h-11 p-0 align-middle">
                      <Input className="h-full rounded-none border-0 py-0 shadow-none" type="number" min={0} step="0.1" value={row.codingDays} onChange={(e) => setDevOverviewRows((items) => items.map((x) => (x.id === row.id ? { ...x, codingDays: Number(e.target.value || 0) } : x)))} />
                    </TableCell>
                    <TableCell className="h-11 align-middle">{analysis.toFixed(1)}</TableCell>
                    <TableCell className="h-11 align-middle">{testing.toFixed(1)}</TableCell>
                    <TableCell className="h-11 align-middle">{total.toFixed(1)}</TableCell>
                  </TableRow>
                )
              }}
            />
          </div>
          <div className="rounded-md border border-border/60 bg-secondary/30 px-3 py-2 text-sm">
            合计：编码 {devSummary.coding.toFixed(1)}，分析 {devSummary.analysis.toFixed(1)}，测试 {devSummary.testing.toFixed(1)}，总计{" "}
            {devSummary.total.toFixed(1)} 人天
          </div>
        </CardContent>
      </Card>

      <Card
        collapsed={sectionCollapsed.productModule}
        onCollapsedChange={(collapsed) => setSectionCollapsed((prev) => ({ ...prev, productModule: collapsed }))}
        contentClassName="gap-1"
        className="gap-3 py-4 border-border/40 bg-card/50 backdrop-blur-sm"
      >
        <CardHeader className="gap-0 pb-0">
          <CardTitle className="text-base">产品及模块信息</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="[&>div]:p-0">
            <TableTemplate
              rows={productModuleRows}
              columns={[
                { key: "productDomain", label: "产品领域", className: "whitespace-nowrap" },
                { key: "moduleName", label: "模块", className: "whitespace-nowrap" },
                { key: "subModule", label: "子模块", className: "whitespace-nowrap" },
                { key: "userCount", label: "用户数", className: "whitespace-nowrap" },
                { key: "implementationOrgCount", label: "实施组织数", className: "whitespace-nowrap" },
                { key: "pilotOrgCount", label: "试点家数", className: "whitespace-nowrap" },
              ]}
              emptyState="暂无产品模块行，请点击“新增行”"
              showSearch={false}
              showFilter={false}
              viewMode={productModuleViewMode}
              onViewModeChange={setProductModuleViewMode}
              createButtonLabel="新增行"
              onCreate={() => setProductModuleRows((rows) => [...rows, createEmptyProductModuleRow()])}
              toolbarActions={
                <Button className="h-10 rounded-xl" variant="outline" onClick={() => setProductModuleRows((rows) => (rows.length > 1 ? rows.slice(0, -1) : rows))}>
                  删除末行
                </Button>
              }
              renderRow={(row) => (
                <TableRow key={row.id}>
                  <TableCell><Input value={row.productDomain} onChange={(e) => setProductModuleRows((items) => items.map((x) => (x.id === row.id ? { ...x, productDomain: e.target.value } : x)))} /></TableCell>
                  <TableCell><Input value={row.moduleName} onChange={(e) => setProductModuleRows((items) => items.map((x) => (x.id === row.id ? { ...x, moduleName: e.target.value } : x)))} /></TableCell>
                  <TableCell><Input value={row.subModule} onChange={(e) => setProductModuleRows((items) => items.map((x) => (x.id === row.id ? { ...x, subModule: e.target.value } : x)))} /></TableCell>
                  <TableCell><Input value={row.userCount} onChange={(e) => setProductModuleRows((items) => items.map((x) => (x.id === row.id ? { ...x, userCount: e.target.value } : x)))} /></TableCell>
                  <TableCell><Input value={row.implementationOrgCount} onChange={(e) => setProductModuleRows((items) => items.map((x) => (x.id === row.id ? { ...x, implementationOrgCount: e.target.value } : x)))} /></TableCell>
                  <TableCell><Input value={row.pilotOrgCount} onChange={(e) => setProductModuleRows((items) => items.map((x) => (x.id === row.id ? { ...x, pilotOrgCount: e.target.value } : x)))} /></TableCell>
                </TableRow>
              )}
            />
          </div>
        </CardContent>
      </Card>

      <Card
        collapsed={sectionCollapsed.implementationScope}
        onCollapsedChange={(collapsed) => setSectionCollapsed((prev) => ({ ...prev, implementationScope: collapsed }))}
        contentClassName="gap-1"
        className="gap-3 py-4 border-border/40 bg-card/50 backdrop-blur-sm"
      >
        <CardHeader className="gap-0 pb-0">
          <CardTitle className="text-base">实施组织范围</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="[&>div]:p-0">
            <TableTemplate
              rows={implementationScopeRows}
              columns={[
                { key: "companyName", label: "公司名称", className: "whitespace-nowrap" },
                { key: "companyType", label: "公司性质", className: "whitespace-nowrap" },
                { key: "moduleScope", label: "实施模块范围说明", className: "whitespace-nowrap" },
                { key: "location", label: "实施地点", className: "whitespace-nowrap" },
                { key: "implementationMode", label: "实施/推广模式", className: "whitespace-nowrap" },
                { key: "note", label: "备注", className: "whitespace-nowrap" },
              ]}
              emptyState="暂无实施组织范围行，请点击“新增行”"
              showSearch={false}
              showFilter={false}
              viewMode={implementationScopeViewMode}
              onViewModeChange={setImplementationScopeViewMode}
              createButtonLabel="新增行"
              onCreate={() => setImplementationScopeRows((rows) => [...rows, createEmptyImplementationScopeRow()])}
              toolbarActions={
                <Button className="h-10 rounded-xl" variant="outline" onClick={() => setImplementationScopeRows((rows) => (rows.length > 1 ? rows.slice(0, -1) : rows))}>
                  删除末行
                </Button>
              }
              renderRow={(row) => (
                <TableRow key={row.id}>
                  <TableCell><Input value={row.companyName} onChange={(e) => setImplementationScopeRows((items) => items.map((x) => (x.id === row.id ? { ...x, companyName: e.target.value } : x)))} /></TableCell>
                  <TableCell><Input value={row.companyType} onChange={(e) => setImplementationScopeRows((items) => items.map((x) => (x.id === row.id ? { ...x, companyType: e.target.value } : x)))} /></TableCell>
                  <TableCell><Input value={row.moduleScope} onChange={(e) => setImplementationScopeRows((items) => items.map((x) => (x.id === row.id ? { ...x, moduleScope: e.target.value } : x)))} /></TableCell>
                  <TableCell><Input value={row.location} onChange={(e) => setImplementationScopeRows((items) => items.map((x) => (x.id === row.id ? { ...x, location: e.target.value } : x)))} /></TableCell>
                  <TableCell><Input value={row.implementationMode} onChange={(e) => setImplementationScopeRows((items) => items.map((x) => (x.id === row.id ? { ...x, implementationMode: e.target.value } : x)))} /></TableCell>
                  <TableCell><Input value={row.note} onChange={(e) => setImplementationScopeRows((items) => items.map((x) => (x.id === row.id ? { ...x, note: e.target.value } : x)))} /></TableCell>
                </TableRow>
              )}
            />
          </div>
        </CardContent>
      </Card>

      <Card
        collapsed={sectionCollapsed.meetingNotes}
        onCollapsedChange={(collapsed) => setSectionCollapsed((prev) => ({ ...prev, meetingNotes: collapsed }))}
        className="border-border/40 bg-card/50 backdrop-blur-sm"
      >
        <CardHeader className="pb-3">
          <CardTitle className="text-base">会议纪要或调研纪要</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            className="min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="请粘贴会议纪要、调研纪要或关键访谈记录"
            value={meetingNotes}
            onChange={(e) => setMeetingNotes(e.target.value)}
          />
        </CardContent>
      </Card>

      <Card
        collapsed={sectionCollapsed.keyPoints}
        onCollapsedChange={(collapsed) => setSectionCollapsed((prev) => ({ ...prev, keyPoints: collapsed }))}
        contentClassName="gap-1"
        className="gap-3 py-4 border-border/40 bg-card/50 backdrop-blur-sm"
      >
        <CardHeader className="gap-0 pb-0">
          <CardTitle className="text-base">需求、方案关键点（合同金额≥100万）</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="[&>div]:p-0">
            <TableTemplate
              rows={keyPointRows}
              columns={[
                { key: "analysisCategory", label: "分析项目", className: "whitespace-nowrap" },
                { key: "subItem", label: "子项", className: "whitespace-nowrap" },
                { key: "detail", label: "明细内容", className: "whitespace-nowrap" },
                { key: "note", label: "备注", className: "whitespace-nowrap" },
              ]}
              emptyState="暂无关键点行，请点击“新增行”"
              showSearch={false}
              showFilter={false}
              viewMode={keyPointViewMode}
              onViewModeChange={setKeyPointViewMode}
              createButtonLabel="新增行"
              onCreate={() => setKeyPointRows((rows) => [...rows, createEmptyKeyPointRow()])}
              toolbarActions={
                <Button className="h-10 rounded-xl" variant="outline" onClick={() => setKeyPointRows((rows) => (rows.length > 1 ? rows.slice(0, -1) : rows))}>
                  删除末行
                </Button>
              }
              renderRow={(row) => (
                <TableRow key={row.id}>
                  <TableCell><Input value={row.analysisCategory} onChange={(e) => setKeyPointRows((items) => items.map((x) => (x.id === row.id ? { ...x, analysisCategory: e.target.value } : x)))} /></TableCell>
                  <TableCell><Input value={row.subItem} onChange={(e) => setKeyPointRows((items) => items.map((x) => (x.id === row.id ? { ...x, subItem: e.target.value } : x)))} /></TableCell>
                  <TableCell><Input value={row.detail} onChange={(e) => setKeyPointRows((items) => items.map((x) => (x.id === row.id ? { ...x, detail: e.target.value } : x)))} /></TableCell>
                  <TableCell><Input value={row.note} onChange={(e) => setKeyPointRows((items) => items.map((x) => (x.id === row.id ? { ...x, note: e.target.value } : x)))} /></TableCell>
                </TableRow>
              )}
            />
          </div>
        </CardContent>
      </Card>
      </fieldset>
      </div>
      <VersionHistoryDialog
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        title="需求导入版本历史"
        description="按更新时间由新到旧排列，含已归档版本。"
        rows={recordsToVersionHistoryRows(versionRecords)}
        highlightVersionCode={selectedVersionCode.trim() || undefined}
      />
    </ModuleShell>
  )
}
