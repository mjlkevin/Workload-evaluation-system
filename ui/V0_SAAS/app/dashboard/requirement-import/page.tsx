"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Brain,
  CheckCircle2,
  ClipboardList,
  FileDown,
  Gauge,
  Lightbulb,
  ShieldAlert,
  TrendingUp,
} from "lucide-react"
import { shouldSuppressUnsavedPrompt, useSetUnsavedDirty, useUnsavedNavigation } from "@/hooks/use-unsaved-changes"
import { ModuleShell } from "@/components/workload/module-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  wesTableHeaderStickyClassName,
  wesTableToolbarHeaderRowClassName,
} from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { VersionVcsToolbar } from "@/components/workload/version-vcs-toolbar"
import { recordsToVersionHistoryRows, VersionHistoryDialog } from "@/components/workload/version-history-dialog"
import { TableTemplate } from "@/components/table-template"
import { useAuth } from "@/hooks/use-auth"
import { apiRequest } from "@/lib/api-client"
import { normalizeKimiModelName } from "@/lib/model-name"
import { cn, createClientRowId } from "@/lib/utils"
import {
  checkinVersionById,
  checkoutVersionById,
  createModuleVersion,
  forceUnlockById,
  generateKimiAssessmentPreview,
  getDashboardPlans,
  getRequirementSystemConfig,
  KIMI_ASSESSMENT_PREFILL_STORAGE_KEY,
  listModuleVersions,
  type KimiAssessmentPreviewResult,
  type ModuleVersionRecord,
  type RequirementSystemConfig,
  promoteVersionById,
  saveCheckedOutVersionDraft,
  undoCheckoutById,
} from "@/lib/workload-service"
import { useReactToPrint } from "react-to-print"
import { toast } from "sonner"

