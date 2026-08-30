import { getToken, clearToken } from './auth'
import { ApiError, NetworkError } from './errors'
import { goToLogin } from '../utils/authRedirect'

const BASE = '/api/v1'

async function request(method, path, {
  body,
  params,
  formData,
  suppressUnauthorizedRedirect = false,
  timeoutMs = 0,
} = {}) {
  let url = `${BASE}${path}`
  if (params) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') {
        qs.set(k, v)
      }
    }
    const q = qs.toString()
    if (q) url += `?${q}`
  }

  const headers = {}
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  if (!formData) {
    headers['Content-Type'] = 'application/json'
  }

  let res
  const controller = Number.isFinite(timeoutMs) && timeoutMs > 0 ? new AbortController() : null
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    res = await fetch(url, {
      method,
      headers,
      body: formData || (body ? JSON.stringify(body) : undefined),
      ...(controller ? { signal: controller.signal } : {}),
    })
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new NetworkError('请求超时，请稍后重试', e)
    }
    throw new NetworkError('网络请求失败', e)
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }

  if (res.status === 401) {
    clearToken()
    if (!suppressUnauthorizedRedirect && window.location.pathname !== '/login') {
      goToLogin(`${window.location.pathname}${window.location.search}${window.location.hash}`)
    }
    throw new ApiError(401, 'UNAUTHORIZED', '登录已过期，请重新登录')
  }

  if (!res.ok) {
    let payload
    try { payload = await res.json() } catch (_) { /* ignore */ }
    throw new ApiError(
      res.status,
      payload?.code || 'UNKNOWN',
      payload?.message || `请求失败 (${res.status})`,
      payload?.details
    )
  }

  if (res.status === 204) return null
  return res.json()
}

export const apiClient = {
  get:    (path, params, options) => request('GET', path, { params, ...options }),
  post:   (path, body, options)   => request('POST', path, { body, ...options }),
  put:    (path, body, options)   => request('PUT', path, { body, ...options }),
  patch:  (path, body, options)   => request('PATCH', path, { body, ...options }),
  delete: (path, options)         => request('DELETE', path, options),
  upload: (path, formData, options) => request('POST', path, { formData, ...options }),
}
