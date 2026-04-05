"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export type VersionVcsState = {
  recordId: string
  checkoutStatus: "checked_in" | "checked_out"
  versionDocStatus: "drafting" | "reviewed"
  checkedOutByUsername?: string
}

type VersionVcsToolbarProps = {
  state?: VersionVcsState
  showHistory: boolean
  onToggleHistory: () => void
  onCheckout: () => void
  onCheckin: () => void
  onUndoCheckout: () => void
  onPromote: () => void
  onForceUnlock?: () => void
  forceUnlockVisible?: boolean
}

export function VersionVcsToolbar({
  state,
  showHistory,
  onToggleHistory,
  onCheckout,
  onCheckin,
  onUndoCheckout,
  onPromote,
  onForceUnlock,
  forceUnlockVisible = false,
}: VersionVcsToolbarProps) {
  return (
    <>
      <Button variant="outline" className="rounded-xl" onClick={onToggleHistory}>
        {showHistory ? "隐藏历史版本" : "显示历史版本"}
      </Button>
      {state ? (
        <>
          <Button variant="outline" className="rounded-xl" disabled={state.checkoutStatus === "checked_out"} onClick={onCheckout}>
            检出
          </Button>
          <Button variant="outline" className="rounded-xl" disabled={state.checkoutStatus === "checked_in"} onClick={onCheckin}>
            检入
          </Button>
          <Button variant="outline" className="rounded-xl" disabled={state.checkoutStatus === "checked_in"} onClick={onUndoCheckout}>
            撤销检出
          </Button>
          <Button variant="outline" className="rounded-xl" disabled={state.checkoutStatus === "checked_out"} onClick={onPromote}>
            升版
          </Button>
          {forceUnlockVisible && onForceUnlock ? (
            <Button variant="outline" className="rounded-xl" disabled={state.checkoutStatus === "checked_in"} onClick={onForceUnlock}>
              强制解锁
            </Button>
          ) : null}
          <Badge variant={state.checkoutStatus === "checked_out" ? "default" : "secondary"} className="rounded-lg">
            {state.checkoutStatus === "checked_out" ? `已检出（${state.checkedOutByUsername || "未知"}）` : "已检入"}
            {state.versionDocStatus === "reviewed" ? " · 已审核" : ""}
          </Badge>
        </>
      ) : null}
    </>
  )
}
