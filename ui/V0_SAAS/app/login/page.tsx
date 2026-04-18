"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/hooks/use-auth"

export default function LoginPage() {
  const [isRegister, setIsRegister] = useState(false)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [inviteCode, setInviteCode] = useState("")
  const [error, setError] = useState("")

  const { login, register, user, initialized, loading } = useAuth()
  const router = useRouter()
  const [nextPath, setNextPath] = useState("/dashboard")

  useEffect(() => {
    if (typeof window === "undefined") return
    const raw = new URLSearchParams(window.location.search).get("next")
    setNextPath(raw || "/dashboard")
  }, [])

  useEffect(() => {
    if (!initialized) return
    if (user) router.replace(nextPath)
  }, [initialized, user, router, nextPath])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    e.stopPropagation()
    setError("")
    try {
      if (isRegister) {
        await register(username.trim(), password, inviteCode.trim())
      } else {
        await login(username.trim(), password)
      }
      // 登录成功后立刻跳转；useAuth 已避免陈旧 /me 清掉新 token，可与下方 effect 并存
      router.replace(nextPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请稍后重试")
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background to-secondary/30 p-6">
      <Card className="w-full max-w-md border-border/40">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-foreground">
              <Sparkles className="size-4 text-background" />
            </div>
            <span className="text-sm font-medium text-muted-foreground">WorkEvolutionSys</span>
          </div>
          <CardTitle>{isRegister ? "注册并登录" : "登录系统"}</CardTitle>
          {isRegister ? (
            <CardDescription>输入用户名、密码和推荐码完成注册</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent>
          <form className="space-y-4" method="post" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名"
                autoComplete="username"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码（至少8位）"
                autoComplete={isRegister ? "new-password" : "current-password"}
                required
              />
            </div>
            {isRegister ? (
              <div className="space-y-2">
                <Label htmlFor="inviteCode">推荐码</Label>
                <Input
                  id="inviteCode"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="请输入推荐码"
                  required
                />
              </div>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full rounded-xl" disabled={loading}>
              {loading ? "提交中..." : isRegister ? "注册并登录" : "登录"}
            </Button>
          </form>
          <Button
            type="button"
            variant="link"
            className="mt-2 w-full"
            disabled={loading}
            onClick={() => {
              setError("")
              setIsRegister((v) => !v)
            }}
          >
            {isRegister ? "已有账号，去登录" : "没有账号，去注册"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
