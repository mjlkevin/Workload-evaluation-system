"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Search, Users } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { ModuleShell } from "@/components/workload/module-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  wesTableHeaderStickyClassName,
} from "@/components/ui/table"
import { getUsers, updateUserRole, updateUserStatus } from "@/lib/workload-service"
import type { UserItem } from "@/lib/workload-types"
import { cn } from "@/lib/utils"

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

function formatLastLogin(raw: string): string {
  const s = raw?.trim()
  if (!s) return "—"
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function statusLabel(status: UserItem["status"]): string {
  return status === "active" ? "正常" : "已禁用"
}

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserItem[]>([])
  const [keyword, setKeyword] = useState("")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkUpdating, setBulkUpdating] = useState(false)
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

  useEffect(() => {
    const visible = new Set(filtered.map((u) => u.id))
    setSelectedIds((prev) => prev.filter((id) => visible.has(id)))
  }, [filtered])

  useEffect(() => {
    const valid = new Set(users.map((u) => u.id))
    setSelectedIds((prev) => prev.filter((id) => valid.has(id)))
  }, [users])

  const canBulkToggleUserStatus = useCallback(
    (target: UserItem): boolean => {
      if (target.id === currentUser?.id) return false
      if (currentUser?.role === "sub_admin" && target.role === "admin") return false
      return true
    },
    [currentUser?.id, currentUser?.role],
  )

  const selectableInView = useMemo(
    () => filtered.filter(canBulkToggleUserStatus),
    [filtered, canBulkToggleUserStatus],
  )

  const selectedInView = useMemo(
    () => selectableInView.filter((u) => selectedIds.includes(u.id)),
    [selectableInView, selectedIds],
  )

  const bulkDisableTargets = useMemo(
    () => selectedInView.filter((u) => u.status === "active"),
    [selectedInView],
  )

  const bulkEnableTargets = useMemo(
    () => selectedInView.filter((u) => u.status === "disabled"),
    [selectedInView],
  )

  const headerCheckboxState = useMemo(() => {
    if (selectableInView.length === 0) return false
    if (selectedInView.length === selectableInView.length) return true
    if (selectedInView.length > 0) return "indeterminate" as const
    return false
  }, [selectableInView.length, selectedInView.length])

  function toggleSelectAll(checked: boolean) {
    if (!checked) {
      setSelectedIds((prev) => prev.filter((id) => !selectableInView.some((u) => u.id === id)))
      return
    }
    setSelectedIds(selectableInView.map((u) => u.id))
  }

  function toggleRowSelected(id: string, checked: boolean) {
    if (checked) {
      setSelectedIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
      return
    }
    setSelectedIds((prev) => prev.filter((x) => x !== id))
  }

  async function runBulkStatusChange(next: "active" | "disabled") {
    const targets =
      next === "disabled"
        ? bulkDisableTargets
        : bulkEnableTargets
    if (targets.length === 0 || bulkUpdating) return
    setBulkUpdating(true)
    setMessage("")
    try {
      const results = await Promise.allSettled(targets.map((t) => updateUserStatus(t.id, next)))
      const ok = results.filter((r) => r.status === "fulfilled").length
      const fail = results.length - ok
      const verb = next === "disabled" ? "禁用" : "启用"
      if (fail === 0) {
        setMessage(`已批量${verb} ${ok} 位用户。`)
      } else {
        setMessage(`批量${verb}完成：成功 ${ok} 人，失败 ${fail} 人。`)
      }
      setSelectedIds([])
      loadUsers()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "批量更新用户状态失败")
    } finally {
      setBulkUpdating(false)
    }
  }

  function canEditRoleRow(target: UserItem): boolean {
    if (!canManageUsers) return false
    if (currentUser?.role === "sub_admin" && target.role === "admin") return false
    if (target.role === "admin" && adminCount <= 1) return false
    return true
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
        <Card collapsible={false} className="border-border/40 bg-card/50 backdrop-blur-sm">
          <CardHeader className="space-y-3 pb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-secondary">
                    <Users className="size-4 text-muted-foreground" aria-hidden />
                  </span>
                  用户列表
                </CardTitle>
                <Badge variant="secondary" className="font-normal tabular-nums">
                  {filtered.length} / {users.length}
                </Badge>
              </div>
              <div className="relative w-full sm:w-72">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  placeholder="搜索用户名或角色"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  className="h-10 rounded-xl border-border/60 bg-background/95 pl-9 pr-3 shadow-sm"
                  aria-label="搜索用户"
                />
              </div>
            </div>
            {currentUser?.role === "sub_admin" ? (
              <p className="rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                子管理员可管理普通用户与子管理员，不可修改或禁用超级管理员，也不可授予超级管理员。
              </p>
            ) : null}
          </CardHeader>
          <CardContent className="pt-0">
            {message ? (
              <p className="mb-3 rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
                {message}
              </p>
            ) : null}
            <div className="mb-3 flex min-h-9 flex-wrap items-center gap-2 border-b border-border/40 pb-3">
              <p className="text-xs text-muted-foreground">
                {selectedIds.length > 0 ? (
                  <>
                    已选 <span className="font-medium text-foreground tabular-nums">{selectedIds.length}</span> 人
                    {bulkDisableTargets.length > 0 ? (
                      <span className="text-muted-foreground"> · 可禁用 {bulkDisableTargets.length} 人</span>
                    ) : null}
                    {bulkEnableTargets.length > 0 ? (
                      <span className="text-muted-foreground"> · 可启用 {bulkEnableTargets.length} 人</span>
                    ) : null}
                  </>
                ) : (
                  "勾选用户后，可在下方批量禁用或启用。"
                )}
              </p>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={bulkDisableTargets.length === 0 || bulkUpdating}
                  className="h-8 rounded-lg border-destructive/35 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => void runBulkStatusChange("disabled")}
                >
                  {bulkUpdating ? "处理中…" : "批量禁用"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={bulkEnableTargets.length === 0 || bulkUpdating}
                  className="h-8 rounded-lg border-primary/35 text-xs text-primary hover:bg-primary/10"
                  onClick={() => void runBulkStatusChange("active")}
                >
                  {bulkUpdating ? "处理中…" : "批量启用"}
                </Button>
              </div>
            </div>
            <Table
              density="compact"
              containerClassName="max-h-[min(520px,calc(100dvh-17rem))] overflow-y-auto overscroll-contain"
            >
              <TableHeader className={cn(wesTableHeaderStickyClassName, "[&_tr]:bg-muted/95")}>
                <TableRow>
                  <TableHead className="w-10 pr-0 [&:has([role=checkbox])]:pr-0">
                    <Checkbox
                      aria-label="全选当前列表"
                      disabled={selectableInView.length === 0 || bulkUpdating}
                      checked={headerCheckboxState}
                      onCheckedChange={(v) => toggleSelectAll(v === true)}
                    />
                  </TableHead>
                  <TableHead>用户名</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>最后登录</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-xs text-muted-foreground">
                      {keyword.trim() ? "没有匹配的用户，请调整搜索条件。" : "暂无用户数据。"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((item) => (
                    <TableRow
                      key={item.id}
                      data-state={selectedIds.includes(item.id) ? "selected" : undefined}
                    >
                      <TableCell className="w-10 pr-0 [&:has([role=checkbox])]:pr-0">
                        <Checkbox
                          aria-label={`选择用户 ${item.username}`}
                          disabled={!canBulkToggleUserStatus(item) || bulkUpdating}
                          checked={selectedIds.includes(item.id)}
                          onCheckedChange={(v) => toggleRowSelected(item.id, v === true)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{item.username}</TableCell>
                      <TableCell>
                        {canEditRoleRow(item) ? (
                          <Select
                            value={item.role}
                            disabled={roleUpdatingId === item.id}
                            onValueChange={(v) => onRoleChange(item, v as UserItem["role"])}
                          >
                            <SelectTrigger size="sm" className="h-8 w-[148px] rounded-lg">
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
                          <Badge variant={roleBadgeVariant(item.role)} className="rounded-md font-normal">
                            {roleLabel(item.role)}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              item.status === "active" ? "bg-emerald-500" : "bg-muted-foreground/60",
                            )}
                            aria-hidden
                          />
                          <Badge
                            variant="outline"
                            className={cn(
                              "rounded-md border font-normal",
                              item.status === "active"
                                ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                                : "border-destructive/40 bg-destructive/5 text-destructive",
                            )}
                          >
                            {statusLabel(item.status)}
                          </Badge>
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground" title={item.lastLoginAt}>
                        {formatLastLogin(item.lastLoginAt)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </ModuleShell>
  )
}
