"use client"

export const DASHBOARD_TABS_STORAGE_KEY = "wes-dashboard-tabs-v1"

export function clearDashboardTabsState() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(DASHBOARD_TABS_STORAGE_KEY)
}
