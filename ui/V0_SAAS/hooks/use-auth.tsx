"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { apiRequest, getStoredToken } from "@/lib/api-client"
import { clearDashboardTabsState } from "@/lib/dashboard-tabs-state"

export type AuthUser = {
  id: string
  username: string
  role: "admin" | "sub_admin" | "user"
  status: "active" | "disabled"
  createdAt: string
  lastLoginAt: string
}

type AuthContextValue = {
  token: string
  user: AuthUser | null
  loading: boolean
  initialized: boolean
  isAdmin: boolean
  /** 用户管理（含子管理员）；系统管理/API 等仍仅用 isAdmin */
  canManageUsers: boolean
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string, inviteCode: string) => Promise<void>
  logout: () => Promise<void>
  refresh: (signal?: AbortSignal) => Promise<void>
}

const AUTH_TOKEN_KEY = "workload-auth-token-v1"

function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true
  if (e instanceof Error && e.name === "AbortError") return true
  return false
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState("")
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(false)
  const [initialized, setInitialized] = useState(false)

  const clearAuth = useCallback(() => {
    setToken("")
    setUser(null)
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(AUTH_TOKEN_KEY)
    }
    clearDashboardTabsState()
  }, [])

  const applyAuth = useCallback((nextToken: string, nextUser: AuthUser) => {
    setToken(nextToken)
    setUser(nextUser)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(AUTH_TOKEN_KEY, nextToken)
    }
  }, [])

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const localToken = getStoredToken()
      if (!localToken) {
        clearAuth()
        return
      }
      setLoading(true)
      try {
        const data = await apiRequest<{ user: AuthUser }>("/api/v1/auth/me", { token: localToken, signal })
        // 登录/注册可能已换新 token；勿用旧 /me 响应覆盖或误清会话
        if (getStoredToken() !== localToken) return
        applyAuth(localToken, data.user)
      } catch (e) {
        if (isAbortError(e)) return
        if (getStoredToken() === localToken) clearAuth()
      } finally {
        setLoading(false)
      }
    },
    [applyAuth, clearAuth],
  )

  const login = useCallback(
    async (username: string, password: string) => {
      setLoading(true)
      try {
        const data = await apiRequest<{ token: string; user: AuthUser }>("/api/v1/auth/login", {
          method: "POST",
          body: { username, password },
        })
        applyAuth(data.token, data.user)
      } finally {
        setLoading(false)
      }
    },
    [applyAuth],
  )

  const register = useCallback(
    async (username: string, password: string, inviteCode: string) => {
      setLoading(true)
      try {
        const data = await apiRequest<{ token: string; user: AuthUser }>("/api/v1/auth/register", {
          method: "POST",
          body: { username, password, inviteCode },
        })
        applyAuth(data.token, data.user)
      } finally {
        setLoading(false)
      }
    },
    [applyAuth],
  )

  const logout = useCallback(async () => {
    const localToken = getStoredToken()
    try {
      if (localToken) {
        await apiRequest<{ success: boolean }>("/api/v1/auth/logout", {
          method: "POST",
          token: localToken,
        })
      }
    } catch {
      // ignore network/auth errors on logout
    } finally {
      clearAuth()
    }
  }, [clearAuth])

  useEffect(() => {
    const ac = new AbortController()
    const id = window.setTimeout(() => ac.abort(), 12_000)
    void refresh(ac.signal).finally(() => {
      window.clearTimeout(id)
      setInitialized(true)
    })
    return () => {
      window.clearTimeout(id)
      ac.abort()
    }
  }, [refresh])

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      loading,
      initialized,
      isAdmin: user?.role === "admin",
      canManageUsers: user?.role === "admin" || user?.role === "sub_admin",
      login,
      register,
      logout,
      refresh,
    }),
    [token, user, loading, initialized, login, register, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider")
  }
  return ctx
}
