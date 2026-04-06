"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"

type MaybeCheckoutRecord = {
  checkoutStatus?: "checked_in" | "checked_out"
} | null | undefined

type UnsavedNavigationContextValue = {
  isDirty: boolean
  /** href the user tried to navigate to; null = no pending navigation */
  pendingHref: string | null
  requestNavigation: (href: string) => boolean
  confirmNavigation: () => void
  cancelNavigation: () => void
}

const UnsavedSetDirtyContext = createContext<((v: boolean) => void) | null>(null)
const UnsavedNavigationContext = createContext<UnsavedNavigationContextValue | null>(null)

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const [isDirty, setIsDirty] = useState(false)
  const [pendingHref, setPendingHref] = useState<string | null>(null)

  const setDirty = useCallback((v: boolean) => {
    setIsDirty(v)
  }, [])

  const requestNavigation = useCallback(
    (href: string): boolean => {
      if (!isDirty) return true
      setPendingHref(href)
      return false
    },
    [isDirty],
  )

  const confirmNavigation = useCallback(() => {
    setIsDirty(false)
    setPendingHref(null)
  }, [])

  const cancelNavigation = useCallback(() => {
    setPendingHref(null)
  }, [])

  const navigationValue = useMemo<UnsavedNavigationContextValue>(
    () => ({ isDirty, pendingHref, requestNavigation, confirmNavigation, cancelNavigation }),
    [isDirty, pendingHref, requestNavigation, confirmNavigation, cancelNavigation],
  )

  return (
    <UnsavedSetDirtyContext.Provider value={setDirty}>
      <UnsavedNavigationContext.Provider value={navigationValue}>{children}</UnsavedNavigationContext.Provider>
    </UnsavedSetDirtyContext.Provider>
  )
}

/** 仅标记脏数据；不订阅导航状态，避免重页在 pendingHref / isDirty 变化时整页重渲染 */
export function useSetUnsavedDirty() {
  const setDirty = useContext(UnsavedSetDirtyContext)
  if (!setDirty) throw new Error("useSetUnsavedDirty must be used within UnsavedChangesProvider")
  return setDirty
}

/** 侧栏拦截导航与确认弹窗 */
export function useUnsavedNavigation() {
  const ctx = useContext(UnsavedNavigationContext)
  if (!ctx) throw new Error("useUnsavedNavigation must be used within UnsavedChangesProvider")
  return ctx
}

/** 已检入版本为只读浏览态，不应触发未保存离开提醒 */
export function shouldSuppressUnsavedPrompt(record: MaybeCheckoutRecord): boolean {
  return record?.checkoutStatus === "checked_in"
}
