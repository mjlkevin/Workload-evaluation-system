"use client"

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties } from "react"
import { shouldSuppressUnsavedPrompt, useSetUnsavedDirty } from "@/hooks/use-unsaved-changes"
import { ModuleShell } from "@/components/workload/module-shell"
import { VersionCheckoutStatusDisplay, VersionVcsToolbar } from "@/components/workload/version-vcs-toolbar"
import {
  recordsToVersionHistoryRows,
  VersionHistoryDialog,
  type VersionHistoryRow,
} from "@/components/workload/version-history-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
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
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAuth } from "@/hooks/use-auth"
import {
  checkinVersionById,
  checkoutVersionById,
  calculateAndExportEstimate,
  calculateEstimate,
  createModuleVersion,
  downloadOwnedExportFile,
  forceUnlockById,
  getActiveRuleSet,
  getDashboardPlans,
  getTemplateDetail,
  listGlobalVersions,
  listEstimateExportHistory,
  listModuleVersions,
  type ModuleVersionRecord,
  listTemplateSummaries,
  promoteVersionById,
  undoCheckoutById,
  type EstimateExportResult,
  type EstimateResult,
  type GlobalVersionRecord,
  type RuleSetMeta,
  type TemplateDetail,
  type TemplateItemOption,
  type TemplateSummary,
} from "@/lib/workload-service"
import type { PlanRow } from "@/lib/workload-types"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

type ItemSelectionState = {
  included: boolean
  customStandardDays?: number
  customAdjustReason?: string
  customAdjustReasonStatus?: "pending" | "saved"
}

type MultiOrgRow = {
  rowId: string
  orgName: string
  orgType: string
  location: string
  deliveryStrategy: string
  userCount: number
  scope: Record<string, boolean>
  otherBusinessDays: number
  difficultyFactor: number
}

type AssessmentForm = {
  templateId: string
  ruleSetId: string
  productLines: string[]
  userCount: number
  difficultyFactor: number
  orgCount: number
  orgSimilarityFactor: number
}

const PRODUCT_LINE_OPTIONS = ["金蝶AI星空", "金蝶AI星瀚", "云之家", "发票云"] as const
const PRODUCT_LINE_BADGE_STYLE_MAP: Record<string, string> = {
  金蝶AI星空: "border-sky-400 bg-sky-500 text-white dark:border-sky-500 dark:bg-sky-500 dark:text-white",
  云之家: "border-cyan-300 bg-cyan-400 text-white dark:border-cyan-400 dark:bg-cyan-400 dark:text-white",
  金蝶AI星瀚: "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-900/30 dark:text-violet-200",
  发票云: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200",
}

const multiOrgScopeDefs: Array<{ key: string; label: string; cloudName: string }> = [
  { key: "finance", label: "财务云", cloudName: "财务云" },
  { key: "scm", label: "供应链云", cloudName: "供应链云" },
  { key: "mfg", label: "制造云", cloudName: "制造云" },
  { key: "plm", label: "PLM云", cloudName: "PLM云" },
  { key: "mes", label: "MES云", cloudName: "MES云" },
  { key: "omni", label: "全渠道云", cloudName: "全渠道云" },
]

const orgTypeOptions = ["集团总部", "分子公司", "工厂", "事业部"]
const deliveryStrategyOptions = ["全新上线", "复制推广", "局部改造", "并行切换"]
const MULTI_ORG_DRAFT_KEY = "workload-assessment-multi-org-draft-v1"

/** 与模板工作表名一致；仅该表展示「预置评估模式」；自定义人天按云产品在条目表工具条开启 */
const SHEET_MODULE_QUOTE = "模块报价"
const ASSESSMENT_VERSION_LOAD_TOAST_ID = "assessment-version-loaded"

/** 模块评估云产品表：列与列之间竖线（与 SKU|实施要点 同色） */
const ASSESS_TABLE_COL_BORDER = "border-l border-border/40"
const COLLAPSED_KEY_TEXT_CLASS = "font-semibold text-emerald-700 dark:text-emerald-300"

function formatDays(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function toInteger(value: number): number {
  return Math.round(value)
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

/** 模板中小计/汇总行写入的 cloudProduct，不作为云产品切换标签展示 */
function isSelectableCloudProductLabel(name: string): boolean {
  const t = String(name || "").trim()
  if (!t) return false
  if (/产品实施工作量小计/i.test(t)) return false
  if (/工作量小计/i.test(t) && /人天/i.test(t)) return false
  return true
}

function cloudLabelFromItem(item: { cloudProduct?: string }) {
  return item.cloudProduct || "未分类云产品"
}

function cloudKeysOnSheet(items: TemplateItemOption[], sheet: string): Set<string> {
  const set = new Set<string>()
  for (const item of items) {
    if (sheet && sheet !== "全部工作表" && (item.sheetName || "全部工作表") !== sheet) continue
    const c = cloudLabelFromItem(item)
    if (!isSelectableCloudProductLabel(c)) continue
    set.add(c)
  }
  return set
}

function pieStyle(slices: Array<{ value: number; color: string }>) {
  const total = slices.reduce((sum, x) => sum + x.value, 0)
  if (total <= 0) return "conic-gradient(#e5e7eb 0 100%)"
  let start = 0
  const parts = slices.map((slice) => {
    const span = (slice.value / total) * 360
    const end = start + span
    const segment = `${slice.color} ${start}deg ${end}deg`
    start = end
    return segment
  })
  return `conic-gradient(${parts.join(", ")})`
}

function createEmptyMultiOrgRow(): MultiOrgRow {
  const scope: Record<string, boolean> = {}
  for (const def of multiOrgScopeDefs) scope[def.key] = false
  return {
    rowId: crypto.randomUUID(),
    orgName: "",
    orgType: orgTypeOptions[0],
    location: "",
    deliveryStrategy: deliveryStrategyOptions[0],
    userCount: 0,
    scope,
    otherBusinessDays: 0,
    difficultyFactor: 1,
  }
}

/** 按更新时间取当前生效（最新）实施评估版本，用于主界面下拉仅展示一条 */
function pickLatestAssessmentRecord(records: ModuleVersionRecord[]): ModuleVersionRecord | undefined {
  if (!records.length) return undefined
  return [...records].sort(
    (a, b) =>
      Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)) ||
      b.versionCode.localeCompare(a.versionCode),
  )[0]
}

function buildLatestAssessmentVersionOptions(records: ModuleVersionRecord[]) {
  const tip = pickLatestAssessmentRecord(records)
  return tip ? [{ value: tip.versionCode, label: `${tip.versionCode}（当前生效）` }] : []
}

