"use client"

import { useEffect, useMemo, useState } from "react"
import { CircleHelp } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { ModuleShell } from "@/components/workload/module-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  activateVersionCodeRule,
  disableVersionCodeRule,
  listVersionCodeRules,
  updateVersionCodeRuleConfig,
  type VersionCodeRuleItem,
  type VersionCodeRuleStatus,
} from "@/lib/workload-service"

const MODULE_OPTIONS: Array<{ value: VersionCodeRuleItem["moduleKey"] | "all"; label: string }> = [
  { value: "all", label: "全部模块" },
  { value: "global", label: "总方案" },
  { value: "requirement", label: "需求" },
  { value: "implementation", label: "实施评估" },
  { value: "dev", label: "开发评估" },
  { value: "resource", label: "资源人天及成本" },
  { value: "wbs", label: "WBS" },
]

const STATUS_LABEL: Record<VersionCodeRuleStatus, string> = {
  active: "已生效",
  draft: "待生效",
  disabled: "已禁用",
}

const VERSION_FORMAT_HELP = [
  "{PREFIX}: 模块前缀（来自本行“版本前缀”配置）",
  "{GL}: 关联总方案基础码（例如 GL001）",
  "{NN}: 2位递增序号（01, 02, 03...）",
  "{NNN}: 3位递增序号（001, 002, 003...）",
  "{YYYY}: 年份（例如 2026）",
  "{YYYYMM}: 年月（例如 202604）",
  "{YYYYMMDD}: 日期（例如 20260406）",
  "{MODULE}: 模块编码（例如 IA, RQ）",
]

