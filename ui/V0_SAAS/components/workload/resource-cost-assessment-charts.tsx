"use client"

import { useMemo } from "react"
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"

import type { EstimateResult } from "@/lib/workload-service"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

const PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-1)",
]

export type CostPieRow = { name: string; value: number }

/** 饼图下方自定义图例 */
function PieLegendBlock({
  rows,
  colorOffset = 0,
  columnsClass = "sm:grid-cols-2",
  formatValue,
}: {
  rows: CostPieRow[]
  colorOffset?: number
  columnsClass?: string
  /** 默认按人天展示 */
  formatValue?: (v: number) => string
}) {
  const fmt = formatValue ?? ((v: number) => formatDays(v))
  if (rows.length === 0) return null
  return (
    <ul
      className={cn(
        "mt-1 grid max-h-[7.5rem] gap-x-3 gap-y-1.5 overflow-y-auto overscroll-y-contain pr-0.5 text-[11px] leading-snug",
        "grid-cols-1",
        columnsClass,
      )}
    >
      {rows.map((row, i) => (
        <li key={`${row.name}-${i}`} className="flex min-w-0 items-start gap-2">
          <span
            className="mt-1.5 size-2 shrink-0 rounded-sm ring-1 ring-border/60"
            style={{ backgroundColor: PIE_COLORS[(i + colorOffset) % PIE_COLORS.length] }}
            aria-hidden
          />
          <span className="min-w-0 break-words">
            <span className="text-foreground">{row.name}</span>
            <span className="text-muted-foreground"> · {fmt(row.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function formatDaysPlain(n: number) {
  if (!Number.isFinite(n)) return "—"
  return n.toFixed(1)
}

/** 人天图例与 Tooltip */
function formatDays(n: number) {
  const p = formatDaysPlain(n)
  return p === "—" ? "—" : `${p} 人天`
}

function formatCurrencyYuan(n: number) {
  if (!Number.isFinite(n)) return "—"
  return `¥${Math.round(n).toLocaleString()}`
}

function buildModulePieData(er: EstimateResult) {
  const rows = (er.groupSubtotals || [])
    .map((g) => ({ name: g.groupName || g.groupId || "未命名模块", value: Math.max(0, Number(g.subtotalDays) || 0) }))
    .filter((x) => x.value > 0)
  return rows
}

function buildTypePieData(er: EstimateResult) {
  const parts = [
    { name: "基础人天", value: Math.max(0, Number(er.baseDays) || 0) },
    { name: "用户规模增量", value: Math.max(0, Number(er.userIncrementDays) || 0) },
    { name: "难度系数增量", value: Math.max(0, Number(er.difficultyIncrementDays) || 0) },
    { name: "组织协同增量", value: Math.max(0, Number(er.orgIncrementDays) || 0) },
  ].filter((x) => x.value > 0)
  return parts
}

type PiePanelProps = {
  data: CostPieRow[]
  colorOffset: number
  tooltipFormatter: (v: number) => [string, string]
  emptyHint: string
}

function PiePanel({ data, colorOffset, tooltipFormatter, emptyHint }: PiePanelProps) {
  if (data.length === 0) {
    return <p className="flex min-h-[120px] items-center justify-center text-xs text-muted-foreground">{emptyHint}</p>
  }
  return (
    <>
      <div className="h-[148px] w-full shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={38}
              outerRadius={62}
              paddingAngle={1}
            >
              {data.map((_, i) => (
                <Cell key={`cell-${i}`} fill={PIE_COLORS[(i + colorOffset) % PIE_COLORS.length]} stroke="transparent" />
              ))}
            </Pie>
            <Tooltip formatter={tooltipFormatter} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <PieLegendBlock rows={data} colorOffset={colorOffset} columnsClass="sm:grid-cols-2" />
    </>
  )
}

type Props = {
  estimate: EstimateResult | null
  loading?: boolean
  assignedPlannedDays: number
  /** 按角色汇总行小计（元） */
  costByRole: CostPieRow[]
  /** 按姓名汇总行小计（元） */
  costByName: CostPieRow[]
}

export function ResourceCostAssessmentCharts({
  estimate,
  loading,
  assignedPlannedDays,
  costByRole,
  costByName,
}: Props) {
  const moduleData = useMemo(() => (estimate ? buildModulePieData(estimate) : []), [estimate])
  const typeData = useMemo(() => (estimate ? buildTypePieData(estimate) : []), [estimate])

  const totalAssessment = estimate?.totalDays ?? 0
  const assigned = Math.max(0, Number(assignedPlannedDays) || 0)
  const remaining = estimate ? Math.max(0, totalAssessment - assigned) : 0
  const over = Boolean(estimate && assigned > totalAssessment + 0.05)
  const progressPct =
    estimate && totalAssessment > 0 ? Math.min(100, Math.round((assigned / totalAssessment) * 1000) / 10) : 0

  if (loading) {
    return (
      <div className="rounded-xl border border-border/40 bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
        正在加载关联实施评估数据…
      </div>
    )
  }

  const totalAssessmentLabel = estimate ? formatDaysPlain(totalAssessment) : "—"
  const remainingLabel = estimate ? formatDaysPlain(remaining) : "—"

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="border-border/40 bg-card/60 flex min-h-0 flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">实施评估人天结构</CardTitle>
          <CardDescription className="text-xs">
            {estimate ? `关联实施评估 · 总人天 ${totalAssessmentLabel}` : "未关联实施评估 · 总人天 —"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-2 pt-0">
          <Tabs defaultValue="module" className="flex min-h-0 flex-1 flex-col gap-2">
            <TabsList className="h-8 w-full justify-start sm:w-auto">
              <TabsTrigger value="module" className="text-xs">
                业务模块
              </TabsTrigger>
              <TabsTrigger value="type" className="text-xs">
                人天类型
              </TabsTrigger>
            </TabsList>
            <TabsContent value="module" className="mt-0 flex min-h-0 flex-1 flex-col gap-2">
              <PiePanel
                data={moduleData}
                colorOffset={0}
                tooltipFormatter={(v: number) => [formatDays(v), ""]}
                emptyHint="暂无分组小计数据"
              />
            </TabsContent>
            <TabsContent value="type" className="mt-0 flex min-h-0 flex-1 flex-col gap-2">
              <PiePanel
                data={typeData}
                colorOffset={1}
                tooltipFormatter={(v: number) => [formatDays(v), ""]}
                emptyHint="暂无类型拆分"
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-card/60 min-h-[280px]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">实施评估人天分配</CardTitle>
          <CardDescription className="text-xs">与下方表格「计划人天」合计联动</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-border/50 bg-background/80 px-3 py-2">
              <p className="text-muted-foreground">实施评估总人天</p>
              <p className="text-lg font-semibold tabular-nums text-primary">{totalAssessmentLabel}</p>
            </div>
            <div className="rounded-lg border border-border/50 bg-background/80 px-3 py-2">
              <p className="text-muted-foreground">表格已分配</p>
              <p className="text-lg font-semibold tabular-nums">{assigned.toFixed(1)}</p>
            </div>
          </div>
          <div
            className={cn(
              "rounded-lg border px-3 py-3",
              over ? "border-amber-500/50 bg-amber-500/10" : "border-primary/30 bg-primary/5",
            )}
          >
            <p className="text-xs text-muted-foreground">
              {!estimate ? "未关联实施评估" : over ? "已超出实施评估总人天" : "尚未分配人天"}
            </p>
            <p className={cn("text-2xl font-bold tabular-nums", over ? "text-amber-700 dark:text-amber-400" : "text-primary")}>
              {!estimate ? "—" : over ? `+${(assigned - totalAssessment).toFixed(1)}` : remainingLabel}
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>分配进度</span>
              <span>{progressPct}%</span>
            </div>
            <Progress value={over ? 100 : progressPct} className={cn("h-2", over && "[&>div]:bg-amber-500")} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-card/60 flex min-h-0 flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">成本金额占比</CardTitle>
          <CardDescription className="text-xs">基于下方表格行小计（单价×计划人天+差旅）</CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-2 pt-0">
          <Tabs defaultValue="role" className="flex min-h-0 flex-1 flex-col gap-2">
            <TabsList className="h-8 w-full justify-start sm:w-auto">
              <TabsTrigger value="role" className="text-xs">
                角色
              </TabsTrigger>
              <TabsTrigger value="name" className="text-xs">
                姓名
              </TabsTrigger>
            </TabsList>
            <TabsContent value="role" className="mt-0 flex min-h-0 flex-1 flex-col gap-2">
              {costByRole.length === 0 ? (
                <p className="flex min-h-[120px] items-center justify-center text-xs text-muted-foreground">暂无成本数据</p>
              ) : (
                <>
                  <div className="h-[148px] w-full shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                        <Pie
                          data={costByRole}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={38}
                          outerRadius={62}
                          paddingAngle={1}
                        >
                          {costByRole.map((_, i) => (
                            <Cell key={`cr-${i}`} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="transparent" />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => [formatCurrencyYuan(v), ""]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <PieLegendBlock rows={costByRole} colorOffset={0} formatValue={formatCurrencyYuan} columnsClass="sm:grid-cols-2" />
                </>
              )}
            </TabsContent>
            <TabsContent value="name" className="mt-0 flex min-h-0 flex-1 flex-col gap-2">
              {costByName.length === 0 ? (
                <p className="flex min-h-[120px] items-center justify-center text-xs text-muted-foreground">暂无成本数据</p>
              ) : (
                <>
                  <div className="h-[148px] w-full shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                        <Pie
                          data={costByName}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={38}
                          outerRadius={62}
                          paddingAngle={1}
                        >
                          {costByName.map((_, i) => (
                            <Cell key={`cn-${i}`} fill={PIE_COLORS[(i + 1) % PIE_COLORS.length]} stroke="transparent" />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => [formatCurrencyYuan(v), ""]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <PieLegendBlock rows={costByName} colorOffset={1} formatValue={formatCurrencyYuan} columnsClass="sm:grid-cols-2" />
                </>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
