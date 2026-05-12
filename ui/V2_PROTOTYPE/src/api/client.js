import { getToken, clearToken } from './auth'
import { ApiError, NetworkError } from './errors'

const BASE = '/api/v1'

async function request(method, path, { body, params, formData } = {}) {
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
  try {
    res = await fetch(url, {
      method,
      headers,
      body: formData || (body ? JSON.stringify(body) : undefined),
    })
  } catch (e) {
    throw new NetworkError('网络请求失败', e)
  }

  if (res.status === 401) {
    clearToken()
    if (window.location.pathname !== '/login') {
      window.location.href = '/login'
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
  get:    (path, params)     => request('GET', path, { params }),
  post:   (path, body)       => request('POST', path, { body }),
  patch:  (path, body)       => request('PATCH', path, { body }),
  delete: (path)             => request('DELETE', path),
  upload: (path, formData)   => request('POST', path, { formData }),
}
