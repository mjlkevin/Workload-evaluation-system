const TOKEN_KEY = 'wes_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY)
}

export function setToken(token, { rememberMe = true } = {}) {
  localStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
  if (token) {
    const storage = rememberMe ? localStorage : sessionStorage
    storage.setItem(TOKEN_KEY, token)
  }
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
}

function isExpiredJwt(token) {
  const segments = String(token || '').split('.')
  if (segments.length !== 3) return false

  try {
    const normalized = segments[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const payload = JSON.parse(atob(padded))
    return Number.isFinite(payload?.exp) && payload.exp * 1000 <= Date.now()
  } catch (_) {
    return false
  }
}

export function isAuthenticated() {
  const token = getToken()
  if (!token) return false
  if (isExpiredJwt(token)) {
    clearToken()
    return false
  }
  return true
}
