import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiClient } from '@/api/client'
import type { AppRole } from '@/router'

export interface AuthUser {
  id: string
  username: string
  role: 'admin' | 'sub_admin' | 'user'
  status: 'active' | 'disabled'
  createdAt: string
  lastLoginAt: string
}

const TOKEN_KEY = 'workload-auth-token-v1'

function resolveAppRoles(serverRole: AuthUser['role']): AppRole[] {
  // 当前后端角色较粗，映射到业务角色用于前端权限控制
  // admin 通吃所有角色权限
  if (serverRole === 'admin') {
    return ['ADMIN', 'PRE_SALES', 'PM', 'PMO', 'SALES', 'DEV']
  }
  if (serverRole === 'sub_admin') {
    return ['PMO', 'PM', 'SALES', 'DEV']
  }
  // 普通 user 暂时赋予 PM / PRE_SALES 用于演示（后续按真实业务调整）
  return ['PM', 'PRE_SALES', 'DEV']
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string>(localStorage.getItem(TOKEN_KEY) || '')
  const user = ref<AuthUser | null>(null)
  const loading = ref(false)

  const isLoggedIn = computed(() => !!token.value && !!user.value)
  const isAdmin = computed(() => user.value?.role === 'admin')

  const appRoles = computed<AppRole[]>(() => {
    if (!user.value) return []
    return resolveAppRoles(user.value.role)
  })

  function hasAnyRole(roles: AppRole[]): boolean {
    return roles.some((r) => appRoles.value.includes(r))
  }

  function setAuth(newToken: string, newUser: AuthUser) {
    token.value = newToken
    user.value = newUser
    localStorage.setItem(TOKEN_KEY, newToken)
  }

  function clearAuth() {
    token.value = ''
    user.value = null
    localStorage.removeItem(TOKEN_KEY)
  }

  async function login(username: string, password: string): Promise<void> {
    loading.value = true
    try {
      const res = await apiClient.post('/auth/login', { username, password })
      const data = res.data.data as { token: string; user: AuthUser }
      setAuth(data.token, data.user)
    } finally {
      loading.value = false
    }
  }

  async function fetchMe(): Promise<void> {
    if (!token.value) return
    try {
      const res = await apiClient.get('/auth/me')
      const data = res.data.data as { user: AuthUser }
      user.value = data.user
    } catch {
      clearAuth()
    }
  }

  function logout() {
    clearAuth()
  }

  // 初始化：如果本地有 token，尝试恢复用户态
  async function init() {
    if (token.value) {
      await fetchMe()
      if (!user.value) {
        clearAuth()
      }
    }
  }

  return {
    token,
    user,
    loading,
    isLoggedIn,
    isAdmin,
    appRoles,
    hasAnyRole,
    login,
    fetchMe,
    logout,
    init,
    setAuth,
    clearAuth,
  }
})
