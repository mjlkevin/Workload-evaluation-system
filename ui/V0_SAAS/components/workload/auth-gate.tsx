"use client"

import { useEffect, useRef } from "react"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, initialized, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const redirected = useRef(false)

  const nextParam = pathname || "/dashboard"
  const loginHref = `/login?next=${encodeURIComponent(nextParam)}`

  useEffect(() => {
    if (!initialized || loading) return
    if (!user && !redirected.current) {
      redirected.current = true
      router.replace(`/login?next=${encodeURIComponent(pathname || "/dashboard")}`)
    }
  }, [initialized, loading, user, router, pathname])

  if (!initialized || loading) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background px-6 text-foreground">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span>正在校验登录状态…</span>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
        <p className="text-sm text-muted-foreground">需要登录后才能进入工作台</p>
        <p className="text-xs text-muted-foreground">若页面长时间空白，请手动进入登录页</p>
        <Link
          href={loginHref}
          className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90"
        >
          前往登录
        </Link>
      </div>
    )
  }

  return <>{children}</>
}
