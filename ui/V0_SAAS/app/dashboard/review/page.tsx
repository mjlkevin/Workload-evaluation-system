"use client"

import { useEffect, useState } from "react"
import { ModuleShell } from "@/components/workload/module-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { closeReviewById, createReviewForVersion, getReviewItems, getTeamPlanOptions } from "@/lib/workload-service"
import type { ReviewItem } from "@/lib/workload-types"

export default function ReviewPage() {
  const [rows, setRows] = useState<ReviewItem[]>([])
  const [globalVersionCode, setGlobalVersionCode] = useState("")
  const [creating, setCreating] = useState(false)
  const [closingReviewId, setClosingReviewId] = useState("")
  const [message, setMessage] = useState("")

  function loadRows() {
    void getReviewItems().then(setRows)
  }

  useEffect(() => {
    loadRows()
    void getTeamPlanOptions().then((items) => {
      if (!items.length) return
      setGlobalVersionCode((prev) => prev || items[0].globalVersionCode)
    })
  }, [])

  async function onCreateReview() {
    setCreating(true)
    setMessage("")
    try {
      await createReviewForVersion(globalVersionCode)
      setMessage(`已发起评审：${globalVersionCode}`)
      loadRows()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "发起评审失败")
    } finally {
      setCreating(false)
    }
  }

  async function onCloseReview(row: ReviewItem) {
    if (!row.reviewId) return
    setClosingReviewId(row.reviewId)
    setMessage("")
    try {
      await closeReviewById(row.reviewId)
      setMessage(`评审已通过：${row.versionCode}`)
      loadRows()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新评审状态失败")
    } finally {
      setClosingReviewId("")
    }
  }

  return (
    <ModuleShell title="评审" description="评审结论沉淀与问题闭环。" breadcrumbs={[{ label: "评审" }]}>
      <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">评审记录</CardTitle>
            <div className="flex w-full gap-2 sm:w-auto">
              <Input
                value={globalVersionCode}
                onChange={(e) => setGlobalVersionCode(e.target.value)}
                placeholder="输入总方案版本号，例如 GLOBAL-20260330-1412"
                className="sm:w-96"
              />
              <Button className="rounded-xl" onClick={onCreateReview} disabled={creating}>
                {creating ? "提交中..." : "发起评审"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {message ? (
            <p className="mb-3 rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
              {message}
            </p>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>方案版本</TableHead>
                <TableHead>评审人</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.versionCode}</TableCell>
                  <TableCell>{row.reviewer}</TableCell>
                  <TableCell>
                    <Badge variant={row.status === "通过" ? "default" : row.status === "驳回" ? "destructive" : "secondary"}>
                      {row.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{row.updatedAt}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={row.status === "通过" || !row.reviewId || closingReviewId === row.reviewId}
                      onClick={() => onCloseReview(row)}
                    >
                      {closingReviewId === row.reviewId ? "处理中..." : row.status === "通过" ? "已通过" : "通过"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ModuleShell>
  )
}
