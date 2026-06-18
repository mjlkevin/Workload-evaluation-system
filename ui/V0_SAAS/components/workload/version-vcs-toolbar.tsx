"use client"

import { useState, type ReactElement } from "react"
import {
  FolderInput,
  FolderOutput,
  History,
  KeyRound,
  TrendingUp,
  Undo2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

export type VersionVcsState = {
  recordId: string
  checkoutStatus: "checked_in" | "checked_out"
  versionDocStatus: "drafting" | "reviewed"
  checkedOutByUsername?: string
}

type VersionVcsToolbarProps = {
  state?: VersionVcsState
  /** 更小按钮与状态区，用于参数条等紧凑布局 */
  compact?: boolean
  /** 仅显示图标（需配合 title/aria-label 保证可访问性） */
  iconOnly?: boolean
  alwaysShowActions?: boolean
  showStatusField?: boolean
  onVersionHistory: () => void
  onCheckout: () => void
  onCheckin: (checkinNote: string) => void | Promise<void>
  onUndoCheckout: () => void
  onPromote: () => void
  onForceUnlock?: () => void
  forceUnlockVisible?: boolean
}

function VcsTooltip({
  iconOnly,
  content,
  children,
}: {
  iconOnly: boolean
  content: string
  children: ReactElement
}) {
  if (!iconOnly) return children
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {content}
      </TooltipContent>
    </Tooltip>
  )
}

/** 检出状态只读展示：可放在表单栅格内（传 className 覆盖 min-width）或工具条内 */
export function VersionCheckoutStatusDisplay({
  state,
  compact = true,
  className,
  labelClassName,
}: {
  state?: VersionVcsState
  compact?: boolean
  className?: string
  /** 与实施评估「基本信息」等字段标签对齐时传入 text-[11px] leading-tight text-muted-foreground */
  labelClassName?: string
}) {
  const hasState = Boolean(state)
  const checkoutStatus = state?.checkoutStatus ?? "checked_in"
  const versionDocStatus = state?.versionDocStatus ?? "drafting"
  const checkedOutByUsername = state?.checkedOutByUsername
  return (
    <div
      className={cn(compact ? "min-w-[180px] space-y-0.5" : "min-w-[220px] space-y-1", className)}
    >
      <p className={cn("text-xs text-muted-foreground", labelClassName)}>检出状态</p>
      <div
        className={
          compact
            ? "h-8 w-full rounded-md border border-input bg-background px-2 text-xs leading-8"
            : "h-9 w-full rounded-md border border-input bg-background px-3 text-sm leading-9"
        }
      >
        {!hasState ? "未选择版本" : checkoutStatus === "checked_out" ? `已检出（${checkedOutByUsername || "未知"}）` : "已检入"}
        {hasState && versionDocStatus === "reviewed" ? " · 已审核" : ""}
      </div>
    </div>
  )
}

