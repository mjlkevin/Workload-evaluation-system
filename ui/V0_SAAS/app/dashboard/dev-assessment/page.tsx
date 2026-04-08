"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { shouldSuppressUnsavedPrompt, useSetUnsavedDirty } from "@/hooks/use-unsaved-changes"
import { ModuleShell } from "@/components/workload/module-shell"
import { VersionVcsToolbar } from "@/components/workload/version-vcs-toolbar"
import { recordsToVersionHistoryRows, VersionHistoryDialog } from "@/components/workload/version-history-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/hooks/use-auth"
import {
  checkinVersionById,
  checkoutVersionById,
  createModuleVersion,
  forceUnlockById,
  getDashboardPlans,
  listModuleVersions,
  type ModuleVersionRecord,
  promoteVersionById,
  undoCheckoutById,
} from "@/lib/workload-service"
import type { PlanRow } from "@/lib/workload-types"
import { toast } from "sonner"
import { createClientRowId } from "@/lib/utils"

type DevRow = {
  id: string
  moduleName: string
  devType: "功能开发" | "报表开发" | "集成开发"
  functionDesc: string
  estimateBasis: string
  codingDays: number
}

function createEmptyDevRow(): DevRow {
  return {
    id: createClientRowId(),
    moduleName: "",
    devType: "功能开发",
    functionDesc: "",
    estimateBasis: "",
    codingDays: 0,
  }
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((line) => line.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n")
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function buildVersionOptions(records: ModuleVersionRecord[]) {
  return records.map((x) => ({ value: x.versionCode, label: `${x.versionCode}（${x.updatedAt}）` }))
}

export default function DevAssessmentPage() {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState<DevRow[]>([createEmptyDevRow()])
  const [evaluator, setEvaluator] = useState("")
  const [evaluateDate, setEvaluateDate] = useState(new Date().toISOString().slice(0, 10))
  const [globalVersionCode, setGlobalVersionCode] = useState("")
  const [dashboardPlans, setDashboardPlans] = useState<PlanRow[]>([])
  const [projectName, setProjectName] = useState("")
  const [linkedAssessmentVersionCode, setLinkedAssessmentVersionCode] = useState("")
  const [globalOptions, setGlobalOptions] = useState<Array<{ value: string; label: string }>>([])
  const [assessmentOptions, setAssessmentOptions] = useState<Array<{ value: string; label: string }>>([])
  const [versionOptions, setVersionOptions] = useState<Array<{ value: string; label: string }>>([])
  const [versionRecords, setVersionRecords] = useState<ModuleVersionRecord[]>([])
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false)
  const [currentVersionCode, setCurrentVersionCode] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const selectedVersionRecord = useMemo(
    () => versionRecords.find((x) => x.versionCode === currentVersionCode),
    [versionRecords, currentVersionCode],
  )
  const isReadonly = Boolean(
    selectedVersionRecord &&
      (selectedVersionRecord.checkoutStatus === "checked_in" || selectedVersionRecord.versionDocStatus === "reviewed"),
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

  useEffect(() => {
    void (async () => {
      try {
        const [plans, assessments, devs] = await Promise.all([
          getDashboardPlans(),
          listModuleVersions("assessment"),
          listModuleVersions("dev"),
        ])
        setDashboardPlans(plans)
        setGlobalOptions(plans.map((x) => ({ value: x.globalVersion, label: `${x.globalVersion}（${x.projectName}）` })))
        setAssessmentOptions(assessments.map((x) => ({ value: x.versionCode, label: `${x.versionCode}（${x.updatedAt}）` })))
        setVersionRecords(devs)
        setVersionOptions(buildVersionOptions(devs))
        const initialQuery = initialEmbedQueryRef.current
        if (!initialEmbedAppliedRef.current && initialQuery) {
          if (initialQuery.globalVersion) {
            setGlobalVersionCode(initialQuery.globalVersion)
            const plan = plans.find((p) => p.globalVersion === initialQuery.globalVersion)
            if (plan?.projectName) setProjectName(plan.projectName)
          }
          if (initialQuery.version) await onLoadVersion(initialQuery.version, plans)
          initialEmbedAppliedRef.current = true
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "初始化失败"
        setError(msg)
        showGlobalWarning(msg)
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
      return
    }
    setDirty(true)
  }, [rows, evaluator, evaluateDate, globalVersionCode, linkedAssessmentVersionCode, projectName, suppressUnsavedPrompt])

  const summary = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        const coding = Number(row.codingDays || 0)
        acc.coding += coding
        acc.planning += coding * 0.2
        acc.testing += coding * 0.4
        acc.total += coding * 1.6
        return acc
      },
      { coding: 0, planning: 0, testing: 0, total: 0 },
    )
  }, [rows])

  async function reloadVersions(nextSelected?: string) {
    const records = await listModuleVersions("dev")
    setVersionRecords(records)
    setVersionOptions(buildVersionOptions(records))
    if (nextSelected) setCurrentVersionCode(nextSelected)
  }

  function currentPayload(checkinNote?: string) {
    return {
      globalVersionCode,
      projectName: projectName.trim(),
      selectedEstimateVersionCode: linkedAssessmentVersionCode,
      evaluator,
      evaluateDate,
      rows,
      ...(checkinNote ? { checkinNote } : {}),
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

  async function onCheckin(checkinNote: string) {
    if (!selectedVersionRecord) return
    try {
      const data = await checkinVersionById(selectedVersionRecord.id, currentPayload(checkinNote))
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
      const records = await listModuleVersions("dev")
      const target = records.find((x) => x.versionCode === code)
      if (!target) return
      const payload = target.payload || {}
      const plansLookup = plansOverride ?? dashboardPlans
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
      setLinkedAssessmentVersionCode((payload.selectedEstimateVersionCode as string) || "")
      setEvaluator((payload.evaluator as string) || "")
      setEvaluateDate((payload.evaluateDate as string) || new Date().toISOString().slice(0, 10))
      const nextRows = (Array.isArray(payload.rows) ? payload.rows : []) as DevRow[]
      setRows(nextRows.length ? nextRows.map((x) => ({ ...x, id: x.id || createClientRowId(), codingDays: Number(x.codingDays || 0) })) : [createEmptyDevRow()])
      showGlobalNotice(`已回读版本：${code}`)
      setDirty(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "回读失败"
      setError(msg)
      showGlobalWarning(msg)
    }
  }

  async function onSave() {
    if (!globalVersionCode.trim()) {
      const msg = "请先选择总方案版本号"
      setError(msg)
      showGlobalWarning(msg)
      return
    }
    setSaving(true)
    setError("")
    try {
      const created = await createModuleVersion(
        "dev",
        {
          globalVersionCode,
          projectName: projectName.trim(),
          selectedEstimateVersionCode: linkedAssessmentVersionCode,
          evaluator,
          evaluateDate,
          rows,
        },
        "DV",
      )
      await reloadVersions(created.versionCode)
      showGlobalNotice(`已保存开发评估版本：${created.versionCode}`)
      setDirty(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "保存失败"
      setError(msg)
      showGlobalWarning(msg)
    } finally {
      setSaving(false)
    }
  }

  function onExportCsv() {
    const data: string[][] = [
      ["模块", "开发类型", "功能说明", "估算依据", "编码人天", "需求规划(20%)", "功能测试(40%)", "合计"],
      ...rows.map((row) => [
        row.moduleName,
        row.devType,
        row.functionDesc,
        row.estimateBasis,
        String(row.codingDays),
        String((row.codingDays * 0.2).toFixed(1)),
        String((row.codingDays * 0.4).toFixed(1)),
        String((row.codingDays * 1.6).toFixed(1)),
      ]),
      ["合计", "-", "-", "-", summary.coding.toFixed(1), summary.planning.toFixed(1), summary.testing.toFixed(1), summary.total.toFixed(1)],
    ]
    const nameSlug = (projectName.trim() || "未命名项目").replace(/[/\\?%*:|"<>]/g, "-").slice(0, 48)
    downloadCsv(`dev-assessment-${nameSlug}-${currentVersionCode || Date.now()}.csv`, data)
    showGlobalNotice("开发评估已导出 CSV")
  }

  return (
    <ModuleShell
      title="开发评估"
      description="开发项录入、联动计算、版本读写与导出。"
      breadcrumbs={[{ label: "开发评估" }]}
    >
      <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">版本与参数</CardTitle>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">项目名称</p>
            <Input
              className="h-9"
              value={projectName}
              placeholder="未选总方案时请填写；选择总方案后将自动带出，可再修改"
              onChange={(e) => setProjectName(e.target.value)}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">总方案版本号</p>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
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
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">关联实施评估版本</p>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={linkedAssessmentVersionCode}
                onChange={(e) => setLinkedAssessmentVersionCode(e.target.value)}
              >
                <option value="">不关联</option>
                {assessmentOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">开发评估版本号</p>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={currentVersionCode}
                onChange={(e) => void onLoadVersion(e.target.value)}
              >
                <option value="">请选择版本回读</option>
                {versionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <Input value={evaluator} onChange={(e) => setEvaluator(e.target.value)} placeholder="评估人" />
            <Input type="date" value={evaluateDate} onChange={(e) => setEvaluateDate(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setRows((x) => [...x, createEmptyDevRow()])}>
              新增行
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
              onVersionHistory={() => setVersionHistoryOpen(true)}
              onCheckout={() => void onCheckout()}
              onCheckin={(checkinNote) => void onCheckin(checkinNote)}
              onUndoCheckout={() => void onUndoCheckout()}
              onPromote={() => void onPromote()}
              onForceUnlock={() => void onForceUnlock()}
              forceUnlockVisible={isAdmin}
            />
            <Button variant="outline" className="rounded-xl" onClick={onExportCsv}>
              导出 CSV
            </Button>
            {error ? <span className="text-xs text-destructive">{error}</span> : null}
          </div>
          {isReadonly ? (
            <p className="text-xs text-muted-foreground">当前版本为只读状态，请先检出后编辑。</p>
          ) : null}
          <div className="rounded-md border border-border/60 bg-secondary/30 px-3 py-2 text-sm">
            项目 {projectName.trim() || "未填写"} · 编码人天 {summary.coding.toFixed(1)}，需求规划 {summary.planning.toFixed(1)}，功能测试{" "}
            {summary.testing.toFixed(1)}，总计 {summary.total.toFixed(1)}
          </div>
          <CardTitle className="text-base">开发项评估明细</CardTitle>
        </CardHeader>
        <fieldset disabled={isReadonly}>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>模块</TableHead>
                <TableHead>开发类型</TableHead>
                <TableHead>功能说明</TableHead>
                <TableHead>编码人天</TableHead>
                <TableHead>需求规划(20%)</TableHead>
                <TableHead>功能测试(40%)</TableHead>
                <TableHead>合计</TableHead>
                <TableHead>估算依据</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    <Input value={row.moduleName} onChange={(e) => setRows((items) => items.map((x) => (x.id === row.id ? { ...x, moduleName: e.target.value } : x)))} />
                  </TableCell>
                  <TableCell>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={row.devType}
                      onChange={(e) =>
                        setRows((items) =>
                          items.map((x) =>
                            x.id === row.id ? { ...x, devType: e.target.value as DevRow["devType"] } : x,
                          ),
                        )
                      }
                    >
                      <option value="功能开发">功能开发</option>
                      <option value="报表开发">报表开发</option>
                      <option value="集成开发">集成开发</option>
                    </select>
                  </TableCell>
                  <TableCell>
                    <textarea
                      className="min-h-14 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={row.functionDesc}
                      onChange={(e) => setRows((items) => items.map((x) => (x.id === row.id ? { ...x, functionDesc: e.target.value } : x)))}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      step="0.1"
                      value={row.codingDays}
                      onChange={(e) => setRows((items) => items.map((x) => (x.id === row.id ? { ...x, codingDays: Number(e.target.value || 0) } : x)))}
                    />
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{(row.codingDays * 0.2).toFixed(1)}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{(row.codingDays * 0.4).toFixed(1)}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{(row.codingDays * 1.6).toFixed(1)}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <textarea
                      className="min-h-14 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={row.estimateBasis}
                      onChange={(e) =>
                        setRows((items) => items.map((x) => (x.id === row.id ? { ...x, estimateBasis: e.target.value } : x)))
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
        </fieldset>
      </Card>
      <VersionHistoryDialog
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        title="开发评估版本历史"
        description="按更新时间由新到旧排列，含已归档版本。"
        rows={recordsToVersionHistoryRows(versionRecords)}
        highlightVersionCode={currentVersionCode.trim() || undefined}
      />
    </ModuleShell>
  )
}
