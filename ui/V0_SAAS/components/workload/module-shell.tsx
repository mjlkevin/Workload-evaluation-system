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
    <div className="flex flex-1 flex-col">
      <DashboardHeader title={title} breadcrumbs={breadcrumbs || [{ label: title }]} />
      <div className="flex-1 space-y-6 p-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {children}
      </div>
    </div>
  )
}
