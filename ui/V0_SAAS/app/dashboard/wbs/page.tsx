"use client"

import { useCallback, useEffect, useState } from "react"
import { ModuleShell } from "@/components/workload/module-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getLatestGlobalVersionLabel, getWbsItems } from "@/lib/workload-service"
import type { WbsItem } from "@/lib/workload-types"

export default function WbsPage() {
  const [rows, setRows] = useState<WbsItem[]>([])
  const [source, setSource] = useState<{ versionCode: string; projectName: string } | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [items, gl] = await Promise.all([getWbsItems(), getLatestGlobalVersionLabel()])
      setRows(items)
      setSource(gl)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <ModuleShell
      title="WBS"
      description="只读 MVP：任务行由服务端根据您最新保存的「总方案」版本（type=global，如 GL- / GLOBAL-）自动派生，无独立 WBS 存储与编辑。"
      breadcrumbs={[{ label: "WBS" }]}
    >
      <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
        <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">WBS 任务列表</CardTitle>
            {source ? (
              <p className="text-xs text-muted-foreground">
                当前派生依据：<span className="font-mono">{source.versionCode}</span>
                {source.projectName ? ` · ${source.projectName}` : null}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                尚未检测到总方案版本记录；请先在总览/各模块保存总方案后再查看。
              </p>
            )}
          </div>
          <Button type="button" variant="secondary" size="sm" className="rounded-xl" disabled={loading} onClick={() => void load()}>
            {loading ? "刷新中…" : "刷新"}
          </Button>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无派生任务。保存总方案后将生成与需求、实施、开发、资源阶段对应的占位行。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>任务</TableHead>
                  <TableHead>模块</TableHead>
                  <TableHead>负责人</TableHead>
                  <TableHead>关联版本</TableHead>
                  <TableHead>开始时间</TableHead>
                  <TableHead>结束时间</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.taskName}</TableCell>
                    <TableCell>{row.moduleKey || "—"}</TableCell>
                    <TableCell>{row.owner}</TableCell>
                    <TableCell className="font-mono text-xs">{row.linkedVersionCode || "—"}</TableCell>
                    <TableCell>{row.start}</TableCell>
                    <TableCell>{row.end}</TableCell>
                    <TableCell>
                      <Badge
                        variant={row.status === "已完成" ? "default" : row.status === "进行中" ? "secondary" : "outline"}
                      >
                        {row.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </ModuleShell>
  )
}
