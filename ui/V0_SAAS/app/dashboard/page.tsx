"use client"

import Link from "next/link"
import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react"
import { ModuleShell } from "@/components/workload/module-shell"
import { VersionVcsToolbar } from "@/components/workload/version-vcs-toolbar"
import { recordsToVersionHistoryRows, VersionHistoryDialog } from "@/components/workload/version-history-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  ArrowRight,
  Banknote,
  ChevronDown,
  ClipboardCheck,
  Code2,
  FolderGit2,
  Inbox,
  Layers,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import {
  checkinVersionById,
  checkoutVersionById,
  createGlobalPlanVersion,
  deleteGlobalPlanVersion,
  forceUnlockById,
  getDashboardPlans,
  listModuleVersions,
  listGlobalVersions,
  promoteVersionById,
  undoCheckoutById,
  type GlobalVersionRecord,
  type ModuleVersionRecord,
} from "@/lib/workload-service"
import type { PlanRow } from "@/lib/workload-types"
import { getCheckoutStatusBadgeClass, getCheckoutStatusText } from "@/lib/checkout-status-ui"

const overviewCards = [
  { label: "总方案数", desc: "近 7 天新增", icon: FolderGit2 },
  { label: "需求条目数", desc: "待结构化", icon: Layers },
  { label: "总评估人天", desc: "高复杂占比", icon: ClipboardCheck },
  { label: "参与成员", desc: "当前在线", icon: Users },
]

const quickActions = ["新建评估方案", "导入需求访谈纪要", "发起评审", "查看 API 调用指南"]

const recentActivities = [
  "李华 更新了 ASM-20260329-07 的难度系数",
  "王敏 提交了 REQ-20260329-03 的需求条目回填",
  "张凯 在 DEV-20260329-02 增加了 5 个开发子项",
  "系统 已同步资源成本草稿到总方案版本",
]

function trimSvgText(value: string, maxUnits: number) {
  const text = String(value || "").trim()
  if (!text) return "—"
  let units = 0
  let result = ""
  for (const ch of text) {
    const charUnits = /[ -~]/.test(ch) ? 0.55 : 1
    if (units + charUnits > maxUnits) {
      return `${result}…`
    }
    result += ch
    units += charUnits
  }
  return result
}

const newPlanWorkflowSteps: Array<{
  id: string
  step: number
  title: string
  hint: string
  href: string
  icon: typeof Inbox
}> = [
  { id: "requirement", step: 1, title: "需求", hint: "录入与结构化需求", href: "/dashboard/requirement-import", icon: Inbox },
  { id: "assessment", step: 2, title: "实施评估", hint: "工作量估算", href: "/dashboard/assessment", icon: ClipboardCheck },
  { id: "dev", step: 3, title: "开发评估", hint: "开发侧评估与填报", href: "/dashboard/dev-assessment", icon: Code2 },
  { id: "resource", step: 4, title: "资源人天及成本", hint: "人天与成本核算", href: "/dashboard/resource-cost", icon: Banknote },
]

