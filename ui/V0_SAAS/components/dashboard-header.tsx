"use client"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Bell, Plus } from "lucide-react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

interface DashboardHeaderProps {
  title: string
  breadcrumbs?: Array<{ label: string; href?: string }>
}

export function DashboardHeader({ title, breadcrumbs }: DashboardHeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-4 border-b border-border/40 bg-background/80 px-6 backdrop-blur-xl">
      <SidebarTrigger className="-ml-2 rounded-lg" />
      <Separator orientation="vertical" className="h-6 opacity-50" />
      
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/dashboard" className="text-muted-foreground hover:text-foreground">
              工作台
            </BreadcrumbLink>
          </BreadcrumbItem>
          {breadcrumbs?.flatMap((crumb, index) => [
            <BreadcrumbSeparator key={`sep-${index}`} />,
            <BreadcrumbItem key={`item-${index}`}>
              {crumb.href ? (
                <BreadcrumbLink href={crumb.href} className="text-muted-foreground hover:text-foreground">
                  {crumb.label}
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage className="font-medium">{crumb.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          ])}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="icon" className="rounded-xl relative">
          <Bell className="size-4" />
          <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-accent text-[9px] font-medium text-accent-foreground">
            5
          </span>
        </Button>
        <Button className="rounded-xl gap-2 bg-foreground text-background hover:bg-foreground/90">
          <Plus className="size-4" />
          新建
        </Button>
      </div>
    </header>
  )
}