function FormatHelpTooltip() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
          aria-label="查看编码格式占位符说明"
        >
          <CircleHelp className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-[360px] rounded-lg px-3 py-2 text-xs leading-5">
        <div className="space-y-1">
          {VERSION_FORMAT_HELP.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function formatDisplayTime(value: string): string {
  if (!value || value === "--") return "--"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("zh-CN", { hour12: false })
}

export default function SystemManagementPage() {
  const { isAdmin, user } = useAuth()
  const [rules, setRules] = useState<VersionCodeRuleItem[]>([])
  const [keyword, setKeyword] = useState("")
  const [moduleFilter, setModuleFilter] = useState<VersionCodeRuleItem["moduleKey"] | "all">("all")
  const [editingRule, setEditingRule] = useState<VersionCodeRuleItem | null>(null)
  const [editingPrefix, setEditingPrefix] = useState("")
  const [editingFormat, setEditingFormat] = useState("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const [actingRuleId, setActingRuleId] = useState("")

  async function loadRules() {
    setLoading(true)
    try {
      const items = await listVersionCodeRules({
        moduleKey: moduleFilter,
        keyword,
      })
      setRules(items)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载版本号编码规则失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isAdmin) return
    void loadRules()
  }, [isAdmin])

  const visibleRules = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    return rules.filter((item) => {
      const matchModule = moduleFilter === "all" || item.moduleKey === moduleFilter
      const matchKeyword =
        q.length === 0 ||
        item.moduleName.toLowerCase().includes(q) ||
        item.moduleCode.toLowerCase().includes(q) ||
        item.prefix.toLowerCase().includes(q) ||
        item.format.toLowerCase().includes(q)
      return matchModule && matchKeyword
    })
  }, [rules, moduleFilter, keyword])

  function startEdit(item: VersionCodeRuleItem) {
    setEditingRule(item)
    setEditingPrefix(item.prefix)
    setEditingFormat(item.format)
    setMessage(`正在配置「${item.moduleName}」编码规则`)
  }

  function clearEdit() {
    setEditingRule(null)
    setEditingPrefix("")
    setEditingFormat("")
  }

  async function saveConfig() {
    if (!editingRule) return
    setActingRuleId(editingRule.id)
    try {
      await updateVersionCodeRuleConfig(editingRule.id, {
        prefix: editingPrefix.trim().toUpperCase(),
        format: editingFormat.trim(),
      })
      setMessage("规则配置已保存，可继续执行“生效”操作。")
      clearEdit()
      await loadRules()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存规则配置失败")
    } finally {
      setActingRuleId("")
    }
  }

  async function onActivateRule(ruleId: string) {
    setActingRuleId(ruleId)
    try {
      await activateVersionCodeRule(ruleId)
      setMessage("编码规则已生效。")
      await loadRules()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "规则生效失败")
    } finally {
      setActingRuleId("")
    }
  }

  async function onDisableRule(ruleId: string) {
    setActingRuleId(ruleId)
    try {
      await disableVersionCodeRule(ruleId)
      setMessage("编码规则已禁用。")
      await loadRules()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "规则禁用失败")
    } finally {
      setActingRuleId("")
    }
  }

  return (
    <ModuleShell
      title="系统管理"
      description="集中维护系统级配置能力；当前已支持版本号编码规则管理。"
      breadcrumbs={[{ label: "系统管理" }]}
    >
      {!isAdmin ? (
        <Card className="border-border/40 bg-card/50">
          <CardContent className="p-6 text-sm text-muted-foreground">
            当前账号 `{user?.username || "unknown"}` 不是管理员，暂无权限访问系统管理。
          </CardContent>
        </Card>
      ) : null}

      {isAdmin ? (
        <div className="space-y-6">
          <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
            <CardHeader className="space-y-2 pb-3">
              <CardTitle className="text-base">版本号编码规则</CardTitle>
              <CardDescription>支持按模块进行编码规则配置、禁用和生效；采用“工具栏 + 表格”方式维护。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/50 bg-background/70 p-3">
                <Select value={moduleFilter} onValueChange={(value) => setModuleFilter(value as typeof moduleFilter)}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="选择模块" />
                  </SelectTrigger>
                  <SelectContent>
                    {MODULE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="w-[280px]"
                  placeholder="搜索模块/前缀/编码格式"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    void loadRules()
                    setMessage("已刷新规则列表。")
                  }}
                  disabled={loading}
                >
                  {loading ? "刷新中..." : "刷新"}
                </Button>
              </div>

              {message ? (
                <p className="rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">{message}</p>
              ) : null}

              <div className="rounded-xl border border-border/50">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>模块</TableHead>
                      <TableHead>模块编码</TableHead>
                      <TableHead>版本前缀</TableHead>
                      <TableHead>
                        <div className="inline-flex items-center gap-1.5">
                          <span>编码格式</span>
                          <FormatHelpTooltip />
                        </div>
                      </TableHead>
                      <TableHead>示例</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>生效时间</TableHead>
                      <TableHead className="w-[260px]">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRules.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.moduleName}</TableCell>
                        <TableCell>{item.moduleCode}</TableCell>
                        <TableCell>{item.prefix}</TableCell>
                        <TableCell>{item.format}</TableCell>
                        <TableCell>{item.sample}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              item.status === "active"
                                ? "secondary"
                                : item.status === "disabled"
                                  ? "destructive"
                                  : "outline"
                            }
                          >
                            {STATUS_LABEL[item.status]}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatDisplayTime(item.effectiveAt)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={() => startEdit(item)}>
                              配置
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => void onActivateRule(item.id)}
                              disabled={item.status === "active" || actingRuleId === item.id}
                            >
                              生效
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => void onDisableRule(item.id)}
                              disabled={item.status === "disabled" || actingRuleId === item.id}
                            >
                              禁用
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-base">其他系统管理内容（预留）</CardTitle>
              <CardDescription>后续可在该容器中扩展字典管理、通知配置、审计策略等系统级能力。</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-dashed border-border/60 bg-background/40 p-4 text-sm text-muted-foreground">
                  字典与编码映射（预留）
                </div>
                <div className="rounded-xl border border-dashed border-border/60 bg-background/40 p-4 text-sm text-muted-foreground">
                  通知与消息策略（预留）
                </div>
                <div className="rounded-xl border border-dashed border-border/60 bg-background/40 p-4 text-sm text-muted-foreground">
                  审计与安全策略（预留）
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Dialog
        open={!!editingRule}
        onOpenChange={(open) => {
          if (!open) clearEdit()
        }}
      >
        <DialogContent className="sm:max-w-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle>配置版本号编码规则</DialogTitle>
            <DialogDescription>
              {editingRule ? `模块：${editingRule.moduleName}（${editingRule.moduleCode}）` : "编辑规则配置"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rule-prefix-dialog">版本前缀</Label>
              <Input
                id="rule-prefix-dialog"
                value={editingPrefix}
                onChange={(event) => setEditingPrefix(event.target.value)}
                placeholder="例如 GL"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-format-dialog" className="inline-flex items-center gap-1.5">
                <span>编码格式</span>
                <FormatHelpTooltip />
              </Label>
              <Input
                id="rule-format-dialog"
                value={editingFormat}
                onChange={(event) => setEditingFormat(event.target.value)}
                placeholder="例如 {PREFIX}-{YYYYMMDD}-{NNN}"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={clearEdit}>
              取消
            </Button>
            <Button onClick={() => void saveConfig()} disabled={!editingRule || actingRuleId === editingRule.id}>
              保存配置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ModuleShell>
  )
}
