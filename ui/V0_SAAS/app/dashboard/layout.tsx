import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { AuthGate } from "@/components/workload/auth-gate"
import { UnsavedChangesProvider } from "@/hooks/use-unsaved-changes"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthGate>
      <UnsavedChangesProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset className="bg-background">{children}</SidebarInset>
        </SidebarProvider>
      </UnsavedChangesProvider>
    </AuthGate>
  )
}
