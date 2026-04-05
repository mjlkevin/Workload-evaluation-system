"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { ModuleShell } from "@/components/workload/module-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { generateInviteCode, getInviteCodes } from "@/lib/workload-service"
import type { InviteCodeItem } from "@/lib/workload-types"

const endpointGroups = [
  { group: "Auth", endpoint: "POST /api/v1/auth/login" },
  { group: "Version", endpoint: "GET /api/v1/versions?templateId=:id" },
  { group: "Estimate", endpoint: "POST /api/v1/estimates/calculate" },
  { group: "Team", endpoint: "POST /api/v1/teams/:teamId/reviews" },
]

export default function ApiKeysPage() {
  const [inviteCodes, setInviteCodes] = useState<InviteCodeItem[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")
  const { isAdmin, user } = useAuth()

  function loadInviteCodes() {
    void getInviteCodes().then(setInviteCodes)
  }

  useEffect(() => {
    if (!isAdmin) return
    loadInviteCodes()
  }, [isAdmin])

  async function onGenerateInviteCode() {
    setLoading(true)
    setMessage("")
    try {
      const created = await generateInviteCode()
      setMessage(`已生成推荐码：${created.code}`)
      loadInviteCodes()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "生成推荐码失败")
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModuleShell title="API" description="API 调用能力、推荐码与接入清单。" breadcrumbs={[{ label: "API" }]}>
      {!isAdmin ? (
        <Card className="border-border/40 bg-card/50">
          <CardContent className="p-6 text-sm text-muted-foreground">
            当前账号 `{user?.username || "unknown"}` 不是管理员，暂无权限访问 API 管理页。
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">推荐码</CardTitle>
              <Button
                className="rounded-xl"
                size="sm"
                onClick={onGenerateInviteCode}
                disabled={!isAdmin || loading}
              >
                {loading ? "生成中..." : "生成推荐码"}
              </Button>
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
                  <TableHead>Code</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inviteCodes.map((item) => (
                  <TableRow key={item.code}>
                    <TableCell className="font-medium">{item.code}</TableCell>
                    <TableCell>
                      <Badge variant={item.status === "active" ? "secondary" : "outline"}>{item.status}</Badge>
                    </TableCell>
                    <TableCell>{item.createdAt}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">接口目录</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>分组</TableHead>
                  <TableHead>Endpoint</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpointGroups.map((item) => (
                  <TableRow key={item.endpoint}>
                    <TableCell>{item.group}</TableCell>
                    <TableCell className="font-mono text-xs">{item.endpoint}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ModuleShell>
  )
}
