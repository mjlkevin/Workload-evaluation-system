"use client"

import { useEffect, useState } from "react"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { AuthGate } from "@/components/workload/auth-gate"
import { UnsavedChangesProvider } from "@/hooks/use-unsaved-changes"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [embedded, setEmbedded] = useState(() => {
    if (typeof window === "undefined") return false
    const params = new URLSearchParams(window.location.search)
    return params.get("embed") === "1"
  })

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setEmbedded(params.get("embed") === "1")
  }, [])

  useEffect(() => {
    if (embedded) {
      document.documentElement.classList.add("embed-mode")
      document.body.classList.add("embed-mode")
    } else {
      document.documentElement.classList.remove("embed-mode")
      document.body.classList.remove("embed-mode")
    }
    return () => {
      document.documentElement.classList.remove("embed-mode")
      document.body.classList.remove("embed-mode")
    }
  }, [embedded])

  return (
    <AuthGate>
      <UnsavedChangesProvider>
        <SidebarProvider>
          {!embedded ? <AppSidebar /> : null}
          {embedded ? <main className="embed-view bg-background min-h-screen">{children}</main> : <SidebarInset className="bg-background">{children}</SidebarInset>}
        </SidebarProvider>
      </UnsavedChangesProvider>
    </AuthGate>
  )
}
