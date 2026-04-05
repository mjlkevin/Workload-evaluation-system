"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { ModuleShell } from "@/components/workload/module-shell"
import { VersionVcsToolbar } from "@/components/workload/version-vcs-toolbar"
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
import { toast } from "sonner"

type ResourceRow = {
  id: string
  role: string
  name: string
  unitCost: number
  plannedDays: number
  trafficCount: number
  trafficUnitCost: number
  stayDays: number
  stayUnitCost: number
  allowanceDays: number
  allowanceUnitCost: number
  monthDays: number[]
}

function createEmptyRow(monthCount: number): ResourceRow {
  return {
    id: crypto.randomUUID(),
    role: "实施顾问",
    name: "",
    unitCost: 0,
    plannedDays: 0,
    trafficCount: 0,
    trafficUnitCost: 0,
    stayDays: 0,
    stayUnitCost: 0,
    allowanceDays: 0,
    allowanceUnitCost: 0,
    monthDays: Array.from({ length: monthCount }, () => 0),
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

function buildVersionOptions(records: ModuleVersionRecord[], showHistorical: boolean) {
  return records
    .filter((x) => showHistorical || !x.isHistoricalArchive)
    .map((x) => ({ value: x.versionCode, label: `${x.versionCode}（${x.updatedAt}）` }))
}

export default function ResourceCostPage() {
  const { isAdmin } = useAuth()
  const [monthCount, setMonthCount] = useState(3)
  const [includeTravel, setIncludeTravel] = useState(true)
  const [rows, setRows] = useState<ResourceRow[]>([createEmptyRow(3)])
  const [globalVersionCode, setGlobalVersionCode] = useState("")
  const [linkedAssessmentVersionCode, setLinkedAssessmentVersionCode] = useState("")
  const [globalOptions, setGlobalOptions] = useState<Array<{ value: string; label: string }>>([])
  const [assessmentOptions, setAssessmentOptions] = useState<Array<{ value: string; label: string }>>([])
  const [versionOptions, setVersionOptions] = useState<Array<{ value: string; label: string }>>([])
  const [versionRecords, setVersionRecords] = useState<ModuleVersionRecord[]>([])
  const [showHistoricalVersions, setShowHistoricalVersions] = useState(false)
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

  const { setDirty } = useUnsavedChanges()
  const dirtyEnabled = useRef(false)

  function showGlobalNotice(text: string) {
    toast(text)
  }

  function showGlobalWarning(text: string) {
    toast.warning(text)
  }

  useEffect(() => {
    void (async () => {
      try {
        const [plans, assessments, resources] = await Promise.all([
          getDashboardPlans(),
          listModuleVersions("assessment"),
          listModuleVersions("resource"),
        ])
        setGlobalOptions(plans.map((x) => ({ value: x.globalVersion, label: `${x.globalVersion}（${x.projectName}）` })))
        setAssessmentOptions(assessments.map((x) => ({ value: x.versionCode, label: `${x.versionCode}（${x.updatedAt}）` })))
        setVersionRecords(resources)
        setVersionOptions(buildVersionOptions(resources, showHistoricalVersions))
      } catch (err) {
        const msg = err instanceof Error ? err.message : "初始化失败"
        setError(msg)
        showGlobalWarning(msg)
      } finally {
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
  }, [rows, monthCount, includeTravel])

  useEffect(() => {
    setRows((items) =>
      items.map((row) => ({
        ...row,
        monthDays: Array.from({ length: monthCount }, (_, idx) => Number(row.monthDays[idx] || 0)),
      })),
    )
  }, [monthCount])

  const monthColumns = useMemo(() => {
    const now = new Date()
    return Array.from({ length: monthCount }, (_, idx) => {
      const d = new Date(now.getFullYear(), now.getMonth() + idx, 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    })
  }, [monthCount])

  function travelCost(row: ResourceRow) {
    return includeTravel
      ? row.trafficCount * row.trafficUnitCost + row.stayDays * row.stayUnitCost + row.allowanceDays * row.allowanceUnitCost
      : 0
  }

  function rowSubtotal(row: ResourceRow) {
    return row.unitCost * row.plannedDays + travelCost(row)
  }

  const totalCost = useMemo(
    () => rows.reduce((sum, x) => sum + rowSubtotal(x), 0),
    [rows, includeTravel],
  )
  const totalDays = useMemo(() => rows.reduce((sum, x) => sum + Number(x.plannedDays || 0), 0), [rows])
  const monthTotals = useMemo(() => {
    return Array.from({ length: monthCount }, (_, idx) => rows.reduce((sum, row) => sum + Number(row.monthDays[idx] || 0), 0))
  }, [rows, monthCount])

  async function reloadVersions(nextSelected?: string) {
    const records = await listModuleVersions("resource")
    setVersionRecords(records)
    setVersionOptions(buildVersionOptions(records, showHistoricalVersions))
    if (nextSelected) setCurrentVersionCode(nextSelected)
  }

  function currentPayload() {
    return {
      globalVersionCode,
      selectedEstimateVersionCode: linkedAssessmentVersionCode,
      includeTravel,
      monthCount,
      rows,
      totalDays,
      totalCost,
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

  async function onCheckin() {
    if (!selectedVersionRecord) return
    try {
      const data = await checkinVersionById(selectedVersionRecord.id, currentPayload())
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

  async function onLoadVersion(code: string) {
    setCurrentVersionCode(code)
    if (!code) return
    try {
      const records = await listModuleVersions("resource")
      const target = records.find((x) => x.versionCode === code)
      if (!target) return
      const payload = target.payload || {}
      const nextMonthCount = Number(payload.monthCount || 3)
      const nextRows = (Array.isArray(payload.rows) ? payload.rows : []) as ResourceRow[]
      dirtyEnabled.current = false
      setGlobalVersionCode((payload.globalVersionCode as string) || "")
      setLinkedAssessmentVersionCode((payload.selectedEstimateVersionCode as string) || "")
      setIncludeTravel(Boolean(payload.includeTravel))
      setMonthCount(nextMonthCount)
      setRows(
        nextRows.length
          ? nextRows.map((x) => ({
              ...x,
              id: x.id || crypto.randomUUID(),
              monthDays: Array.from({ length: nextMonthCount }, (_, i) => Number(x.monthDays?.[i] || 0)),
            }))
          : [createEmptyRow(nextMonthCount)],
      )
      showGlobalNotice(`已回读版本：${code}`)
      setDirty(false)
      setTimeout(() => { dirtyEnabled.current = true }, 0)
      setError("")
    } catch (err) {
      const msg = err instanceof Error ? err.message : "版本回读失败"
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
        "resource",
        {
          globalVersionCode,
          selectedEstimateVersionCode: linkedAssessmentVersionCode,
          includeTravel,
          monthCount,
          rows,
          totalDays,
          totalCost,
        },
        "RS",
      )
      await reloadVersions(created.versionCode)
      showGlobalNotice(`已保存资源成本版本：${created.versionCode}`)
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
      ["角色", "姓名", "单价", "计划人天", "差旅成本", "小计", ...monthColumns],
      ...rows.map((row) => [
        row.role,
        row.name,
        String(row.unitCost),
        String(row.plannedDays),
        String(travelCost(row)),
        String(rowSubtotal(row)),
        ...monthColumns.map((_, i) => String(row.monthDays[i] || 0)),
      ]),
      [
        "合计",
        "-",
        "-",
        totalDays.toFixed(1),
        rows.reduce((sum, row) => sum + travelCost(row), 0).toFixed(0),
        totalCost.toFixed(0),
        ...monthTotals.map((x) => x.toFixed(1)),
      ],
    ]
    downloadCsv(`resource-cost-${currentVersionCode || Date.now()}.csv`, data)
    showGlobalNotice("资源成本已导出 CSV")
  }

  return (
    <ModuleShell
      title="资源人天及成本"
      description="资源行编辑、月度分配、差旅核算、版本保存与导出。"
      breadcrumbs={[{ label: "资源人天及成本" }]}
    >
      <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
        <CardHeader className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
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
              <p className="text-xs text-muted-foreground">关联实施评估版本</p>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={linkedAssessmentVersionCode}
                onChange={(e) => setLinkedAssessmentVersionCode(e.target.value)}
              >
                <option value="">可选，不关联</option>
                {assessmentOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">资源成本版本号</p>
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
            <div className="flex items-end gap-2">
              <Button variant="outline" className="rounded-xl" onClick={() => setMonthCount((x) => x + 1)}>
                增加投入月
              </Button>
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={() => setMonthCount((x) => Math.max(1, x - 1))}
                disabled={monthCount <= 1}
              >
                减少投入月
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setIncludeTravel((v) => !v)}>
              {includeTravel ? "不含差旅" : "含差旅"}
            </Button>
            <Button variant="outline" className="rounded-xl" onClick={() => setRows((x) => [...x, createEmptyRow(monthCount)])}>
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
              showHistory={showHistoricalVersions}
              onToggleHistory={() => setShowHistoricalVersions((v) => !v)}
              onCheckout={() => void onCheckout()}
              onCheckin={() => void onCheckin()}
              onUndoCheckout={() => void onUndoCheckout()}
              onPromote={() => void onPromote()}
              onForceUnlock={() => void onForceUnlock()}
              forceUnlockVisible={isAdmin}
            />
            <Button className="rounded-xl" variant="outline" onClick={onExportCsv}>
              导出成本清单
            </Button>
            {error ? <span className="text-xs text-destructive">{error}</span> : null}
          </div>
          {isReadonly ? (
            <p className="text-xs text-muted-foreground">当前版本为只读状态，请先检出后编辑。</p>
          ) : null}
        </CardHeader>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">资源成本明细</CardTitle>
          </div>
        </CardHeader>
        <fieldset disabled={isReadonly}>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-border/40 bg-secondary/20 px-4 py-3 text-sm">
            总人天：<span className="font-semibold">{totalDays.toFixed(1)}</span>，总成本估算：
            <span className="font-semibold"> ¥ {totalCost.toLocaleString()}</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>角色</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead>单价(元/天)</TableHead>
                <TableHead>计划人天</TableHead>
                <TableHead>差旅成本(元)</TableHead>
                <TableHead>小计(元)</TableHead>
                {monthColumns.map((month) => (
                  <TableHead key={month}>{month}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const subtotal = rowSubtotal(row)
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Input value={row.role} onChange={(e) => setRows((items) => items.map((x) => (x.id === row.id ? { ...x, role: e.target.value } : x)))} />
                    </TableCell>
                    <TableCell className="font-medium">
                      <Input value={row.name} onChange={(e) => setRows((items) => items.map((x) => (x.id === row.id ? { ...x, name: e.target.value } : x)))} />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        value={row.unitCost}
                        onChange={(e) => setRows((items) => items.map((x) => (x.id === row.id ? { ...x, unitCost: Number(e.target.value || 0) } : x)))}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        step="0.1"
                        value={row.plannedDays}
                        onChange={(e) => setRows((items) => items.map((x) => (x.id === row.id ? { ...x, plannedDays: Number(e.target.value || 0) } : x)))}
                      />
                    </TableCell>
                    <TableCell>{travelCost(row).toLocaleString()}</TableCell>
                    <TableCell>{subtotal.toLocaleString()}</TableCell>
                    {monthColumns.map((_, idx) => (
                      <TableCell key={`${row.id}-${idx}`}>
                        <Input
                          type="number"
                          min={0}
                          step="0.1"
                          value={row.monthDays[idx] || 0}
                          onChange={(e) =>
                            setRows((items) =>
                              items.map((x) =>
                                x.id === row.id
                                  ? {
                                      ...x,
                                      monthDays: Array.from({ length: monthCount }, (_, i) =>
                                        i === idx ? Number(e.target.value || 0) : Number(x.monthDays[i] || 0),
                                      ),
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
        </fieldset>
      </Card>
    </ModuleShell>
  )
}
