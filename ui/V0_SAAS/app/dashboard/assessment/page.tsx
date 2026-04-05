"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { ModuleShell } from "@/components/workload/module-shell"
import { VersionVcsToolbar } from "@/components/workload/version-vcs-toolbar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/hooks/use-auth"
import {
  checkinVersionById,
  checkoutVersionById,
  calculateAndExportEstimate,
  calculateEstimate,
  createModuleVersion,
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
import { toast } from "sonner"

type ItemSelectionState = {
  included: boolean
  customStandardDays?: number
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
  userCount: number
  difficultyFactor: number
  orgCount: number
  orgSimilarityFactor: number
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

function formatDays(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
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

function buildVersionOptions<T extends { versionCode: string; updatedAt: string; isHistoricalArchive?: boolean }>(
  records: T[],
  showHistorical: boolean,
) {
  return records
    .filter((x) => showHistorical || !x.isHistoricalArchive)
    .map((x) => ({ value: x.versionCode, label: `${x.versionCode}（${x.updatedAt}）` }))
}

export default function AssessmentPage() {
  const { isAdmin } = useAuth()
  const [form, setForm] = useState<AssessmentForm>({
    templateId: "",
    ruleSetId: "",
    userCount: 100,
    difficultyFactor: 1,
    orgCount: 1,
    orgSimilarityFactor: 0.8,
  })
  const [templateOptions, setTemplateOptions] = useState<TemplateSummary[]>([])
  const [templateDetail, setTemplateDetail] = useState<TemplateDetail | null>(null)
  const [ruleSet, setRuleSet] = useState<RuleSetMeta | null>(null)
  const [selectedSheet, setSelectedSheet] = useState("")
  const [selectedPresetMode, setSelectedPresetMode] = useState("标准财务供应链制造")
  const [selectedCloudNames, setSelectedCloudNames] = useState<string[]>([])
  const [itemSelection, setItemSelection] = useState<Record<string, ItemSelectionState>>({})
  const [customModeEnabled, setCustomModeEnabled] = useState(false)
  const [multiOrgRows, setMultiOrgRows] = useState<MultiOrgRow[]>([createEmptyMultiOrgRow()])
  const [serverResult, setServerResult] = useState<EstimateResult | null>(null)
  const [exportInfo, setExportInfo] = useState<EstimateExportResult | null>(null)
  const [exportHistory, setExportHistory] = useState<Array<{ fileName: string; downloadUrl: string; modifiedAt: string }>>([])
  const [exportHistoryFilter, setExportHistoryFilter] = useState("")
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(1)
  const [globalVersionCode, setGlobalVersionCode] = useState("")
  const [globalOptions, setGlobalOptions] = useState<Array<{ value: string; label: string }>>([])
  const [versionOptions, setVersionOptions] = useState<Array<{ value: string; label: string }>>([])
  const [versionRecords, setVersionRecords] = useState<ModuleVersionRecord[]>([])
  const [globalVersionRecords, setGlobalVersionRecords] = useState<GlobalVersionRecord[]>([])
  const [showHistoricalVersions, setShowHistoricalVersions] = useState(false)
  const [currentVersionCode, setCurrentVersionCode] = useState("")
  const [paramCardCollapsed, setParamCardCollapsed] = useState(false)
  const [paramCardFadeProgress, setParamCardFadeProgress] = useState(0)
  const [saving, setSaving] = useState(false)
  const [savePhase, setSavePhase] = useState<"idle" | "validating" | "saving">("idle")
  const [calculating, setCalculating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [initLoading, setInitLoading] = useState(true)
  const [error, setError] = useState("")
  const selectedVersionRecord = useMemo(
    () => versionRecords.find((x) => x.versionCode === currentVersionCode),
    [versionRecords, currentVersionCode],
  )
  const isReadonly = Boolean(
    selectedVersionRecord &&
      (selectedVersionRecord.checkoutStatus === "checked_in" || selectedVersionRecord.versionDocStatus === "reviewed"),
  )

  const { setDirty } = useUnsavedChanges()
  const dirtyEnabled = useRef(false)

  function showGlobalNotice(text: string) {
    toast(text)
  }

  function showGlobalWarning(text: string) {
    toast.warning(text)
  }

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
    for (const item of itemsInSheet) set.add(item.cloudProduct || "未分类云产品")
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
      const fallback = Number(item.standardDays || 0)
      const effective = customModeEnabled && Number.isFinite(Number(state.customStandardDays))
        ? Number(state.customStandardDays || 0)
        : fallback
      return sum + Math.max(0, effective)
    }, 0)
  }, [customModeEnabled, itemSelection, itemsInSheet])

  const tierFactor = useMemo(() => {
    const tiers = ruleSet?.baseRule?.userCountTiers || []
    const hit = tiers.find((x) => form.userCount >= x.min && form.userCount <= x.max)
    return Number(hit?.factor || 0)
  }, [form.userCount, ruleSet])

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
        setGlobalOptions(
          plans
            .filter((x) => {
              const record = globals.find((g) => g.versionCode === x.globalVersion)
              return showHistoricalVersions || !record?.isHistoricalArchive
            })
            .map((x) => ({
            value: x.globalVersion,
            label: `${x.globalVersion}（${x.projectName}）`,
            })),
        )
        setVersionRecords(records)
        setVersionOptions(buildVersionOptions(records, showHistoricalVersions))
        setTemplateOptions(templates)
        setRuleSet(activeRule)
        setForm((prev) => ({ ...prev, ruleSetId: activeRule.ruleSetId }))

        const chosenTemplateId = templates[0]?.templateId || ""
        if (chosenTemplateId) {
          const detail = await getTemplateDetail(chosenTemplateId)
          setTemplateDetail(detail)
          const firstSheet = detail.sheets?.[0]?.sheetName || "全部工作表"
          setSelectedSheet(firstSheet)
          setSelectedCloudNames(
            Array.from(new Set(detail.items.filter((x) => (x.sheetName || firstSheet) === firstSheet).map((x) => x.cloudProduct || "未分类云产品"))),
          )
          const initialSelection: Record<string, ItemSelectionState> = {}
          for (const item of detail.items) {
            initialSelection[item.templateItemId] = {
              included: Boolean(item.defaultIncluded),
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : "初始化失败"
        setError(msg)
        showGlobalWarning(msg)
      } finally {
        setInitLoading(false)
        dirtyEnabled.current = true
      }
    })()
  }, [showHistoricalVersions])

  // 卸载时重置 dirty 状态
  useEffect(() => {
    return () => { setDirty(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 数据变化时标记脏状态
  useEffect(() => {
    if (dirtyEnabled.current) setDirty(true)
  }, [form, selectedSheet, selectedPresetMode, selectedCloudNames, itemSelection, multiOrgRows, customModeEnabled])

  useEffect(() => {
    const fadeThreshold = 200
    const collapseThreshold = 240
    const expandThreshold = 140
    const onWindowScroll = () => {
      const y = window.scrollY || 0
      const progress = Math.min(1, y / collapseThreshold)
      setParamCardFadeProgress(progress)
      setParamCardCollapsed((prev) => (prev ? y > expandThreshold : y >= collapseThreshold))
    }
    onWindowScroll()
    window.addEventListener("scroll", onWindowScroll, { passive: true })
    return () => window.removeEventListener("scroll", onWindowScroll)
  }, [])

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
      const cloud = item.cloudProduct || "未分类云产品"
      const effective = customModeEnabled && Number.isFinite(Number(state.customStandardDays))
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
  }, [customModeEnabled, itemSelection, itemsInSheet])

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
    setVersionOptions(buildVersionOptions(records, showHistoricalVersions))
    if (nextSelected) setCurrentVersionCode(nextSelected)
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

  async function onCheckin() {
    if (!selectedVersionRecord) return
    try {
      const data = await checkinVersionById(selectedVersionRecord.id, {
        globalVersionCode,
        form,
        selectedSheet,
        selectedPresetMode,
        selectedCloudNames,
        customModeEnabled,
        itemSelection: currentItemsPayload(),
        multiOrgRows,
      })
      await reloadVersions(data.versionCode || selectedVersionRecord.versionCode)
      showGlobalNotice(`检入成功：${data.versionCode}`)
      setDirty(false)
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
        customStandardDays: customModeEnabled ? Number(state.customStandardDays || item.standardDays || 0) : undefined,
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

  async function onSave() {
    if (savePhase !== "idle") return
    if (!globalVersionCode.trim()) {
      const msg = "请先选择总方案版本号"
      setError(msg)
      showGlobalWarning(msg)
      return
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
          form,
          selectedSheet,
          selectedPresetMode,
          selectedCloudNames,
          customModeEnabled,
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : "保存失败"
      setError(msg)
      showGlobalWarning(msg)
    } finally {
      setSaving(false)
      setSavePhase("idle")
    }
  }

  async function onLoadVersion(code: string) {
    setCurrentVersionCode(code)
    if (!code) return
    setError("")
    try {
      const records = await listModuleVersions("assessment")
      const target = records.find((x) => x.versionCode === code)
      if (!target) return
      const payload = target.payload || {}
      const payloadForm = (payload.form || {}) as Partial<AssessmentForm>
      const nextTemplateId = String(payloadForm.templateId || form.templateId)
      if (nextTemplateId && nextTemplateId !== form.templateId) {
        const detail = await getTemplateDetail(nextTemplateId)
        setTemplateDetail(detail)
      }
      dirtyEnabled.current = false
      setGlobalVersionCode((payload.globalVersionCode as string) || "")
      setForm((prev) => ({
        templateId: nextTemplateId || prev.templateId,
        ruleSetId: String(payloadForm.ruleSetId || prev.ruleSetId),
        userCount: Number(payloadForm.userCount || prev.userCount),
        difficultyFactor: Number(payloadForm.difficultyFactor || prev.difficultyFactor),
        orgCount: Number(payloadForm.orgCount || prev.orgCount),
        orgSimilarityFactor: Number(payloadForm.orgSimilarityFactor || prev.orgSimilarityFactor),
      }))
      setSelectedSheet(String(payload.selectedSheet || selectedSheet || "全部工作表"))
      setSelectedPresetMode(String(payload.selectedPresetMode || "标准财务供应链制造"))
      setSelectedCloudNames(Array.isArray(payload.selectedCloudNames) ? (payload.selectedCloudNames as string[]) : [])
      setCustomModeEnabled(Boolean(payload.customModeEnabled))
      const selectionPayload = Array.isArray(payload.itemSelection)
        ? (payload.itemSelection as Array<{ templateItemId: string; included: boolean; customStandardDays?: number }>)
        : []
      const nextSelection: Record<string, ItemSelectionState> = {}
      for (const row of selectionPayload) {
        nextSelection[row.templateItemId] = {
          included: Boolean(row.included),
          customStandardDays: Number(row.customStandardDays || 0),
        }
      }
      if (Object.keys(nextSelection).length) setItemSelection(nextSelection)
      const nextMultiOrg = Array.isArray(payload.multiOrgRows) ? (payload.multiOrgRows as MultiOrgRow[]) : []
      setMultiOrgRows(nextMultiOrg.length ? nextMultiOrg : [createEmptyMultiOrgRow()])
      setServerResult((payload.serverResult as EstimateResult) || null)
      showGlobalNotice(`已回读版本：${code}`)
      setDirty(false)
      setTimeout(() => { dirtyEnabled.current = true }, 0)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "回读失败"
      setError(msg)
      showGlobalWarning(msg)
    }
  }

  function applyPreset(mode: string) {
    setSelectedPresetMode(mode)
    const matchers: Record<string, string[]> = {
      标准财务供应链制造: ["财务", "供应链", "制造"],
      标准财务供应链: ["财务", "供应链"],
      全量云产品: [],
    }
    const keywords = matchers[mode] || []
    if (!keywords.length) {
      setSelectedCloudNames(allCloudNames)
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
        exportProjectName: globalOptions.find((x) => x.value === globalVersionCode)?.label || "未命名项目",
        exportAssessmentVersionCode: currentVersionCode || "UNSAVED",
      })
      setExportInfo(result)
      if (result.downloadUrl) {
        window.open(result.downloadUrl, "_blank", "noopener,noreferrer")
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
      <div className="space-y-6 overflow-x-hidden">
      <Card
        className={
          (paramCardCollapsed
            ? "fixed right-4 top-[4.5rem] z-30 w-[calc(100vw-2rem)] md:w-[min(980px,calc(100vw-15rem))] shadow-lg "
            : "relative z-0 w-full shadow-sm ") + "border-border/40 bg-card/80 backdrop-blur-sm transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
        }
        style={
          paramCardCollapsed
            ? { opacity: 0.98, transform: "translateY(0px) scale(0.985)" }
            : {
                opacity: 1 - paramCardFadeProgress * 0.45,
                transform: `translateY(${Math.max(-6, -paramCardFadeProgress * 8)}px) scale(${1 - paramCardFadeProgress * 0.01})`,
              }
        }
        collapsed={paramCardCollapsed}
        onCollapsedChange={setParamCardCollapsed}
        collapsedSummary={
          <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">参数与版本</span>
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
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">参数与版本</CardTitle>
          <div className="grid gap-3 md:grid-cols-5">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">总方案版本号</p>
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
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">实施评估版本号</p>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={currentVersionCode}
                onChange={(e) => void onLoadVersion(e.target.value)}
              >
                <option value="">请选择历史版本回读</option>
                {versionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">模板</p>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.templateId}
                disabled={initLoading}
                onChange={async (e) => {
                  const nextId = e.target.value
                  setForm((s) => ({ ...s, templateId: nextId }))
                  const detail = await getTemplateDetail(nextId)
                  setTemplateDetail(detail)
                  const firstSheet = detail.sheets?.[0]?.sheetName || "全部工作表"
                  setSelectedSheet(firstSheet)
                  setSelectedCloudNames(
                    Array.from(new Set(detail.items.filter((x) => (x.sheetName || firstSheet) === firstSheet).map((x) => x.cloudProduct || "未分类云产品"))),
                  )
                  setItemSelection(
                    Object.fromEntries(
                      detail.items.map((item) => [
                        item.templateItemId,
                        { included: Boolean(item.defaultIncluded), customStandardDays: Number(item.standardDays || 0) },
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
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">规则集 ID</p>
              <Input value={form.ruleSetId} disabled placeholder="规则集 ID" />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">用户数</p>
              <Input
                type="number"
                min={0}
                value={form.userCount}
                onChange={(e) => setForm((s) => ({ ...s, userCount: Number(e.target.value || 0) }))}
                placeholder="用户数"
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">难度系数</p>
              <Input
                type="number"
                min={0}
                step="0.1"
                value={form.difficultyFactor}
                onChange={(e) => setForm((s) => ({ ...s, difficultyFactor: Number(e.target.value || 0) }))}
                placeholder="难度系数"
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">组织数</p>
              <Input
                type="number"
                min={1}
                value={form.orgCount}
                onChange={(e) => setForm((s) => ({ ...s, orgCount: Number(e.target.value || 1) }))}
                placeholder="组织数"
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">组织相似度</p>
              <Input
                type="number"
                min={0}
                max={1}
                step="0.1"
                value={form.orgSimilarityFactor}
                onChange={(e) => setForm((s) => ({ ...s, orgSimilarityFactor: Number(e.target.value || 0) }))}
                placeholder="组织相似度"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button className="rounded-xl" onClick={() => void onSave()} disabled={savePhase !== "idle"}>
              {savePhase === "validating" ? "校验中..." : savePhase === "saving" ? "保存中..." : "保存版本"}
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
              showHistory={showHistoricalVersions}
              onToggleHistory={() => setShowHistoricalVersions((v) => !v)}
              onCheckout={() => void onCheckout()}
              onCheckin={() => void onCheckin()}
              onUndoCheckout={() => void onUndoCheckout()}
              onPromote={() => void onPromote()}
              onForceUnlock={() => void onForceUnlock()}
              forceUnlockVisible={isAdmin}
            />
            <Button className="rounded-xl" variant="outline" onClick={() => void onCalculate()} disabled={calculating || savePhase !== "idle"}>
              {calculating ? "计算中..." : "实时校验"}
            </Button>
            <Button className="rounded-xl" variant="outline" onClick={() => void onExport("excel")} disabled={exporting || savePhase !== "idle"}>
              {exporting ? "导出中..." : "导出 Excel"}
            </Button>
            <Button className="rounded-xl" variant="outline" onClick={() => void onExport("pdf")} disabled={exporting || savePhase !== "idle"}>
              {exporting ? "导出中..." : "导出 PDF"}
            </Button>
            {error ? <span className="text-xs text-destructive">{error}</span> : null}
          </div>
          {isReadonly ? (
            <p className="text-xs text-muted-foreground">当前版本为只读状态，请先检出后编辑。</p>
          ) : null}
        </CardHeader>
      </Card>

      <fieldset disabled={isReadonly} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
          <CardContent className="h-full p-3">
            <p className="text-sm font-medium">人天构成</p>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_92px] items-center gap-2">
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
        <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
          <CardContent className="h-full p-3">
            <p className="text-sm font-medium">云产品工作量占比</p>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_92px] items-center gap-2">
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
        <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">勾选条目 / 基础人天</p>
            <p className="mt-2 text-2xl font-semibold">{selectedCount} / {formatDays(baseDays)}</p>
          </CardContent>
        </Card>
        <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">总评估人天（实时）</p>
            <p className="mt-2 text-2xl font-semibold">{formatDays(scaleFactor.total)}</p>
          </CardContent>
        </Card>
      </div>

      <Card
        className="border-border/40 bg-card/50 backdrop-blur-sm"
        collapsedSummary={
          <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">模块评估工作台</span>
            <span>|</span>
            <span>工作表 <span className="font-semibold text-foreground">{selectedSheet || "—"}</span></span>
            <span>|</span>
            <span>预置 <span className="font-semibold text-foreground">{selectedPresetMode}</span></span>
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
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">模块评估工作台</CardTitle>
            <div className="flex gap-2">
              {["标准财务供应链制造", "标准财务供应链", "全量云产品"].map((mode) => (
                <Button
                  key={mode}
                  className="rounded-xl"
                  variant={selectedPresetMode === mode ? "default" : "outline"}
                  onClick={() => applyPreset(mode)}
                >
                  {mode}
                </Button>
              ))}
              <Button className="rounded-xl" variant="outline" onClick={() => setCustomModeEnabled((v) => !v)}>
                {customModeEnabled ? "取消自定义人天" : "自定义人天"}
              </Button>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-4">
            {sheets.map((sheet) => (
              <Button
                key={sheet}
                size="sm"
                className="rounded-lg"
                variant={selectedSheet === sheet ? "default" : "outline"}
                onClick={() => {
                  setSelectedSheet(sheet)
                  const clouds = Array.from(new Set((templateDetail?.items || [])
                    .filter((x) => (x.sheetName || sheet) === sheet)
                    .map((x) => x.cloudProduct || "未分类云产品")))
                  setSelectedCloudNames(clouds)
                }}
              >
                {sheet}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {allCloudNames.map((cloud) => (
              <Button
                key={cloud}
                size="sm"
                variant={selectedCloudNames.includes(cloud) ? "default" : "outline"}
                onClick={() => toggleCloud(cloud)}
              >
                {cloud}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {!visibleCloudNames.length ? (
            <p className="text-sm text-muted-foreground">请选择一个或多个云产品标签查看条目。</p>
          ) : (
            <div className="space-y-4">
              {Array.from(cloudTree.entries()).map(([cloudName, skuMap]) => {
                const flat = Array.from(skuMap.values()).flat()
                const includedCount = flat.filter((x) => itemSelection[x.templateItemId]?.included).length
                const selectedModuleCount = new Set(
                  flat
                    .filter((x) => itemSelection[x.templateItemId]?.included)
                    .map((x) => x.deliveryModule || x.itemName || x.templateItemId),
                ).size
                const totalDays = flat.reduce((sum, item) => {
                  const state = itemSelection[item.templateItemId]
                  if (!state?.included) return sum
                  const effective = customModeEnabled
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
                    : selectedSkuNames.length <= 2
                      ? selectedSkuNames.join("、")
                      : `${selectedSkuNames.slice(0, 2).join("、")} 等 ${selectedSkuNames.length} 个`
                return (
                  <Card
                    key={cloudName}
                    className="gap-3 rounded-xl border border-border/60 py-4"
                    collapsedSummary={
                      <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground">{cloudName}</span>
                        <span>|</span>
                        <span>
                          已选模块 <span className="font-semibold text-foreground">{selectedModuleCount}</span>
                        </span>
                        <span>|</span>
                        <span>
                          已选条目 <span className="font-semibold text-foreground">{includedCount}</span> / {flat.length}
                        </span>
                        <span>|</span>
                        <span>
                          累计人天 <span className="font-semibold text-primary">{formatDays(totalDays)}</span>
                        </span>
                        <span>|</span>
                        <span>
                          已选SKU <span className="font-semibold text-foreground">{selectedSkuText}</span>
                        </span>
                      </div>
                    }
                  >
                    <div className="mb-2 flex items-center justify-between px-4">
                      <div className="text-sm font-semibold">
                        云产品：{cloudName}（已选 {includedCount}/{flat.length}，{formatDays(totalDays)} 人天，模块 {selectedModuleCount}）
                        <p className="mt-1 text-[11px] font-normal text-muted-foreground">双击空白处可折叠/展开该云产品卡片</p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setCloudSelections(cloudName, true)}>
                          全选
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setCloudSelections(cloudName, false)}>
                          全不选
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-3 px-4">
                      {Array.from(skuMap.entries()).map(([skuName, items]) => (
                        <div key={`${cloudName}-${skuName}`} className="rounded-lg border border-border/50">
                          <div className="border-b border-border/40 px-3 py-2 text-xs font-medium text-muted-foreground">SKU：{skuName}</div>
                          <div className="w-full overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-20">选择</TableHead>
                                <TableHead>实施要点</TableHead>
                                <TableHead>评估说明</TableHead>
                                <TableHead className="w-28 text-right">标准人天</TableHead>
                                {customModeEnabled ? <TableHead className="w-36">自定义人天</TableHead> : null}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {items.map((item) => (
                                <TableRow key={item.templateItemId}>
                                  <TableCell>
                                    <input
                                      type="checkbox"
                                      checked={Boolean(itemSelection[item.templateItemId]?.included)}
                                      onChange={(e) =>
                                        setItemSelection((prev) => ({
                                          ...prev,
                                          [item.templateItemId]: {
                                            included: e.target.checked,
                                            customStandardDays: Number(prev[item.templateItemId]?.customStandardDays ?? item.standardDays),
                                          },
                                        }))
                                      }
                                    />
                                  </TableCell>
                                  <TableCell className="font-medium">
                                    {item.deliveryPoint || item.itemName}
                                    <p className="text-xs text-muted-foreground">{item.deliveryModule || item.itemName}</p>
                                  </TableCell>
                                  <TableCell className="text-muted-foreground">{item.evalDesc || "-"}</TableCell>
                                  <TableCell className="text-right">{formatDays(Number(item.standardDays || 0))}</TableCell>
                                  {customModeEnabled ? (
                                    <TableCell>
                                      <Input
                                        type="number"
                                        min={0}
                                        step="0.1"
                                        value={Number(itemSelection[item.templateItemId]?.customStandardDays ?? item.standardDays)}
                                        onChange={(e) =>
                                          setItemSelection((prev) => ({
                                            ...prev,
                                            [item.templateItemId]: {
                                              included: Boolean(prev[item.templateItemId]?.included),
                                              customStandardDays: Number(e.target.value || 0),
                                            },
                                          }))
                                        }
                                      />
                                    </TableCell>
                                  ) : null}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </CardContent>
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
                      <Button size="sm" variant="outline" onClick={() => window.open(item.downloadUrl, "_blank", "noopener,noreferrer")}>
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

      <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">多组织推广估算</CardTitle>
            <Button className="rounded-xl" variant="outline" onClick={() => setMultiOrgRows((prev) => [...prev, createEmptyMultiOrgRow()])}>
              新增组织
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="w-full overflow-x-auto">
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
          <p className="mt-3 text-sm text-muted-foreground">
            推广人天合计：<span className="font-semibold text-foreground">{formatDays(multiOrgTotalDays)}</span>
          </p>
        </CardContent>
      </Card>
      </fieldset>
      </div>
    </ModuleShell>
  )
}