export function VersionVcsToolbar({
  state,
  compact = false,
  iconOnly = false,
  alwaysShowActions = false,
  showStatusField = true,
  onVersionHistory,
  onCheckout,
  onCheckin,
  onUndoCheckout,
  onPromote,
  onForceUnlock,
  forceUnlockVisible = false,
}: VersionVcsToolbarProps) {
  const hasState = Boolean(state)
  const canRenderActions = alwaysShowActions || hasState
  const checkoutStatus = state?.checkoutStatus ?? "checked_in"
  const btnSize = iconOnly ? (compact ? "icon-sm" : "icon") : compact ? "sm" : "default"
  const btnClass = cn(
    iconOnly ? (compact ? "rounded-lg" : "rounded-xl") : compact ? "rounded-lg text-xs" : "rounded-xl",
    "shrink-0",
  )
  const [promoteAlertOpen, setPromoteAlertOpen] = useState(false)
  const [checkinDialogOpen, setCheckinDialogOpen] = useState(false)
  const [checkinNote, setCheckinNote] = useState("")
  const [checkinNoteError, setCheckinNoteError] = useState("")
  const [checkinSubmitting, setCheckinSubmitting] = useState(false)

  function openPromoteAlert() {
    if (!hasState || checkoutStatus === "checked_out") return
    setPromoteAlertOpen(true)
  }

  function openCheckinDialog() {
    if (!hasState || checkoutStatus === "checked_in") return
    setCheckinNote("")
    setCheckinNoteError("")
    setCheckinDialogOpen(true)
  }

  async function confirmCheckin() {
    const note = checkinNote.trim() || "未说明"
    setCheckinSubmitting(true)
    try {
      await onCheckin(note)
      setCheckinDialogOpen(false)
      setCheckinNote("")
      setCheckinNoteError("")
    } catch (error) {
      setCheckinNoteError(error instanceof Error ? error.message : "检入失败")
    } finally {
      setCheckinSubmitting(false)
    }
  }

  function confirmPromote() {
    setPromoteAlertOpen(false)
    onPromote()
  }

  return (
    <>
      <VcsTooltip
        iconOnly={iconOnly}
        content="版本历史：查看总方案各历史记录，可进行对比或还原等操作。"
      >
        <Button
          type="button"
          variant="outline"
          size={btnSize}
          className={btnClass}
          onClick={onVersionHistory}
          aria-label="版本历史"
        >
          {iconOnly ? <History className="size-4" /> : "版本历史"}
        </Button>
      </VcsTooltip>
      {canRenderActions ? (
        <>
          <VcsTooltip
            iconOnly={iconOnly}
            content="检出：将当前版本切换为可编辑；检出后其他人将看到占用状态。"
          >
            <Button
              variant="outline"
              size={btnSize}
              className={btnClass}
              disabled={!hasState || checkoutStatus === "checked_out"}
              onClick={onCheckout}
              aria-label="检出"
            >
              {iconOnly ? <FolderOutput className="size-4" /> : "检出"}
            </Button>
          </VcsTooltip>
          <VcsTooltip
            iconOnly={iconOnly}
            content="检入：提交本次修改并恢复为只读，需填写检入说明。"
          >
            <Button
              variant="outline"
              size={btnSize}
              className={btnClass}
              disabled={!hasState || checkoutStatus === "checked_in"}
              onClick={openCheckinDialog}
              aria-label="检入"
            >
              {iconOnly ? <FolderInput className="size-4" /> : "检入"}
            </Button>
          </VcsTooltip>
          <VcsTooltip
            iconOnly={iconOnly}
            content="撤销检出：取消检出锁；请确认本地未提交的改动已妥善处理。"
          >
            <Button
              variant="outline"
              size={btnSize}
              className={btnClass}
              disabled={!hasState || checkoutStatus === "checked_in"}
              onClick={onUndoCheckout}
              aria-label="撤销检出"
            >
              {iconOnly ? <Undo2 className="size-4" /> : "撤销检出"}
            </Button>
          </VcsTooltip>
          <VcsTooltip
            iconOnly={iconOnly}
            content="升版：将当前版本记入历史并生成新的主版本线。"
          >
            <Button
              variant="outline"
              size={btnSize}
              className={btnClass}
              disabled={!hasState || checkoutStatus === "checked_out"}
              onClick={openPromoteAlert}
              aria-label="升版"
            >
              {iconOnly ? <TrendingUp className="size-4" /> : "升版"}
            </Button>
          </VcsTooltip>
          {forceUnlockVisible && onForceUnlock ? (
            <VcsTooltip
              iconOnly={iconOnly}
              content="强制解锁：以管理员身份解除他人检出（可能造成编辑冲突，请谨慎）。"
            >
              <Button
                variant="outline"
                size={btnSize}
                className={btnClass}
                disabled={!hasState || checkoutStatus === "checked_in"}
                onClick={onForceUnlock}
                aria-label="强制解锁"
              >
                {iconOnly ? <KeyRound className="size-4" /> : "强制解锁"}
              </Button>
            </VcsTooltip>
          ) : null}
          {showStatusField ? <VersionCheckoutStatusDisplay state={state} compact={compact} /> : null}
        </>
      ) : null}
      <Dialog open={checkinDialogOpen} onOpenChange={setCheckinDialogOpen}>
        <DialogContent className="sm:max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle>检入提醒</DialogTitle>
            <DialogDescription>检入后只读，后续修改前，先检出。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm font-medium">检入说明</p>
            <Textarea
              value={checkinNote}
              onChange={(event) => {
                setCheckinNote(event.target.value)
                if (checkinNoteError) setCheckinNoteError("")
              }}
              placeholder="请填写本次修改内容（可选，留空将记为「未说明」）"
              rows={4}
            />
            {checkinNoteError ? <p className="text-xs text-destructive">{checkinNoteError}</p> : null}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setCheckinDialogOpen(false)} disabled={checkinSubmitting}>
              取消
            </Button>
            <Button onClick={() => void confirmCheckin()} disabled={checkinSubmitting}>
              {checkinSubmitting ? "检入中..." : "确认检入"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={promoteAlertOpen} onOpenChange={setPromoteAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>升版提醒</AlertDialogTitle>
            <AlertDialogDescription>
              升版后，当前版本记入历史版本中，后续可通过【版本历史】进行回溯或还原。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPromote}>确认升版</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