export default function DashboardPage() {
  const { isAdmin } = useAuth()
  const [planRows, setPlanRows] = useState<PlanRow[]>([])
  const [globalRecords, setGlobalRecords] = useState<GlobalVersionRecord[]>([])
  const [selectedGlobalVersionCode, setSelectedGlobalVersionCode] = useState("")
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createMessage, setCreateMessage] = useState("")
  const [previewRow, setPreviewRow] = useState<PlanRow | null>(null)
  const [graphOffset, setGraphOffset] = useState({ x: 0, y: 0 })
  const [graphScale, setGraphScale] = useState(1)
  const [draggingGraph, setDraggingGraph] = useState(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [erModulePreview, setErModulePreview] = useState<{ label: string; version: string; src: string } | null>(null)
  const [hoveredErNodeKey, setHoveredErNodeKey] = useState<string | null>(null)
  const [selectedErNodeKey, setSelectedErNodeKey] = useState<string | null>(null)
  const [expandedErNodeKeys, setExpandedErNodeKeys] = useState<Record<string, boolean>>({})
  const [moduleHistoryByGlobal, setModuleHistoryByGlobal] = useState<{
    requirement: Record<string, string[]>
    assessment: Record<string, string[]>
  }>({
    requirement: {},
    assessment: {},
  })
  const [deletePlanDialogOpen, setDeletePlanDialogOpen] = useState(false)
  const [deletingPlan, setDeletingPlan] = useState(false)
  const [planListSearch, setPlanListSearch] = useState("")
  const [createPlanWizardOpen, setCreatePlanWizardOpen] = useState(false)
  const [newProjectNameInput, setNewProjectNameInput] = useState("")
  const [postCreateGuide, setPostCreateGuide] = useState<{ versionCode: string; projectName: string } | null>(null)

  const loadPlans = () => {
    void Promise.all([getDashboardPlans(), listGlobalVersions()]).then(([plans, globals]) => {
      setGlobalRecords(globals)
      setPlanRows(plans)
    })
  }

  useEffect(() => {
    loadPlans()
    const onFocus = () => loadPlans()
    const onVisible = () => {
      if (document.visibilityState === "visible") loadPlans()
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  useEffect(() => {
    if (!previewRow) return
    setGraphOffset({ x: 0, y: 0 })
    setGraphScale(1)
    setDraggingGraph(false)
    setDragStart(null)
    setSelectedErNodeKey(null)
    setHoveredErNodeKey(null)
    setExpandedErNodeKeys({})
  }, [previewRow?.id])

  useEffect(() => {
    const byGlobal = (records: ModuleVersionRecord[]) => {
      const map: Record<string, Array<{ versionCode: string; updatedAtMs: number }>> = {}
      for (const record of records) {
        const globalVersionCode = String(record.payload?.globalVersionCode || "").trim()
        if (!globalVersionCode) continue
        if (!map[globalVersionCode]) map[globalVersionCode] = []
        map[globalVersionCode].push({
          versionCode: record.versionCode,
          updatedAtMs: Number(new Date(record.updatedAt || 0)),
        })
      }
      const normalized: Record<string, string[]> = {}
      for (const [globalCode, rows] of Object.entries(map)) {
        const seen = new Set<string>()
        normalized[globalCode] = rows
          .sort((a, b) => b.updatedAtMs - a.updatedAtMs || b.versionCode.localeCompare(a.versionCode))
          .map((row) => row.versionCode)
          .filter((code) => {
            if (seen.has(code)) return false
            seen.add(code)
            return true
          })
      }
      return normalized
    }

    void Promise.all([listModuleVersions("requirementImport"), listModuleVersions("assessment")]).then(
      ([requirements, assessments]) => {
        setModuleHistoryByGlobal({
          requirement: byGlobal(requirements),
          assessment: byGlobal(assessments),
        })
      },
    )
  }, [])

  function openCreatePlanWizard() {
    setNewProjectNameInput("")
    setCreateMessage("")
    setCreatePlanWizardOpen(true)
  }

  async function submitCreatePlanFromWizard() {
    const trimmed = newProjectNameInput.trim()
    setCreating(true)
    setCreateMessage("")
    try {
      const created = await createGlobalPlanVersion(trimmed || undefined)
      const displayName = trimmed || "未命名项目"
      setCreatePlanWizardOpen(false)
      setPostCreateGuide({ versionCode: created.versionCode, projectName: displayName })
      setCreateMessage(`已创建方案「${displayName}」：${created.versionCode}`)
      setSelectedGlobalVersionCode(created.versionCode)
      loadPlans()
    } catch (error) {
      setCreateMessage(error instanceof Error ? error.message : "新建失败，请稍后重试")
    } finally {
      setCreating(false)
    }
  }

  const selectedGlobalRecord = useMemo(
    () => globalRecords.find((x) => x.versionCode === selectedGlobalVersionCode),
    [globalRecords, selectedGlobalVersionCode],
  )
  const selectedPlanRow = useMemo(
    () => planRows.find((row) => row.globalVersion === selectedGlobalVersionCode),
    [planRows, selectedGlobalVersionCode],
  )
  const globalRecordByVersionCode = useMemo(
    () => new Map(globalRecords.map((record) => [record.versionCode, record])),
    [globalRecords],
  )

  const displayPlanRows = useMemo(() => {
    const q = planListSearch.trim().toLowerCase()
    if (!q) return planRows
    return planRows.filter((row) => {
      const rec = globalRecordByVersionCode.get(row.globalVersion)
      const checkoutText = rec?.checkoutStatus === "checked_out" ? "已检出" : "已检入"
      const haystack = [
        row.id,
        row.projectName,
        row.globalVersion,
        row.assessmentVersion,
        row.resourceVersion,
        row.requirementVersion,
        row.devVersion,
        row.status,
        row.createdAt,
        row.updatedAt,
        row.reviewedAt,
        checkoutText,
      ]
        .map((x) => String(x ?? ""))
        .join(" ")
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [planRows, planListSearch, globalRecordByVersionCode])

  async function onCheckout() {
    if (!selectedGlobalRecord) return
    try {
      await checkoutVersionById(selectedGlobalRecord.id)
      loadPlans()
      setCreateMessage("检出成功")
    } catch (error) {
      setCreateMessage(error instanceof Error ? error.message : "检出失败")
    }
  }

  async function onCheckin(checkinNote: string) {
    if (!selectedGlobalRecord) return
    try {
      const data = await checkinVersionById(selectedGlobalRecord.id, {
        ...((selectedGlobalRecord.payload || {}) as Record<string, unknown>),
        checkinNote,
      })
      setSelectedGlobalVersionCode(data.versionCode)
      loadPlans()
      setCreateMessage(`检入成功：${data.versionCode}`)
    } catch (error) {
      setCreateMessage(error instanceof Error ? error.message : "检入失败")
    }
  }

  async function onUndoCheckout() {
    if (!selectedGlobalRecord) return
    try {
      await undoCheckoutById(selectedGlobalRecord.id)
      loadPlans()
      setCreateMessage("已撤销检出")
    } catch (error) {
      setCreateMessage(error instanceof Error ? error.message : "撤销检出失败")
    }
  }

  async function onPromote() {
    if (!selectedGlobalRecord) return
    try {
      const data = await promoteVersionById(selectedGlobalRecord.id)
      setSelectedGlobalVersionCode(data.newRecord.versionCode)
      loadPlans()
      setCreateMessage(`升版成功：${data.newRecord.versionCode}`)
    } catch (error) {
      setCreateMessage(error instanceof Error ? error.message : "升版失败")
    }
  }

  async function onForceUnlock() {
    if (!selectedGlobalRecord || !isAdmin) return
    try {
      await forceUnlockById(selectedGlobalRecord.id)
      loadPlans()
      setCreateMessage("强制解锁成功")
    } catch (error) {
      setCreateMessage(error instanceof Error ? error.message : "强制解锁失败")
    }
  }

  function onOpenDeletePlanDialog() {
    if (!selectedGlobalRecord) {
      setCreateMessage("请先在列表中选中要删除的方案行")
      return
    }
    setDeletePlanDialogOpen(true)
  }

  async function onConfirmDeletePlan() {
    if (!selectedGlobalRecord) return
    const code = selectedGlobalRecord.versionCode
    setDeletingPlan(true)
    setCreateMessage("")
    try {
      await deleteGlobalPlanVersion(code)
      setCreateMessage(`已删除方案：${code}`)
      setSelectedGlobalVersionCode("")
      setDeletePlanDialogOpen(false)
      loadPlans()
    } catch (error) {
      setCreateMessage(error instanceof Error ? error.message : "删除失败，请稍后重试")
    } finally {
      setDeletingPlan(false)
    }
  }

  const summary = useMemo(() => {
    const totalPlans = planRows.length
    const activeCount = planRows.filter((x) => x.status === "进行中").length
    const waitingCount = planRows.filter((x) => x.status === "待评审").length
    return {
      totalPlans: `${totalPlans}`,
      requirementCount: `${totalPlans * 18}`,
      assessmentDays: `${totalPlans * 76}`,
      onlineMembers: `${Math.max(6, activeCount * 4)}`,
      activeCount,
      waitingCount,
    }
  }, [planRows])

  function onRowDoubleClick(row: PlanRow) {
    setPreviewRow(row)
  }

  const previewRelations = useMemo(
    () => [
      {
        key: "requirement",
        label: "需求版本号",
        value: previewRow?.requirementVersion || "—",
        historyVersions: (moduleHistoryByGlobal.requirement[previewRow?.globalVersion || ""] || []).filter(
          (code) => code !== (previewRow?.requirementVersion || "—"),
        ),
        allowHistoryExpand: true,
      },
      {
        key: "assessment",
        label: "实施评估版本号",
        value: previewRow?.assessmentVersion || "—",
        historyVersions: (moduleHistoryByGlobal.assessment[previewRow?.globalVersion || ""] || []).filter(
          (code) => code !== (previewRow?.assessmentVersion || "—"),
        ),
        allowHistoryExpand: true,
      },
      { key: "resource", label: "资源版本号", value: previewRow?.resourceVersion || "—", historyVersions: [], allowHistoryExpand: false },
      { key: "dev", label: "开发版本号", value: previewRow?.devVersion || "—", historyVersions: [], allowHistoryExpand: false },
    ],
    [previewRow, moduleHistoryByGlobal],
  )
  const selectedErNode = useMemo(
    () => previewRelations.find((node) => node.key === selectedErNodeKey),
    [previewRelations, selectedErNodeKey],
  )

  function zoomGraph(step: number) {
    setGraphScale((prev) => Math.max(0.8, Math.min(1.8, Number((prev + step).toFixed(2)))))
  }

  function resetGraphView() {
    setGraphOffset({ x: 0, y: 0 })
    setGraphScale(1)
  }

  function onGraphPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target as Element | null
    if (target?.closest("[data-er-node='true']")) return
    setDraggingGraph(true)
    setDragStart({ x: event.clientX - graphOffset.x, y: event.clientY - graphOffset.y })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onGraphPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingGraph || !dragStart) return
    setGraphOffset({ x: event.clientX - dragStart.x, y: event.clientY - dragStart.y })
  }

  function onGraphPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    setDraggingGraph(false)
    setDragStart(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function onGraphWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault()
    const step = event.deltaY < 0 ? 0.08 : -0.08
    zoomGraph(step)
  }

  function buildErModuleTarget(node: { key: string; label: string; value: string }, embedded: boolean) {
    if (!previewRow || !node.value || node.value === "—") return
    const pathMap: Record<string, string> = {
      requirement: "/dashboard/requirement-import",
      assessment: "/dashboard/assessment",
      resource: "/dashboard/resource-cost",
      dev: "/dashboard/dev-assessment",
    }
    const path = pathMap[node.key]
    if (!path) return
    const params = new URLSearchParams()
    if (embedded) params.set("embed", "1")
    if (previewRow.globalVersion) params.set("globalVersion", previewRow.globalVersion)
    params.set("version", node.value)
    return {
      label: node.label,
      version: node.value,
      target: `${path}?${params.toString()}`,
    }
  }

  function onOpenErModulePreview(node: { key: string; label: string; value: string }) {
    const target = buildErModuleTarget(node, true)
    if (!target) return
    setErModulePreview({
      label: target.label,
      version: target.version,
      src: target.target,
    })
  }

  function onPreviewSelectedNode() {
    if (!selectedErNode) return
    onOpenErModulePreview(selectedErNode)
  }

  function onModifySelectedNode() {
    if (!selectedErNode) return
    const target = buildErModuleTarget(selectedErNode, false)
    if (!target) return
    window.location.href = target.target
  }

  return (
    <ModuleShell title="主页" showPageHeading={false} breadcrumbs={[{ label: "主页" }]}>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {overviewCards.map((item, index) => (
            <Card
              key={item.label}
              collapsible={false}
              className="border-border/40 bg-card/50 py-3 backdrop-blur-sm"
            >
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-secondary">
                    <item.icon className="size-4 text-muted-foreground" />
                  </div>
                  <Badge variant="outline" className="rounded-md px-2 py-0 text-[10px]">
                    实时
                  </Badge>
                </div>
                <div className="space-y-0.5">
                  <p className="text-xl font-semibold leading-none tabular-nums">
                    {index === 0
                      ? summary.totalPlans
                      : index === 1
                        ? summary.requirementCount
                        : index === 2
                          ? summary.assessmentDays
                          : summary.onlineMembers}
                  </p>
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                </div>
                <Progress value={Math.min(100, 45 + index * 14 + summary.activeCount * 3)} className="h-1" />
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {index === 0
                    ? `${item.desc} ${summary.activeCount} 个进行中`
                    : index === 1
                      ? `${item.desc} ${summary.waitingCount} 条待处理`
                      : index === 2
                        ? `${item.desc} ${(summary.waitingCount + 10) * 2}%`
                        : `${item.desc} ${summary.activeCount * 2} 人`}
                </p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-3 xl:grid-cols-4 xl:gap-4">
          <Card
            collapsible={false}
            className="lg:col-span-2 xl:col-span-3 gap-4 border-0 bg-transparent py-0 shadow-none backdrop-blur-none"
          >
            <CardHeader className="pb-3">
              <div className="space-y-3">
                <div className="min-w-[220px]">
                  <CardTitle className="whitespace-nowrap">评估方案列表</CardTitle>
                </div>
                <div className="flex flex-col gap-3 rounded-xl border border-border/40 bg-card/50 p-3 shadow-sm backdrop-blur-sm lg:flex-row lg:items-center lg:justify-between lg:gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Tooltip delayDuration={250}>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Button
                            size="icon-sm"
                            className="rounded-lg bg-foreground text-background hover:bg-foreground/90"
                            onClick={openCreatePlanWizard}
                            disabled={creating}
                            aria-label="新建方案"
                          >
                            <Plus className="size-4" />
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={6}>
                        新建方案：打开创建向导，新增评估总方案并生成初始版本号。
                        {creating ? "（正在创建中，请稍候。）" : ""}
                      </TooltipContent>
                    </Tooltip>
                    <VersionVcsToolbar
                      compact
                      iconOnly
                      state={
                        selectedGlobalRecord
                          ? {
                              recordId: selectedGlobalRecord.id,
                              checkoutStatus: selectedGlobalRecord.checkoutStatus,
                              versionDocStatus: selectedGlobalRecord.versionDocStatus,
                              checkedOutByUsername: selectedGlobalRecord.checkedOutByUsername,
                            }
                          : undefined
                      }
                      showStatusField={false}
                      onVersionHistory={() => setVersionHistoryOpen(true)}
                      onCheckout={() => void onCheckout()}
                      onCheckin={(checkinNote) => void onCheckin(checkinNote)}
                      onUndoCheckout={() => void onUndoCheckout()}
                      onPromote={() => void onPromote()}
                      onForceUnlock={() => void onForceUnlock()}
                      forceUnlockVisible={isAdmin}
                    />
                    <Tooltip delayDuration={250}>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            className="rounded-lg border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={!selectedGlobalRecord || deletingPlan}
                            onClick={onOpenDeletePlanDialog}
                            aria-label="删除方案"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={6}>
                        删除方案：移除列表中当前选中的方案及其关联数据（不可恢复）。
                        {!selectedGlobalRecord ? "请先在表格中选择一行方案。" : deletingPlan ? "正在删除，请稍候。" : ""}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="relative w-full shrink-0 lg:w-72">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden
                    />
                    <Input
                      type="search"
                      value={planListSearch}
                      onChange={(e) => setPlanListSearch(e.target.value)}
                      placeholder="搜索项目名称、版本号、状态、检出…"
                      className="h-10 rounded-xl border-border/60 bg-background/95 pl-9 pr-3 shadow-sm"
                      aria-label="筛选评估方案列表"
                    />
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {createMessage ? (
                <p className="mb-3 rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
                  {createMessage}
                </p>
              ) : null}
              <Table density="compact">
                <TableHeader>
                  <TableRow>
                    <TableHead>序号</TableHead>
                    <TableHead>项目名称</TableHead>
                    <TableHead>总方案版本</TableHead>
                    <TableHead>评估版本</TableHead>
                    <TableHead>资源版本</TableHead>
                    <TableHead>需求版本</TableHead>
                    <TableHead>开发版本</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>检出状态</TableHead>
                    <TableHead>更新时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayPlanRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="h-24 text-center text-muted-foreground text-sm">
                        {!planRows.length
                          ? "暂无方案数据"
                          : planListSearch.trim()
                            ? "没有匹配当前关键字的方案，请尝试其它关键词或清空搜索框"
                            : "暂无方案数据"}
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {displayPlanRows.map((row, rowIndex) => {
                    const isSelected = selectedGlobalVersionCode === row.globalVersion
                    const rowGlobalRecord = globalRecordByVersionCode.get(row.globalVersion)
                    return (
                    <TableRow
                      key={row.id}
                      data-state={isSelected ? "selected" : undefined}
                      aria-selected={isSelected}
                      className="cursor-pointer data-[state=selected]:bg-primary/10 data-[state=selected]:hover:bg-primary/15"
                      onClick={() => setSelectedGlobalVersionCode((prev) => (prev === row.globalVersion ? "" : row.globalVersion))}
                      onDoubleClick={() => onRowDoubleClick(row)}
                    >
                      <TableCell>{rowIndex + 1}</TableCell>
                      <TableCell className="font-medium">{row.projectName}</TableCell>
                      <TableCell>{row.globalVersion}</TableCell>
                      <TableCell>{row.assessmentVersion}</TableCell>
                      <TableCell>{row.resourceVersion}</TableCell>
                      <TableCell>{row.requirementVersion}</TableCell>
                      <TableCell>{row.devVersion}</TableCell>
                      <TableCell>
                        <Badge
                          variant={row.status === "进行中" ? "default" : row.status === "待评审" ? "secondary" : "outline"}
                          className="rounded-lg"
                        >
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`rounded-lg ${getCheckoutStatusBadgeClass(rowGlobalRecord?.checkoutStatus)}`}
                        >
                          {getCheckoutStatusText(rowGlobalRecord?.checkoutStatus) || "已检入"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.updatedAt}</TableCell>
                    </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="space-y-6 xl:col-span-1">
            <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">快速操作</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {quickActions.map((action) => (
                  <Button key={action} variant="ghost" className="h-9 w-full justify-between rounded-lg px-3">
                    <span>{action}</span>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </Button>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">最近动态</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {recentActivities.map((item, index) => (
                  <div key={item} className="space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-md bg-accent/15 p-1.5">
                        <Sparkles className="size-3.5 text-accent-foreground" />
                      </div>
                      <p className="text-sm leading-6 text-muted-foreground">{item}</p>
                    </div>
                    {index < recentActivities.length - 1 ? <Separator /> : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </section>

        <Dialog
          open={createPlanWizardOpen}
          onOpenChange={(open) => {
            if (!open && !creating) setCreatePlanWizardOpen(false)
          }}
        >
          <DialogContent className="gap-0 border-border/60 p-0 sm:max-w-md" showCloseButton={!creating}>
            <DialogHeader className="space-y-2 border-b border-border/50 px-6 py-5">
              <DialogTitle>新建评估方案</DialogTitle>
              <DialogDescription>
                请先填写项目名称。创建完成后方案会出现在下方列表中；请再按顺序完善：需求 → 实施评估 → 开发评估 → 资源人天及成本。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-5 px-6 py-5">
              <div className="space-y-2">
                <Label htmlFor="dashboard-new-plan-name">项目名称</Label>
                <Input
                  id="dashboard-new-plan-name"
                  value={newProjectNameInput}
                  onChange={(e) => setNewProjectNameInput(e.target.value)}
                  placeholder="例如：XX 集团数字化项目（可留空，将使用「未命名项目」）"
                  className="h-11 rounded-xl border-border/60 bg-background"
                  autoComplete="off"
                  disabled={creating}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !creating) {
                      e.preventDefault()
                      void submitCreatePlanFromWizard()
                    }
                  }}
                />
              </div>
              <div className="rounded-xl border border-border/50 bg-secondary/25 p-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">建议完成顺序</p>
                <div className="flex flex-col gap-0">
                  {newPlanWorkflowSteps.map((item, i) => (
                    <div key={item.id}>
                      <div className="flex w-full items-start gap-3 rounded-lg border border-border/40 bg-card/80 px-3 py-3 text-left shadow-sm">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-foreground">
                          {item.step}
                        </span>
                        <item.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium leading-snug break-words text-foreground">{item.title}</p>
                          <p className="mt-0.5 text-xs leading-snug break-words text-muted-foreground">{item.hint}</p>
                        </div>
                      </div>
                      {i < newPlanWorkflowSteps.length - 1 ? (
                        <div className="flex justify-center py-1.5" aria-hidden>
                          <ChevronDown className="size-4 text-muted-foreground/70" />
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  创建成功后将弹出引导窗口，列出带当前总方案版本号的快捷入口；也可随时从左侧主菜单进入上述页面并选择总方案。
                </p>
              </div>
            </div>
            <DialogFooter className="gap-2 border-t border-border/50 bg-secondary/10 px-6 py-4 sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                disabled={creating}
                onClick={() => setCreatePlanWizardOpen(false)}
              >
                取消
              </Button>
              <Button
                type="button"
                className="rounded-xl bg-foreground text-background hover:bg-foreground/90"
                disabled={creating}
                onClick={() => void submitCreatePlanFromWizard()}
              >
                {creating ? "创建中…" : "创建方案"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={!!postCreateGuide}
          onOpenChange={(open) => {
            if (!open) setPostCreateGuide(null)
          }}
        >
          <DialogContent className="gap-0 border-primary/25 bg-primary/5 p-0 sm:max-w-lg">
            <DialogHeader className="space-y-2 px-6 pt-6 pr-14">
              <DialogTitle>下一步：按顺序完善方案内容</DialogTitle>
              <DialogDescription>
                {postCreateGuide
                  ? `已绑定总方案版本 ${postCreateGuide.versionCode}，点击下方入口将带上该版本（请在各页确认总方案选择）。`
                  : "请按顺序点击下方模块入口。"}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-2 px-6 pb-4 sm:grid-cols-2">
              {postCreateGuide
                ? newPlanWorkflowSteps.map((item) => {
                    const q = `globalVersion=${encodeURIComponent(postCreateGuide.versionCode)}`
                    return (
                      <Button
                        key={item.id}
                        asChild
                        variant="secondary"
                        size="sm"
                        className="h-auto min-h-9 w-full justify-start gap-2 rounded-lg border-border/60 bg-background py-2 whitespace-normal shadow-sm"
                      >
                        <Link
                          href={`${item.href}?${q}`}
                          className="flex w-full items-start gap-2"
                          onClick={() => setPostCreateGuide(null)}
                        >
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-semibold text-foreground">
                            {item.step}
                          </span>
                          <item.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 text-left text-sm leading-snug break-words">{item.title}</span>
                        </Link>
                      </Button>
                    )
                  })
                : null}
            </div>
            <DialogFooter className="gap-2 border-t border-primary/20 bg-background/50 px-6 py-4 sm:justify-end">
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => setPostCreateGuide(null)}>
                关闭
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={deletePlanDialogOpen} onOpenChange={setDeletePlanDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除该评估方案？</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-muted-foreground text-sm">
                  <p>
                    将删除总方案版本「{selectedGlobalRecord?.versionCode ?? "—"}」
                    {selectedPlanRow?.projectName ? `（${selectedPlanRow.projectName}）` : ""}
                    对应的版本记录。此操作不可恢复。
                  </p>
                  <p>若该方案仍处于检出状态，删除后未保存的检出内容将一并丢失。请确认后再继续。</p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletingPlan}>取消</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                className="rounded-xl"
                disabled={deletingPlan}
                onClick={() => void onConfirmDeletePlan()}
              >
                {deletingPlan ? "删除中…" : "确认删除"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={!!previewRow} onOpenChange={(open) => { if (!open) setPreviewRow(null) }}>
          <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>评估方案预览 · {previewRow?.projectName || "未命名项目"}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">版本号关联关系图（ER）</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="outline" size="sm" className="h-7 rounded-lg px-2" onClick={() => zoomGraph(-0.1)}>
                        -
                      </Button>
                      <span className="w-12 text-center text-xs text-muted-foreground">{Math.round(graphScale * 100)}%</span>
                      <Button type="button" variant="outline" size="sm" className="h-7 rounded-lg px-2" onClick={() => zoomGraph(0.1)}>
                        +
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="h-7 rounded-lg px-2" onClick={resetGraphView}>
                        重置
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 rounded-lg px-2"
                        onClick={onPreviewSelectedNode}
                        disabled={!selectedErNode || selectedErNode.value === "—"}
                      >
                        预览
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 rounded-lg px-2"
                        onClick={onModifySelectedNode}
                        disabled={!selectedErNode || selectedErNode.value === "—"}
                      >
                        修改
                      </Button>
                    </div>
                  </div>

                  <div
                    className={`relative h-[420px] overflow-hidden rounded-lg border border-border/60 bg-background select-none touch-none ${
                      draggingGraph ? "cursor-grabbing" : "cursor-grab"
                    }`}
                    onPointerDown={onGraphPointerDown}
                    onPointerMove={onGraphPointerMove}
                    onPointerUp={onGraphPointerUp}
                    onPointerCancel={onGraphPointerUp}
                    onPointerLeave={onGraphPointerUp}
                    onWheel={onGraphWheel}
                  >
                    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 860 420">
                      <g transform={`translate(${graphOffset.x} ${graphOffset.y}) scale(${graphScale})`}>
                        <line x1="430" y1="136" x2="130" y2="220" stroke="#94A3B8" strokeWidth="2" />
                        <line x1="430" y1="136" x2="340" y2="220" stroke="#94A3B8" strokeWidth="2" />
                        <line x1="430" y1="136" x2="550" y2="220" stroke="#94A3B8" strokeWidth="2" />
                        <line x1="430" y1="136" x2="760" y2="220" stroke="#94A3B8" strokeWidth="2" />

                        <rect x="320" y="60" width="220" height="76" rx="12" fill="#EFF6FF" stroke="#3B82F6" />
                        <text x="430" y="88" textAnchor="middle" fontSize="12" fill="#64748B">
                          总方案版本号
                        </text>
                        <text x="430" y="113" textAnchor="middle" fontSize="14" fontWeight="700" fill="#0F172A">
                          {trimSvgText(previewRow?.globalVersion || "—", 14)}
                        </text>

                        {previewRelations.map((node, idx) => {
                          const positions = [
                            { x: 40, y: 220 },
                            { x: 250, y: 220 },
                            { x: 460, y: 220 },
                            { x: 670, y: 220 },
                          ]
                          const pos = positions[idx]
                          const canOpen = Boolean(node.value && node.value !== "—")
                          const isHovered = hoveredErNodeKey === node.key
                          const isSelected = selectedErNodeKey === node.key
                          const expanded = Boolean(expandedErNodeKeys[node.key])
                          const historyRows = node.allowHistoryExpand ? node.historyVersions : []
                          const showHistoryPanel = expanded
                          const nodeHeight = showHistoryPanel ? 156 : 78
                          return (
                            <g
                              key={node.key}
                              data-er-node="true"
                              className={canOpen ? "cursor-pointer" : "cursor-not-allowed"}
                              onMouseEnter={() => setHoveredErNodeKey(node.key)}
                              onMouseLeave={() => setHoveredErNodeKey(null)}
                              onClick={() => setSelectedErNodeKey((prev) => (prev === node.key ? null : node.key))}
                              onDoubleClick={(event) => {
                                event.stopPropagation()
                                onOpenErModulePreview(node)
                              }}
                            >
                              <rect
                                x={pos.x}
                                y={pos.y}
                                width="180"
                                height={nodeHeight}
                                rx="12"
                                fill={isSelected ? "#DBEAFE" : isHovered ? "#EEF6FF" : "#F8FAFC"}
                                stroke={isSelected ? "#3B82F6" : isHovered ? "#93C5FD" : "#CBD5E1"}
                              />
                              <text x={pos.x + 90} y={pos.y + 27} textAnchor="middle" fontSize="12" fill="#64748B">
                                {trimSvgText(node.label, 12)}
                              </text>
                              <text x={pos.x + 90} y={pos.y + 53} textAnchor="middle" fontSize="13" fontWeight="600" fill="#0F172A">
                                {trimSvgText(node.value || "—", 12)}
                              </text>
                              {node.allowHistoryExpand ? (
                                <g
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    setExpandedErNodeKeys((prev) => ({ ...prev, [node.key]: !expanded }))
                                  }}
                                  style={{ cursor: "pointer" }}
                                >
                                  <rect
                                    x={pos.x + 156}
                                    y={pos.y + 10}
                                    width="14"
                                    height="14"
                                    rx="7"
                                    fill="#F1F5F9"
                                    stroke="#94A3B8"
                                  />
                                  <text
                                    x={pos.x + 163}
                                    y={pos.y + 20}
                                    textAnchor="middle"
                                    fontSize="11"
                                    fontWeight="700"
                                    fill="#334155"
                                  >
                                    {expanded ? "−" : "+"}
                                  </text>
                                </g>
                              ) : null}
                              {showHistoryPanel ? (
                                <>
                                  <rect
                                    x={pos.x + 10}
                                    y={pos.y + 86}
                                    width="160"
                                    height="62"
                                    rx="8"
                                    fill="#F8FAFC"
                                    stroke="#CBD5E1"
                                  />
                                  <foreignObject x={pos.x + 12} y={pos.y + 88} width="156" height="58">
                                    <div
                                      xmlns="http://www.w3.org/1999/xhtml"
                                      style={{
                                        height: "58px",
                                        overflowY: "auto",
                                        overflowX: "hidden",
                                        fontSize: "11px",
                                        lineHeight: "16px",
                                        color: "#475569",
                                        paddingRight: "4px",
                                      }}
                                    >
                                      {historyRows.length ? (
                                        historyRows.map((historyVersion, historyIdx) => (
                                          <div key={`${node.key}-history-${historyVersion}-${historyIdx}`}>
                                            {"- "}
                                            {trimSvgText(historyVersion, 20)}
                                          </div>
                                        ))
                                      ) : (
                                        <div style={{ color: "#94A3B8" }}>暂无历史版本</div>
                                      )}
                                    </div>
                                  </foreignObject>
                                </>
                              ) : null}
                            </g>
                          )
                        })}
                      </g>
                    </svg>
                  </div>
                </div>
              </section>

            </div>
          </DialogContent>
        </Dialog>
        <Dialog
          open={!!erModulePreview}
          onOpenChange={(open) => {
            if (!open) setErModulePreview(null)
          }}
        >
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
            <DialogHeader>
              <DialogTitle>{erModulePreview ? `${erModulePreview.label} · ${erModulePreview.version}` : "模块内容预览"}</DialogTitle>
            </DialogHeader>
            <div className="rounded-lg border border-border/60 bg-background p-1">
              {erModulePreview ? (
                <iframe
                  title={`${erModulePreview.label}内容预览`}
                  src={erModulePreview.src}
                  className="h-[70vh] w-full rounded-md border-0"
                />
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
        <VersionHistoryDialog
          open={versionHistoryOpen}
          onOpenChange={setVersionHistoryOpen}
          title="总方案版本历史"
          description="按更新时间由新到旧排列，含已归档版本。"
          rows={recordsToVersionHistoryRows(globalRecords)}
          highlightVersionCode={selectedGlobalVersionCode.trim() || undefined}
        />
    </ModuleShell>
  )
}
