import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'

const UnsavedSetDirtyContext = createContext(null)
const UnsavedNavigationContext = createContext(null)

export function UnsavedChangesProvider({ children }) {
  const [isDirty, setIsDirty] = useState(false)
  const [pendingHref, setPendingHref] = useState(null)

  const setDirty = useCallback((value) => {
    setIsDirty(Boolean(value))
  }, [])

  const requestNavigation = useCallback((href) => {
    if (!isDirty) return true
    setPendingHref(href)
    return false
  }, [isDirty])

  const confirmNavigation = useCallback(() => {
    setIsDirty(false)
    setPendingHref(null)
  }, [])

  const cancelNavigation = useCallback(() => {
    setPendingHref(null)
  }, [])

  const navigationValue = useMemo(() => ({
    isDirty,
    pendingHref,
    requestNavigation,
    confirmNavigation,
    cancelNavigation,
  }), [isDirty, pendingHref, requestNavigation, confirmNavigation, cancelNavigation])

  return (
    <UnsavedSetDirtyContext.Provider value={setDirty}>
      <UnsavedNavigationContext.Provider value={navigationValue}>
        {children}
      </UnsavedNavigationContext.Provider>
    </UnsavedSetDirtyContext.Provider>
  )
}

export function useSetUnsavedDirty() {
  const setDirty = useContext(UnsavedSetDirtyContext)
  if (!setDirty) return () => {}
  return setDirty
}

export function useUnsavedNavigation() {
  const ctx = useContext(UnsavedNavigationContext)
  if (!ctx) {
    return {
      isDirty: false,
      pendingHref: null,
      requestNavigation: () => true,
      confirmNavigation: () => {},
      cancelNavigation: () => {},
    }
  }
  return ctx
}
