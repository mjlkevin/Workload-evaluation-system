"use client"

import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { apiRequest, getStoredToken } from "@/lib/api-client"

export type AuthUser = {
  id: string
  username: string
  role: "admin" | "user"
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
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string, inviteCode: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AUTH_TOKEN_KEY = "workload-auth-token-v1"

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState("")
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(false)
  const [initialized, setInitialized] = useState(false)

  const clearAuth = () => {
    setToken("")
    setUser(null)
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(AUTH_TOKEN_KEY)
    }
  }

  const applyAuth = (nextToken: string, nextUser: AuthUser) => {
    setToken(nextToken)
    setUser(nextUser)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(AUTH_TOKEN_KEY, nextToken)
    }
  }

  const refresh = async () => {
    const localToken = getStoredToken()
    if (!localToken) {
      clearAuth()
      return
    }
    setLoading(true)
    try {
      const data = await apiRequest<{ user: AuthUser }>("/api/v1/auth/me", { token: localToken })
      applyAuth(localToken, data.user)
    } catch {
      clearAuth()
    } finally {
      setLoading(false)
    }
  }

  const login = async (username: string, password: string) => {
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
  }

  const register = async (username: string, password: string, inviteCode: string) => {
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
  }

  const logout = async () => {
    const localToken = token || getStoredToken()
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
  }

  useEffect(() => {
    void refresh().finally(() => setInitialized(true))
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      loading,
      initialized,
      isAdmin: user?.role === "admin",
      login,
      register,
      logout,
      refresh,
    }),
    [token, user, loading, initialized],
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
