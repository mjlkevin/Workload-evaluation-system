"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"

type UnsavedChangesContextValue = {
  isDirty: boolean
  setDirty: (v: boolean) => void
  /** href the user tried to navigate to; null = no pending navigation */
  pendingHref: string | null
  requestNavigation: (href: string) => boolean // returns true if navigation is allowed immediately
  confirmNavigation: () => void
  cancelNavigation: () => void
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null)

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const [isDirty, setIsDirty] = useState(false)
  const [pendingHref, setPendingHref] = useState<string | null>(null)

  const setDirty = useCallback((v: boolean) => setIsDirty(v), [])

  // Returns true = navigate immediately; false = blocked, show dialog
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

  const value = useMemo<UnsavedChangesContextValue>(
    () => ({ isDirty, setDirty, pendingHref, requestNavigation, confirmNavigation, cancelNavigation }),
    [isDirty, setDirty, pendingHref, requestNavigation, confirmNavigation, cancelNavigation],
  )

  return <UnsavedChangesContext.Provider value={value}>{children}</UnsavedChangesContext.Provider>
}

export function useUnsavedChanges() {
  const ctx = useContext(UnsavedChangesContext)
  if (!ctx) throw new Error("useUnsavedChanges must be used within UnsavedChangesProvider")
  return ctx
}
