"use client"

import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react"
import { ModuleShell } from "@/components/workload/module-shell"
import { VersionVcsToolbar } from "@/components/workload/version-vcs-toolbar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowRight, ClipboardCheck, FolderGit2, Layers, Plus, Sparkles, Users } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import {
  checkinVersionById,
  checkoutVersionById,
  createGlobalPlanVersion,
  forceUnlockById,
  getDashboardPlans,
  listGlobalVersions,
  promoteVersionById,
  undoCheckoutById,
  type GlobalVersionRecord,
} from "@/lib/workload-service"
import type { PlanRow } from "@/lib/workload-types"

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

export default function DashboardPage() {
  const { isAdmin } = useAuth()
  const [planRows, setPlanRows] = useState<PlanRow[]>([])
  const [globalRecords, setGlobalRecords] = useState<GlobalVersionRecord[]>([])
  const [selectedGlobalVersionCode, setSelectedGlobalVersionCode] = useState("")
  const [showHistoricalVersions, setShowHistoricalVersions] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createMessage, setCreateMessage] = useState("")
  const [previewRow, setPreviewRow] = useState<PlanRow | null>(null)
  const [graphOffset, setGraphOffset] = useState({ x: 0, y: 0 })
  const [graphScale, setGraphScale] = useState(1)
  const [draggingGraph, setDraggingGraph] = useState(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)

  const loadPlans = () => {
    void Promise.all([getDashboardPlans(), listGlobalVersions()]).then(([plans, globals]) => {
      setGlobalRecords(globals)
      const filtered = plans.filter((row) => {
        const record = globals.find((x) => x.versionCode === row.globalVersion)
        return showHistoricalVersions || !record?.isHistoricalArchive
      })
      setPlanRows(filtered)
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
  }, [showHistoricalVersions])

  useEffect(() => {
    if (!previewRow) return
    setGraphOffset({ x: 0, y: 0 })
    setGraphScale(1)
    setDraggingGraph(false)
    setDragStart(null)
  }, [previewRow?.id])

  async function onCreatePlan() {
    setCreating(true)
    setCreateMessage("")
    try {
      const created = await createGlobalPlanVersion()
      setCreateMessage(`已创建版本：${created.versionCode}`)
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

  async function onCheckin() {
    if (!selectedGlobalRecord) return
    try {
      const data = await checkinVersionById(selectedGlobalRecord.id, selectedGlobalRecord.payload || {})
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

  function formatDateTimeText(value: string) {
    if (!value || value === "—") return "—"
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return value
    return d.toLocaleString("zh-CN", { hour12: false })
  }

  const previewTimeline = useMemo(
    () => [
      { key: "created", label: "创建时间", value: formatDateTimeText(previewRow?.createdAt || "") },
      { key: "updated", label: "最新修改时间", value: formatDateTimeText(previewRow?.updatedAt || "") },
      { key: "reviewed", label: "审核时间", value: formatDateTimeText(previewRow?.reviewedAt || "") },
    ],
    [previewRow],
  )

  const previewRelations = useMemo(
    () => [
      { key: "requirement", label: "需求版本号", value: previewRow?.requirementVersion || "—" },
      { key: "assessment", label: "实施评估版本号", value: previewRow?.assessmentVersion || "—" },
      { key: "resource", label: "资源版本号", value: previewRow?.resourceVersion || "—" },
      { key: "dev", label: "开发版本号", value: previewRow?.devVersion || "—" },
    ],
    [previewRow],
  )

  function zoomGraph(step: number) {
    setGraphScale((prev) => Math.max(0.8, Math.min(1.8, Number((prev + step).toFixed(2)))))
  }

  function resetGraphView() {
    setGraphOffset({ x: 0, y: 0 })
    setGraphScale(1)
  }

  function onGraphPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
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

  return (
    <ModuleShell
      title="主页"
      description="按当前系统语义重绘：总览、方案版本关系、关键指标与近期协作动态。"
      breadcrumbs={[{ label: "主页" }]}
    >

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {overviewCards.map((item, index) => (
            <Card key={item.label} className="border-border/40 bg-card/50 backdrop-blur-sm">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-center justify-between">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-secondary">
                    <item.icon className="size-5 text-muted-foreground" />
                  </div>
                  <Badge variant="outline" className="rounded-lg text-[11px]">
                    实时
                  </Badge>
                </div>
                <div>
                  <p className="text-2xl font-semibold">
                    {index === 0
                      ? summary.totalPlans
                      : index === 1
                        ? summary.requirementCount
                        : index === 2
                          ? summary.assessmentDays
                          : summary.onlineMembers}
                  </p>
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                </div>
                <Progress value={Math.min(100, 45 + index * 14 + summary.activeCount * 3)} className="h-1.5" />
                <p className="text-xs text-muted-foreground">
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

        <section className="grid gap-6 lg:grid-cols-3">
          <Card collapsible={false} className="border-border/40 bg-card/50 backdrop-blur-sm lg:col-span-2">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>评估方案列表</CardTitle>
                  <CardDescription>双击列表行打开预览弹窗</CardDescription>
                </div>
                <Button
                  className="rounded-xl gap-2 bg-foreground text-background hover:bg-foreground/90"
                  onClick={onCreatePlan}
                  disabled={creating}
                >
                  <Plus className="size-4" />
                  {creating ? "创建中..." : "新建方案"}
                </Button>
                <VersionVcsToolbar
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
                  showHistory={showHistoricalVersions}
                  onToggleHistory={() => setShowHistoricalVersions((v) => !v)}
                  onCheckout={() => void onCheckout()}
                  onCheckin={() => void onCheckin()}
                  onUndoCheckout={() => void onUndoCheckout()}
                  onPromote={() => void onPromote()}
                  onForceUnlock={() => void onForceUnlock()}
                  forceUnlockVisible={isAdmin}
                />
              </div>
            </CardHeader>
            <CardContent>
              {createMessage ? (
                <p className="mb-3 rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
                  {createMessage}
                </p>
              ) : null}
              <Table>
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
                    <TableHead>更新时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {planRows.map((row, rowIndex) => (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedGlobalVersionCode(row.globalVersion)}
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
                      <TableCell className="text-muted-foreground">{row.updatedAt}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="space-y-6">
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

        <Dialog open={!!previewRow} onOpenChange={(open) => { if (!open) setPreviewRow(null) }}>
          <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>评估方案预览 · {previewRow?.projectName || "未命名项目"}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <section className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">0、时间信息</h3>
                <div className="grid gap-3 md:grid-cols-3">
                  {previewTimeline.map((item) => (
                    <article key={item.key} className="rounded-lg border border-border/60 bg-background p-3">
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                      <p className="mt-1 text-sm font-medium">{item.value}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">1、版本号关联关系图（ER）</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">支持拖拽查看，点击控件可缩放与重置视图。</p>
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
                  >
                    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 860 420">
                      <g transform={`translate(${graphOffset.x} ${graphOffset.y}) scale(${graphScale})`}>
                        <line x1="430" y1="136" x2="170" y2="220" stroke="#94A3B8" strokeWidth="2" />
                        <line x1="430" y1="136" x2="350" y2="220" stroke="#94A3B8" strokeWidth="2" />
                        <line x1="430" y1="136" x2="530" y2="220" stroke="#94A3B8" strokeWidth="2" />
                        <line x1="430" y1="136" x2="710" y2="220" stroke="#94A3B8" strokeWidth="2" />

                        <rect x="320" y="60" width="220" height="76" rx="12" fill="#EFF6FF" stroke="#3B82F6" />
                        <text x="430" y="88" textAnchor="middle" fontSize="12" fill="#64748B">
                          总方案版本号
                        </text>
                        <text x="430" y="113" textAnchor="middle" fontSize="14" fontWeight="700" fill="#0F172A">
                          {previewRow?.globalVersion || "—"}
                        </text>

                        {previewRelations.map((node, idx) => {
                          const positions = [
                            { x: 70, y: 220 },
                            { x: 250, y: 220 },
                            { x: 430, y: 220 },
                            { x: 610, y: 220 },
                          ]
                          const pos = positions[idx]
                          return (
                            <g key={node.key}>
                              <rect
                                x={pos.x}
                                y={pos.y}
                                width="180"
                                height="78"
                                rx="12"
                                fill="#F8FAFC"
                                stroke="#CBD5E1"
                              />
                              <text x={pos.x + 90} y={pos.y + 27} textAnchor="middle" fontSize="12" fill="#64748B">
                                {node.label}
                              </text>
                              <text x={pos.x + 90} y={pos.y + 53} textAnchor="middle" fontSize="13" fontWeight="600" fill="#0F172A">
                                {node.value || "—"}
                              </text>
                            </g>
                          )
                        })}
                      </g>
                    </svg>
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">2、已关联模块概览</h3>
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="rounded-lg border border-border/60 bg-background p-3 text-sm">
                    <p className="font-medium">需求概览</p>
                    <p className="mt-1 text-muted-foreground">版本号：{previewRow?.requirementVersion || "—"}</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-background p-3 text-sm">
                    <p className="font-medium">实施评估概览</p>
                    <p className="mt-1 text-muted-foreground">版本号：{previewRow?.assessmentVersion || "—"}</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-background p-3 text-sm">
                    <p className="font-medium">资源人天概览</p>
                    <p className="mt-1 text-muted-foreground">版本号：{previewRow?.resourceVersion || "—"}</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-background p-3 text-sm">
                    <p className="font-medium">开发评估概览</p>
                    <p className="mt-1 text-muted-foreground">版本号：{previewRow?.devVersion || "—"}</p>
                  </div>
                </div>
              </section>
            </div>
          </DialogContent>
        </Dialog>
    </ModuleShell>
  )
}
