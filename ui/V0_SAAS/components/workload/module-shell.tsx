"use client"

import { DashboardHeader } from "@/components/dashboard-header"

type ModuleShellProps = {
  title: string
  /** 不传则不展示副标题段落 */
  description?: string
  /** 为 false 时不渲染页面主标题 h1 与副标题（顶栏面包屑仍可用） */
  showPageHeading?: boolean
  breadcrumbs?: Array<{ label: string; href?: string }>
  children: React.ReactNode
}

export function ModuleShell({
  title,
  description,
  showPageHeading = true,
  breadcrumbs,
  children,
}: ModuleShellProps) {
  const desc = description?.trim()
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <DashboardHeader title={title} breadcrumbs={breadcrumbs || [{ label: title }]} />
      <div className="min-w-0 flex-1 space-y-6 p-6">
        {showPageHeading ? (
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="shrink-0 text-2xl font-semibold tracking-tight">{title}</h1>
            {desc ? <p className="min-w-0 flex-1 text-sm text-muted-foreground">{desc}</p> : null}
          </div>
        ) : desc ? (
          <p className="min-w-0 text-sm text-muted-foreground">{desc}</p>
        ) : null}
        {children}
      </div>
    </div>
  )
}
