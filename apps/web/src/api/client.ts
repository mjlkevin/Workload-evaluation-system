import axios from 'axios'
import { ElMessage } from 'element-plus'

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api/v1'

export const apiClient = axios.create({
  baseURL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器：自动附加 JWT
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('workload-auth-token-v1')
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// 响应拦截器：统一错误提示 + 401 自动登出
apiClient.interceptors.response.use(
  (response) => {
    const data = response.data
    // 后端统一响应格式 A：{ code, message, data, requestId }
    if (data && typeof data.code === 'number' && data.code !== 0) {
      ElMessage.error(data.message || '请求失败')
      return Promise.reject(new Error(data.message || '请求失败'))
    }
    // 后端统一响应格式 B：{ success, data }（presales / pm 等模块）
    if (data && data.success === false) {
      const msg = data.message || data.error || '请求失败'
      ElMessage.error(msg)
      return Promise.reject(new Error(msg))
    }
    return response
  },
  (error) => {
    if (error.response?.status === 401) {
      ElMessage.error('登录已过期，请重新登录')
      localStorage.removeItem('workload-auth-token-v1')
      window.location.href = '/login'
    } else {
      ElMessage.error(error.message || '网络错误')
    }
    return Promise.reject(error)
  }
)

// 便捷封装：直接返回 data.data
export async function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const res = await apiClient.get(url, { params })
  return res.data.data as T
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const res = await apiClient.post(url, body)
  return res.data.data as T
}

export async function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  const res = await apiClient.patch(url, body)
  return res.data.data as T
}

export async function apiDelete<T>(url: string): Promise<T> {
  const res = await apiClient.delete(url)
  return res.data.data as T
}
