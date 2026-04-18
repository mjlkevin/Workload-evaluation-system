"use client"

export class ApiError extends Error {
  status: number
  details?: unknown

  constructor(message: string, status = 500, details?: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.details = details
  }
}

type ApiSuccess<T> = {
  code: number
  message: string
  data: T
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE"
  body?: unknown
  token?: string
  signal?: AbortSignal
}

export function getStoredToken(): string {
  if (typeof window === "undefined") return ""
  return window.localStorage.getItem("workload-auth-token-v1") || ""
}

const DEFAULT_DEV_API_PORT = process.env.NEXT_PUBLIC_API_PORT || "3000"

function isPrivateOrLocalHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1") return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (!m) return false
  const oct = [1, 2, 3, 4].map((i) => Number(m[i]))
  if (oct.some((n) => n > 255)) return false
  const [a, b] = oct
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

/**
 * 浏览器侧按当前页面 host 直连 API（不依赖 NODE_ENV 内联，避免 next start / 部分构建下局域网登录仍走 /api 反代失败）。
 * - localhost / 127.0.0.1 → http://127.0.0.1:3000
 * - 私网 IPv4（10/172.16-31/192.168）→ http://{hostname}:3000
 * 覆盖：NEXT_PUBLIC_WORKLOAD_API_ORIGIN；端口：NEXT_PUBLIC_API_PORT
 */
function resolveApiUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path
  const explicit = (process.env.NEXT_PUBLIC_WORKLOAD_API_ORIGIN || "").trim().replace(/\/$/, "")
  if (explicit) return `${explicit}${path.startsWith("/") ? path : `/${path}`}`
  if (typeof window === "undefined") return path
  const host = window.location.hostname
  if (host === "localhost" || host === "127.0.0.1") {
    return `http://127.0.0.1:${DEFAULT_DEV_API_PORT}${path.startsWith("/") ? path : `/${path}`}`
  }
  if (isPrivateOrLocalHostname(host)) {
    return `http://${host}:${DEFAULT_DEV_API_PORT}${path.startsWith("/") ? path : `/${path}`}`
  }
  return path
}

export async function apiRequest<T>(
  path: string,
  { method = "GET", body, token, signal }: RequestOptions = {},
): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData
  const headers = new Headers(isFormData ? undefined : { "Content-Type": "application/json" })
  const authToken = token || getStoredToken()
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`)

  const url = resolveApiUrl(path)
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body ? (isFormData ? (body as FormData) : JSON.stringify(body)) : undefined,
      signal,
      cache: "no-store",
    })
  } catch (e) {
    const hint =
      typeof window !== "undefined" && isPrivateOrLocalHostname(window.location.hostname)
        ? `无法连接 API（${url}）。请在本机执行 npm run dev:api，并确认防火墙放行端口 ${DEFAULT_DEV_API_PORT}。`
        : "网络请求失败，请检查网络或服务是否已启动。"
    throw new ApiError(e instanceof Error ? `${hint} (${e.message})` : hint, 0, e)
  }

  const rawText = await response.text()
  let payload: ApiSuccess<T> | null = null
  if (rawText) {
    try {
      payload = JSON.parse(rawText) as ApiSuccess<T>
    } catch {
      payload = null
    }
  }

  if (!response.ok || !payload || typeof payload.code !== "number" || payload.code !== 0) {
    const message =
      payload?.message ||
      (rawText && rawText.length < 200 ? rawText : `请求失败(${response.status})，响应非 JSON 或网关错误`)
    throw new ApiError(message, response.status, payload)
  }

  return payload.data
}

function deriveDownloadFileName(path: string, contentDisposition: string | null): string {
  if (contentDisposition) {
    const utf8Match = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
    if (utf8Match?.[1]) {
      try {
        return decodeURIComponent(utf8Match[1].trim())
      } catch {
        return utf8Match[1].trim()
      }
    }
    const plainMatch = contentDisposition.match(/filename\s*=\s*"?([^";]+)"?/i)
    if (plainMatch?.[1]) return plainMatch[1].trim()
  }
  const seg = path.split("/").filter(Boolean).pop() || "download.bin"
  return seg.split("?")[0] || "download.bin"
}

export async function downloadWithAuth(path: string, fileNameHint?: string): Promise<void> {
  const authToken = getStoredToken()
  const headers = new Headers()
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`)

  const response = await fetch(resolveApiUrl(path), {
    method: "GET",
    headers,
    cache: "no-store",
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null
    const message = payload?.message || `下载失败(${response.status})`
    throw new ApiError(message, response.status, payload)
  }

  const blob = await response.blob()
  const fileName = fileNameHint || deriveDownloadFileName(path, response.headers.get("Content-Disposition"))
  const objectUrl = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement("a")
    anchor.href = objectUrl
    anchor.download = fileName
    anchor.rel = "noopener noreferrer"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
