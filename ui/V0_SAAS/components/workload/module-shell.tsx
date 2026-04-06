"use client"

import { DashboardHeader } from "@/components/dashboard-header"

type ModuleShellProps = {
  title: string
  description: string
  breadcrumbs?: Array<{ label: string; href?: string }>
  children: React.ReactNode
}

export function ModuleShell({ title, description, breadcrumbs, children }: ModuleShellProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <DashboardHeader title={title} breadcrumbs={breadcrumbs || [{ label: title }]} />
      <div className="min-w-0 flex-1 space-y-6 p-6">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="shrink-0 text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {children}
      </div>
    </div>
  )
}
