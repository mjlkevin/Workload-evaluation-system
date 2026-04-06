"use client"

import { Button } from "@/components/ui/button"
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
  alwaysShowActions?: boolean
  showStatusField?: boolean
  onVersionHistory: () => void
  onCheckout: () => void
  onCheckin: () => void
  onUndoCheckout: () => void
  onPromote: () => void
  onForceUnlock?: () => void
  forceUnlockVisible?: boolean
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
  const btnSize = compact ? "sm" : "default"
  const btnClass = compact ? "rounded-lg" : "rounded-xl"

  return (
    <>
      <Button type="button" variant="outline" size={btnSize} className={btnClass} onClick={onVersionHistory}>
        版本历史
      </Button>
      {canRenderActions ? (
        <>
          <Button variant="outline" size={btnSize} className={btnClass} disabled={!hasState || checkoutStatus === "checked_out"} onClick={onCheckout}>
            检出
          </Button>
          <Button variant="outline" size={btnSize} className={btnClass} disabled={!hasState || checkoutStatus === "checked_in"} onClick={onCheckin}>
            检入
          </Button>
          <Button variant="outline" size={btnSize} className={btnClass} disabled={!hasState || checkoutStatus === "checked_in"} onClick={onUndoCheckout}>
            撤销检出
          </Button>
          <Button variant="outline" size={btnSize} className={btnClass} disabled={!hasState || checkoutStatus === "checked_out"} onClick={onPromote}>
            升版
          </Button>
          {forceUnlockVisible && onForceUnlock ? (
            <Button variant="outline" size={btnSize} className={btnClass} disabled={!hasState || checkoutStatus === "checked_in"} onClick={onForceUnlock}>
              强制解锁
            </Button>
          ) : null}
          {showStatusField ? <VersionCheckoutStatusDisplay state={state} compact={compact} /> : null}
        </>
      ) : null}
    </>
  )
}
