"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

export type VersionHistoryRow = {
  id: string
  versionCode: string
  updatedAt: string
  checkoutStatus: "checked_in" | "checked_out"
  versionDocStatus: "drafting" | "reviewed"
  status: string
  isHistoricalArchive: boolean
}

export function recordsToVersionHistoryRows(
  records: Array<{
    id: string
    versionCode: string
    updatedAt: string
    checkoutStatus: "checked_in" | "checked_out"
    versionDocStatus: "drafting" | "reviewed"
    status: string
    isHistoricalArchive: boolean
  }>,
): VersionHistoryRow[] {
  return records.map((r) => ({
    id: r.id,
    versionCode: r.versionCode,
    updatedAt: r.updatedAt,
    checkoutStatus: r.checkoutStatus,
    versionDocStatus: r.versionDocStatus,
    status: r.status,
    isHistoricalArchive: r.isHistoricalArchive,
  }))
}

function formatCheckout(s: VersionHistoryRow["checkoutStatus"]) {
  return s === "checked_out" ? "已检出" : "已检入"
}

function formatDocStatus(s: VersionHistoryRow["versionDocStatus"]) {
  return s === "reviewed" ? "已审核" : "修订中"
}

function formatRecordStatus(s: string) {
  const m: Record<string, string> = {
    draft: "草稿",
    reviewed: "已审核",
    published: "已发布",
    archived: "已归档",
  }
  return m[s] || s
}

export function VersionHistoryDialog({
  open,
  onOpenChange,
  title,
  description,
  rows,
  highlightVersionCode,
  latestRecordId,
  onCreateFromHistory,
  createFromHistoryLoading,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  rows: VersionHistoryRow[]
  highlightVersionCode?: string
  /** 当前生效（最新）记录 id；与选中行相同时禁用「按历史版本创建新版」 */
  latestRecordId?: string
  /** 基于选中行的快照创建新版本（版本号由后端递增，仅最新版在主页可选） */
  onCreateFromHistory?: (row: VersionHistoryRow) => void | Promise<void>
  createFromHistoryLoading?: boolean
}) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt))),
    [rows],
  )

  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setSelectedId(null)
      return
    }
    if (highlightVersionCode) {
      const hit = sorted.find((r) => r.versionCode === highlightVersionCode)
      if (hit) setSelectedId(hit.id)
    }
  }, [open, highlightVersionCode, sorted])

  const canCreateFromSelection =
    Boolean(selectedId && latestRecordId && selectedId !== latestRecordId && onCreateFromHistory)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border/60 px-6 py-4 pr-12">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4 pt-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">版本号</TableHead>
                <TableHead className="whitespace-nowrap">更新时间</TableHead>
                <TableHead className="whitespace-nowrap">检出状态</TableHead>
                <TableHead className="whitespace-nowrap">文档状态</TableHead>
                <TableHead className="whitespace-nowrap">历史归档</TableHead>
                <TableHead className="whitespace-nowrap">记录状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    暂无版本记录
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((row) => {
                  const active = Boolean(highlightVersionCode && row.versionCode === highlightVersionCode)
                  const picked = row.id === selectedId
                  return (
                    <TableRow
                      key={row.id}
                      role={onCreateFromHistory ? "button" : undefined}
                      tabIndex={onCreateFromHistory ? 0 : undefined}
                      onClick={() => onCreateFromHistory && setSelectedId(row.id)}
                      onKeyDown={(e) => {
                        if (!onCreateFromHistory) return
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          setSelectedId(row.id)
                        }
                      }}
                      className={cn(
                        active && "bg-primary/10 dark:bg-primary/15",
                        picked && "ring-1 ring-inset ring-primary/40",
                        onCreateFromHistory && "cursor-pointer hover:bg-muted/40",
                      )}
                    >
                      <TableCell className="max-w-[200px] truncate font-mono text-xs" title={row.versionCode}>
                        {row.versionCode}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{row.updatedAt}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{formatCheckout(row.checkoutStatus)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{formatDocStatus(row.versionDocStatus)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{row.isHistoricalArchive ? "是" : "否"}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{formatRecordStatus(row.status)}</TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
        {onCreateFromHistory ? (
          <div className="flex flex-col gap-2 border-t border-border/60 px-6 py-3">
            <p className="text-xs text-muted-foreground">
              点击表格行选中历史快照；版本号只增不减，回退内容请使用下方操作生成新的生效版本。
            </p>
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                disabled={!canCreateFromSelection || createFromHistoryLoading}
                onClick={() => {
                  const row = sorted.find((r) => r.id === selectedId)
                  if (row) void onCreateFromHistory(row)
                }}
              >
                {createFromHistoryLoading ? "创建中…" : "按历史版本创建新版"}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
