"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ModuleShell } from "@/components/workload/module-shell"
import { VersionHistoryDialog, recordsToVersionHistoryRows } from "@/components/workload/version-history-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { getCheckoutStatusBadgeClass, getCheckoutStatusText } from "@/lib/checkout-status-ui"
import {
  deleteModuleVersion,
  getReviewItems,
  getWbsItems,
  listLatestModuleDocuments,
  type CoreModuleVersionType,
  type ModuleDocListItem,
} from "@/lib/workload-service"
import { toast } from "sonner"

type ModuleListPageConfig = {
  moduleType: CoreModuleVersionType | "wbs" | "review"
  title: string
  /** 不传则 ModuleShell 不展示副标题段落 */
  description?: string
  editorPath: string
  breadcrumbs: Array<{ label: string; href?: string }>
}

function asNumber(value: unknown): number | null {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function formatNum(value: number | null): string {
  if (value === null) return "—"
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function pickQuoteMode(item: ModuleDocListItem): string {
  const payload = item.latestRecord?.payload || {}
  const modes: string[] = []

  const selectedSheet = String(payload.selectedSheet || "").trim()
  if (selectedSheet) modes.push(selectedSheet)

  const rootMode = String(payload.selectedPresetMode || payload.quoteMode || "").trim()
  if (rootMode && !modes.includes(rootMode)) modes.push(rootMode)

  const formMode = String(
    (payload.form as { selectedPresetMode?: string; quoteMode?: string } | undefined)
      ?.selectedPresetMode ||
      (payload.form as { selectedPresetMode?: string; quoteMode?: string } | undefined)
        ?.quoteMode ||
      "",
  ).trim()
  if (formMode && !modes.includes(formMode)) modes.push(formMode)

  if (!modes.length && Boolean(payload.customModeEnabled)) modes.push("自定义模式")

  return modes.length ? modes.join(" / ") : "—"
}

function pickTotalDays(item: ModuleDocListItem): number | null {
  const payload = item.latestRecord?.payload || {}
  const localSummary = (payload.localSummary as { totalDays?: number } | undefined)?.totalDays
  const serverResult = (payload.serverResult as { totalDays?: number } | undefined)?.totalDays
  return asNumber(localSummary ?? serverResult ?? payload.totalDays)
}

function pickOrgCount(item: ModuleDocListItem): number | null {
  const payload = item.latestRecord?.payload || {}
  const formCount = (payload.form as { orgCount?: number } | undefined)?.orgCount
  return asNumber(formCount ?? payload.orgCount)
}

function pickDifficultyFactor(item: ModuleDocListItem): number | null {
  const payload = item.latestRecord?.payload || {}
  const formFactor = (payload.form as { difficultyFactor?: number } | undefined)?.difficultyFactor
  return asNumber(formFactor ?? payload.difficultyFactor)
}

function pickCustomerName(item: ModuleDocListItem): string {
  const payload = item.latestRecord?.payload || {}
  const basicInfoCustomer = String(
    (payload.basicInfo as { customerName?: string } | undefined)?.customerName || "",
  ).trim()
  if (basicInfoCustomer) return basicInfoCustomer
  const rootCustomer = String(payload.customerName || "").trim()
  return rootCustomer || "—"
}

function pickProductLineList(item: ModuleDocListItem): string[] {
  const payload = item.latestRecord?.payload || {}
  const formLines = (payload.form as { productLines?: unknown } | undefined)?.productLines
  const rootLines = (payload as { productLines?: unknown }).productLines
  const basicInfoLines = (payload.basicInfo as { productLines?: unknown } | undefined)?.productLines
  const source = Array.isArray(formLines)
    ? formLines
    : Array.isArray(rootLines)
      ? rootLines
      : Array.isArray(basicInfoLines)
        ? basicInfoLines
        : []
  return source
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .filter((line, index, arr) => arr.indexOf(line) === index)
}

function pickProductLines(item: ModuleDocListItem): string {
  const lines = pickProductLineList(item)
  return lines.length ? lines.join(" / ") : "—"
}

const PRODUCT_LINE_BADGE_STYLE_MAP: Record<string, string> = {
  金蝶AI星空: "border-sky-400 bg-sky-500 text-white dark:border-sky-500 dark:bg-sky-500 dark:text-white",
  云之家: "border-cyan-300 bg-cyan-400 text-white dark:border-cyan-400 dark:bg-cyan-400 dark:text-white",
}

const PRODUCT_LINE_BADGE_FALLBACK_CLASSES = [
  "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-900/30 dark:text-violet-200",
  "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200",
  "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200",
] as const

function renderProductLineBadges(item: ModuleDocListItem) {
  const lines = pickProductLineList(item)
  if (!lines.length) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {lines.map((line, index) => (
        <Badge
          key={`${line}-${index}`}
          variant="outline"
          className={cn(
            "rounded-full px-3 py-0.5 text-xs font-medium leading-5",
            PRODUCT_LINE_BADGE_STYLE_MAP[line] ||
              PRODUCT_LINE_BADGE_FALLBACK_CLASSES[index % PRODUCT_LINE_BADGE_FALLBACK_CLASSES.length],
          )}
        >
          {line}
        </Badge>
      ))}
    </div>
  )
}

function renderCheckoutStatusBadge(item: ModuleDocListItem) {
  const label = getCheckoutStatusText(item.latestRecord?.checkoutStatus || item.statusText) || item.statusText || "—"
  return (
    <Badge variant="outline" className={cn("rounded-lg", getCheckoutStatusBadgeClass(item.latestRecord?.checkoutStatus || item.statusText))}>
      {label}
    </Badge>
  )
}

function pickListCreator(item: ModuleDocListItem): string {
  const u = item.latestRecord?.createdByUsername?.trim()
  return u || "—"
}

function pickListModifier(item: ModuleDocListItem): string {
  const u = item.latestRecord?.updatedByUsername?.trim()
  if (u) return u
  return pickListCreator(item)
}

export function ModuleDocListPage({
  moduleType,
  title,
  description,
  editorPath,
  breadcrumbs,
}: ModuleListPageConfig) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<ModuleDocListItem[]>([])
  const [keyword, setKeyword] = useState("")
  const [selectedKey, setSelectedKey] = useState<string>("")
  const [historyOpen, setHistoryOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const isRequirementList = moduleType === "requirementImport"
  const isAssessmentList = moduleType === "assessment"
  const listColSpan = isRequirementList ? 9 : isAssessmentList ? 12 : 11

  const selected = useMemo(
    () => items.find((item) => item.docKey === selectedKey) || null,
    [items, selectedKey],
  )

  const filteredItems = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) =>
      [
        item.title,
        item.latestVersionCode,
        item.globalVersionCode,
        item.projectName,
        item.statusText,
        pickCustomerName(item),
        pickProductLines(item),
        pickListCreator(item),
        pickListModifier(item),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    )
  }, [items, keyword])

  useEffect(() => {
    void loadList()
  }, [moduleType])

  async function loadList() {
    setLoading(true)
    try {
      if (moduleType === "wbs") {
        const rows = await getWbsItems()
        const list: ModuleDocListItem[] = rows.map((row) => ({
          docKey: `wbs:${row.id}`,
          moduleType: "wbs",
          title: row.taskName || "WBS单据",
          latestVersionCode: row.linkedVersionCode || "—",
          globalVersionCode: row.sourceGlobalVersionCode || "—",
          projectName: row.owner || "未命名项目",
          updatedAt: row.end || row.start || "—",
          statusText: row.status || "进行中",
          recordId: row.id,
          historySupported: false,
        }))
        setItems(list)
      } else if (moduleType === "review") {
        const rows = await getReviewItems()
        const list: ModuleDocListItem[] = rows.map((row) => ({
          docKey: `review:${row.id}`,
          moduleType: "review",
          title: `评审单 ${row.reviewId || row.id}`,
          latestVersionCode: row.versionCode || "—",
          globalVersionCode: row.versionCode || "—",
          projectName: row.reviewer || "评审负责人",
          updatedAt: row.updatedAt || "—",
          statusText: row.status || "待评审",
          recordId: row.id,
          historySupported: false,
        }))
        setItems(list)
      } else {
        const list = await listLatestModuleDocuments(moduleType)
        setItems(list)
      }
      setSelectedKey("")
    } catch (error) {
      toast.warning(error instanceof Error ? error.message : "加载单据列表失败")
    } finally {
      setLoading(false)
    }
  }

  function buildEditorHref(item: ModuleDocListItem, mode: "preview" | "edit", forceNewTab = false): string {
    const params = new URLSearchParams()
    if (item.latestVersionCode && item.latestVersionCode !== "—") {
      params.set("version", item.latestVersionCode)
    }
    if (item.globalVersionCode && item.globalVersionCode !== "—") {
      params.set("globalVersion", item.globalVersionCode)
    }
    if (mode === "preview") params.set("mode", "preview")
    if (forceNewTab) {
      params.set("tabKey", `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
    }
    const query = params.toString()
    return `${editorPath}${query ? `?${query}` : ""}`
  }

  function jumpToEditor(mode: "preview" | "edit") {
    if (!selected) return
    router.push(buildEditorHref(selected, mode, false))
  }

  async function handleDelete() {
    if (!selected || !selected.latestVersionCode || selected.latestVersionCode === "—") return
    if (selected.moduleType === "wbs" || selected.moduleType === "review") {
      toast.warning("该模块暂不支持删除单据")
      setDeleteOpen(false)
      return
    }
    setDeleteSubmitting(true)
    try {
      await deleteModuleVersion(selected.moduleType, selected.latestVersionCode)
      toast("删除成功")
      setDeleteOpen(false)
      await loadList()
    } catch (error) {
      toast.warning(error instanceof Error ? error.message : "删除失败")
    } finally {
      setDeleteSubmitting(false)
    }
  }

  function openHistory() {
    if (!selected) return
    if (!selected.historySupported) {
      toast.warning("该模块暂不支持历史版本")
      return
    }
    setHistoryOpen(true)
  }

  return (
    <ModuleShell title={title} description={description} breadcrumbs={breadcrumbs}>
      <Card className="border-border/40 bg-card/60">
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Input
              className="h-9 w-full max-w-sm"
              placeholder="搜索项目/版本号/状态/创建人/修改人"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void loadList()} disabled={loading}>
                {loading ? "刷新中..." : "刷新"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => jumpToEditor("preview")} disabled={!selected}>
                预览
              </Button>
              <Button size="sm" variant="outline" onClick={() => jumpToEditor("edit")} disabled={!selected}>
                修改
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDeleteOpen(true)} disabled={!selected}>
                删除
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={openHistory}
                disabled={!selected || !selected.historySupported}
                title={!selected?.historySupported && selected ? "该模块暂不支持历史版本" : undefined}
              >
                查看历史版本
              </Button>
              <Button size="sm" onClick={() => router.push(editorPath)}>
                新增
              </Button>
            </div>
          </div>
          <div className="rounded-xl border border-border/50">
            <Table>
              <TableHeader>
                <TableRow>
                  {isRequirementList ? (
                    <>
                      <TableHead>总方案版本号</TableHead>
                      <TableHead>需求版本号</TableHead>
                      <TableHead>项目名称</TableHead>
                      <TableHead>产品线</TableHead>
                      <TableHead>客户名称</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>创建人</TableHead>
                      <TableHead>修改人</TableHead>
                      <TableHead>更新时间</TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead>项目名称</TableHead>
                      {isAssessmentList ? <TableHead>产品线</TableHead> : null}
                      <TableHead>总方案版本号</TableHead>
                      <TableHead>最新版本号</TableHead>
                      <TableHead>报价模式</TableHead>
                      <TableHead>总人天数</TableHead>
                      <TableHead>组织数</TableHead>
                      <TableHead>难度系数</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>创建人</TableHead>
                      <TableHead>修改人</TableHead>
                      <TableHead>更新时间</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={listColSpan} className="text-center text-muted-foreground">
                      加载中...
                    </TableCell>
                  </TableRow>
                ) : filteredItems.length ? (
                  filteredItems.map((item) => (
                    <TableRow
                      key={item.docKey}
                      className={cn("cursor-pointer hover:bg-muted/30", selectedKey === item.docKey && "bg-primary/10")}
                      onClick={() => setSelectedKey(item.docKey)}
                      onDoubleClick={() => router.push(buildEditorHref(item, "edit", true))}
                    >
                      {isRequirementList ? (
                        <>
                          <TableCell className="font-mono text-xs">{item.globalVersionCode || "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{item.latestVersionCode || "—"}</TableCell>
                          <TableCell className="max-w-[260px] truncate font-medium" title={item.projectName}>
                            {item.projectName || "未命名项目"}
                          </TableCell>
                          <TableCell className="max-w-[320px]">
                            {renderProductLineBadges(item)}
                          </TableCell>
                          <TableCell className="max-w-[220px] truncate" title={pickCustomerName(item)}>
                            {pickCustomerName(item)}
                          </TableCell>
                          <TableCell>{renderCheckoutStatusBadge(item)}</TableCell>
                          <TableCell className="max-w-[120px] truncate text-xs" title={pickListCreator(item)}>
                            {pickListCreator(item)}
                          </TableCell>
                          <TableCell className="max-w-[120px] truncate text-xs" title={pickListModifier(item)}>
                            {pickListModifier(item)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{item.updatedAt || "—"}</TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell className="max-w-[320px] truncate font-medium" title={item.projectName}>
                            {item.projectName || "未命名项目"}
                          </TableCell>
                          {isAssessmentList ? <TableCell className="max-w-[320px]">{renderProductLineBadges(item)}</TableCell> : null}
                          <TableCell className="font-mono text-xs">{item.globalVersionCode || "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{item.latestVersionCode || "—"}</TableCell>
                          <TableCell>{pickQuoteMode(item)}</TableCell>
                          <TableCell className="tabular-nums">{formatNum(pickTotalDays(item))}</TableCell>
                          <TableCell className="tabular-nums">{formatNum(pickOrgCount(item))}</TableCell>
                          <TableCell className="tabular-nums">{formatNum(pickDifficultyFactor(item))}</TableCell>
                          <TableCell>{renderCheckoutStatusBadge(item)}</TableCell>
                          <TableCell className="max-w-[120px] truncate text-xs" title={pickListCreator(item)}>
                            {pickListCreator(item)}
                          </TableCell>
                          <TableCell className="max-w-[120px] truncate text-xs" title={pickListModifier(item)}>
                            {pickListModifier(item)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{item.updatedAt || "—"}</TableCell>
                        </>
                      )}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={listColSpan} className="text-center text-muted-foreground">
                      暂无单据
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              将删除当前单据对应的最新版本记录，删除后无法恢复。确定继续吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSubmitting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteSubmitting}
              onClick={(event) => {
                event.preventDefault()
                void handleDelete()
              }}
            >
              {deleteSubmitting ? "删除中..." : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <VersionHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        title={`${title}历史版本`}
        description="展示当前单据下的历史版本快照。"
        rows={recordsToVersionHistoryRows(selected?.historyRecords || [])}
        highlightVersionCode={selected?.latestVersionCode}
      />
    </ModuleShell>
  )
}