type BasicInfo = {
  customerName: string
  location: string
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

type CompanyProfileDisambiguationCandidate = {
  id: string
  displayName: string
  summary: string
}

type CompanyProfileSummaryResponse = {
  enterpriseProfile: string
  location: string
  customerIndustry: string
  enterpriseRevenue: string
  itStatus: string
  model: string
  mode?: "model" | "rule_fallback" | "disambiguation"
  fallbackReason?: string
  disambiguationCandidates?: CompanyProfileDisambiguationCandidate[]
}

const DEV_OVERVIEW_TOTAL_ROW_ID = "__dev-overview-total__"

function resolveEffectiveKimiModelForFileParsing(active: RequirementSystemConfig): string {
  const fp = (active.fileParsing.model || "").trim()
  const ke = (active.kimiEvaluation.model || "").trim()
  return fp || ke || ""
}

function createEmptyBusinessNeedRow(): BusinessNeedRow {
  return {
    id: createClientRowId(),
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
    id: createClientRowId(),
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
    id: createClientRowId(),
    summary: "",
    refinedContent: "",
    originalDemand: "",
    interviewOutline: "",
  }
}

function createEmptyProductModuleRow(): ProductModuleRow {
  return {
    id: createClientRowId(),
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
    id: createClientRowId(),
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
    id: createClientRowId(),
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
  location: "",
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
    basicInfo: false,
    valueProposition: false,
    businessNeed: false,
    devOverview: false,
    productModule: false,
    implementationScope: false,
    meetingNotes: false,
    keyPoints: false,
  }
}

/** 需求单里曾保存占位符式总方案号（如 GL-{YYMMDD}-{N}），总方案修复后用项目名称对齐到当前列表中的真实版本号 */
function resolveStaleGlobalVersionCode(
  stored: string,
  plans: Array<{ globalVersion: string; projectName: string }>,
  projectName: string,
): string {
  const t = stored.trim()
  if (!t) return ""
  if (!/\{[A-Za-z0-9]+\}/.test(t)) return t
  const pn = projectName.trim()
  if (!pn) return ""
  return plans.find((p) => p.projectName === pn)?.globalVersion ?? ""
}

/** 与后端升版/检入逻辑一致：同一 `baseCode` 视为同一条需求文档的版本脉络 */
function requirementVersionLineageKey(record: ModuleVersionRecord): string {
  const base = String(record.baseCode || "").trim()
  if (base) return base
  return String(record.versionCode || "").trim()
}

export default function RequirementImportPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { requestNavigation } = useUnsavedNavigation()
  const lastDraftKeyRef = useRef<string | null>(null)
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
  const [saveWithoutGlobalConfirmOpen, setSaveWithoutGlobalConfirmOpen] = useState(false)
  const [createNewSubmitting, setCreateNewSubmitting] = useState(false)
  const [hasLocalChanges, setHasLocalChanges] = useState(false)
  const [basicInfoModelName, setBasicInfoModelName] = useState("kimi-k2.5")
  const [basicInfoImportVisible, setBasicInfoImportVisible] = useState(false)
  const [basicInfoImportFile, setBasicInfoImportFile] = useState<File | null>(null)
  const [basicInfoImporting, setBasicInfoImporting] = useState(false)
  const [basicInfoImportError, setBasicInfoImportError] = useState("")
  const [basicInfoImportProgressValue, setBasicInfoImportProgressValue] = useState(0)
  const [basicInfoImportProgressStatus, setBasicInfoImportProgressStatus] = useState("")
  const [basicInfoImportOverwriteNonEmpty, setBasicInfoImportOverwriteNonEmpty] = useState(true)
  const basicInfoImportAbortRef = useRef<AbortController | null>(null)
  const [enterpriseProfileGenerating, setEnterpriseProfileGenerating] = useState(false)
  const [kimiHelpOpen, setKimiHelpOpen] = useState(false)
  const kimiHelpCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [enterpriseProfilePreviewVisible, setEnterpriseProfilePreviewVisible] = useState(false)
  const [enterpriseProfileDisambiguationOpen, setEnterpriseProfileDisambiguationOpen] = useState(false)
  const [enterpriseProfileDisambiguationList, setEnterpriseProfileDisambiguationList] = useState<
    CompanyProfileDisambiguationCandidate[]
  >([])
  const [enterpriseProfileGeneratedText, setEnterpriseProfileGeneratedText] = useState("")
  const [enterpriseProfileGeneratedFields, setEnterpriseProfileGeneratedFields] = useState({
    location: "",
    customerIndustry: "",
    enterpriseRevenue: "",
    itStatus: "",
  })
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
    toast.success(text)
  }

  function showGlobalWarning(text: string) {
    toast.warning(text)
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

  // 总方案版本号曾为未展开的占位符时，按项目名称与当前总方案列表对齐，避免下拉一直显示 GL-{…}-{N}
  useEffect(() => {
    if (!globalOptions.length || !globalVersionCode) return
    if (globalOptions.some((o) => o.value === globalVersionCode)) return
    if (!/\{[A-Za-z0-9]+\}/.test(globalVersionCode)) return
    const pn = basicInfo.projectName?.trim()
    const hit = pn ? globalOptions.find((o) => o.label.includes(`（${pn}）`)) : undefined
    setGlobalVersionCode(hit?.value ?? "")
  }, [globalOptions, globalVersionCode, basicInfo.projectName])

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
  const devOverviewDisplayRows = useMemo<DevOverviewRow[]>(
    () => [
      ...devOverviewRows,
      {
        id: DEV_OVERVIEW_TOTAL_ROW_ID,
        businessDomain: "合计",
        moduleName: "",
        moduleBrief: "",
        functionDesc: "",
        solutionSuggestion: "",
        codingDays: Number(devSummary.coding.toFixed(1)),
        estimateBasis: "",
      },
    ],
    [devOverviewRows, devSummary.coding],
  )
  const customerIndustryTags = useMemo(() => parseIndustryTags(basicInfo.customerIndustry), [basicInfo.customerIndustry])
  const selectedVersionRecord = useMemo(
    () => versionRecords.find((x) => x.versionCode === selectedVersionCode),
    [versionRecords, selectedVersionCode],
  )
  const requirementVersionHistoryRecords = useMemo(() => {
    if (!selectedVersionCode.trim() || !selectedVersionRecord) return []
    const key = requirementVersionLineageKey(selectedVersionRecord)
    return versionRecords.filter((r) => requirementVersionLineageKey(r) === key)
  }, [versionRecords, selectedVersionCode, selectedVersionRecord])
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

  const resetToNewRequirementDraft = useCallback(() => {
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
    setError("")
    setDirty(false)
    setHasLocalChanges(false)
    dirtyEnabled.current = true
  }, [setDirty])

  /** 顶部 Dashboard 页签：带 draftKey 且无 version 时视为「空白需求」实例，与已打开版本页签并存 */
  useEffect(() => {
    const version = searchParams.get("version")?.trim() || ""
    const draftKey = searchParams.get("draftKey")?.trim() || ""
    if (!draftKey || version) {
      lastDraftKeyRef.current = null
      return
    }
    if (lastDraftKeyRef.current === draftKey) return
    lastDraftKeyRef.current = draftKey
    resetToNewRequirementDraft()
  }, [searchParams, resetToNewRequirementDraft])

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
      const plans = await getDashboardPlans()
      const rawGlobal = (payload.globalVersionCode as string) || ""
      const pn = String(nextBasic.projectName || "").trim()
      const t = rawGlobal.trim()
      setGlobalVersionCode(
        /\{[A-Za-z0-9]+\}/.test(t) ? resolveStaleGlobalVersionCode(rawGlobal, plans, pn) : t,
      )
      setBasicInfo({
        ...EMPTY_BASIC_INFO,
        ...nextBasic,
        productLines: normalizeProductLines(nextBasic.productLines),
      })
      setValuePropositionRows(
        nextValueRows.length
          ? nextValueRows.map((row) => ({ ...row, id: row.id || createClientRowId() }))
          : [createEmptyValuePropositionRow()],
      )
      setBusinessNeedRows(
        nextRows.length
          ? nextRows.map((row) => ({ ...row, id: row.id || createClientRowId(), requiresCustomDev: row.requiresCustomDev || "否" }))
          : [createEmptyBusinessNeedRow()],
      )
      setDevOverviewRows(
        nextDevRows.length
          ? nextDevRows.map((row) => ({ ...row, id: row.id || createClientRowId(), codingDays: Number(row.codingDays || 0) }))
          : [createEmptyDevOverviewRow()],
      )
      setProductModuleRows(
        nextProductRows.length
          ? nextProductRows.map((row) => ({ ...row, id: row.id || createClientRowId() }))
          : [createEmptyProductModuleRow()],
      )
      setImplementationScopeRows(
        nextScopeRows.length
          ? nextScopeRows.map((row) => ({ ...row, id: row.id || createClientRowId() }))
          : [createEmptyImplementationScopeRow()],
      )
      dirtyEnabled.current = false
      setMeetingNotes((payload.meetingNotes as string) || "")
      setKeyPointRows(
        nextKeyPointRows.length
          ? nextKeyPointRows.map((row) => ({ ...row, id: row.id || createClientRowId() }))
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

  async function onSave(options?: { allowWithoutGlobal?: boolean }): Promise<boolean> {
    if (!(basicInfo.customerName || "").trim()) {
      setError("请填写客户名称")
      return false
    }
    if (!basicInfo.productLines.length) {
      setError("请至少选择一条产品线")
      return false
    }
    if (!basicInfo.projectName.trim()) {
      setError("请填写项目名称")
      return false
    }
    if (!globalVersionCode.trim() && !options?.allowWithoutGlobal) {
      setSaveWithoutGlobalConfirmOpen(true)
      return false
    }
    setSaving(true)
    setError("")
    try {
      const draftPayload = {
        globalVersionCode: globalVersionCode.trim(),
        basicInfo,
        valuePropositionRows,
        businessNeedRows,
        devOverviewRows,
        productModuleRows,
        implementationScopeRows,
        meetingNotes,
        keyPointRows,
      }
      const co = selectedVersionRecord
      if (co?.checkoutStatus === "checked_out" && co.id) {
        await saveCheckedOutVersionDraft(co.id, draftPayload)
        await reloadVersions(co.versionCode)
        showGlobalNotice(`已保存修改（仍为检出）：${co.versionCode}`)
      } else {
        const created = await createModuleVersion("requirementImport", draftPayload, "RI")
        await reloadVersions(created.versionCode)
        showGlobalNotice(`已保存需求版本：${created.versionCode}`)
      }
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

  async function onConfirmSaveWithoutGlobal() {
    const saved = await onSave({ allowWithoutGlobal: true })
    if (saved) setSaveWithoutGlobalConfirmOpen(false)
  }

  function onCreateNewRequirement() {
    if (saving) return
    // 已加载某一需求版本时：新增顶部页签打开空白表单，不替换当前页
    if (selectedVersionCode.trim()) {
      const draftKey = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      const href = `/dashboard/requirement-import?draftKey=${encodeURIComponent(draftKey)}`
      if (!requestNavigation(href)) return
      router.push(href)
      showGlobalNotice("已新增空白需求页签")
      return
    }
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
      const saved = await onSave({ allowWithoutGlobal: true })
      if (!saved) return
      setCreateNewConfirmOpen(false)
      resetToNewRequirementDraft()
      showGlobalNotice("已保存并新建需求")
    } finally {
      setCreateNewSubmitting(false)
    }
  }

  function isFilledImportStr(v: string | undefined | null): boolean {
    return String(v ?? "").trim().length > 0
  }

  function mergeBasicInfoFromImport(prev: BasicInfo, inc: Partial<BasicInfo>, overwriteNonEmpty: boolean): BasicInfo {
    if (overwriteNonEmpty) {
      return { ...prev, ...inc }
    }
    const next: BasicInfo = { ...prev }
    const strKeys: (keyof BasicInfo)[] = [
      "customerName",
      "location",
      "projectName",
      "opportunityNo",
      "customerIndustry",
      "enterpriseRevenue",
      "itStatus",
      "expectedGoLive",
      "enterpriseProfile",
      "projectBackgroundNeeds",
      "projectGoals",
    ]
    for (const k of strKeys) {
      if (!(k in inc) || typeof inc[k] !== "string") continue
      if (!isFilledImportStr(prev[k])) {
        next[k] = inc[k] as string
      }
    }
    if (inc.productLines && Array.isArray(inc.productLines)) {
      const pp = prev.productLines
      const anyPrev = pp.some((s) => isFilledImportStr(s))
      if (!anyPrev) {
        next.productLines = [...inc.productLines]
      } else {
        const maxLen = Math.max(pp.length, inc.productLines.length)
        next.productLines = Array.from({ length: maxLen }, (_, i) =>
          isFilledImportStr(pp[i] ?? "") ? (pp[i] ?? "") : (inc.productLines![i] ?? ""),
        )
      }
    }
    return next
  }

  function mergeValuePropositionRows(
    prev: ValuePropositionRow[],
    incoming: Array<Omit<ValuePropositionRow, "id">>,
  ): ValuePropositionRow[] {
    const maxLen = Math.max(prev.length, incoming.length)
    const out: ValuePropositionRow[] = []
    for (let i = 0; i < maxLen; i++) {
      const p = prev[i]
      const c = incoming[i]
      if (!p && c) {
        out.push({ id: createClientRowId(), ...c })
        continue
      }
      if (p && !c) {
        out.push(p)
        continue
      }
      if (p && c) {
        out.push({
          id: p.id,
          summary: isFilledImportStr(p.summary) ? p.summary : c.summary,
          refinedContent: isFilledImportStr(p.refinedContent) ? p.refinedContent : c.refinedContent,
          originalDemand: isFilledImportStr(p.originalDemand) ? p.originalDemand : c.originalDemand,
          interviewOutline: isFilledImportStr(p.interviewOutline) ? p.interviewOutline : c.interviewOutline,
        })
      }
    }
    return out
  }

  function businessNeedRowHasUserInput(p: BusinessNeedRow): boolean {
    return (
      isFilledImportStr(p.businessDomain) ||
      isFilledImportStr(p.category) ||
      isFilledImportStr(p.businessNeed) ||
      isFilledImportStr(p.proposer) ||
      isFilledImportStr(p.title) ||
      p.requiresCustomDev === "是"
    )
  }

  function mergeBusinessNeedRows(prev: BusinessNeedRow[], incoming: BusinessNeedRow[]): BusinessNeedRow[] {
    const maxLen = Math.max(prev.length, incoming.length)
    const out: BusinessNeedRow[] = []
    for (let i = 0; i < maxLen; i++) {
      const p = prev[i]
      const c = incoming[i]
      if (!p && c) {
        out.push({ ...c, id: createClientRowId() })
        continue
      }
      if (p && !c) {
        out.push(p)
        continue
      }
      if (p && c) {
        const touched = businessNeedRowHasUserInput(p)
        out.push({
          id: p.id,
          businessDomain: isFilledImportStr(p.businessDomain) ? p.businessDomain : c.businessDomain,
          category: isFilledImportStr(p.category) ? p.category : c.category,
          businessNeed: isFilledImportStr(p.businessNeed) ? p.businessNeed : c.businessNeed,
          proposer: isFilledImportStr(p.proposer) ? p.proposer : c.proposer,
          title: isFilledImportStr(p.title) ? p.title : c.title,
          requiresCustomDev: touched ? p.requiresCustomDev : c.requiresCustomDev,
        })
      }
    }
    return out
  }

  function mergeDevOverviewRows(prev: DevOverviewRow[], incoming: DevOverviewRow[]): DevOverviewRow[] {
    const maxLen = Math.max(prev.length, incoming.length)
    const out: DevOverviewRow[] = []
    for (let i = 0; i < maxLen; i++) {
      const p = prev[i]
      const c = incoming[i]
      if (!p && c) {
        out.push({ ...c, id: createClientRowId() })
        continue
      }
      if (p && !c) {
        out.push(p)
        continue
      }
      if (p && c) {
        out.push({
          id: p.id,
          businessDomain: isFilledImportStr(p.businessDomain) ? p.businessDomain : c.businessDomain,
          moduleName: isFilledImportStr(p.moduleName) ? p.moduleName : c.moduleName,
          moduleBrief: isFilledImportStr(p.moduleBrief) ? p.moduleBrief : c.moduleBrief,
          functionDesc: isFilledImportStr(p.functionDesc) ? p.functionDesc : c.functionDesc,
          solutionSuggestion: isFilledImportStr(p.solutionSuggestion) ? p.solutionSuggestion : c.solutionSuggestion,
          codingDays: p.codingDays !== 0 ? p.codingDays : c.codingDays,
          estimateBasis: isFilledImportStr(p.estimateBasis) ? p.estimateBasis : c.estimateBasis,
        })
      }
    }
    return out
  }

  function mergeProductModuleRows(prev: ProductModuleRow[], incoming: ProductModuleRow[]): ProductModuleRow[] {
    const maxLen = Math.max(prev.length, incoming.length)
    const out: ProductModuleRow[] = []
    for (let i = 0; i < maxLen; i++) {
      const p = prev[i]
      const c = incoming[i]
      if (!p && c) {
        out.push({ ...c, id: createClientRowId() })
        continue
      }
      if (p && !c) {
        out.push(p)
        continue
      }
      if (p && c) {
        out.push({
          id: p.id,
          productDomain: isFilledImportStr(p.productDomain) ? p.productDomain : c.productDomain,
          moduleName: isFilledImportStr(p.moduleName) ? p.moduleName : c.moduleName,
          subModule: isFilledImportStr(p.subModule) ? p.subModule : c.subModule,
          userCount: isFilledImportStr(p.userCount) ? p.userCount : c.userCount,
          implementationOrgCount: isFilledImportStr(p.implementationOrgCount)
            ? p.implementationOrgCount
            : c.implementationOrgCount,
          pilotOrgCount: isFilledImportStr(p.pilotOrgCount) ? p.pilotOrgCount : c.pilotOrgCount,
          partyBLead: isFilledImportStr(p.partyBLead) ? p.partyBLead : c.partyBLead,
          partyALead: isFilledImportStr(p.partyALead) ? p.partyALead : c.partyALead,
        })
      }
    }
    return out
  }

  function mergeImplementationScopeRows(
    prev: ImplementationScopeRow[],
    incoming: ImplementationScopeRow[],
  ): ImplementationScopeRow[] {
    const maxLen = Math.max(prev.length, incoming.length)
    const out: ImplementationScopeRow[] = []
    for (let i = 0; i < maxLen; i++) {
      const p = prev[i]
      const c = incoming[i]
      if (!p && c) {
        out.push({ ...c, id: createClientRowId() })
        continue
      }
      if (p && !c) {
        out.push(p)
        continue
      }
      if (p && c) {
        out.push({
          id: p.id,
          companyName: isFilledImportStr(p.companyName) ? p.companyName : c.companyName,
          companyType: isFilledImportStr(p.companyType) ? p.companyType : c.companyType,
          moduleScope: isFilledImportStr(p.moduleScope) ? p.moduleScope : c.moduleScope,
          location: isFilledImportStr(p.location) ? p.location : c.location,
          implementationMode: isFilledImportStr(p.implementationMode) ? p.implementationMode : c.implementationMode,
          note: isFilledImportStr(p.note) ? p.note : c.note,
        })
      }
    }
    return out
  }

  function mergeKeyPointRows(prev: KeyPointRow[], incoming: KeyPointRow[]): KeyPointRow[] {
    const maxLen = Math.max(prev.length, incoming.length)
    const out: KeyPointRow[] = []
    for (let i = 0; i < maxLen; i++) {
      const p = prev[i]
      const c = incoming[i]
      if (!p && c) {
        out.push({ ...c, id: createClientRowId() })
        continue
      }
      if (p && !c) {
        out.push(p)
        continue
      }
      if (p && c) {
        out.push({
          id: p.id,
          analysisCategory: isFilledImportStr(p.analysisCategory) ? p.analysisCategory : c.analysisCategory,
          subItem: isFilledImportStr(p.subItem) ? p.subItem : c.subItem,
          detail: isFilledImportStr(p.detail) ? p.detail : c.detail,
          note: isFilledImportStr(p.note) ? p.note : c.note,
        })
      }
    }
    return out
  }

  function applyRequirementImportData(
    data?: ParseBasicInfoResponse["requirementImportData"],
    overwriteNonEmpty = true,
  ) {
    if (!data) return
    const ow = overwriteNonEmpty

    if (Array.isArray(data.valuePropositionRows) && data.valuePropositionRows.length > 0) {
      const incoming = data.valuePropositionRows.map((row) => ({
        summary: String(row.summary || ""),
        refinedContent: String(row.refinedContent || ""),
        originalDemand: String(row.originalDemand || ""),
        interviewOutline: String(row.interviewOutline || ""),
      }))
      setValuePropositionRows((prev) =>
        ow ? incoming.map((r) => ({ id: createClientRowId(), ...r })) : mergeValuePropositionRows(prev, incoming),
      )
    }
    if (Array.isArray(data.businessNeedRows) && data.businessNeedRows.length > 0) {
      const incoming = data.businessNeedRows.map((row) => ({
        id: createClientRowId(),
        businessDomain: String(row.businessDomain || ""),
        category: String(row.category || ""),
        businessNeed: String(row.businessNeed || ""),
        proposer: String(row.proposer || ""),
        title: String(row.title || ""),
        requiresCustomDev: row.requiresCustomDev === "是" ? "是" : ("否" as const),
      }))
      setBusinessNeedRows((prev) => (ow ? incoming : mergeBusinessNeedRows(prev, incoming)))
    }
    if (Array.isArray(data.devOverviewRows) && data.devOverviewRows.length > 0) {
      const incoming = data.devOverviewRows.map((row) => ({
        id: createClientRowId(),
        businessDomain: String(row.businessDomain || ""),
        moduleName: String(row.moduleName || ""),
        moduleBrief: String(row.moduleBrief || ""),
        functionDesc: String(row.functionDesc || ""),
        solutionSuggestion: String(row.solutionSuggestion || ""),
        codingDays: Number(row.codingDays || 0),
        estimateBasis: String(row.estimateBasis || ""),
      }))
      setDevOverviewRows((prev) => (ow ? incoming : mergeDevOverviewRows(prev, incoming)))
    }
    if (Array.isArray(data.productModuleRows) && data.productModuleRows.length > 0) {
      const incoming = data.productModuleRows.map((row) => ({
        id: createClientRowId(),
        productDomain: String(row.productDomain || ""),
        moduleName: String(row.moduleName || ""),
        subModule: String(row.subModule || ""),
        userCount: String(row.userCount || ""),
        implementationOrgCount: String(row.implementationOrgCount || ""),
        pilotOrgCount: String(row.pilotOrgCount || ""),
        partyBLead: String(row.partyBLead || ""),
        partyALead: String(row.partyALead || ""),
      }))
      setProductModuleRows((prev) => (ow ? incoming : mergeProductModuleRows(prev, incoming)))
    }
    if (Array.isArray(data.implementationScopeRows) && data.implementationScopeRows.length > 0) {
      const incoming = data.implementationScopeRows.map((row) => ({
        id: createClientRowId(),
        companyName: String(row.companyName || ""),
        companyType: String(row.companyType || ""),
        moduleScope: String(row.moduleScope || ""),
        location: String(row.location || ""),
        implementationMode: String(row.implementationMode || ""),
        note: String(row.note || ""),
      }))
      setImplementationScopeRows((prev) => (ow ? incoming : mergeImplementationScopeRows(prev, incoming)))
    }
    if (typeof data.meetingNotes === "string" && data.meetingNotes.trim()) {
      setMeetingNotes((prev) => (ow || !prev.trim() ? data.meetingNotes! : prev))
    }
    if (Array.isArray(data.keyPointRows) && data.keyPointRows.length > 0) {
      const incoming = data.keyPointRows.map((row) => ({
        id: createClientRowId(),
        analysisCategory: String(row.analysisCategory || ""),
        subItem: String(row.subItem || ""),
        detail: String(row.detail || ""),
        note: String(row.note || ""),
      }))
      setKeyPointRows((prev) => (ow ? incoming : mergeKeyPointRows(prev, incoming)))
    }
  }

  function closeBasicInfoImportDialog() {
    basicInfoImportAbortRef.current?.abort()
    setBasicInfoImporting(false)
    setBasicInfoImportVisible(false)
    setBasicInfoImportProgressStatus("")
    setBasicInfoImportProgressValue(0)
    setBasicInfoImportError("")
  }

  async function onImportBasicInfoByExcel() {
    setBasicInfoImportError("")
    setError("")
    if (!basicInfoImportFile) {
      setBasicInfoImportError("请先选择 Excel 文件")
      return
    }
    const ac = new AbortController()
    basicInfoImportAbortRef.current = ac
    const overwriteNonEmpty = basicInfoImportOverwriteNonEmpty
    setBasicInfoImporting(true)
    setBasicInfoImportProgressValue(8)
    setBasicInfoImportProgressStatus("正在准备解析请求…")
    const bumpBasicInfoImportProgress = (text: string, progress?: number) => {
      if (ac.signal.aborted) return
      setBasicInfoImportProgressStatus(text)
      if (typeof progress === "number") {
        setBasicInfoImportProgressValue((prev) => Math.max(prev, Math.min(100, progress)))
      }
    }
    try {
      let waitModelLabel = normalizeKimiModelName(basicInfoModelName)
      try {
        bumpBasicInfoImportProgress("正在获取解析模型配置…", 12)
        const cfgView = await getRequirementSystemConfig()
        if (ac.signal.aborted) return
        const raw = resolveEffectiveKimiModelForFileParsing(cfgView.active)
        if (raw) {
          setBasicInfoModelName(raw)
          waitModelLabel = normalizeKimiModelName(raw)
        }
      } catch {
        // 配置不可用则沿用页面上已有的模型名
      }
      bumpBasicInfoImportProgress("正在上传文件并调用解析接口…", 22)
      const formData = new FormData()
      formData.append("file", basicInfoImportFile)
      bumpBasicInfoImportProgress(`解析请求已发送，正在等待 ${waitModelLabel} 返回结果…`, 40)
      const data = await apiRequest<ParseBasicInfoResponse>("/api/v1/ai/parse-basic-info", {
        method: "POST",
        body: formData,
        signal: ac.signal,
      })
      if (ac.signal.aborted) return
      bumpBasicInfoImportProgress("已收到解析结果，正在写入基本情况与需求表…", 88)
      setBasicInfo((prev) => mergeBasicInfoFromImport(prev, data.basicInfo ?? {}, overwriteNonEmpty))
      applyRequirementImportData(data.requirementImportData, overwriteNonEmpty)
      if (data.model) setBasicInfoModelName(data.model)
      bumpBasicInfoImportProgress(
        data.mode === "rule_fallback" ? "解析完成（已使用规则回填）" : "解析完成（模型已返回结构化结果）",
        100,
      )
      setBasicInfoImportVisible(false)
      setBasicInfoImportFile(null)
      setBasicInfoImportProgressStatus("")
      setBasicInfoImportProgressValue(0)
      const mergeHint = overwriteNonEmpty ? "" : "（已保留已有非空字段）"
      if (data.mode === "rule_fallback") {
        const fallbackHint = data.fallbackReason ? `（${data.fallbackReason}）` : ""
        showGlobalNotice(`Excel 已按规则回填${fallbackHint}${mergeHint}`)
      } else {
        showGlobalNotice(`Excel 解析完成，已回填需求内容${mergeHint}`)
      }
    } catch (err) {
      if (ac.signal.aborted) return
      setBasicInfoImportProgressStatus("解析失败，请检查网络或文件内容后重试。")
      setBasicInfoImportError(err instanceof Error ? err.message : "解析失败")
    } finally {
      if (basicInfoImportAbortRef.current === ac) {
        basicInfoImportAbortRef.current = null
      }
      setBasicInfoImporting(false)
    }
  }

  function applyCompanyProfileSummaryToPreview(data: CompanyProfileSummaryResponse) {
    setEnterpriseProfileGeneratedText(data.enterpriseProfile)
    setEnterpriseProfileGeneratedFields({
      location: data.location || "",
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
  }

  async function onGenerateEnterpriseProfileByKimi() {
    const customerName = (basicInfo.customerName || "").trim()
    if (!customerName) {
      setError("请先填写客户名称")
      return
    }
    setEnterpriseProfileGenerating(true)
    setError("")
    setEnterpriseProfileDisambiguationOpen(false)
    setEnterpriseProfileDisambiguationList([])
    try {
      const data = await apiRequest<CompanyProfileSummaryResponse>("/api/v1/ai/company-profile-summary", {
        method: "POST",
        body: {
          customerName,
          location: basicInfo.location || "",
          customerIndustry: basicInfo.customerIndustry || "",
          enterpriseRevenue: basicInfo.enterpriseRevenue || "",
          itStatus: basicInfo.itStatus || "",
        },
      })
      if (data.mode === "disambiguation" && data.disambiguationCandidates?.length) {
        setEnterpriseProfileDisambiguationList(data.disambiguationCandidates.slice(0, 3))
        setEnterpriseProfileDisambiguationOpen(true)
        showGlobalNotice("识别到多个可能的企业主体，请任选一项后继续生成")
        return
      }
      applyCompanyProfileSummaryToPreview(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "企业简介生成失败")
    } finally {
      setEnterpriseProfileGenerating(false)
    }
  }

  async function onContinueEnterpriseProfileAfterDisambiguation(choice: CompanyProfileDisambiguationCandidate) {
    const customerName = (basicInfo.customerName || "").trim()
    if (!customerName) {
      setError("请先填写客户名称")
      return
    }
    setEnterpriseProfileGenerating(true)
    setError("")
    try {
      const data = await apiRequest<CompanyProfileSummaryResponse>("/api/v1/ai/company-profile-summary", {
        method: "POST",
        body: {
          customerName,
          location: basicInfo.location || "",
          customerIndustry: basicInfo.customerIndustry || "",
          enterpriseRevenue: basicInfo.enterpriseRevenue || "",
          itStatus: basicInfo.itStatus || "",
          disambiguationChoice: {
            displayName: choice.displayName,
            summary: choice.summary,
          },
        },
      })
      if (data.mode === "disambiguation" && data.disambiguationCandidates?.length) {
        setEnterpriseProfileDisambiguationList(data.disambiguationCandidates.slice(0, 3))
        showGlobalNotice("模型仍返回多个主体，请再次选择")
        return
      }
      setEnterpriseProfileDisambiguationOpen(false)
      setEnterpriseProfileDisambiguationList([])
      applyCompanyProfileSummaryToPreview(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "企业简介生成失败")
    } finally {
      setEnterpriseProfileGenerating(false)
    }
  }

  async function onGenerateAssessmentPreviewByKimi() {
    if (kimiAssessing) return
    if (!(basicInfo.customerName || "").trim()) {
      setError("请先填写客户名称，再进行 Kimi 评估")
      return
    }
    if (!basicInfo.productLines.length) {
      setError("请先选择至少一条产品线，再进行 Kimi 评估")
      return
    }
    if (!basicInfo.projectName.trim()) {
      setError("请先填写项目名称，再进行 Kimi 评估")
      return
    }
    setKimiAssessing(true)
    setKimiAssessProgressOpen(true)
    setKimiAssessProgressValue(8)
    setKimiAssessProgressLogs([`[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] 已启动 Kimi 评估任务`])
    setError("")
    const appendAssessProgress = (text: string, progress?: number) => {
      setKimiAssessProgressLogs((logs) => [
        ...logs,
        `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${text}`,
      ])
      if (typeof progress === "number") {
        setKimiAssessProgressValue((prev) => Math.max(prev, Math.min(100, progress)))
      }
    }
    let rollingTimer: ReturnType<typeof window.setInterval> | null = null
    try {
      appendAssessProgress("正在校验项目名称与需求快照...", 18)
      appendAssessProgress("正在整理开发需求合计并构建评估上下文...", 30)
      appendAssessProgress("已提交评估请求，等待 Kimi 返回结果...", 45)
      const rollingTips = [
        "模型正在分析模块边界与实施范围...",
        "模型正在计算标准/建议人天与偏离原因...",
        "模型正在汇总风险与前提假设...",
      ]
      let tipIndex = 0
      rollingTimer = window.setInterval(() => {
        tipIndex = (tipIndex + 1) % rollingTips.length
        appendAssessProgress(rollingTips[tipIndex])
        setKimiAssessProgressValue((prev) => Math.min(88, prev + 4))
      }, 1600)
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
          devTotalDays: Number(devSummary.total.toFixed(1)),
          productModuleRows: productModuleRows as unknown as Array<Record<string, unknown>>,
          implementationScopeRows: implementationScopeRows as unknown as Array<Record<string, unknown>>,
          meetingNotes,
          keyPointRows: keyPointRows as unknown as Array<Record<string, unknown>>,
        },
      })
      if (rollingTimer) {
        window.clearInterval(rollingTimer)
        rollingTimer = null
      }
      appendAssessProgress("已收到评估响应，正在渲染预览...", 94)
      setKimiAssessmentPreview(data)
      setKimiAssessmentPreviewOpen(true)
      appendAssessProgress("评估预览已生成", 100)
      if (data.meta.mode === "rule_fallback") {
        const hint = data.meta.fallbackReason ? `（${data.meta.fallbackReason}）` : ""
        showGlobalNotice(`Kimi 评估已生成（规则兜底）${hint}`)
      } else {
        showGlobalNotice("Kimi 评估预览已生成")
      }
      window.setTimeout(() => {
        setKimiAssessProgressOpen(false)
      }, 450)
    } catch (err) {
      if (rollingTimer) {
        window.clearInterval(rollingTimer)
        rollingTimer = null
      }
      appendAssessProgress("评估失败，请检查网络或稍后重试。", 100)
      setError(err instanceof Error ? err.message : "Kimi 评估生成失败")
    } finally {
      if (rollingTimer) window.clearInterval(rollingTimer)
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
    const generatedLocation = enterpriseProfileGeneratedFields.location.trim()
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
      location: generatedLocation || prev.location,
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
      showGlobalNotice("已插入企业简介并同步回填地点/客户行业/企业营收/信息化现状")
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
  const [kimiAssessProgressOpen, setKimiAssessProgressOpen] = useState(false)
  const [kimiAssessProgressValue, setKimiAssessProgressValue] = useState(0)
  const [kimiAssessProgressLogs, setKimiAssessProgressLogs] = useState<string[]>([])
  const kimiAssessProgressLogRef = useRef<HTMLDivElement | null>(null)
  const kimiAssessmentPrintRef = useRef<HTMLDivElement | null>(null)
  const printKimiAssessmentPreview = useReactToPrint({
    contentRef: kimiAssessmentPrintRef,
    documentTitle: () => {
      const d = new Date()
      const p = (n: number) => String(n).padStart(2, "0")
      return `Kimi评估预览_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
    },
    pageStyle: "@page { size: A4; margin: 12mm; }",
    onPrintError: (_loc, err) => {
      console.error(err)
      toast.error("无法打开打印/导出，请检查浏览器是否拦截弹出窗口")
    },
  })
  const kimiDevTotalDays = useMemo(() => {
    if (!kimiAssessmentPreview) return 0
    const hit = kimiAssessmentPreview.assessmentDraft.moduleItems.find((item) => {
      const cloud = String(item.cloudProduct || "")
      const sku = String(item.skuName || item.moduleName || "")
      return /开发需求概要/.test(cloud) || /开发总人天|合计行/.test(sku)
    })
    return Number(hit?.suggestedDays || 0)
  }, [kimiAssessmentPreview])
  const kimiPreviewMetrics = useMemo(() => {
    if (!kimiAssessmentPreview) {
      return {
        confidencePct: 0,
        totalSuggestedDays: 0,
        totalStandardDays: 0,
        avgDeltaPct: 0,
        riskCount: 0,
        assumptionCount: 0,
        highDeltaCount: 0,
      }
    }
    const items = kimiAssessmentPreview.assessmentDraft.moduleItems || []
    const totalSuggestedDays = items.reduce((sum, item) => sum + Number(item.suggestedDays || 0), 0)
    const totalStandardDays = items.reduce((sum, item) => sum + Number(item.standardDays || 0), 0)
    const avgDeltaPct =
      totalStandardDays > 0 ? Math.round(((totalSuggestedDays - totalStandardDays) / totalStandardDays) * 100) : 0
    const highDeltaCount = items.filter((item) => {
      const std = Number(item.standardDays || 0)
      if (std <= 0) return false
      return Math.abs((Number(item.suggestedDays || 0) - std) / std) >= 0.3
    }).length
    return {
      confidencePct: Math.round((Number(kimiAssessmentPreview.meta.confidence) || 0) * 100),
      totalSuggestedDays: Math.round(totalSuggestedDays),
      totalStandardDays: Math.round(totalStandardDays),
      avgDeltaPct,
      riskCount: kimiAssessmentPreview.assessmentDraft.risks.length,
      assumptionCount: kimiAssessmentPreview.assessmentDraft.assumptions.length,
      highDeltaCount,
    }
  }, [kimiAssessmentPreview])
  const kimiRiskLevel = useMemo(() => {
    if (!kimiAssessmentPreview) return { label: "未知", className: "text-muted-foreground", score: 0 }
    const riskCount = kimiPreviewMetrics.riskCount
    const highDeltaCount = kimiPreviewMetrics.highDeltaCount
    const score = riskCount * 0.7 + highDeltaCount * 0.9 + Math.max(0, kimiPreviewMetrics.avgDeltaPct) / 20
    if (score >= 4) return { label: "高", className: "text-destructive", score: 90 }
    if (score >= 2.2) return { label: "中", className: "text-amber-600", score: 60 }
    return { label: "低", className: "text-emerald-600", score: 30 }
  }, [kimiAssessmentPreview, kimiPreviewMetrics])
  const kimiRiskRationale = useMemo(() => {
    if (!kimiAssessmentPreview) return ["暂无评估数据"]
    const reasons: string[] = []
    if (kimiPreviewMetrics.riskCount >= 4) reasons.push(`风险条目较多（${kimiPreviewMetrics.riskCount} 条）`)
    else if (kimiPreviewMetrics.riskCount > 0) reasons.push(`存在风险条目（${kimiPreviewMetrics.riskCount} 条）`)

    if (kimiPreviewMetrics.highDeltaCount >= 3) reasons.push(`高偏差SKU较多（${kimiPreviewMetrics.highDeltaCount} 项）`)
    else if (kimiPreviewMetrics.highDeltaCount > 0) reasons.push(`存在高偏差SKU（${kimiPreviewMetrics.highDeltaCount} 项）`)

    if (kimiPreviewMetrics.avgDeltaPct >= 50) reasons.push(`平均偏差较高（${kimiPreviewMetrics.avgDeltaPct}%）`)
    else if (kimiPreviewMetrics.avgDeltaPct > 20) reasons.push(`平均偏差中等（${kimiPreviewMetrics.avgDeltaPct}%）`)
    else reasons.push(`平均偏差可控（${kimiPreviewMetrics.avgDeltaPct}%）`)

    if (kimiAssessmentPreview.assessmentDraft.orgCount >= 3) {
      reasons.push(`组织数量较多（${kimiAssessmentPreview.assessmentDraft.orgCount}），协同复杂度提升`)
    }
    return reasons
  }, [kimiAssessmentPreview, kimiPreviewMetrics])
  const kimiTopEvidence = useMemo(() => {
    if (!kimiAssessmentPreview) return []
    return [...(kimiAssessmentPreview.assessmentDraft.moduleItems || [])]
      .map((item) => {
        const std = Number(item.standardDays || 0)
        const sug = Number(item.suggestedDays || 0)
        const deltaPct = std > 0 ? Math.round(((sug - std) / std) * 100) : 0
        const sku = String(item.skuName ?? "").trim()
        const cloud = String(item.cloudProduct ?? "").trim()
        const moduleName =
          sku || (cloud ? `${cloud}（云级）` : String(item.moduleName || "").trim() || "未命名模块")
        return {
          moduleName,
          deltaPct,
          reason: item.reason || "未给出原因",
        }
      })
      .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
      .slice(0, 3)
  }, [kimiAssessmentPreview])
  const kimiWaterfall = useMemo(() => {
    if (!kimiAssessmentPreview) {
      return {
        rows: [] as Array<{ key: string; label: string; value: number; cumulative: number; cumulativeEnd: number; tone: "base" | "up" | "down" | "final" }>,
        maxAbs: 1,
        breakdowns: [] as Array<{
          key: string
          label: string
          formula: string
          computed: string
          inputs: Array<{ name: string; value: string | number }>
          note: string
        }>,
      }
    }
    const base = kimiPreviewMetrics.totalStandardDays
    const suggested = kimiPreviewMetrics.totalSuggestedDays
    const draft = kimiAssessmentPreview.assessmentDraft
    const difficulty = Number(draft.difficultyFactor || 0)
    const orgSimilarity = Number(draft.orgSimilarity || 0)
    const orgCount = Math.max(1, Number(draft.orgCount || 1))
    const riskCount = draft.risks.length

    const complexityAdj = Math.round(base * difficulty * 0.35)
    const orgAdj = Math.round(base * orgSimilarity * Math.max(0, orgCount - 1) * 0.08)
    const riskAdj = Math.round(base * Math.min(6, riskCount) * 0.03)
    const calibration = suggested - (base + complexityAdj + orgAdj + riskAdj)

    const items = [
      { key: "base", label: "标准人天基线", value: base, tone: "base" as const },
      { key: "complexity", label: "复杂度调整", value: complexityAdj, tone: complexityAdj >= 0 ? ("up" as const) : ("down" as const) },
      { key: "org", label: "组织协同调整", value: orgAdj, tone: orgAdj >= 0 ? ("up" as const) : ("down" as const) },
      { key: "risk", label: "风险缓冲调整", value: riskAdj, tone: riskAdj >= 0 ? ("up" as const) : ("down" as const) },
      { key: "calibration", label: "模型校准调整", value: calibration, tone: calibration >= 0 ? ("up" as const) : ("down" as const) },
    ]

    let running = 0
    const rows = items.map((item) => {
      const start = running
      const end = running + item.value
      running = end
      return {
        ...item,
        cumulative: start,
        cumulativeEnd: end,
      }
    })
    rows.push({
      key: "final",
      label: "建议人天结果",
      value: suggested,
      cumulative: 0,
      cumulativeEnd: suggested,
      tone: "final",
    })
    const maxAbs = Math.max(
      1,
      ...rows.map((row) => Math.abs(row.value)),
      Math.abs(suggested),
      Math.abs(base),
    )
    const breakdowns = [
      {
        key: "complexity",
        label: "复杂度调整",
        formula: "复杂度调整 = 标准人天 × 难度系数 × 0.35",
        computed: `${base} × ${difficulty.toFixed(2)} × 0.35 = ${(base * difficulty * 0.35).toFixed(2)} ≈ ${complexityAdj}`,
        inputs: [
          { name: "标准人天", value: base },
          { name: "难度系数", value: difficulty.toFixed(2) },
          { name: "系数", value: "0.35" },
        ],
        note: "体现需求复杂性对实施工作量的增量影响。",
      },
      {
        key: "org",
        label: "组织协同调整",
        formula: "组织协同调整 = 标准人天 × 组织相似度 × max(组织数-1,0) × 0.08",
        computed: `${base} × ${orgSimilarity.toFixed(2)} × ${Math.max(0, orgCount - 1)} × 0.08 = ${(base * orgSimilarity * Math.max(0, orgCount - 1) * 0.08).toFixed(2)} ≈ ${orgAdj}`,
        inputs: [
          { name: "标准人天", value: base },
          { name: "组织相似度", value: orgSimilarity.toFixed(2) },
          { name: "组织数", value: orgCount },
          { name: "系数", value: "0.08" },
        ],
        note: "组织越多、差异越大，跨组织协调与推广成本越高。",
      },
      {
        key: "risk",
        label: "风险缓冲调整",
        formula: "风险缓冲调整 = 标准人天 × min(风险条目数,6) × 0.03",
        computed: `${base} × ${Math.min(riskCount, 6)} × 0.03 = ${(base * Math.min(riskCount, 6) * 0.03).toFixed(2)} ≈ ${riskAdj}`,
        inputs: [
          { name: "标准人天", value: base },
          { name: "风险条目数", value: riskCount },
          { name: "封顶条目数", value: Math.min(riskCount, 6) },
          { name: "系数", value: "0.03" },
        ],
        note: "用于给高风险场景留出缓冲人天，避免排期过紧。",
      },
      {
        key: "calibration",
        label: "模型校准调整",
        formula: "模型校准调整 = 建议人天 - (标准人天 + 复杂度调整 + 组织协同调整 + 风险缓冲调整)",
        computed: `${suggested} - (${base} + ${complexityAdj} + ${orgAdj} + ${riskAdj}) = ${calibration}`,
        inputs: [
          { name: "建议人天", value: suggested },
          { name: "标准人天", value: base },
          { name: "复杂度调整", value: complexityAdj },
          { name: "组织协同调整", value: orgAdj },
          { name: "风险缓冲调整", value: riskAdj },
        ],
        note: "用于吸收模型综合判断（行业经验、上下文语义）带来的剩余差值。",
      },
    ]
    return { rows, maxAbs, breakdowns }
  }, [kimiAssessmentPreview, kimiPreviewMetrics])
  const kimiAssessProgressCurrentText = useMemo(
    () => kimiAssessProgressLogs[kimiAssessProgressLogs.length - 1] || "准备中...",
    [kimiAssessProgressLogs],
  )
  useEffect(() => {
    if (!kimiAssessProgressOpen) return
    const el = kimiAssessProgressLogRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [kimiAssessProgressLogs, kimiAssessProgressOpen])

  return (
    <ModuleShell
      title="需求"
      breadcrumbs={[{ label: "需求" }]}
    >
    <div className="wes-requirement-page min-w-0 max-w-full space-y-2 overflow-x-hidden [&_td:has(>input)]:h-11 [&_td:has(>input)]:p-0 [&_td:has(>input)]:align-middle [&_td>input]:block [&_td>input]:w-full [&_td>input]:h-full [&_td>input]:min-h-9 [&_td>input]:rounded-none [&_td>input]:border-0 [&_td>input]:py-0 [&_td>input]:shadow-none">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5 md:flex-nowrap">
          <Button className="rounded-lg text-xs" size="sm" variant="outline" onClick={() => void onCreateNewRequirement()} disabled={saving || createNewSubmitting}>
            新建需求
          </Button>
          <Button className="rounded-lg text-xs" size="sm" onClick={() => void onSave()} disabled={saving}>
            {saving ? "保存中..." : "保存版本"}
          </Button>
          <VersionVcsToolbar
            compact
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
            onVersionHistory={() => {
              if (!selectedVersionCode.trim()) {
                toast.warning("请先选择需求版本")
                return
              }
              setVersionHistoryOpen(true)
            }}
            onCheckout={() => void onCheckout()}
            onCheckin={(checkinNote) => void onCheckin(checkinNote)}
            onUndoCheckout={() => void onUndoCheckout()}
            onPromote={() => void onPromote()}
            onForceUnlock={() => void onForceUnlock()}
            forceUnlockVisible={isAdmin}
          />
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[11px] leading-tight text-muted-foreground">模型：{normalizeKimiModelName(basicInfoModelName)}</span>
            <Popover open={kimiHelpOpen} onOpenChange={setKimiHelpOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  className="wes-kimi-help-btn rounded-lg px-3 text-xs focus-visible:ring-violet-400/45"
                  onMouseEnter={openKimiHelpByHover}
                  onMouseLeave={scheduleCloseKimiHelpByHover}
                >
                  Kimi-help
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={8}
                className="w-44 gap-1 border border-violet-500/30 bg-gradient-to-b from-violet-950/[0.07] via-background to-background p-2 shadow-md shadow-violet-500/15"
                onMouseEnter={openKimiHelpByHover}
                onMouseLeave={scheduleCloseKimiHelpByHover}
              >
                <div className="flex flex-col gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    className="wes-kimi-help-menu-btn h-8 justify-start rounded-lg px-2 text-xs"
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
                    className="wes-kimi-help-menu-btn h-8 justify-start rounded-lg px-2 text-xs"
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
                            className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white/45 text-[10px] leading-none text-white/90"
                            onClick={(e) => e.stopPropagation()}
                          >
                            ?
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={6} className="max-w-64 text-xs leading-5">
                          维护好客户名称后，通过kimi生成回填企业简介、地点、企业营收、信息化现状等信息
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="wes-kimi-help-menu-btn h-8 justify-start rounded-lg px-2 text-xs"
                    onClick={() => {
                      setKimiHelpOpen(false)
                      setBasicInfoImportProgressStatus("")
                      setBasicInfoImportProgressValue(0)
                      setBasicInfoImportError("")
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
        <Card
          collapsed={false}
          collapsible={false}
          className="gap-1.5 py-2 border-border/40 bg-card/50 backdrop-blur-sm"
          contentClassName="!gap-0"
        >
          <CardHeader className="space-y-1 gap-1 px-4 pb-1.5 pt-1">
            <CardTitle className="text-sm">版本与上下文</CardTitle>
            <div className="grid gap-x-2 gap-y-1 md:grid-cols-3">
              <p className="wes-req-field-caption text-[11px] leading-tight">总方案版本号</p>
              <p className="wes-req-field-caption text-[11px] leading-tight">需求版本号</p>
              <p className="wes-req-field-caption text-[11px] leading-tight">检出状态</p>
              <select
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
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
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
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
              <div className="h-8 w-full rounded-md border border-border/70 bg-background/95 px-2 text-xs leading-8 shadow-sm">
                {checkoutStatusText}
              </div>
            </div>
            {error ? (
              <div className="pt-0.5">
                <span className="text-xs text-destructive">{error}</span>
              </div>
            ) : null}
            {isReadonly ? (
              <p className="text-[11px] leading-snug text-muted-foreground">当前版本为只读状态，请先检出后编辑。</p>
            ) : null}
          </CardHeader>
        </Card>
      </div>

      <fieldset
        disabled={isReadonly}
        className="min-w-0 max-w-full space-y-2 overflow-x-hidden [&>[data-slot=card][data-collapsed=true]]:h-14 [&>[data-slot=card][data-collapsed=true]]:min-h-14 [&>[data-slot=card][data-collapsed=true]]:overflow-hidden"
      >
      <Card
        collapsed={sectionCollapsed.basicInfo}
        onCollapsedChange={(collapsed) => setSectionCollapsed((prev) => ({ ...prev, basicInfo: collapsed }))}
        className="w-full min-w-0 max-w-full gap-2 py-3 overflow-x-hidden border-border/40 bg-card/50 backdrop-blur-sm"
        contentClassName="!gap-2"
      >
        <CardHeader className="gap-1 px-4 pb-0.5 pt-0">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">基本情况</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 px-4 pb-3 pt-0">
          <div className="grid gap-x-2 gap-y-1.5 md:grid-cols-3">
            <label className="space-y-0.5">
              <span className="text-xs">
                客户名称
                <span className="ml-0.5 text-destructive" aria-hidden="true">
                  *
                </span>
              </span>
              <Input
                value={basicInfo.customerName}
                onChange={(e) => setBasicInfo((s) => ({ ...s, customerName: e.target.value }))}
                required
                aria-required
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-xs">地点</span>
              <Input value={basicInfo.location} onChange={(e) => setBasicInfo((s) => ({ ...s, location: e.target.value }))} />
            </label>
            <label className="space-y-0.5">
              <span className="text-xs">
                项目名称
                <span className="ml-0.5 text-destructive" aria-hidden="true">
                  *
                </span>
              </span>
              <Input value={basicInfo.projectName} onChange={(e) => setBasicInfo((s) => ({ ...s, projectName: e.target.value }))} />
            </label>
            <label className="space-y-0.5">
              <span className="text-xs">商机号</span>
              <Input value={basicInfo.opportunityNo} onChange={(e) => setBasicInfo((s) => ({ ...s, opportunityNo: e.target.value }))} />
            </label>
            <label className="space-y-0.5">
              <span className="text-xs">
                产品线
                <span className="ml-0.5 text-destructive" aria-hidden="true">
                  *
                </span>
              </span>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="h-8 w-full rounded-md border border-border/70 bg-background/95 px-2 text-left text-xs leading-8 shadow-sm"
                    aria-required
                  >
                    {basicInfo.productLines.length ? (
                      <span className="block truncate">{basicInfo.productLines.join(" / ")}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">请选择产品线（可多选，至少一项）</span>
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
            <label className="space-y-0.5">
              <span className="inline-flex items-center gap-1 text-xs">
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
              <div className="min-h-8 min-w-0 max-w-full rounded-md border border-border/70 bg-background/95 px-2 py-1 shadow-sm">
                <div className="flex min-w-0 max-w-full flex-wrap gap-1.5">
                  {customerIndustryTags.length > 0 ? (
                    customerIndustryTags.map((tag, idx) => (
                      <Badge
                        key={`${tag}-${idx}`}
                        variant={idx === customerIndustryTags.length - 1 ? "default" : "secondary"}
                        className="max-w-full whitespace-normal break-all rounded-full px-2.5 py-0.5 text-xs"
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
            <label className="space-y-0.5">
              <span className="text-xs">企业营收</span>
              <Input value={basicInfo.enterpriseRevenue} onChange={(e) => setBasicInfo((s) => ({ ...s, enterpriseRevenue: e.target.value }))} />
            </label>
            <label className="space-y-0.5">
              <span className="text-xs text-muted-foreground">信息化现状</span>
              <Input value={basicInfo.itStatus} onChange={(e) => setBasicInfo((s) => ({ ...s, itStatus: e.target.value }))} />
            </label>
            <label className="space-y-0.5">
              <span className="text-xs">预期上线时间</span>
              <Input type="month" value={basicInfo.expectedGoLive} onChange={(e) => setBasicInfo((s) => ({ ...s, expectedGoLive: e.target.value }))} />
            </label>
          </div>

          <div className="space-y-2 rounded-lg border border-border/50 bg-secondary/20 p-2">
            <label className="block space-y-0.5">
              <span className="text-xs">企业简介</span>
              <textarea
                ref={enterpriseProfileRef}
                className="w-full resize-none overflow-hidden rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                placeholder="请输入企业简介"
                value={basicInfo.enterpriseProfile}
                onChange={(e) => setBasicInfo((s) => ({ ...s, enterpriseProfile: e.target.value }))}
                onInput={(e) => autoResizeTextarea(e.currentTarget, 72)}
              />
            </label>
            <label className="block space-y-0.5">
              <span className="text-xs">项目背景和需求</span>
              <textarea
                ref={projectBackgroundNeedsRef}
                className="w-full resize-none overflow-hidden rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                placeholder="请输入项目背景和需求"
                value={basicInfo.projectBackgroundNeeds}
                onChange={(e) => setBasicInfo((s) => ({ ...s, projectBackgroundNeeds: e.target.value }))}
                onInput={(e) => autoResizeTextarea(e.currentTarget, 72)}
              />
            </label>
            <label className="block space-y-0.5">
              <span className="text-xs">项目目标</span>
              <textarea
                ref={projectGoalsRef}
                className="w-full resize-none overflow-hidden rounded-md border border-input bg-background px-2 py-1.5 text-sm"
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
        open={kimiAssessProgressOpen}
        onOpenChange={(open) => {
          if (kimiAssessing) return
          setKimiAssessProgressOpen(open)
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Kimi 评估进行中</DialogTitle>
            <DialogDescription>系统正在生成实施评估草稿，进度会实时更新。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-border/60 bg-secondary/10 px-3 py-2 text-sm text-muted-foreground">
              当前进度：{kimiAssessProgressCurrentText}
            </div>
            <Progress value={kimiAssessProgressValue} />
            <div
              ref={kimiAssessProgressLogRef}
              className="h-52 shrink-0 space-y-1 overflow-y-auto overflow-x-hidden rounded-lg border border-border/60 bg-background/80 p-3 text-xs text-muted-foreground"
            >
              {kimiAssessProgressLogs.length ? (
                kimiAssessProgressLogs.map((line, idx) => <p key={`${line}-${idx}`}>{line}</p>)
              ) : (
                <p>等待任务启动...</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setKimiAssessProgressOpen(false)}
              disabled={kimiAssessing}
            >
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={basicInfoImportVisible}
        onOpenChange={(open) => {
          if (!open) {
            closeBasicInfoImportDialog()
            return
          }
          setBasicInfoImportVisible(true)
          setBasicInfoImportProgressStatus("")
          setBasicInfoImportProgressValue(0)
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>智能解析回填</DialogTitle>
            <DialogDescription>优先使用 KIMI {normalizeKimiModelName(basicInfoModelName)} 模型，失败时自动规则回填。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="file"
              accept=".xlsx,.xls"
              disabled={basicInfoImporting}
              className="cursor-pointer transition-colors hover:bg-amber-50/70 dark:hover:bg-amber-900/20"
              onChange={(e) => setBasicInfoImportFile(e.target.files?.[0] || null)}
            />
            <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
              <Checkbox
                id="basic-info-import-overwrite"
                checked={basicInfoImportOverwriteNonEmpty}
                disabled={basicInfoImporting}
                onCheckedChange={(v) => setBasicInfoImportOverwriteNonEmpty(v === true)}
              />
              <Label htmlFor="basic-info-import-overwrite" className="cursor-pointer text-sm font-medium leading-snug">
                是否覆盖非空字段
              </Label>
            </div>
            {basicInfoImportError ? <p className="text-xs text-destructive">{basicInfoImportError}</p> : null}
            {basicInfoImporting || basicInfoImportProgressStatus ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-border/60 bg-secondary/10 px-3 py-2 text-sm text-muted-foreground">
                  {basicInfoImporting ? "当前进度" : "处理记录"}：
                  {basicInfoImportProgressStatus || "准备中..."}
                </div>
                <Progress value={basicInfoImportProgressValue} />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => closeBasicInfoImportDialog()}>
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
      <AlertDialog open={saveWithoutGlobalConfirmOpen} onOpenChange={setSaveWithoutGlobalConfirmOpen}>
        <AlertDialogContent className="sm:max-w-lg rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>未关联总方案版本号</AlertDialogTitle>
            <AlertDialogDescription>
              当前【需求】未关联总方案版本号，本次将独立保存为一个需求版本，确定继续吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(event) => {
                event.preventDefault()
                void onConfirmSaveWithoutGlobal()
              }}
            >
              {saving ? "保存中..." : "确定继续"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={enterpriseProfileDisambiguationOpen}
        onOpenChange={(open) => {
          if (!open) {
            setEnterpriseProfileDisambiguationOpen(false)
            setEnterpriseProfileDisambiguationList([])
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>请选择企业主体</DialogTitle>
            <DialogDescription>
              根据客户名称匹配到多个可能主体，请任选最符合的一项；系统将据此再次调用 Kimi 生成结构化企业简介与关联字段（最多展示 3 项）。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[min(420px,55vh)] space-y-2 overflow-y-auto pr-1">
            {enterpriseProfileDisambiguationList.map((c) => (
              <button
                key={`${c.id}-${c.displayName}`}
                type="button"
                disabled={enterpriseProfileGenerating}
                className={cn(
                  "w-full rounded-xl border border-border/70 bg-card px-4 py-3 text-left text-sm transition-colors",
                  "hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  enterpriseProfileGenerating && "pointer-events-none opacity-60",
                )}
                onClick={() => void onContinueEnterpriseProfileAfterDisambiguation(c)}
              >
                <p className="font-medium text-foreground">{c.displayName}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.summary}</p>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              disabled={enterpriseProfileGenerating}
              onClick={() => {
                setEnterpriseProfileDisambiguationOpen(false)
                setEnterpriseProfileDisambiguationList([])
              }}
            >
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <div className="grid gap-3 md:grid-cols-4">
              <Input value={enterpriseProfileGeneratedFields.location} readOnly />
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
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
          <div
            ref={kimiAssessmentPrintRef}
            className="kimi-assessment-print-root flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground print:h-auto print:max-h-none print:overflow-visible"
          >
          <div className="shrink-0 px-6 pt-6 pr-14 pb-0">
            <DialogHeader>
              <DialogTitle>Kimi 评估预览</DialogTitle>
            </DialogHeader>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pt-4 print:max-h-none print:overflow-visible">
          {kimiAssessmentPreview ? (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-4">
                <div className="flex min-h-0 items-center justify-between gap-2 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
                  <span className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
                    <Brain className="size-3.5" /> 模型
                  </span>
                  <span className="truncate text-right text-sm font-medium text-foreground">
                    {normalizeKimiModelName(kimiAssessmentPreview.meta.model)}
                  </span>
                </div>
                <div className="flex min-h-0 items-center justify-between gap-2 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
                  <span className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
                    <Activity className="size-3.5" /> 评估模式
                  </span>
                  <span className="truncate text-right text-sm font-medium text-foreground">
                    {kimiAssessmentPreview.meta.mode === "model" ? "模型生成" : "规则兜底"}
                  </span>
                </div>
                <div className="flex min-h-0 items-center justify-between gap-2 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
                  <span className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
                    <Gauge className="size-3.5" /> 置信度
                  </span>
                  <span className="tabular-nums text-sm font-semibold text-primary">
                    {kimiPreviewMetrics.confidencePct}%
                  </span>
                </div>
                <div className="flex min-h-0 items-center justify-between gap-2 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
                  <span className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
                    <ClipboardList className="size-3.5" /> 规则集
                  </span>
                  <span className="truncate text-right text-sm font-medium text-foreground">
                    {kimiAssessmentPreview.meta.ruleSetId}
                  </span>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-4">
                <div className="rounded-lg border border-border/60 bg-background/70 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                      <BarChart3 className="size-3.5" /> 总建议人天
                    </span>
                    <span className="tabular-nums text-xl font-semibold text-primary">
                      {kimiPreviewMetrics.totalSuggestedDays}
                    </span>
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-background/70 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                      <BarChart3 className="size-3.5" /> 总标准人天
                    </span>
                    <span className="tabular-nums text-xl font-semibold text-primary">
                      {kimiPreviewMetrics.totalStandardDays}
                    </span>
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-background/70 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                      <Lightbulb className="size-3.5" /> 平均偏差
                    </span>
                    <span className="tabular-nums text-xl font-semibold text-primary">
                      {kimiPreviewMetrics.avgDeltaPct > 0 ? "+" : ""}
                      {kimiPreviewMetrics.avgDeltaPct}%
                    </span>
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-background/70 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                      <ShieldAlert className="size-3.5" /> 风险等级
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-muted-foreground/50 text-[10px] leading-none text-muted-foreground print:hidden">
                            ?
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={6} className="max-w-72 text-xs leading-5">
                          {kimiRiskRationale.map((line, idx) => (
                            <p key={`${line}-${idx}`}>- {line}</p>
                          ))}
                        </TooltipContent>
                      </Tooltip>
                    </span>
                    <span className="text-xl font-semibold text-primary">{kimiRiskLevel.label}</span>
                  </div>
                  <ul className="mt-1 hidden list-none space-y-0.5 text-[10px] leading-snug text-muted-foreground print:block">
                    {kimiRiskRationale.map((line, idx) => (
                      <li key={`print-risk-${line}-${idx}`}>- {line}</li>
                    ))}
                  </ul>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-secondary">
                    <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${kimiRiskLevel.score}%` }} />
                  </div>
                </div>
              </div>

              <div className="grid gap-x-4 gap-y-2 rounded-lg border border-border/60 bg-secondary/10 p-3 text-sm sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
                <div className="flex min-w-0 items-baseline gap-1.5">
                  <span className="wes-req-field-caption shrink-0">报价模式</span>
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {kimiAssessmentPreview.assessmentDraft.quoteMode || "—"}
                  </span>
                </div>
                <div className="flex min-w-0 items-baseline gap-1.5">
                  <span className="wes-req-field-caption shrink-0">用户数</span>
                  <span className="font-medium tabular-nums text-primary">{kimiAssessmentPreview.assessmentDraft.userCount}</span>
                </div>
                <div className="flex min-w-0 items-baseline gap-1.5">
                  <span className="wes-req-field-caption shrink-0">组织数</span>
                  <span className="font-medium tabular-nums text-primary">{kimiAssessmentPreview.assessmentDraft.orgCount}</span>
                </div>
                <div className="flex min-w-0 items-baseline gap-1.5">
                  <span className="wes-req-field-caption shrink-0">组织相似度</span>
                  <span className="font-medium tabular-nums text-primary">{kimiAssessmentPreview.assessmentDraft.orgSimilarity}</span>
                </div>
                <div className="flex min-w-0 items-baseline gap-1.5">
                  <span className="wes-req-field-caption shrink-0">难度系数</span>
                  <span className="font-medium tabular-nums text-primary">{kimiAssessmentPreview.assessmentDraft.difficultyFactor}</span>
                </div>
                <div className="flex min-w-0 items-baseline gap-1.5">
                  <span className="wes-req-field-caption shrink-0">总人天</span>
                  <span className="font-medium tabular-nums text-primary">
                    {kimiAssessmentPreview.assessmentDraft.moduleItems.reduce(
                      (sum, item) => sum + Number(item.suggestedDays || 0),
                      0,
                    )}
                  </span>
                </div>
                <div className="flex min-w-0 items-baseline gap-1.5">
                  <span className="wes-req-field-caption shrink-0">开发总人天</span>
                  <span className="font-medium tabular-nums text-primary">{kimiDevTotalDays > 0 ? kimiDevTotalDays : "未识别"}</span>
                </div>
                <div className="flex min-w-0 items-baseline gap-1.5 sm:col-span-2 md:col-span-4 xl:col-span-7">
                  <span className="wes-req-field-caption shrink-0">产品线</span>
                  <span className="min-w-0 break-words font-medium text-foreground">
                    {kimiAssessmentPreview.assessmentDraft.productLines.length
                      ? kimiAssessmentPreview.assessmentDraft.productLines.join(" / ")
                      : "—"}
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                <p className="mb-2 inline-flex items-center gap-1 text-sm font-medium">
                  <CheckCircle2 className="size-4 text-emerald-600" />
                  关键论证证据（偏差最大的模块）
                </p>
                <div className="space-y-2">
                  {kimiTopEvidence.length ? (
                    kimiTopEvidence.map((item, idx) => (
                      <div key={`${item.moduleName}-${idx}`} className="rounded-md border border-border/50 bg-background/80 p-2">
                        <p className="text-sm font-medium">{item.moduleName}（偏差 {item.deltaPct > 0 ? "+" : ""}{item.deltaPct}%）</p>
                        <p className="mt-1 text-xs text-muted-foreground">{item.reason}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground">暂无可展示的证据项</p>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                <p className="mb-2 inline-flex items-center gap-1 text-sm font-medium">
                  <TrendingUp className="size-4 text-indigo-600" />
                  人天构成瀑布图（标准 -&gt; 调整 -&gt; 建议）
                </p>
                <div className="space-y-2">
                  {kimiWaterfall.rows.map((row) => {
                    const widthPct = Math.max(3, Math.round((Math.abs(row.value) / kimiWaterfall.maxAbs) * 100))
                    const barClass =
                      row.tone === "base"
                        ? "bg-slate-500"
                        : row.tone === "final"
                          ? "bg-indigo-600"
                          : row.tone === "up"
                            ? "bg-amber-500"
                            : "bg-emerald-600"
                    return (
                      <div key={row.key} className="grid grid-cols-[140px_1fr_92px] items-center gap-2">
                        <p className="text-xs text-muted-foreground">{row.label}</p>
                        <div className="h-6 rounded-md bg-secondary/50 px-1">
                          <div
                            className={cn("mt-[3px] h-4 rounded-sm transition-all", barClass)}
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                        <p className="text-right text-xs font-medium">
                          {row.value > 0 && row.tone !== "base" && row.tone !== "final" ? "+" : ""}
                          {row.value}
                        </p>
                      </div>
                    )
                  })}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  说明：复杂度/组织/风险调整基于本次评估关键参数计算，模型校准调整用于对齐最终建议人天。
                </p>
                <details className="mt-2 rounded-md border border-border/50 bg-background/70 p-2 text-xs">
                  <summary className="cursor-pointer font-medium text-foreground">查看计算公式与输入来源</summary>
                  <div className="mt-2 space-y-2">
                    {kimiWaterfall.breakdowns.map((item) => (
                      <div key={item.key} className="rounded-md border border-border/40 bg-background p-2">
                        <p className="font-medium">{item.label}</p>
                        <p className="mt-1 text-muted-foreground">{item.formula}</p>
                        <p className="mt-1 text-muted-foreground">计算过程：{item.computed}</p>
                        <p className="mt-1 text-muted-foreground">
                          输入：
                          {item.inputs.map((input) => `${input.name}=${input.value}`).join("，")}
                        </p>
                        <p className="mt-1 text-muted-foreground">来源说明：{item.note}</p>
                      </div>
                    ))}
                  </div>
                </details>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">模块估算建议</p>
                <div className="min-w-0 max-w-full overflow-x-auto rounded-lg border border-border/60">
                  {kimiAssessmentPreview.assessmentDraft.moduleItems.length ? (
                    <Table
                      containerClassName="max-h-64 min-w-0 overflow-x-auto overflow-y-auto print:max-h-none print:h-auto print:overflow-visible"
                      className="min-w-[520px] table-fixed"
                    >
                      <TableHeader className={wesTableHeaderStickyClassName}>
                        <TableRow className={wesTableToolbarHeaderRowClassName}>
                          <TableHead className="w-[92px] max-w-[92px] whitespace-nowrap px-2" data-manual-width="1">
                            云产品
                          </TableHead>
                          <TableHead className="w-[108px] max-w-[108px] whitespace-nowrap px-2" data-manual-width="1">
                            SKU
                          </TableHead>
                          <TableHead className="w-14 whitespace-nowrap px-1 text-center" data-manual-width="1">
                            标准人天
                          </TableHead>
                          <TableHead className="w-14 whitespace-nowrap px-1 text-center" data-manual-width="1">
                            建议人天
                          </TableHead>
                          <TableHead className="min-w-0 whitespace-nowrap px-2" data-manual-width="1">
                            原因
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {kimiAssessmentPreview.assessmentDraft.moduleItems.map((item, index) => (
                          <TableRow key={`${item.cloudProduct || "cloud"}-${item.skuName || item.moduleName}-${index}`}>
                            <TableCell
                              className="max-w-[92px] truncate font-medium px-2"
                              data-manual-width="1"
                              title={item.cloudProduct || "未分类云产品"}
                            >
                              {item.cloudProduct || "未分类云产品"}
                            </TableCell>
                            <TableCell
                              className="max-w-[108px] truncate font-medium px-2"
                              data-manual-width="1"
                              title={
                                String(item.skuName ?? "").trim()
                                  ? String(item.skuName)
                                  : "—（云级或非 SKU 明细）"
                              }
                            >
                              {String(item.skuName ?? "").trim() ? item.skuName : "—"}
                            </TableCell>
                            <TableCell className="w-14 px-1 text-center tabular-nums" data-manual-width="1">
                              {item.standardDays}
                            </TableCell>
                            <TableCell className="w-14 px-1 text-center tabular-nums" data-manual-width="1">
                              {item.suggestedDays}
                            </TableCell>
                            <TableCell
                              className="min-w-0 p-2 align-middle text-muted-foreground"
                              data-manual-width="1"
                              data-skip-table-preview=""
                            >
                              {String(item.reason || "").length > 16 ? (
                                <>
                                  <Tooltip delayDuration={200}>
                                    <TooltipTrigger asChild>
                                      <span className="block w-full max-w-full cursor-default truncate text-left print:hidden">
                                        {item.reason}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent
                                      side="top"
                                      align="start"
                                      sideOffset={8}
                                      className="z-[100] max-w-md border border-border bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-lg break-words whitespace-pre-wrap"
                                    >
                                      {item.reason}
                                    </TooltipContent>
                                  </Tooltip>
                                  <span className="hidden text-left text-xs leading-relaxed whitespace-pre-wrap break-words print:block">
                                    {item.reason}
                                  </span>
                                </>
                              ) : (
                                <span className="block truncate print:whitespace-normal print:break-words">
                                  {item.reason}
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="px-3 py-5 text-sm text-muted-foreground">暂无模块估算建议</div>
                  )}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/60 p-3">
                  <p className="mb-2 inline-flex items-center gap-1 text-sm font-medium">
                    <AlertTriangle className="size-4 text-amber-600" />
                    风险提示（{kimiPreviewMetrics.riskCount}）
                  </p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {kimiAssessmentPreview.assessmentDraft.risks.map((risk, idx) => (
                      <li key={`risk-${idx}`}>- {risk}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg border border-border/60 p-3">
                  <p className="mb-2 inline-flex items-center gap-1 text-sm font-medium">
                    <Lightbulb className="size-4 text-blue-600" />
                    前提假设（{kimiPreviewMetrics.assumptionCount}）
                  </p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {kimiAssessmentPreview.assessmentDraft.assumptions.map((assumption, idx) => (
                      <li key={`assumption-${idx}`}>- {assumption}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : null}
          </div>
          </div>
          <div className="shrink-0 border-t border-border/50 px-6 py-4">
            <DialogFooter className="gap-2 p-0 sm:justify-end">
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => setKimiAssessmentPreviewOpen(false)}>
                关闭
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                disabled={!kimiAssessmentPreview}
                onClick={() => {
                  if (!kimiAssessmentPrintRef.current || !kimiAssessmentPreview) {
                    toast.error("暂无可导出的预览内容")
                    return
                  }
                  void printKimiAssessmentPreview()
                  toast.message("请在打印对话框中选择「存储为 PDF」或「另存为 PDF」")
                }}
              >
                <FileDown className="size-4" />
                导出 PDF
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
          </div>
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
              rows={devOverviewDisplayRows}
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
                if (row.id === DEV_OVERVIEW_TOTAL_ROW_ID) {
                  return (
                    <TableRow key={row.id} className="bg-secondary/25 font-medium hover:bg-secondary/35">
                      <TableCell colSpan={3} className="h-11 align-middle">
                        合计
                      </TableCell>
                      <TableCell className="h-11 align-middle">{devSummary.coding.toFixed(1)}</TableCell>
                      <TableCell className="h-11 align-middle">{devSummary.analysis.toFixed(1)}</TableCell>
                      <TableCell className="h-11 align-middle">{devSummary.testing.toFixed(1)}</TableCell>
                      <TableCell className="h-11 align-middle">{devSummary.total.toFixed(1)}</TableCell>
                    </TableRow>
                  )
                }
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
        title="需求版本历史"
        description="仅展示与当前所选版本同一脉络（检入、升版）的记录；按更新时间由新到旧排列，含已归档版本。"
        rows={recordsToVersionHistoryRows(requirementVersionHistoryRecords)}
        highlightVersionCode={selectedVersionCode.trim() || undefined}
      />
    </ModuleShell>
  )
}
