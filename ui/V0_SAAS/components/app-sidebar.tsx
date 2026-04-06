"use client"

import {
  LayoutDashboard,
  Inbox,
  ClipboardCheck,
  Banknote,
  Code2,
  Blocks,
  FileSearch,
  Users,
  UserCog,
  ShieldCheck,
  KeyRound,
  Settings,
  Search,
  ChevronsUpDown,
  LogOut,
  Sparkles,
  AlertTriangle,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { useUnsavedNavigation } from "@/hooks/use-unsaved-changes"

const mainNavItems = [
  {
    title: "主页",
    url: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "需求",
    url: "/dashboard/requirement-import",
    icon: Inbox,
  },
  {
    title: "实施评估",
    url: "/dashboard/assessment",
    icon: ClipboardCheck,
  },
  {
    title: "资源人天及成本",
    url: "/dashboard/resource-cost",
    icon: Banknote,
  },
  {
    title: "开发评估",
    url: "/dashboard/dev-assessment",
    icon: Code2,
  },
  {
    title: "WBS",
    url: "/dashboard/wbs",
    icon: Blocks,
  },
  {
    title: "评审",
    url: "/dashboard/review",
    icon: FileSearch,
  },
  {
    title: "团队协同",
    url: "/dashboard/team-collaboration",
    icon: Users,
  },
]

const teamNavItems = [
  {
    title: "用户管理",
    url: "/dashboard/user-management",
    icon: UserCog,
  },
  {
    title: "系统管理",
    url: "/dashboard/system-management",
    icon: ShieldCheck,
  },
  {
    title: "API",
    url: "/dashboard/api-keys",
    icon: KeyRound,
  },
]

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, isAdmin, logout } = useAuth()
  const { pendingHref, requestNavigation, confirmNavigation, cancelNavigation } = useUnsavedNavigation()

  const visibleTeamNavItems = isAdmin
    ? teamNavItems
    : teamNavItems.filter(
        (item) =>
          item.url !== "/dashboard/user-management" &&
          item.url !== "/dashboard/system-management" &&
          item.url !== "/dashboard/api-keys",
      )

  function handleNavClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    const allowed = requestNavigation(href)
    if (!allowed) {
      e.preventDefault()
    }
  }

  function handleConfirm() {
    if (!pendingHref) return
    const dest = pendingHref
    confirmNavigation()
    router.push(dest)
  }

  return (
    <>
      <Sidebar className="border-r border-border/40">
        <SidebarHeader className="px-4 py-5">
          <Link
            href="/dashboard"
            className="flex items-center gap-3"
            onClick={(e) => handleNavClick(e, "/dashboard")}
          >
            <div className="flex size-9 items-center justify-center rounded-xl bg-foreground">
              <Sparkles className="size-5 text-background" />
            </div>
            <span className="text-lg font-semibold tracking-tight">Nova</span>
          </Link>
        </SidebarHeader>

        <SidebarContent className="px-2">
          {/* Search */}
          <SidebarGroup>
            <SidebarGroupContent>
              <button className="flex w-full items-center gap-3 rounded-xl bg-secondary/50 px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary">
                <Search className="size-4" />
                <span>搜索...</span>
                <kbd className="ml-auto rounded-md bg-background/50 px-2 py-0.5 text-[10px] font-medium">
                  ⌘K
                </kbd>
              </button>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarSeparator className="mx-4 my-2 opacity-50" />

          {/* Main Navigation */}
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              主菜单
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {mainNavItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={
                        item.url === "/dashboard"
                          ? pathname === item.url
                          : pathname === item.url || pathname.startsWith(`${item.url}/`)
                      }
                      className="rounded-xl px-3 py-2.5 transition-all data-[active=true]:bg-foreground data-[active=true]:text-background data-[active=true]:shadow-lg"
                    >
                      <Link href={item.url} onClick={(e) => handleNavClick(e, item.url)}>
                        <item.icon className="size-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarSeparator className="mx-4 my-2 opacity-50" />

          {/* Team Navigation */}
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              系统管理
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleTeamNavItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.url || pathname.startsWith(`${item.url}/`)}
                      className="rounded-xl px-3 py-2.5 transition-all data-[active=true]:bg-foreground data-[active=true]:text-background data-[active=true]:shadow-lg"
                    >
                      <Link href={item.url} className="relative" onClick={(e) => handleNavClick(e, item.url)}>
                        <item.icon className="size-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="border-t border-border/40 p-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    className="rounded-xl px-3 py-2.5 transition-all hover:bg-secondary"
                  >
                    <Avatar className="size-8">
                      <AvatarImage src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=32&h=32&fit=crop&crop=face" />
                      <AvatarFallback className="bg-accent text-accent-foreground text-xs">
                        {(user?.username || "U").slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col items-start text-sm">
                      <span className="font-medium">{user?.username || "未登录"}</span>
                      <span className="text-xs text-muted-foreground">
                        {user?.role === "admin" ? "管理员" : "普通用户"}
                      </span>
                    </div>
                    <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-56 rounded-xl"
                  align="end"
                  side="top"
                  sideOffset={8}
                >
                  <DropdownMenuItem className="rounded-lg" asChild>
                    <Link
                      href={isAdmin ? "/dashboard/user-management" : "/dashboard"}
                      onClick={(e) =>
                        handleNavClick(e, isAdmin ? "/dashboard/user-management" : "/dashboard")
                      }
                    >
                      <Settings className="mr-2 size-4" />
                      <span>账户设置</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="rounded-lg text-destructive"
                    onClick={() => {
                      void logout().finally(() => router.replace("/login"))
                    }}
                  >
                    <LogOut className="mr-2 size-4" />
                    <span>退出登录</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      {/* Unsaved changes confirmation dialog */}
      <Dialog open={!!pendingHref} onOpenChange={(open) => { if (!open) cancelNavigation() }}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-500" />
              有未保存的修改
            </DialogTitle>
            <DialogDescription>
              当前页面存在未保存的修改，离开后这些修改将会丢失。是否继续离开？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={cancelNavigation}>
              留在此页
            </Button>
            <Button variant="destructive" onClick={handleConfirm}>
              不保存，直接离开
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
