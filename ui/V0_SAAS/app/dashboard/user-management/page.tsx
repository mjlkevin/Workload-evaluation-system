"use client"

import { useEffect, useMemo, useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { ModuleShell } from "@/components/workload/module-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getUsers, updateUserRole, updateUserStatus } from "@/lib/workload-service"
import type { UserItem } from "@/lib/workload-types"

function roleLabel(role: UserItem["role"]) {
  if (role === "admin") return "超级管理员"
  if (role === "sub_admin") return "子管理员"
  return "普通用户"
}

function roleBadgeVariant(role: UserItem["role"]): "default" | "secondary" | "outline" {
  if (role === "admin") return "default"
  if (role === "sub_admin") return "secondary"
  return "outline"
}

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserItem[]>([])
  const [keyword, setKeyword] = useState("")
  const [updatingUserId, setUpdatingUserId] = useState("")
  const [roleUpdatingId, setRoleUpdatingId] = useState("")
  const [message, setMessage] = useState("")
  const { canManageUsers, isAdmin, user: currentUser, refresh } = useAuth()

  const adminCount = useMemo(() => users.filter((u) => u.role === "admin").length, [users])

  function loadUsers() {
    void getUsers().then(setUsers)
  }

  useEffect(() => {
    if (!canManageUsers) return
    loadUsers()
  }, [canManageUsers])

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

  async function onRoleChange(target: UserItem, next: UserItem["role"]) {
    if (next === target.role) return
    setRoleUpdatingId(target.id)
    setMessage("")
    try {
      await updateUserRole(target.id, next)
      setMessage(`已更新 ${target.username} 的角色为 ${roleLabel(next)}`)
      loadUsers()
      if (target.id === currentUser?.id) {
        await refresh()
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新角色失败")
    } finally {
      setRoleUpdatingId("")
    }
  }

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (x) =>
        x.username.toLowerCase().includes(q) ||
        x.role.toLowerCase().includes(q) ||
        roleLabel(x.role).toLowerCase().includes(q),
    )
  }, [users, keyword])

  function canEditRoleRow(target: UserItem): boolean {
    if (!canManageUsers) return false
    if (currentUser?.role === "sub_admin" && target.role === "admin") return false
    if (target.role === "admin" && adminCount <= 1) return false
    return true
  }

  function statusToggleDisabled(target: UserItem): boolean {
    if (updatingUserId === target.id) return true
    if (target.id === currentUser?.id) return true
    if (currentUser?.role === "sub_admin" && target.role === "admin") return true
    return false
  }

  return (
    <ModuleShell
      title="用户管理"
      description="用户、角色与状态管理。"
      breadcrumbs={[{ label: "用户管理" }]}
    >
      {!canManageUsers ? (
        <Card className="border-border/40 bg-card/50">
          <CardContent className="p-6 text-sm text-muted-foreground">
            当前账号 `{currentUser?.username || "unknown"}` 无用户管理权限。
          </CardContent>
        </Card>
      ) : null}

      {canManageUsers ? (
        <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
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
            {currentUser?.role === "sub_admin" ? (
              <p className="text-xs text-muted-foreground">
                子管理员可管理普通用户与子管理员，不可修改或禁用超级管理员，也不可授予超级管理员。
              </p>
            ) : null}
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
                      {canEditRoleRow(item) ? (
                        <Select
                          value={item.role}
                          disabled={roleUpdatingId === item.id}
                          onValueChange={(v) => onRoleChange(item, v as UserItem["role"])}
                        >
                          <SelectTrigger size="sm" className="w-[160px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {isAdmin ? (
                              <>
                                <SelectItem value="admin">超级管理员</SelectItem>
                                <SelectItem value="sub_admin">子管理员</SelectItem>
                                <SelectItem value="user">普通用户</SelectItem>
                              </>
                            ) : (
                              <>
                                <SelectItem value="sub_admin">子管理员</SelectItem>
                                <SelectItem value="user">普通用户</SelectItem>
                              </>
                            )}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant={roleBadgeVariant(item.role)}>{roleLabel(item.role)}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.status === "active" ? "secondary" : "destructive"}>
                        {item.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{item.lastLoginAt}</TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={statusToggleDisabled(item)}
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
        </Card>
      ) : null}
    </ModuleShell>
  )
}