export default function AssessmentPage() {
  const { isAdmin } = useAuth()
  const [form, setForm] = useState<AssessmentForm>({
    templateId: "",
    ruleSetId: "",
    productLines: [],
    userCount: 100,
    difficultyFactor: 0.2,
    orgCount: 1,
    orgSimilarityFactor: 0.8,
  })
  const [templateOptions, setTemplateOptions] = useState<TemplateSummary[]>([])
  const [templateDetail, setTemplateDetail] = useState<TemplateDetail | null>(null)
  const [ruleSet, setRuleSet] = useState<RuleSetMeta | null>(null)
  const [selectedSheet, setSelectedSheet] = useState("")
  const [selectedPresetMode, setSelectedPresetMode] = useState("")
  const [selectedCloudNames, setSelectedCloudNames] = useState<string[]>([])
  const [itemSelection, setItemSelection] = useState<Record<string, ItemSelectionState>>({})
  const [customAdjustReasonEditor, setCustomAdjustReasonEditor] = useState<{
    itemId: string
    draft: string
  } | null>(null)
  /** 按云产品开启「自定义人天」列与有效人天计算 */
  const [customModeByCloud, setCustomModeByCloud] = useState<Record<string, boolean>>({})
  const [multiOrgRows, setMultiOrgRows] = useState<MultiOrgRow[]>([createEmptyMultiOrgRow()])
  const [serverResult, setServerResult] = useState<EstimateResult | null>(null)
  const [exportInfo, setExportInfo] = useState<EstimateExportResult | null>(null)
  const [exportHistory, setExportHistory] = useState<Array<{ fileName: string; downloadUrl: string; modifiedAt: string }>>([])
  const [exportHistoryFilter, setExportHistoryFilter] = useState("")
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(1)
  const [globalVersionCode, setGlobalVersionCode] = useState("")
  /** 与仪表盘总方案列表一致，用于选择总方案时回填项目名称 */
  const [dashboardPlans, setDashboardPlans] = useState<PlanRow[]>([])
  /** 未选总方案时可手填；选择总方案时从方案携带，仍可再改 */
  const [projectName, setProjectName] = useState("")
  const [globalOptions, setGlobalOptions] = useState<Array<{ value: string; label: string }>>([])
  const [versionOptions, setVersionOptions] = useState<Array<{ value: string; label: string }>>([])
  const [versionRecords, setVersionRecords] = useState<ModuleVersionRecord[]>([])
  const [globalVersionRecords, setGlobalVersionRecords] = useState<GlobalVersionRecord[]>([])
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false)
  const [creatingFromHistory, setCreatingFromHistory] = useState(false)
  const [currentVersionCode, setCurrentVersionCode] = useState("")
  const [paramCardCollapsed, setParamCardCollapsed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savePhase, setSavePhase] = useState<"idle" | "validating" | "saving">("idle")
  const [hasLocalChanges, setHasLocalChanges] = useState(false)
  const [createNewConfirmOpen, setCreateNewConfirmOpen] = useState(false)
  const [createNewSubmitting, setCreateNewSubmitting] = useState(false)
  const [saveWithoutGlobalConfirmOpen, setSaveWithoutGlobalConfirmOpen] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [initLoading, setInitLoading] = useState(true)
  const [error, setError] = useState("")
  const latestAssessmentRecord = useMemo(
    () => pickLatestAssessmentRecord(versionRecords),
    [versionRecords],
  )
  const selectedVersionRecord = useMemo(
    () => versionRecords.find((x) => x.versionCode === currentVersionCode),
    [versionRecords, currentVersionCode],
  )
  const isReadonly = Boolean(
    selectedVersionRecord &&
      (selectedVersionRecord.checkoutStatus === "checked_in" || selectedVersionRecord.versionDocStatus === "reviewed"),
  )
  /** 已检入只读浏览：SKU 表仅展示已勾选行，检出后可编辑时再展示全部 */
  const showOnlySelectedSkuRows = Boolean(
    selectedVersionRecord && selectedVersionRecord.checkoutStatus === "checked_in",
  )
  const suppressUnsavedPrompt = shouldSuppressUnsavedPrompt(selectedVersionRecord)

  const setDirty = useSetUnsavedDirty()
  const dirtyEnabled = useRef(false)
  const initialEmbedQueryRef = useRef<{ globalVersion: string; version: string } | null>(null)
  const initialEmbedAppliedRef = useRef(false)

  function showGlobalNotice(text: string) {
    toast(text)
  }

  function showGlobalWarning(text: string) {
    toast.warning(text)
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    initialEmbedQueryRef.current = {
      globalVersion: params.get("globalVersion") || "",
      version: params.get("version") || "",
    }
  }, [])

  const allItems = useMemo(() => templateDetail?.items || [], [templateDetail])
  const sheets = useMemo(
    () => (templateDetail?.sheets?.length ? templateDetail.sheets.map((x) => x.sheetName) : ["全部工作表"]),
    [templateDetail],
  )

  const itemsInSheet = useMemo(() => {
    if (!allItems.length) return []
    if (!selectedSheet || selectedSheet === "全部工作表") return allItems
    return allItems.filter((item) => (item.sheetName || "全部工作表") === selectedSheet)
  }, [allItems, selectedSheet])

  const allCloudNames = useMemo(() => {
    const set = new Set<string>()
    for (const item of itemsInSheet) {
      const c = item.cloudProduct || "未分类云产品"
      if (!isSelectableCloudProductLabel(c)) continue
      set.add(c)
    }
    return Array.from(set)
  }, [itemsInSheet])

  const visibleCloudNames = useMemo(() => {
    if (!selectedCloudNames.length) return []
    const picked = new Set(selectedCloudNames)
    return allCloudNames.filter((x) => picked.has(x))
  }, [allCloudNames, selectedCloudNames])

  const scopeDefsVisible = useMemo(() => {
    const set = new Set(allCloudNames)
    return multiOrgScopeDefs.filter((x) => set.has(x.cloudName))
  }, [allCloudNames])

  const cloudTree = useMemo(() => {
    const visibleSet = new Set(visibleCloudNames)
    const map = new Map<string, Map<string, TemplateItemOption[]>>()
    for (const item of itemsInSheet) {
      const cloud = item.cloudProduct || "未分类云产品"
      if (!visibleSet.has(cloud)) continue
      const sku = item.skuName || "未分类SKU"
      if (!map.has(cloud)) map.set(cloud, new Map())
      const skuMap = map.get(cloud)!
      if (!skuMap.has(sku)) skuMap.set(sku, [])
      skuMap.get(sku)!.push(item)
    }
    return map
  }, [itemsInSheet, visibleCloudNames])

  const selectedCount = useMemo(() => {
    return itemsInSheet.filter((item) => itemSelection[item.templateItemId]?.included).length
  }, [itemsInSheet, itemSelection])

  const baseDays = useMemo(() => {
    return itemsInSheet.reduce((sum, item) => {
      const state = itemSelection[item.templateItemId]
      if (!state?.included) return sum
      const cloud = cloudLabelFromItem(item)
      const fallback = Number(item.standardDays || 0)
      const effective =
        customModeByCloud[cloud] && Number.isFinite(Number(state.customStandardDays))
          ? Number(state.customStandardDays || 0)
          : fallback
      return sum + Math.max(0, effective)
    }, 0)
  }, [customModeByCloud, itemSelection, itemsInSheet])

  const tierFactor = useMemo(() => {
    const tiers = ruleSet?.baseRule?.userCountTiers || []
    const hit = tiers.find((x) => form.userCount >= x.min && form.userCount <= x.max)
    return Number(hit?.factor || 0)
  }, [form.userCount, ruleSet])

  useEffect(() => {
    const allowed = new Set(allCloudNames)
    setSelectedCloudNames((prev) => {
      const next = prev.filter((x) => allowed.has(x))
      return next.length === prev.length ? prev : next
    })
  }, [allCloudNames])

  useEffect(() => {
    void (async () => {
      try {
        setInitLoading(true)
        const [plans, records, templates, activeRule, globals] = await Promise.all([
          getDashboardPlans(),
          listModuleVersions("assessment"),
          listTemplateSummaries(),
          getActiveRuleSet(),
          listGlobalVersions(),
        ])
        setGlobalVersionRecords(globals)
        setDashboardPlans(plans)
        setGlobalOptions(
          plans.map((x) => ({
            value: x.globalVersion,
            label: `${x.globalVersion}（${x.projectName}）`,
          })),
        )
        setVersionRecords(records)
        setVersionOptions(buildLatestAssessmentVersionOptions(records))
        setTemplateOptions(templates)
        setRuleSet(activeRule)
        setForm((prev) => ({ ...prev, ruleSetId: activeRule.ruleSetId }))

        const chosenTemplateId = templates[0]?.templateId || ""
        if (chosenTemplateId) {
          const detail = await getTemplateDetail(chosenTemplateId)
          setTemplateDetail(detail)
          const firstSheet = detail.sheets?.[0]?.sheetName || "全部工作表"
          setSelectedSheet(firstSheet)
          setSelectedCloudNames([])
          const initialSelection: Record<string, ItemSelectionState> = {}
          for (const item of detail.items) {
            initialSelection[item.templateItemId] = {
              included: false,
              customStandardDays: Number(item.standardDays || 0),
            }
          }
          setItemSelection(initialSelection)
          setForm((prev) => ({ ...prev, templateId: detail.templateId }))
        }
        const history = await listEstimateExportHistory(1, 8)
        setHistoryTotal(history.total)
        setHistoryPage(1)
        setExportHistory(history.items)
        const initialQuery = initialEmbedQueryRef.current
        if (!initialEmbedAppliedRef.current && initialQuery) {
          if (initialQuery.globalVersion) {
            setGlobalVersionCode(initialQuery.globalVersion)
            const plan = plans.find((p) => p.globalVersion === initialQuery.globalVersion)
            if (plan?.projectName) setProjectName(plan.projectName)
          }
          const tip = pickLatestAssessmentRecord(records)
          const qv = initialQuery.version?.trim() || ""
          if (qv) {
            const hit = records.find((r) => r.versionCode === qv)
            if (hit && tip && hit.versionCode !== tip.versionCode) {
              showGlobalNotice(
                "链接中的实施评估版本非当前生效版本，已加载当前生效版本。回退请打开「版本历史」，使用「按历史版本创建新版」。",
              )
            }
          }
          const loadCode = tip?.versionCode ?? ""
          if (loadCode) await onLoadVersion(loadCode, plans)
          initialEmbedAppliedRef.current = true
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "初始化失败"
        setError(msg)
        showGlobalWarning(msg)
      } finally {
        setInitLoading(false)
        dirtyEnabled.current = true
      }
    })()
  }, [])

  useEffect(() => {
    const list = ruleSet?.baseRule?.difficultyFactorList
    if (!list?.length) return
    setForm((s) => {
      if (list.includes(s.difficultyFactor)) return s
      const pick = list.includes(0.2) ? 0.2 : list[0]!
      return { ...s, difficultyFactor: pick }
    })
  }, [ruleSet, form.difficultyFactor])

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
  }, [
    form,
    globalVersionCode,
    projectName,
    selectedSheet,
    selectedPresetMode,
    selectedCloudNames,
    itemSelection,
    multiOrgRows,
    customModeByCloud,
    suppressUnsavedPrompt,
  ])

  // 滚动联动折叠/视差已暂时关闭；仍可通过卡片标题区手动折叠（paramCardCollapsed）。

  const scaleFactor = useMemo(() => {
    const userIncrement = (ruleSet?.baseRule?.userIncrementRounding === "ceil_int"
      ? Math.ceil(baseDays * tierFactor)
      : baseDays * tierFactor)
    const difficultyIncrement = baseDays * Math.max(0, Number(form.difficultyFactor || 0))
    const orgEnabled = ruleSet?.orgIncrementRule?.enabled !== false
    const orgFactor = Number(ruleSet?.orgIncrementRule?.factor ?? 0.1)
    const orgIncrement = orgEnabled
      ? baseDays * Math.max(0, form.orgCount - 1) * (1 - Math.min(1, Math.max(0, form.orgSimilarityFactor))) * orgFactor
      : 0
    return {
      userIncrement,
      difficultyIncrement,
      orgIncrement,
      total: baseDays + userIncrement + difficultyIncrement + orgIncrement,
    }
  }, [baseDays, form.difficultyFactor, form.orgCount, form.orgSimilarityFactor, ruleSet, tierFactor])

  const cloudWorkloadSlices = useMemo(() => {
    const sums = new Map<string, number>()
    for (const item of itemsInSheet) {
      const state = itemSelection[item.templateItemId]
      if (!state?.included) continue
      const cloud = cloudLabelFromItem(item)
      const effective =
        customModeByCloud[cloud] && Number.isFinite(Number(state.customStandardDays))
          ? Number(state.customStandardDays || 0)
          : Number(item.standardDays || 0)
      sums.set(cloud, Number(sums.get(cloud) || 0) + effective)
    }
    const rows = Array.from(sums.entries()).map(([label, value]) => ({ label, value }))
    const total = rows.reduce((sum, x) => sum + x.value, 0)
    return rows.map((row) => ({
      ...row,
      percent: total > 0 ? ((row.value / total) * 100).toFixed(1) : "0.0",
    }))
  }, [customModeByCloud, itemSelection, itemsInSheet])

  const breakdownSlices = useMemo(
    () => [
      { label: "基础人天", value: baseDays, color: "#7c3aed" },
      { label: "用户增量", value: scaleFactor.userIncrement, color: "#f59e0b" },
      { label: "难度增量", value: scaleFactor.difficultyIncrement, color: "#2563eb" },
      { label: "组织增量", value: scaleFactor.orgIncrement, color: "#10b981" },
    ],
    [baseDays, scaleFactor.difficultyIncrement, scaleFactor.orgIncrement, scaleFactor.userIncrement],
  )

  const cloudPieStyle = useMemo(
    () =>
      pieStyle(
        cloudWorkloadSlices.map((x, idx) => ({
          value: x.value,
          color: ["#7c3aed", "#2563eb", "#10b981", "#f59e0b", "#ef4444", "#14b8a6", "#8b5cf6"][idx % 7],
        })),
      ),
    [cloudWorkloadSlices],
  )
  const breakdownPieStyle = useMemo(() => pieStyle(breakdownSlices), [breakdownSlices])

  function calcMultiOrgStandardDays(row: MultiOrgRow) {
    const scopeCount = scopeDefsVisible.filter((x) => row.scope[x.key]).length
    const scopePart = scopeCount > 0 ? (baseDays / Math.max(1, scopeDefsVisible.length)) * scopeCount * 0.15 : 0
    const userPart = Number(row.userCount || 0) * 0.05
    return Math.max(0, scopePart + userPart + Number(row.otherBusinessDays || 0))
  }

  function calcMultiOrgEstimatedDays(row: MultiOrgRow) {
    const strategyFactor =
      row.deliveryStrategy === "全新上线" ? 1.2 : row.deliveryStrategy === "复制推广" ? 0.85 : row.deliveryStrategy === "并行切换" ? 1.1 : 1
    return calcMultiOrgStandardDays(row) * Math.max(0, Number(row.difficultyFactor || 1)) * strategyFactor
  }

  const multiOrgTotalDays = useMemo(() => multiOrgRows.reduce((sum, x) => sum + calcMultiOrgEstimatedDays(x), 0), [multiOrgRows, baseDays, scopeDefsVisible.length])

  const filteredExportHistory = useMemo(() => {
    const keyword = exportHistoryFilter.trim().toLowerCase()
    if (!keyword) return exportHistory
    return exportHistory.filter((item) => item.fileName.toLowerCase().includes(keyword))
  }, [exportHistory, exportHistoryFilter])

  useEffect(() => {
    if (typeof window === "undefined") return
    const templateId = form.templateId.trim()
    const sheet = selectedSheet.trim()
    if (!templateId || !sheet) return
    const draftMapRaw = window.localStorage.getItem(MULTI_ORG_DRAFT_KEY)
    let draftMap: Record<string, MultiOrgRow[]> = {}
    try {
      draftMap = draftMapRaw ? (JSON.parse(draftMapRaw) as Record<string, MultiOrgRow[]>) : {}
    } catch {
      draftMap = {}
    }
    const key = `${templateId}::${sheet}`
    const rows = draftMap[key]
    if (Array.isArray(rows) && rows.length) {
      setMultiOrgRows(rows)
    } else {
      setMultiOrgRows([createEmptyMultiOrgRow()])
    }
  }, [form.templateId, selectedSheet])

  useEffect(() => {
    if (typeof window === "undefined") return
    const templateId = form.templateId.trim()
    const sheet = selectedSheet.trim()
    if (!templateId || !sheet) return
    const key = `${templateId}::${sheet}`
    const draftMapRaw = window.localStorage.getItem(MULTI_ORG_DRAFT_KEY)
    let draftMap: Record<string, MultiOrgRow[]> = {}
    try {
      draftMap = draftMapRaw ? (JSON.parse(draftMapRaw) as Record<string, MultiOrgRow[]>) : {}
    } catch {
      draftMap = {}
    }
    draftMap[key] = multiOrgRows
    window.localStorage.setItem(MULTI_ORG_DRAFT_KEY, JSON.stringify(draftMap))
  }, [form.templateId, multiOrgRows, selectedSheet])

  async function reloadVersions(nextSelected?: string) {
    const records = await listModuleVersions("assessment")
    setVersionRecords(records)
    setVersionOptions(buildLatestAssessmentVersionOptions(records))
    const tip = pickLatestAssessmentRecord(records)
    if (nextSelected) {
      setCurrentVersionCode(nextSelected)
    } else if (tip) {
      setCurrentVersionCode(tip.versionCode)
    } else {
      setCurrentVersionCode("")
    }
  }

  async function onCheckout() {
    if (!selectedVersionRecord) return
    if (selectedVersionRecord.versionDocStatus === "reviewed") {
      showGlobalWarning("已审核版本不可检出，请先升版")
      return
    }
    try {
      const updated = await checkoutVersionById(selectedVersionRecord.id)
      await reloadVersions(selectedVersionRecord.versionCode)
      // 列表接口若未及时带上 checkoutStatus，会回落为 checked_in 导致整表只读；以检出接口返回为准写回
      setVersionRecords((prev) =>
        prev.map((r) =>
          r.id !== updated.id
            ? r
            : {
                ...r,
                checkoutStatus: updated.checkoutStatus ?? "checked_out",
                versionDocStatus: updated.versionDocStatus ?? r.versionDocStatus,
                checkedOutByUserId: updated.checkedOutByUserId,
                checkedOutByUsername: updated.checkedOutByUsername,
                checkoutAt: updated.checkoutAt,
                updatedAt: updated.updatedAt,
              },
        ),
      )
      showGlobalNotice("检出成功")
    } catch (err) {
      showGlobalWarning(err instanceof Error ? err.message : "检出失败")
    }
  }

  async function onCheckin(checkinNote: string) {
    if (!selectedVersionRecord) return
    try {
      const data = await checkinVersionById(selectedVersionRecord.id, {
        globalVersionCode,
        projectName: projectName.trim(),
        form,
        selectedSheet,
        selectedPresetMode,
        selectedCloudNames,
        customModeByCloud,
        customModeEnabled: Object.values(customModeByCloud).some(Boolean),
        itemSelection: currentItemsPayload(),
        multiOrgRows,
        checkinNote,
      })
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

  async function loadHistory(reset = false) {
    const nextPage = reset ? 1 : historyPage + 1
    const data = await listEstimateExportHistory(nextPage, 8)
    setHistoryTotal(data.total)
    if (reset) {
      setHistoryPage(1)
      setExportHistory(data.items)
    } else {
      setHistoryPage(nextPage)
      setExportHistory((prev) => [...prev, ...data.items])
    }
  }

  function currentItemsPayload() {
    return allItems.map((item) => {
      const state = itemSelection[item.templateItemId] || { included: false }
      return {
        templateItemId: item.templateItemId,
        included: Boolean(state.included),
        customStandardDays: customModeByCloud[cloudLabelFromItem(item)]
          ? Number(state.customStandardDays || item.standardDays || 0)
          : undefined,
        customAdjustReason: customModeByCloud[cloudLabelFromItem(item)]
          ? String(state.customAdjustReason || "").trim() || undefined
          : undefined,
        customAdjustReasonStatus: customModeByCloud[cloudLabelFromItem(item)]
          ? state.customAdjustReasonStatus
          : undefined,
      }
    })
  }

  function buildEstimatePayload() {
    return {
      ...form,
      selectedSheet,
      items: currentItemsPayload(),
    }
  }

  async function onCalculate() {
    if (!form.templateId || !form.ruleSetId) {
      showGlobalWarning("模板或规则集未就绪")
      return
    }
    setCalculating(true)
    setError("")
    try {
      const result = await calculateEstimate(buildEstimatePayload())
      setServerResult(result)
      showGlobalNotice("已完成后端规则校验")
    } catch (err) {
      const msg = err instanceof Error ? err.message : "计算失败"
      setError(msg)
      showGlobalWarning(msg)
    } finally {
      setCalculating(false)
    }
  }

  async function onSave(options?: { allowWithoutGlobal?: boolean }): Promise<boolean> {
    if (savePhase !== "idle") return false
    if (!globalVersionCode.trim() && !options?.allowWithoutGlobal) {
      setSaveWithoutGlobalConfirmOpen(true)
      return false
    }
    setSaving(true)
    setSavePhase("validating")
    setError("")
    try {
      const validatedResult = await calculateEstimate(buildEstimatePayload())
      setServerResult(validatedResult)
      setSavePhase("saving")
      const created = await createModuleVersion(
        "assessment",
        {
          globalVersionCode,
          projectName: projectName.trim(),
          form,
          selectedSheet,
          selectedPresetMode,
          selectedCloudNames,
          customModeByCloud,
          customModeEnabled: Object.values(customModeByCloud).some(Boolean),
          itemSelection: currentItemsPayload(),
          multiOrgRows,
          localSummary: {
            selectedCount,
            baseDays,
            totalDays: scaleFactor.total,
            userIncrementDays: scaleFactor.userIncrement,
            difficultyIncrementDays: scaleFactor.difficultyIncrement,
            orgIncrementDays: scaleFactor.orgIncrement,
            multiOrgTotalDays,
          },
          serverResult: validatedResult,
        },
        "AS",
      )
      await reloadVersions(created.versionCode)
      showGlobalNotice(`已保存实施评估版本：${created.versionCode}`)
      setDirty(false)
      setHasLocalChanges(false)
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : "保存失败"
      setError(msg)
      showGlobalWarning(msg)
      return false
    } finally {
      setSaving(false)
      setSavePhase("idle")
    }
  }

  async function onConfirmSaveWithoutGlobal() {
    const saved = await onSave({ allowWithoutGlobal: true })
    if (saved) setSaveWithoutGlobalConfirmOpen(false)
  }

  function resetToNewAssessmentDraft() {
    setGlobalVersionCode("")
    setCurrentVersionCode("")
    setVersionOptions([])
    setProjectName("")
    setSelectedPresetMode("")
    setSelectedCloudNames([])
    setCustomModeByCloud({})
    setForm((prev) => ({
      ...prev,
      productLines: [],
      userCount: 0,
      difficultyFactor: 0,
      orgCount: 1,
      orgSimilarityFactor: 0,
    }))
    if (templateDetail?.items?.length) {
      const nextSelection: Record<string, ItemSelectionState> = {}
      for (const item of templateDetail.items) {
        nextSelection[item.templateItemId] = {
          included: false,
          customStandardDays: toInteger(Number(item.standardDays || 0)),
        }
      }
      setItemSelection(nextSelection)
    } else {
      setItemSelection({})
    }
    setMultiOrgRows([createEmptyMultiOrgRow()])
    setServerResult(null)
    setError("")
    setDirty(false)
    setHasLocalChanges(false)
    dirtyEnabled.current = true
  }

  function onCreateNewAssessment() {
    if (savePhase !== "idle") return
    const isCheckedOut = selectedVersionRecord?.checkoutStatus === "checked_out"
    if (isCheckedOut && hasLocalChanges) {
      setCreateNewConfirmOpen(true)
      return
    }
    resetToNewAssessmentDraft()
    showGlobalNotice("已进入新建实施评估")
  }

  async function onSaveAndCreateNew() {
    if (createNewSubmitting) return
    setCreateNewSubmitting(true)
    try {
      const saved = await onSave({ allowWithoutGlobal: true })
      if (!saved) return
      setCreateNewConfirmOpen(false)
      resetToNewAssessmentDraft()
      showGlobalNotice("已保存并新建实施评估")
    } finally {
      setCreateNewSubmitting(false)
    }
  }

  function applyGlobalVersionSelection(code: string) {
    setGlobalVersionCode(code)
    if (!code.trim()) return
    const plan = dashboardPlans.find((p) => p.globalVersion === code)
    if (plan?.projectName) setProjectName(plan.projectName)
  }

  async function onLoadVersion(code: string, plansOverride?: PlanRow[]) {
    setCurrentVersionCode(code)
    if (!code) return
    setError("")
    try {
      const records = await listModuleVersions("assessment")
      const target = records.find((x) => x.versionCode === code)
      if (!target) return
      const payload = target.payload || {}
      const plansLookup = plansOverride ?? dashboardPlans
      const payloadForm = (payload.form || {}) as Partial<AssessmentForm>
      const nextTemplateId = String(payloadForm.templateId || form.templateId)
      const loadedDetailForVersion = nextTemplateId ? await getTemplateDetail(nextTemplateId) : null
      if (loadedDetailForVersion && nextTemplateId !== form.templateId) {
        setTemplateDetail(loadedDetailForVersion)
      }
      dirtyEnabled.current = false
      const gv = String((payload.globalVersionCode as string) || "")
      setGlobalVersionCode(gv)
      const savedPn = String((payload as { projectName?: string }).projectName || "").trim()
      if (savedPn) {
        setProjectName(savedPn)
      } else if (gv) {
        const plan = plansLookup.find((p) => p.globalVersion === gv)
        setProjectName(plan?.projectName || "")
      } else {
        setProjectName("")
      }
      const productLinesFromForm = normalizeProductLines(payloadForm.productLines)
      const productLinesFromPayload = normalizeProductLines((payload as { productLines?: unknown }).productLines)
      setForm((prev) => ({
        templateId: nextTemplateId || prev.templateId,
        ruleSetId: String(payloadForm.ruleSetId || prev.ruleSetId),
        productLines: productLinesFromForm.length ? productLinesFromForm : productLinesFromPayload,
        userCount: Number(payloadForm.userCount || prev.userCount),
        difficultyFactor: Number(payloadForm.difficultyFactor || prev.difficultyFactor),
        orgCount: Number(payloadForm.orgCount || prev.orgCount),
        orgSimilarityFactor: Number(payloadForm.orgSimilarityFactor || prev.orgSimilarityFactor),
      }))
      const nextSheet = String(payload.selectedSheet || selectedSheet || "全部工作表")
      setSelectedSheet(nextSheet)
      setSelectedCloudNames(Array.isArray(payload.selectedCloudNames) ? (payload.selectedCloudNames as string[]) : [])
      if (nextSheet === SHEET_MODULE_QUOTE) {
        setSelectedPresetMode(
          payload.selectedPresetMode !== undefined && payload.selectedPresetMode !== null
            ? String(payload.selectedPresetMode)
            : "",
        )
        const rawByCloud = payload.customModeByCloud as Record<string, boolean> | undefined
        if (rawByCloud && typeof rawByCloud === "object" && !Array.isArray(rawByCloud)) {
          setCustomModeByCloud({ ...rawByCloud })
        } else if (Boolean(payload.customModeEnabled) && loadedDetailForVersion?.items?.length) {
          const next: Record<string, boolean> = {}
          for (const c of cloudKeysOnSheet(loadedDetailForVersion.items, nextSheet)) {
            next[c] = true
          }
          setCustomModeByCloud(next)
        } else {
          setCustomModeByCloud({})
        }
      } else {
        setSelectedPresetMode("")
        setCustomModeByCloud({})
      }
      const selectionPayload = Array.isArray(payload.itemSelection)
        ? (payload.itemSelection as Array<{
            templateItemId: string
            included: boolean
            customStandardDays?: number
            customAdjustReason?: string
            customAdjustReasonStatus?: "pending" | "saved"
          }>)
        : []
      const nextSelection: Record<string, ItemSelectionState> = {}
      for (const row of selectionPayload) {
        nextSelection[row.templateItemId] = {
          included: Boolean(row.included),
          customStandardDays: Number(row.customStandardDays || 0),
          customAdjustReason: String(row.customAdjustReason || "").trim() || undefined,
          customAdjustReasonStatus:
            row.customAdjustReasonStatus === "pending" || row.customAdjustReasonStatus === "saved"
              ? row.customAdjustReasonStatus
              : row.customAdjustReason
                ? "saved"
                : undefined,
        }
      }
      if (Object.keys(nextSelection).length) setItemSelection(nextSelection)
      const nextMultiOrg = Array.isArray(payload.multiOrgRows) ? (payload.multiOrgRows as MultiOrgRow[]) : []
      setMultiOrgRows(nextMultiOrg.length ? nextMultiOrg : [createEmptyMultiOrgRow()])
      setServerResult((payload.serverResult as EstimateResult) || null)
      toast(`已回读版本：${code}`, { id: ASSESSMENT_VERSION_LOAD_TOAST_ID })
      setDirty(false)
      setHasLocalChanges(false)
      setTimeout(() => { dirtyEnabled.current = true }, 0)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "回读失败"
      setError(msg)
      showGlobalWarning(msg)
    }
  }

  async function onCreateAssessmentVersionFromHistory(row: VersionHistoryRow) {
    const source = versionRecords.find((r) => r.id === row.id)
    if (!source) {
      showGlobalWarning("找不到所选版本记录")
      return
    }
    setCreatingFromHistory(true)
    setError("")
    try {
      const payload = JSON.parse(JSON.stringify(source.payload || {})) as Record<string, unknown>
      const created = await createModuleVersion("assessment", payload, "AS")
      await reloadVersions(created.versionCode)
      await onLoadVersion(created.versionCode, dashboardPlans)
      setVersionHistoryOpen(false)
      showGlobalNotice(`已按历史快照创建新版：${created.versionCode}（来源：${source.versionCode}）`)
      setDirty(false)
      setHasLocalChanges(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "创建失败"
      setError(msg)
      showGlobalWarning(msg)
    } finally {
      setCreatingFromHistory(false)
    }
  }

  function applyPreset(mode: string) {
    setSelectedPresetMode(mode)
    if (mode === "全量云产品") {
      setSelectedCloudNames(allCloudNames)
      return
    }
    const matchers: Record<string, string[]> = {
      标准财务供应链制造: ["财务", "供应链", "制造"],
      标准财务供应链: ["财务", "供应链"],
    }
    const keywords = matchers[mode] || []
    if (!keywords.length) {
      setSelectedCloudNames([])
      return
    }
    setSelectedCloudNames(allCloudNames.filter((x) => keywords.some((k) => x.includes(k))))
  }

  function toggleCloud(name: string) {
    setSelectedCloudNames((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]))
  }

  function setCloudSelections(cloudName: string, included: boolean) {
    const relatedItems = itemsInSheet.filter((x) => (x.cloudProduct || "未分类云产品") === cloudName)
    setItemSelection((prev) => {
      const next = { ...prev }
      for (const item of relatedItems) {
        const old = next[item.templateItemId] || { included: false, customStandardDays: item.standardDays }
        next[item.templateItemId] = { ...old, included }
      }
      return next
    })
  }

  /** SKU 列与行点击分离：原 SKU 单元格 stopPropagation 导致点左侧无法勾选；此处整组切换该 SKU 下条目 */
  function toggleSkuGroupInclusion(groupItems: TemplateDetail["items"]) {
    if (isReadonly) return
    setItemSelection((prev) => {
      if (!groupItems.length) return prev
      const allIncluded = groupItems.every((it) => Boolean(prev[it.templateItemId]?.included))
      const nextIncluded = !allIncluded
      const next = { ...prev }
      for (const item of groupItems) {
        const old = next[item.templateItemId] || { included: false, customStandardDays: item.standardDays }
        next[item.templateItemId] = { ...old, included: nextIncluded }
      }
      return next
    })
  }

  async function onExport(type: "excel" | "pdf") {
    if (!form.templateId || !form.ruleSetId) {
      showGlobalWarning("模板或规则集未就绪")
      return
    }
    setExporting(true)
    setError("")
    try {
      const result = await calculateAndExportEstimate({
        ...buildEstimatePayload(),
        exportType: type,
        exportProjectName: projectName.trim() || "未命名项目",
        exportAssessmentVersionCode: currentVersionCode || "UNSAVED",
      })
      setExportInfo(result)
      if (result.downloadUrl) {
        const safeProjectName = (projectName.trim() || "未命名项目").replace(/[\/\\?%*:|"<>]/g, "-")
        const fallbackName = `assessment-${safeProjectName}-${currentVersionCode || Date.now()}.${
          type === "excel" ? "xlsx" : "pdf"
        }`
        await downloadOwnedExportFile(result.downloadUrl, fallbackName)
      }
      await loadHistory(true)
      showGlobalNotice(`已导出${type === "excel" ? "Excel" : "PDF"}：${formatDays(result.totalDays)} 人天`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "导出失败"
      setError(msg)
      showGlobalWarning(msg)
    } finally {
      setExporting(false)
    }
  }

  async function onCopyExportLink(downloadUrl: string) {
    const url = downloadUrl.startsWith("http")
      ? downloadUrl
      : `${window.location.origin}${downloadUrl.startsWith("/") ? "" : "/"}${downloadUrl}`
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
        showGlobalNotice("下载链接已复制")
        return
      }
      throw new Error("clipboard_unavailable")
    } catch {
      showGlobalWarning("复制失败，请手动复制链接")
    }
  }

  async function onDownloadExport(downloadUrl: string, fileName?: string) {
    try {
      await downloadOwnedExportFile(downloadUrl, fileName)
    } catch (err) {
      showGlobalWarning(err instanceof Error ? err.message : "下载失败")
    }
  }

  const templateDisplayName = templateOptions.find((x) => x.templateId === form.templateId)?.templateName || "未选择模板"
  const cloudSummaryText =
    selectedCloudNames.length === 0
      ? "未选云产品"
      : selectedCloudNames.length <= 3
        ? selectedCloudNames.join("、")
        : `${selectedCloudNames.slice(0, 3).join("、")} 等 ${selectedCloudNames.length} 项`

  return (
    <ModuleShell
      title="实施评估"
      description="参数配置、规则计算、版本持久化与导出。"
      breadcrumbs={[{ label: "实施评估" }]}
    >
      <div className="max-w-full min-w-0 space-y-6 overflow-x-hidden">
      <Card
        className={
          (paramCardCollapsed
            ? "fixed right-4 top-[4.5rem] z-30 w-[calc(100vw-2rem)] md:w-[min(980px,calc(100vw-15rem))] shadow-lg "
            : "relative z-0 w-full shadow-sm ") +
            "border-border/40 bg-card/80 backdrop-blur-sm transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] gap-2 py-3"
        }
        style={
          paramCardCollapsed
            ? { opacity: 0.98, transform: "translateY(0px) scale(0.985)" }
            : { opacity: 1, transform: "translateY(0px) scale(1)" }
        }
        collapsed={paramCardCollapsed}
        onCollapsedChange={setParamCardCollapsed}
        collapsedSummary={
          <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">参数与版本</span>
            <span>|</span>
            <span>项目 <span className="font-semibold text-foreground">{projectName.trim() || "未填写"}</span></span>
            <span>|</span>
            <span>总方案 <span className="font-semibold text-foreground">{globalVersionCode || "未选择"}</span></span>
            <span>|</span>
            <span>评估版本 <span className="font-semibold text-foreground">{currentVersionCode || "未选择"}</span></span>
            <span>|</span>
            <span>模板 <span className="font-semibold text-foreground">{templateDisplayName}</span></span>
            <span>|</span>
            <span>规则 <span className="font-semibold text-foreground">{form.ruleSetId || "未就绪"}</span></span>
            <span>|</span>
            <span>用户 <span className="font-semibold text-primary">{form.userCount}</span></span>
            <span>|</span>
            <span>难度 <span className="font-semibold text-primary">{form.difficultyFactor}</span></span>
            <span>|</span>
            <span>组织 <span className="font-semibold text-primary">{form.orgCount}</span></span>
          </div>
        }
      >
        <CardHeader className="space-y-2">
          <div className="grid gap-2 xl:grid-cols-2 xl:gap-3">
            <div className="rounded-lg border border-border/50 bg-muted/15 px-3 py-2 dark:bg-muted/10">
              <p className="mb-1.5 text-xs font-semibold text-foreground">基本信息</p>
              <div className="grid gap-x-2 gap-y-1.5 sm:grid-cols-2">
                <div className="space-y-0.5 sm:col-span-2">
                  <p className="text-[11px] leading-tight text-muted-foreground">项目名称</p>
                  <Input
                    className="h-8 text-xs"
                    value={projectName}
                    placeholder="未选总方案时请填写；选择总方案后将自动带出，可再修改"
                    onChange={(e) => setProjectName(e.target.value)}
                  />
                </div>
                <div className="space-y-0.5">
                  <p className="text-[11px] leading-tight text-muted-foreground">总方案版本号</p>
                  <select
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    value={globalVersionCode}
                    onChange={(e) => applyGlobalVersionSelection(e.target.value)}
                  >
                    <option value="">请选择总方案版本</option>
                    {globalOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[11px] leading-tight text-muted-foreground">当前生效版本</p>
                  <select
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    value={currentVersionCode}
                    disabled={initLoading || !versionOptions.length}
                    onChange={(e) => void onLoadVersion(e.target.value, dashboardPlans)}
                  >
                    <option value="">{!versionOptions.length ? "尚无版本，请先保存" : "未选择版本"}</option>
                    {versionOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[11px] leading-tight text-muted-foreground">模板</p>
                  <select
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    value={form.templateId}
                    disabled={initLoading}
                    onChange={async (e) => {
                      const nextId = e.target.value
                      setForm((s) => ({ ...s, templateId: nextId }))
                      const detail = await getTemplateDetail(nextId)
                      setTemplateDetail(detail)
                      const firstSheet = detail.sheets?.[0]?.sheetName || "全部工作表"
                      setSelectedSheet(firstSheet)
                      setSelectedCloudNames([])
                      setSelectedPresetMode("")
                      if (firstSheet !== SHEET_MODULE_QUOTE) setCustomModeByCloud({})
                      setItemSelection(
                        Object.fromEntries(
                          detail.items.map((item) => [
                            item.templateItemId,
                            { included: false, customStandardDays: Number(item.standardDays || 0) },
                          ]),
                        ),
                      )
                    }}
                  >
                    <option value="">请选择模板</option>
                    {templateOptions.map((item) => (
                      <option key={item.templateId} value={item.templateId}>
                        {item.templateName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[11px] leading-tight text-muted-foreground">规则集 ID</p>
                  <Input className="h-8 text-xs" value={form.ruleSetId} disabled placeholder="规则集 ID" />
                </div>
                <VersionCheckoutStatusDisplay
                  compact
                  className="min-w-0 sm:col-span-2"
                  labelClassName="text-[11px] leading-tight text-muted-foreground"
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
                />
              </div>
            </div>
            <div className="rounded-lg border border-border/50 bg-muted/15 px-3 py-2 dark:bg-muted/10">
              <p className="mb-1.5 text-xs font-semibold text-foreground">评估信息</p>
              <div className="grid gap-x-2 gap-y-1.5 sm:grid-cols-2">
                <div className="space-y-0.5">
                  <p className="text-[11px] leading-tight text-muted-foreground">用户数</p>
                  <Input
                    className="h-8 text-xs"
                    type="number"
                    min={0}
                    value={form.userCount}
                    onFocus={(event) => {
                      if (Number(event.currentTarget.value || 0) === 0) {
                        event.currentTarget.select()
                      }
                    }}
                    onChange={(e) => setForm((s) => ({ ...s, userCount: Number(e.target.value || 0) }))}
                    placeholder="用户数"
                  />
                </div>
                <div className="space-y-0.5">
                  <p className="text-[11px] leading-tight text-muted-foreground">难度系数</p>
                  <Input
                    className="h-8 text-xs"
                    type="number"
                    min={0}
                    step="0.1"
                    value={form.difficultyFactor}
                    onChange={(e) => setForm((s) => ({ ...s, difficultyFactor: Number(e.target.value || 0) }))}
                    placeholder="难度系数"
                  />
                </div>
                <div className="space-y-0.5">
                  <p className="text-[11px] leading-tight text-muted-foreground">组织数</p>
                  <Input
                    className="h-8 text-xs"
                    type="number"
                    min={1}
                    value={form.orgCount}
                    onChange={(e) => setForm((s) => ({ ...s, orgCount: Number(e.target.value || 1) }))}
                    placeholder="组织数"
                  />
                </div>
                <div className="space-y-0.5">
                  <p className="text-[11px] leading-tight text-muted-foreground">组织相似度</p>
                  <Input
                    className="h-8 text-xs"
                    type="number"
                    min={0}
                    max={1}
                    step="0.1"
                    value={form.orgSimilarityFactor}
                    onChange={(e) => setForm((s) => ({ ...s, orgSimilarityFactor: Number(e.target.value || 0) }))}
                    placeholder="组织相似度"
                  />
                </div>
                <div className="space-y-0.5 sm:col-span-2">
                  <p className="text-[11px] leading-tight text-muted-foreground">产品线</p>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="min-h-8 w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-left"
                      >
                        {form.productLines.length ? (
                          <span className="flex flex-wrap gap-1">
                            {form.productLines.map((line) => (
                              <Badge
                                key={line}
                                variant="outline"
                                className={cn(
                                  "rounded-full px-3 py-0.5 text-xs font-medium leading-5",
                                  PRODUCT_LINE_BADGE_STYLE_MAP[line] || "border-border/70 bg-background text-foreground",
                                )}
                              >
                                {line}
                              </Badge>
                            ))}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">请选择产品线（可多选）</span>
                        )}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-80 p-2">
                      <div className="flex flex-wrap gap-1.5">
                        {PRODUCT_LINE_OPTIONS.map((line) => {
                          const active = form.productLines.includes(line)
                          return (
                            <button
                              key={line}
                              type="button"
                              className={cn(
                                "inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-medium transition-colors",
                                active
                                  ? PRODUCT_LINE_BADGE_STYLE_MAP[line]
                                  : "border-border/70 bg-background text-muted-foreground hover:text-foreground",
                              )}
                              onClick={() =>
                                setForm((prev) => ({
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
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <Button className="rounded-lg" size="sm" variant="outline" onClick={() => void onCreateNewAssessment()} disabled={savePhase !== "idle" || createNewSubmitting}>
              新建
            </Button>
            <Button className="rounded-lg" size="sm" onClick={() => void onSave()} disabled={savePhase !== "idle"}>
              {savePhase === "validating" ? "校验中..." : savePhase === "saving" ? "保存中..." : "保存版本"}
            </Button>
            <VersionVcsToolbar
              compact
              showStatusField={false}
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
              onVersionHistory={() => setVersionHistoryOpen(true)}
              onCheckout={() => void onCheckout()}
              onCheckin={(checkinNote) => void onCheckin(checkinNote)}
              onUndoCheckout={() => void onUndoCheckout()}
              onPromote={() => void onPromote()}
              onForceUnlock={() => void onForceUnlock()}
              forceUnlockVisible={isAdmin}
            />
            <Button className="rounded-lg" size="sm" variant="outline" onClick={() => void onCalculate()} disabled={calculating || savePhase !== "idle"}>
              {calculating ? "计算中..." : "实时校验"}
            </Button>
            <Button className="rounded-lg" size="sm" variant="outline" onClick={() => void onExport("excel")} disabled={exporting || savePhase !== "idle"}>
              {exporting ? "导出中..." : "导出 Excel"}
            </Button>
            <Button className="rounded-lg" size="sm" variant="outline" onClick={() => void onExport("pdf")} disabled={exporting || savePhase !== "idle"}>
              {exporting ? "导出中..." : "导出 PDF"}
            </Button>
            {error ? <span className="text-xs text-destructive">{error}</span> : null}
          </div>
          {isReadonly ? (
            <p className="text-xs text-muted-foreground">当前版本为只读状态，请先检出后编辑。</p>
          ) : null}
        </CardHeader>
      </Card>

      <fieldset disabled={isReadonly} className="max-w-full min-w-0 space-y-6">
      <Card className="max-w-full min-w-0 border-border/40 bg-card/50 backdrop-blur-sm pt-4">
        <Tabs defaultValue="module" className="w-full min-w-0">
          <CardContent className="min-w-0 space-y-6 px-6 pb-6 pt-3">
            <TabsList className="grid h-10 w-full grid-cols-2 sm:inline-flex sm:w-auto sm:max-w-lg">
              <TabsTrigger
                value="module"
                className="rounded-lg px-4 data-[state=active]:border-transparent data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm dark:data-[state=active]:bg-blue-600 dark:data-[state=active]:text-white"
              >
                模块评估
              </TabsTrigger>
              <TabsTrigger
                value="multi-org"
                className="rounded-lg px-4 data-[state=active]:border-transparent data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm dark:data-[state=active]:bg-blue-600 dark:data-[state=active]:text-white"
              >
                多组织推广估算
              </TabsTrigger>
            </TabsList>

            <TabsContent value="module" className="mt-0 min-w-0 space-y-6 outline-none">
      <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-[repeat(4,minmax(0,1fr))]">
        <Card
          collapsible={false}
          className="min-w-0 gap-2 border-border/40 bg-card/50 py-2.5 backdrop-blur-sm"
        >
          <CardContent className="h-full min-w-0 px-3 py-2">
            <p className="text-sm font-medium">人天构成</p>
            <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_92px] items-center gap-2">
              <div className="flex justify-center">
                <div className="h-32 w-32 shrink-0 rounded-full border border-border/40" style={{ background: breakdownPieStyle }} />
              </div>
              <div className="space-y-1 text-[10px] text-muted-foreground">
                {breakdownSlices.map((slice) => (
                  <p key={slice.label} className="truncate leading-4">
                    <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: slice.color }} />
                    {slice.label}：{formatDays(slice.value)}
                  </p>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card
          collapsible={false}
          className="min-w-0 gap-2 border-border/40 bg-card/50 py-2.5 backdrop-blur-sm"
        >
          <CardContent className="h-full min-w-0 px-3 py-2">
            <p className="text-sm font-medium">云产品工作量占比</p>
            <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_92px] items-center gap-2">
              <div className="flex justify-center">
                <div className="h-32 w-32 shrink-0 rounded-full border border-border/40" style={{ background: cloudPieStyle }} />
              </div>
              <div className="space-y-1 text-[10px] text-muted-foreground">
                {cloudWorkloadSlices.length ? (
                  cloudWorkloadSlices.slice(0, 4).map((slice, idx) => (
                    <p key={slice.label} className="truncate leading-4">
                      <span
                        className="mr-1.5 inline-block h-2 w-2 rounded-full"
                        style={{ background: ["#7c3aed", "#2563eb", "#10b981", "#f59e0b", "#ef4444", "#14b8a6", "#8b5cf6"][idx % 7] }}
                      />
                      {slice.label}：{slice.percent}%
                    </p>
                  ))
                ) : (
                  <p>暂无数据</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card
          collapsible={false}
          className="min-w-0 gap-2 border-border/40 bg-card/50 py-2.5 backdrop-blur-sm"
        >
          <CardContent className="min-w-0 px-3 py-2">
            <p className="text-sm text-muted-foreground">勾选条目 / 基础人天</p>
            <p className="mt-1.5 text-2xl font-semibold">{selectedCount} / {formatDays(baseDays)}</p>
          </CardContent>
        </Card>
        <Card
          collapsible={false}
          className="min-w-0 gap-2 border-border/40 bg-card/50 py-2.5 backdrop-blur-sm"
        >
          <CardContent className="min-w-0 px-3 py-2">
            <p className="text-sm text-muted-foreground">总评估人天（实时）</p>
            <p className="mt-1.5 text-2xl font-semibold">{formatDays(scaleFactor.total)}</p>
          </CardContent>
        </Card>
      </div>

      <Card
        className="min-w-0 max-w-full border-border/40 bg-card/50 backdrop-blur-sm"
        collapsedSummary={
          <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap text-[11px] text-muted-foreground">
            <span>工作表 <span className="font-semibold text-foreground">{selectedSheet || "—"}</span></span>
            <span>|</span>
            <span>预置 <span className="font-semibold text-foreground">{selectedPresetMode || "未选择"}</span></span>
            <span>|</span>
            <span>云产品 <span className="font-semibold text-foreground">{cloudSummaryText}</span></span>
            <span>|</span>
            <span>勾选 <span className="font-semibold text-primary">{selectedCount}</span></span>
            <span>|</span>
            <span>基础人天 <span className="font-semibold text-primary">{formatDays(baseDays)}</span></span>
            <span>|</span>
            <span>总人天 <span className="font-semibold text-primary">{formatDays(scaleFactor.total)}</span></span>
          </div>
        }
      >
        <CardHeader className="min-w-0 space-y-4 pb-3">
          <div className="flex w-full min-w-0 max-w-full flex-col gap-4 md:flex-row md:items-start md:gap-6">
            <div className="flex min-w-0 max-w-full flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
              <span className="text-xs font-medium text-muted-foreground shrink-0 pt-2 sm:pt-1.5">报价模式</span>
              <div className="flex min-w-0 max-w-full flex-1 flex-wrap gap-2 overflow-x-auto [scrollbar-gutter:stable]">
                {sheets.map((sheet) => (
                  <Button
                    key={sheet}
                    size="sm"
                    className="h-8 w-fit max-w-full shrink-0 rounded-lg px-3"
                    variant={selectedSheet === sheet ? "default" : "outline"}
                    onClick={() => {
                      setSelectedSheet(sheet)
                      setSelectedCloudNames([])
                      if (sheet !== SHEET_MODULE_QUOTE) {
                        setSelectedPresetMode("")
                        setCustomModeByCloud({})
                      }
                    }}
                  >
                    {sheet}
                  </Button>
                ))}
              </div>
            </div>
            {selectedSheet === SHEET_MODULE_QUOTE ? (
              <div className="flex min-w-0 max-w-full flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
                <span className="text-xs font-medium text-muted-foreground shrink-0 pt-2 sm:pt-1.5">预置评估模式</span>
                <div className="flex min-w-0 max-w-full flex-1 flex-wrap gap-2 overflow-x-auto [scrollbar-gutter:stable]">
                  {["标准财务供应链制造", "标准财务供应链", "全量云产品"].map((mode) => (
                    <Button
                      key={mode}
                      size="sm"
                      className="max-w-full shrink-0 whitespace-normal rounded-xl text-center leading-snug"
                      variant={selectedPresetMode === mode ? "default" : "outline"}
                      onClick={() => applyPreset(mode)}
                    >
                      {mode}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex w-full min-w-0 max-w-full flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
            <span className="text-xs font-medium text-muted-foreground shrink-0 pt-2 sm:pt-1.5">云产品</span>
            <div className="flex min-w-0 max-w-full flex-1 flex-wrap gap-2 overflow-x-auto [scrollbar-gutter:stable]">
              {allCloudNames.map((cloud) => (
                <Button
                  key={cloud}
                  size="sm"
                  className="h-auto min-h-8 w-fit max-w-full shrink-0 whitespace-normal rounded-lg px-3 py-1.5 text-center leading-snug"
                  variant={selectedCloudNames.includes(cloud) ? "default" : "outline"}
                  onClick={() => toggleCloud(cloud)}
                >
                  {cloud}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!visibleCloudNames.length ? (
            <p className="text-sm text-muted-foreground">请选择一个或多个云产品标签查看条目。</p>
          ) : (
            <div className="space-y-4">
              {showOnlySelectedSkuRows && selectedCount === 0 ? (
                <p className="text-sm text-muted-foreground px-1">已检入：当前工作表下暂无已勾选条目。</p>
              ) : null}
              {Array.from(cloudTree.entries()).map(([cloudName, skuMap]) => {
                const flat = Array.from(skuMap.values()).flat()
                const skuEntriesForTable = Array.from(skuMap.entries())
                  .map(([skuName, items]) => {
                    const rowItems = showOnlySelectedSkuRows
                      ? items.filter((it) => itemSelection[it.templateItemId]?.included)
                      : items
                    return [skuName, rowItems] as const
                  })
                  .filter(([, rowItems]) => rowItems.length > 0)
                if (showOnlySelectedSkuRows && skuEntriesForTable.length === 0) {
                  return null
                }
                const cloudCustom = Boolean(customModeByCloud[cloudName])
                const includedCount = flat.filter((x) => itemSelection[x.templateItemId]?.included).length
                const selectedModuleCount = new Set(
                  flat
                    .filter((x) => itemSelection[x.templateItemId]?.included)
                    .map((x) => x.deliveryModule || x.itemName || x.templateItemId),
                ).size
                const totalDays = flat.reduce((sum, item) => {
                  const state = itemSelection[item.templateItemId]
                  if (!state?.included) return sum
                  const useCustom =
                    cloudCustom && Number.isFinite(Number(state.customStandardDays))
                  const effective = useCustom
                    ? Number(state.customStandardDays || item.standardDays || 0)
                    : Number(item.standardDays || 0)
                  return sum + effective
                }, 0)
                const selectedSkuNames = Array.from(skuMap.entries())
                  .filter(([, items]) => items.some((item) => itemSelection[item.templateItemId]?.included))
                  .map(([sku]) => sku)
                const selectedSkuText =
                  selectedSkuNames.length === 0
                    ? "未选SKU"
                    : selectedSkuNames.join("、")
                return (
                  <Card
                    key={cloudName}
                    className="gap-3 rounded-xl border border-border/60 py-4 data-[collapsed=true]:gap-1.5 data-[collapsed=true]:py-1.5"
                    collapsedSummary={
                      <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap text-[12px] leading-5 text-muted-foreground">
                        <span className="font-medium text-foreground">{cloudName}</span>
                        <span>|</span>
                        <span>
                          已选模块 <span className={COLLAPSED_KEY_TEXT_CLASS}>{selectedModuleCount}</span>
                        </span>
                        <span>|</span>
                        <span>
                          已选条目 <span className={COLLAPSED_KEY_TEXT_CLASS}>{includedCount}</span> / {flat.length}
                        </span>
                        <span>|</span>
                        <span>
                          累计人天 <span className={COLLAPSED_KEY_TEXT_CLASS}>{formatDays(totalDays)}</span>
                        </span>
                        <span>|</span>
                        <span>
                          已选SKU <span className={COLLAPSED_KEY_TEXT_CLASS}>{selectedSkuText}</span>
                        </span>
                      </div>
                    }
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-4">
                      <div className="text-sm font-semibold">
                        云产品：{cloudName}
                        {showOnlySelectedSkuRows ? (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">（已检入 · 仅显示已勾选条目）</span>
                        ) : null}
                        （已选 {includedCount}/{flat.length}，{formatDays(totalDays)} 人天，模块 {selectedModuleCount}）
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {selectedSheet === SHEET_MODULE_QUOTE ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isReadonly}
                            onClick={(e) => {
                              e.stopPropagation()
                              const willEnable = !cloudCustom
                              setCustomModeByCloud((prev) => ({ ...prev, [cloudName]: willEnable }))
                              if (willEnable) {
                                // 开启自定义人天时，默认按标准人天回填（整数），便于按 +/- 整数调整
                                setItemSelection((prev) => {
                                  const next = { ...prev }
                                  for (const item of flat) {
                                    const cur = next[item.templateItemId]
                                    next[item.templateItemId] = {
                                      included: Boolean(cur?.included),
                                      customStandardDays: toInteger(Number(item.standardDays || 0)),
                                      customAdjustReason: cur?.customAdjustReason,
                                      customAdjustReasonStatus: cur?.customAdjustReasonStatus,
                                    }
                                  }
                                  return next
                                })
                              }
                            }}
                          >
                            {cloudCustom ? "取消自定义人天" : "自定义人天"}
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isReadonly}
                          onClick={() => setCloudSelections(cloudName, true)}
                        >
                          全选
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isReadonly}
                          onClick={() => setCloudSelections(cloudName, false)}
                        >
                          全不选
                        </Button>
                      </div>
                    </div>
                    <div className="px-4">
                      <div className="w-full min-w-0 overflow-x-auto rounded-lg border border-border/50">
                        <Table
                          className="w-full min-w-0 border-collapse table-fixed"
                          style={
                            {
                              // 与左侧 SKU/实施要点、右侧标准人天/自定义列宽之和大致对齐；中间两列按 75%/25% 分剩余宽
                              ["--assess-fixed-side" as string]: cloudCustom ? "33rem" : "24rem",
                            } as CSSProperties
                          }
                        >
                          <colgroup>
                            <col className="w-[min(7.5rem,15vw)]" />
                            <col className="w-[min(12rem,26vw)]" />
                            <col
                              style={{
                                width: "calc((100% - var(--assess-fixed-side, 24rem)) * 0.75)",
                              }}
                            />
                            <col
                              style={{
                                width: "calc((100% - var(--assess-fixed-side, 24rem)) * 0.25)",
                              }}
                            />
                            <col className="w-24" />
                            {cloudCustom ? <col className="w-36" /> : null}
                          </colgroup>
                          <TableHeader className="[&_th]:bg-accent/12 dark:[&_th]:bg-accent/20 [&_th]:text-foreground">
                            <TableRow className="hover:bg-transparent">
                              <TableHead className="border-r border-border/40 whitespace-normal">SKU</TableHead>
                              <TableHead className={cn("min-w-0 whitespace-normal", ASSESS_TABLE_COL_BORDER)}>
                                实施要点
                              </TableHead>
                              <TableHead className={cn("min-w-0 whitespace-normal", ASSESS_TABLE_COL_BORDER)}>
                                实施要点内容说明
                              </TableHead>
                              <TableHead className={cn("min-w-0 whitespace-normal", ASSESS_TABLE_COL_BORDER)}>
                                评估说明
                              </TableHead>
                              <TableHead className={cn("w-24 text-left whitespace-normal", ASSESS_TABLE_COL_BORDER)}>
                                标准人天
                              </TableHead>
                              {cloudCustom ? (
                                <TableHead className={cn("w-36 whitespace-normal", ASSESS_TABLE_COL_BORDER)}>
                                  自定义人天
                                </TableHead>
                              ) : null}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {skuEntriesForTable.map(([skuName, rowItems]) => (
                              <Fragment key={`${cloudName}-${skuName}`}>
                                {rowItems.map((item, rowIdx) => {
                                  const primary =
                                    String(item.deliveryPoint || item.itemName || "").trim() || "-"
                                  const moduleLine = String(item.deliveryModule || "").trim()
                                  const showModuleLine = moduleLine.length > 0 && moduleLine !== primary
                                  const pointsOneLine = showModuleLine
                                    ? `${primary} · ${moduleLine}`
                                    : primary
                                  const evalText = String(item.evalDesc || "-").trim() || "-"
                                  const deliveryDescText =
                                    String(item.deliveryDesc || "").trim() || "-"
                                  const included = Boolean(itemSelection[item.templateItemId]?.included)
                                  const standardDaysNum = Number(item.standardDays || 0)
                                  const standardDaysCellClass =
                                    standardDaysNum > 10
                                      ? "font-semibold text-red-800 dark:text-red-400"
                                      : standardDaysNum > 5
                                        ? "font-semibold text-orange-800 dark:text-orange-400"
                                        : "font-semibold text-foreground"
                                  function toggleRowIncluded() {
                                    if (isReadonly) return
                                    setItemSelection((prev) => {
                                      const cur = prev[item.templateItemId]
                                      return {
                                        ...prev,
                                        [item.templateItemId]: {
                                          included: !included,
                                          customStandardDays: Number(
                                            cur?.customStandardDays ?? item.standardDays,
                                          ),
                                          customAdjustReason: cur?.customAdjustReason,
                                          customAdjustReasonStatus: cur?.customAdjustReasonStatus,
                                        },
                                      }
                                    })
                                  }
                                  return (
                                    <TableRow
                                      key={item.templateItemId}
                                      data-state={included ? "selected" : undefined}
                                      aria-selected={included}
                                      tabIndex={isReadonly ? undefined : 0}
                                      className={cn(
                                        "border-b transition-colors data-[state=selected]:bg-blue-500/12 dark:data-[state=selected]:bg-blue-500/20",
                                        !isReadonly &&
                                          "cursor-pointer hover:bg-accent/28 dark:hover:bg-accent/42 data-[state=selected]:hover:bg-blue-500/18 dark:data-[state=selected]:hover:bg-blue-500/25",
                                        isReadonly && "cursor-default",
                                      )}
                                      onClick={isReadonly ? undefined : toggleRowIncluded}
                                      onKeyDown={
                                        isReadonly
                                          ? undefined
                                          : (e) => {
                                              if (e.key === "Enter" || e.key === " ") {
                                                e.preventDefault()
                                                toggleRowIncluded()
                                              }
                                            }
                                      }
                                    >
                                      {rowIdx === 0 ? (
                                        <TableCell
                                          rowSpan={rowItems.length}
                                          className={cn(
                                            "align-middle border-r border-border/40 bg-muted/20 text-xs font-medium text-muted-foreground whitespace-nowrap",
                                            !isReadonly && "cursor-pointer hover:bg-muted/35",
                                          )}
                                          title={
                                            isReadonly
                                              ? "当前版本只读（已检入或已审核），不可更改勾选"
                                              : "单击切换本 SKU 下全部条目的勾选"
                                          }
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            if (isReadonly) return
                                            toggleSkuGroupInclusion(
                                              skuMap.get(skuName) ?? rowItems,
                                            )
                                          }}
                                        >
                                          {skuName}
                                        </TableCell>
                                      ) : null}
                                      <TableCell
                                        className={cn(
                                          "min-w-0 align-top break-words whitespace-normal text-sm font-medium leading-snug",
                                          ASSESS_TABLE_COL_BORDER,
                                        )}
                                        title={pointsOneLine}
                                      >
                                        {pointsOneLine}
                                      </TableCell>
                                      <TableCell
                                        className={cn(
                                          "min-w-0 align-top break-words whitespace-normal text-muted-foreground text-sm leading-snug",
                                          ASSESS_TABLE_COL_BORDER,
                                        )}
                                      >
                                        {deliveryDescText}
                                      </TableCell>
                                      <TableCell
                                        className={cn(
                                          "min-w-0 align-top break-words whitespace-normal text-muted-foreground text-sm leading-snug",
                                          ASSESS_TABLE_COL_BORDER,
                                        )}
                                      >
                                        {evalText}
                                      </TableCell>
                                      <TableCell
                                        className={cn(
                                          "align-middle text-center whitespace-nowrap tabular-nums",
                                          standardDaysCellClass,
                                          ASSESS_TABLE_COL_BORDER,
                                        )}
                                      >
                                        {formatDays(standardDaysNum)}
                                      </TableCell>
                                      {cloudCustom ? (
                                        <TableCell
                                          className={cn("align-middle text-center", ASSESS_TABLE_COL_BORDER)}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <div className="mx-auto inline-flex items-center justify-center gap-2 rounded-md border border-input bg-background px-2 py-1.5">
                                            {(() => {
                                              const standardDaysBase = toInteger(Number(item.standardDays || 0))
                                              const customDaysCurrent = Number(
                                                itemSelection[item.templateItemId]?.customStandardDays ??
                                                  item.standardDays ??
                                                  0,
                                              )
                                              const reasonStatus =
                                                itemSelection[item.templateItemId]?.customAdjustReasonStatus
                                              const reasonPreview =
                                                String(
                                                  itemSelection[item.templateItemId]?.customAdjustReason || "",
                                                ).trim() || "暂未填写调整原因"
                                              const dotSide =
                                                customDaysCurrent > standardDaysBase
                                                  ? "plus"
                                                  : customDaysCurrent < standardDaysBase
                                                    ? "minus"
                                                    : null
                                              return (
                                                <>
                                            <span className="min-w-0 truncate text-sm tabular-nums">
                                              {formatDays(
                                                customDaysCurrent,
                                              )}
                                            </span>
                                            <Popover
                                              open={customAdjustReasonEditor?.itemId === item.templateItemId}
                                              onOpenChange={(open) => {
                                                if (open) return
                                                if (customAdjustReasonEditor?.itemId !== item.templateItemId) return
                                                const reason = customAdjustReasonEditor.draft.trim()
                                                if (reason.length < 2) {
                                                  showGlobalWarning("调整原因不能少于2个字")
                                                  return
                                                }
                                                setItemSelection((prev) => {
                                                  const cur = prev[item.templateItemId]
                                                  const nextCustom = Number(
                                                    cur?.customStandardDays ?? item.standardDays ?? 0,
                                                  )
                                                  const nextStatus =
                                                    nextCustom === standardDaysBase ? undefined : "saved"
                                                  return {
                                                    ...prev,
                                                    [item.templateItemId]: {
                                                      included: Boolean(cur?.included),
                                                      customStandardDays: nextCustom,
                                                      customAdjustReason:
                                                        nextCustom === standardDaysBase
                                                          ? undefined
                                                          : reason || undefined,
                                                      customAdjustReasonStatus: nextStatus,
                                                    },
                                                  }
                                                })
                                                setCustomAdjustReasonEditor(null)
                                              }}
                                            >
                                              <div className="flex items-center gap-1">
                                                <div className="relative">
                                                  <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-6 w-6 rounded-md px-0"
                                                    disabled={isReadonly}
                                                    onClick={(e) => {
                                                      e.stopPropagation()
                                                      setItemSelection((prev) => {
                                                        const cur = prev[item.templateItemId]
                                                        const base = Number(cur?.customStandardDays ?? item.standardDays ?? 0)
                                                        const nextCustom = Math.max(0, toInteger(base) - 1)
                                                        const nextStatus =
                                                          nextCustom === standardDaysBase ? undefined : "pending"
                                                        return {
                                                          ...prev,
                                                          [item.templateItemId]: {
                                                            included: Boolean(cur?.included),
                                                            customStandardDays: nextCustom,
                                                            customAdjustReason:
                                                              nextCustom === standardDaysBase
                                                                ? undefined
                                                                : cur?.customAdjustReason,
                                                            customAdjustReasonStatus: nextStatus,
                                                          },
                                                        }
                                                      })
                                                    }}
                                                  >
                                                    -
                                                  </Button>
                                                  {reasonStatus && dotSide === "minus" ? (
                                                    <Tooltip delayDuration={2000}>
                                                      <PopoverAnchor asChild>
                                                        <TooltipTrigger asChild>
                                                          <button
                                                            type="button"
                                                            className={cn(
                                                              "absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ring-2 ring-background transition-all duration-200 ease-out hover:scale-125 hover:shadow-[0_0_0_3px_rgba(16,185,129,0.18)] focus-visible:scale-125 focus-visible:shadow-[0_0_0_3px_rgba(16,185,129,0.22)]",
                                                              reasonStatus === "saved"
                                                                ? "bg-emerald-500"
                                                                : "bg-red-500",
                                                            )}
                                                            aria-label="维护调整原因"
                                                            onClick={(e) => {
                                                              e.stopPropagation()
                                                              setCustomAdjustReasonEditor({
                                                                itemId: item.templateItemId,
                                                                draft:
                                                                  itemSelection[item.templateItemId]
                                                                    ?.customAdjustReason || "",
                                                              })
                                                            }}
                                                          />
                                                        </TooltipTrigger>
                                                      </PopoverAnchor>
                                                      <TooltipContent side="top" sideOffset={6}>
                                                        {reasonPreview}
                                                      </TooltipContent>
                                                    </Tooltip>
                                                  ) : null}
                                                </div>
                                                <div className="relative">
                                                  <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-6 w-6 rounded-md px-0"
                                                    disabled={isReadonly}
                                                    onClick={(e) => {
                                                      e.stopPropagation()
                                                      setItemSelection((prev) => {
                                                        const cur = prev[item.templateItemId]
                                                        const base = Number(cur?.customStandardDays ?? item.standardDays ?? 0)
                                                        const nextCustom = toInteger(base) + 1
                                                        const nextStatus =
                                                          nextCustom === standardDaysBase ? undefined : "pending"
                                                        return {
                                                          ...prev,
                                                          [item.templateItemId]: {
                                                            included: Boolean(cur?.included),
                                                            customStandardDays: nextCustom,
                                                            customAdjustReason:
                                                              nextCustom === standardDaysBase
                                                                ? undefined
                                                                : cur?.customAdjustReason,
                                                            customAdjustReasonStatus: nextStatus,
                                                          },
                                                        }
                                                      })
                                                    }}
                                                  >
                                                    +
                                                  </Button>
                                                  {reasonStatus && dotSide === "plus" ? (
                                                    <Tooltip delayDuration={2000}>
                                                      <PopoverAnchor asChild>
                                                        <TooltipTrigger asChild>
                                                          <button
                                                            type="button"
                                                            className={cn(
                                                              "absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ring-2 ring-background transition-all duration-200 ease-out hover:scale-125 hover:shadow-[0_0_0_3px_rgba(16,185,129,0.18)] focus-visible:scale-125 focus-visible:shadow-[0_0_0_3px_rgba(16,185,129,0.22)]",
                                                              reasonStatus === "saved"
                                                                ? "bg-emerald-500"
                                                                : "bg-red-500",
                                                            )}
                                                            aria-label="维护调整原因"
                                                            onClick={(e) => {
                                                              e.stopPropagation()
                                                              setCustomAdjustReasonEditor({
                                                                itemId: item.templateItemId,
                                                                draft:
                                                                  itemSelection[item.templateItemId]
                                                                    ?.customAdjustReason || "",
                                                              })
                                                            }}
                                                          />
                                                        </TooltipTrigger>
                                                      </PopoverAnchor>
                                                      <TooltipContent side="top" sideOffset={6}>
                                                        {reasonPreview}
                                                      </TooltipContent>
                                                    </Tooltip>
                                                  ) : null}
                                                </div>
                                              </div>
                                              <PopoverContent
                                                side="top"
                                                align="end"
                                                className="w-64 space-y-2 rounded-xl p-3"
                                                onOpenAutoFocus={(event) => event.preventDefault()}
                                              >
                                                <p className="text-xs font-medium text-foreground">调整原因</p>
                                                <Input
                                                  value={
                                                    customAdjustReasonEditor?.itemId === item.templateItemId
                                                      ? customAdjustReasonEditor.draft
                                                      : ""
                                                  }
                                                  placeholder="请填写本次调增/调减原因"
                                                  maxLength={120}
                                                  onChange={(event) => {
                                                    setCustomAdjustReasonEditor((prev) =>
                                                      prev && prev.itemId === item.templateItemId
                                                        ? { ...prev, draft: event.target.value }
                                                        : prev,
                                                    )
                                                  }}
                                                />
                                              </PopoverContent>
                                            </Popover>
                                                </>
                                              )
                                            })()}
                                          </div>
                                        </TableCell>
                                      ) : null}
                                    </TableRow>
                                  )
                                })}
                              </Fragment>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
            </TabsContent>

            <TabsContent value="multi-org" className="mt-0 space-y-4 outline-none">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-base font-semibold text-foreground">多组织推广估算</p>
                  <p className="text-xs text-muted-foreground">按组织维度汇总推广人天，与模块评估基础人天联动。</p>
                </div>
                <Button className="rounded-xl shrink-0" variant="outline" onClick={() => setMultiOrgRows((prev) => [...prev, createEmptyMultiOrgRow()])}>
                  新增组织
                </Button>
              </div>
              <div className="w-full overflow-x-auto rounded-xl border border-border/50">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>组织名称</TableHead>
                <TableHead>组织形态</TableHead>
                <TableHead>实施地点</TableHead>
                <TableHead>交付策略</TableHead>
                <TableHead>用户数</TableHead>
                {scopeDefsVisible.map((scope) => (
                  <TableHead key={scope.key}>{scope.label}</TableHead>
                ))}
                <TableHead>其他业务</TableHead>
                <TableHead>难度系数</TableHead>
                <TableHead>估算人天</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {multiOrgRows.map((row) => (
                <TableRow key={row.rowId}>
                  <TableCell>
                    <Input value={row.orgName} onChange={(e) => setMultiOrgRows((prev) => prev.map((x) => (x.rowId === row.rowId ? { ...x, orgName: e.target.value } : x)))} />
                  </TableCell>
                  <TableCell>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={row.orgType}
                      onChange={(e) => setMultiOrgRows((prev) => prev.map((x) => (x.rowId === row.rowId ? { ...x, orgType: e.target.value } : x)))}
                    >
                      {orgTypeOptions.map((x) => (
                        <option key={x} value={x}>{x}</option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell>
                    <Input value={row.location} onChange={(e) => setMultiOrgRows((prev) => prev.map((x) => (x.rowId === row.rowId ? { ...x, location: e.target.value } : x)))} />
                  </TableCell>
                  <TableCell>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={row.deliveryStrategy}
                      onChange={(e) => setMultiOrgRows((prev) => prev.map((x) => (x.rowId === row.rowId ? { ...x, deliveryStrategy: e.target.value } : x)))}
                    >
                      {deliveryStrategyOptions.map((x) => (
                        <option key={x} value={x}>{x}</option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell>
                    <Input type="number" min={0} value={row.userCount} onChange={(e) => setMultiOrgRows((prev) => prev.map((x) => (x.rowId === row.rowId ? { ...x, userCount: Number(e.target.value || 0) } : x)))} />
                  </TableCell>
                  {scopeDefsVisible.map((scope) => (
                    <TableCell key={`${row.rowId}-${scope.key}`}>
                      <input
                        type="checkbox"
                        checked={Boolean(row.scope[scope.key])}
                        onChange={(e) =>
                          setMultiOrgRows((prev) =>
                            prev.map((x) =>
                              x.rowId === row.rowId
                                ? { ...x, scope: { ...x.scope, [scope.key]: e.target.checked } }
                                : x,
                            ),
                          )
                        }
                      />
                    </TableCell>
                  ))}
                  <TableCell>
                    <Input type="number" min={0} step="0.1" value={row.otherBusinessDays} onChange={(e) => setMultiOrgRows((prev) => prev.map((x) => (x.rowId === row.rowId ? { ...x, otherBusinessDays: Number(e.target.value || 0) } : x)))} />
                  </TableCell>
                  <TableCell>
                    <Input type="number" min={0} step="0.1" value={row.difficultyFactor} onChange={(e) => setMultiOrgRows((prev) => prev.map((x) => (x.rowId === row.rowId ? { ...x, difficultyFactor: Number(e.target.value || 0) } : x)))} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{formatDays(calcMultiOrgEstimatedDays(row))}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={multiOrgRows.length <= 1}
                      onClick={() => setMultiOrgRows((prev) => (prev.length > 1 ? prev.filter((x) => x.rowId !== row.rowId) : prev))}
                    >
                      删除
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
              </div>
              <p className="text-sm text-muted-foreground">
                推广人天合计：<span className="font-semibold text-foreground">{formatDays(multiOrgTotalDays)}</span>
              </p>
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>

      <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">导出历史</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {serverResult ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-50/60 p-3 text-xs text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200">
              后端校验：ruleVersion {serverResult.ruleVersion}，pipelineVersion {serverResult.pipelineVersion}，总人天{" "}
              {formatDays(serverResult.totalDays)}
            </div>
          ) : null}
          {exportInfo ? (
            <div className="rounded-xl border border-border/50 p-3 text-xs text-muted-foreground">
              最近导出：{formatDays(exportInfo.totalDays)} 人天，文件链接 {exportInfo.downloadUrl}
            </div>
          ) : null}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">导出历史</p>
              <Input
                className="h-8 max-w-xs"
                placeholder="按评估版本号过滤（如 AS-2026）"
                value={exportHistoryFilter}
                onChange={(e) => setExportHistoryFilter(e.target.value)}
              />
            </div>
            {filteredExportHistory.length ? (
              <div className="space-y-1">
                {filteredExportHistory.map((item) => (
                  <div key={`${item.fileName}-${item.modifiedAt}`} className="flex items-center justify-between rounded-md border border-border/40 px-3 py-2 text-xs">
                    <div>
                      <p className="font-medium">{item.fileName}</p>
                      <p className="text-muted-foreground">{new Date(item.modifiedAt).toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => void onCopyExportLink(item.downloadUrl)}>
                        复制链接
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void onDownloadExport(item.downloadUrl, item.fileName)}>
                        下载
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {exportHistory.length ? "没有匹配的导出记录" : "暂无导出历史"}
              </p>
            )}
            {exportHistory.length < historyTotal ? (
              <Button size="sm" variant="outline" onClick={() => void loadHistory(false)}>
                查看更多
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
      </fieldset>
      </div>
      <AlertDialog open={createNewConfirmOpen} onOpenChange={setCreateNewConfirmOpen}>
        <AlertDialogContent className="sm:max-w-lg rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>检测到未保存修改</AlertDialogTitle>
            <AlertDialogDescription>
              当前版本处于已检出状态，且存在未保存修改。请先保存当前修改，再进入新建空白界面。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={createNewSubmitting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={createNewSubmitting || savePhase !== "idle"}
              onClick={(event) => {
                event.preventDefault()
                void onSaveAndCreateNew()
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
              当前【实施评估】未关联总方案版本号，本次评估将独立保存为一个实施评估版本，确定继续吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savePhase !== "idle"}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={savePhase !== "idle"}
              onClick={(event) => {
                event.preventDefault()
                void onConfirmSaveWithoutGlobal()
              }}
            >
              {savePhase === "validating" ? "校验中..." : savePhase === "saving" ? "保存中..." : "确定继续"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <VersionHistoryDialog
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        title="实施评估版本历史"
        description="按更新时间由新到旧排列，含已归档版本。主界面仅可选当前生效版本；回退历史内容请选中行后使用「按历史版本创建新版」。"
        rows={recordsToVersionHistoryRows(versionRecords)}
        showProjectNameColumn
        highlightVersionCode={currentVersionCode.trim() || undefined}
        latestRecordId={latestAssessmentRecord?.id}
        onCreateFromHistory={(r) => void onCreateAssessmentVersionFromHistory(r)}
        createFromHistoryLoading={creatingFromHistory}
      />
    </ModuleShell>
  )
}
