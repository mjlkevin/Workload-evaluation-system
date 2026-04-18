"use client"

import { useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { useUnsavedNavigation } from "@/hooks/use-unsaved-changes"
import { DASHBOARD_TABS_STORAGE_KEY } from "@/lib/dashboard-tabs-state"

type DashboardTab = {
  path: string
  title: string
}

const TAB_TITLE_MAP: Record<string, string> = {
  "/dashboard": "主页",
  "/dashboard/requirement-import": "需求",
  "/dashboard/requirement-import/list": "需求列表",
  "/dashboard/assessment": "实施评估",
  "/dashboard/assessment/list": "实施评估列表",
  "/dashboard/resource-cost": "资源人天及成本",
  "/dashboard/dev-assessment": "开发评估",
  "/dashboard/wbs": "WBS",
  "/dashboard/review": "评审",
  "/dashboard/team-collaboration": "团队协同",
  "/dashboard/user-management": "用户管理",
  "/dashboard/system-management": "系统管理",
  "/dashboard/api-keys": "API",
  "/dashboard/settings": "设置",
  "/dashboard/team": "团队",
  "/dashboard/projects": "项目",
  "/dashboard/analytics": "分析",
}

function resolveTabTitle(path: string) {
  const purePath = path.split("?")[0] || path
  if (TAB_TITLE_MAP[purePath]) return TAB_TITLE_MAP[purePath]
  const segments = purePath.split("/").filter(Boolean)
  const last = segments[segments.length - 1] || "页面"
  return decodeURIComponent(last)
}

function normalizeTabPath(path: string): string {
  const raw = String(path || "").trim()
  if (!raw) return "/dashboard"
  const [basePath, query = ""] = raw.split("?")
  if (!query) return basePath || "/dashboard"
  const params = new URLSearchParams(query)
  // 从列表双击进入编辑页会携带随机 tabKey，仅用于强制新开；去重时应忽略。
  params.delete("tabKey")
  const entries = [...params.entries()].sort(([aKey, aVal], [bKey, bVal]) => {
    const keyOrder = aKey.localeCompare(bKey)
    return keyOrder !== 0 ? keyOrder : aVal.localeCompare(bVal)
  })
  if (!entries.length) return basePath || "/dashboard"
  const normalizedQuery = new URLSearchParams(entries).toString()
  return `${basePath || "/dashboard"}?${normalizedQuery}`
}

function normalizeTabs(input: DashboardTab[]): DashboardTab[] {
  const seen = new Set<string>()
  const normalized: DashboardTab[] = []
  for (const tab of input) {
    const path = String(tab.path || "").trim()
    if (!path.startsWith("/dashboard")) continue
    const dedupeKey = normalizeTabPath(path)
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    normalized.push({ path, title: resolveTabTitle(path) })
  }
  return normalized
}

export function DashboardTabs() {
  const pathname = usePathname() || "/dashboard"
  const searchParams = useSearchParams()
  const router = useRouter()
  const { requestNavigation } = useUnsavedNavigation()
  const [tabs, setTabs] = useState<DashboardTab[]>([])
  const [ready, setReady] = useState(false)

  const currentRouteKey = useMemo(() => {
    const query = searchParams?.toString() || ""
    return query ? `${pathname}?${query}` : pathname
  }, [pathname, searchParams])

  useEffect(() => {
    if (typeof window === "undefined") return
    let restored: DashboardTab[] = []
    try {
      const raw = window.localStorage.getItem(DASHBOARD_TABS_STORAGE_KEY)
      if (raw) restored = JSON.parse(raw) as DashboardTab[]
    } catch {
      restored = []
    }
    const merged = normalizeTabs([...restored, { path: currentRouteKey, title: resolveTabTitle(pathname) }])
    setTabs(merged.length ? merged : [{ path: "/dashboard", title: resolveTabTitle("/dashboard") }])
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    const currentDedupeKey = normalizeTabPath(currentRouteKey)
    const existing = tabs.find((tab) => normalizeTabPath(tab.path) === currentDedupeKey)
    if (existing && existing.path !== currentRouteKey) {
      // 命中重复版本页签：不新增，直接切回已存在页签。
      router.replace(existing.path)
    }
  }, [currentRouteKey, ready, tabs, router])

  useEffect(() => {
    if (!ready) return
    const currentDedupeKey = normalizeTabPath(currentRouteKey)
    setTabs((prev) => {
      if (prev.some((tab) => normalizeTabPath(tab.path) === currentDedupeKey)) return prev
      return normalizeTabs([...prev, { path: currentRouteKey, title: resolveTabTitle(pathname) }])
    })
  }, [pathname, currentRouteKey, ready])

  useEffect(() => {
    if (!ready || typeof window === "undefined") return
    window.localStorage.setItem(DASHBOARD_TABS_STORAGE_KEY, JSON.stringify(tabs))
  }, [tabs, ready])

  const activePath = useMemo(() => currentRouteKey, [currentRouteKey])

  function openTab(path: string) {
    if (path === activePath) return
    if (!requestNavigation(path)) return
    router.push(path)
  }

  function closeTab(path: string) {
    if (tabs.length <= 1) return
    const nextTabs = tabs.filter((tab) => tab.path !== path)
    if (!nextTabs.length) return
    if (path === activePath) {
      const fallbackPath = nextTabs[nextTabs.length - 1]?.path || "/dashboard"
      if (!requestNavigation(fallbackPath)) return
      setTabs(nextTabs)
      router.push(fallbackPath)
      return
    }
    setTabs(nextTabs)
  }

  function closeOtherTabs(path: string) {
    const kept = tabs.find((tab) => tab.path === path) || { path, title: resolveTabTitle(path) }
    setTabs([kept])
    if (activePath !== path) {
      if (!requestNavigation(path)) return
      router.push(path)
    }
  }

  function closeAllTabs(path: string) {
    const fallback = { path: "/dashboard", title: resolveTabTitle("/dashboard") }
    setTabs([fallback])
    if (path !== "/dashboard" && activePath !== "/dashboard") {
      if (!requestNavigation("/dashboard")) return
      router.push("/dashboard")
    } else if (activePath !== "/dashboard") {
      if (!requestNavigation("/dashboard")) return
      router.push("/dashboard")
    }
  }

  if (!ready) return null

  return (
    <div className="w-full overflow-x-auto">
      <div className="flex min-w-max items-center gap-1">
        {tabs.map((tab) => {
          const isActive = tab.path === activePath
          return (
            <ContextMenu key={tab.path}>
              <ContextMenuTrigger>
                <div
                  className={cn(
                    "group flex min-h-8 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm",
                    isActive
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border/60 bg-background/70 text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  <button type="button" className="max-w-[180px] truncate text-left" onClick={() => openTab(tab.path)}>
                    {tab.title}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 rounded p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => closeTab(tab.path)}
                    aria-label="关闭页签"
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-36 rounded-lg">
                <ContextMenuItem onClick={() => closeTab(tab.path)}>关闭页签</ContextMenuItem>
                <ContextMenuItem onClick={() => closeOtherTabs(tab.path)}>关闭其他页签</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => closeAllTabs(tab.path)}>关闭所有页签</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </div>
    </div>
  )
}

