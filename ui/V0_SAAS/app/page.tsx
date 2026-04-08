"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/dashboard")
  }, [router])

  return (
    <div
      className="flex min-h-svh flex-col items-center justify-center gap-2 bg-background px-6 text-foreground"
      style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
    >
      <p className="text-sm text-muted-foreground">正在进入工作台…</p>
      <p className="text-xs text-muted-foreground">若长时间无响应，请直接打开 /login</p>
    </div>
  )
}
