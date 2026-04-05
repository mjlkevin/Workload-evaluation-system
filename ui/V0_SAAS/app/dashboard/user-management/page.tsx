"use client"

import { useEffect, useMemo, useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { ModuleShell } from "@/components/workload/module-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getUsers, updateUserStatus } from "@/lib/workload-service"
import type { UserItem } from "@/lib/workload-types"

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserItem[]>([])
  const [keyword, setKeyword] = useState("")
  const [updatingUserId, setUpdatingUserId] = useState("")
  const [message, setMessage] = useState("")
  const { isAdmin, user: currentUser } = useAuth()

  function loadUsers() {
    void getUsers().then(setUsers)
  }

  useEffect(() => {
    if (!isAdmin) return
    loadUsers()
  }, [isAdmin])

  async function onToggleStatus(target: UserItem) {
    setUpdatingUserId(target.id)
    setMessage("")
    try {
      const nextStatus = target.status === "active" ? "disabled" : "active"
      await updateUserStatus(target.id, nextStatus)
      setMessage(`已将用户 ${target.username} 更新为 ${nextStatus}`)
      loadUsers()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新用户状态失败")
    } finally {
      setUpdatingUserId("")
    }
  }

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return users
    return users.filter((x) => x.username.toLowerCase().includes(q) || x.role.toLowerCase().includes(q))
  }, [users, keyword])

  return (
    <ModuleShell
      title="用户管理"
      description="用户、角色与状态管理。"
      breadcrumbs={[{ label: "用户管理" }]}
    >
      {!isAdmin ? (
        <Card className="border-border/40 bg-card/50">
          <CardContent className="p-6 text-sm text-muted-foreground">
            当前账号 `{currentUser?.username || "unknown"}` 不是管理员，暂无权限访问用户管理。
          </CardContent>
        </Card>
      ) : null}

      {isAdmin ? <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">用户列表</CardTitle>
            <Input
              placeholder="搜索用户名或角色"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="w-64"
            />
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
                <TableHead>用户名</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>最后登录</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.username}</TableCell>
                  <TableCell>
                    <Badge variant={item.role === "admin" ? "default" : "outline"}>{item.role}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.status === "active" ? "secondary" : "destructive"}>{item.status}</Badge>
                  </TableCell>
                  <TableCell>{item.lastLoginAt}</TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={updatingUserId === item.id || item.id === currentUser?.id}
                      onClick={() => onToggleStatus(item)}
                    >
                      {updatingUserId === item.id ? "更新中..." : item.status === "active" ? "禁用" : "启用"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card> : null}
    </ModuleShell>
  )
}
