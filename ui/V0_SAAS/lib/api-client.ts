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

export async function apiRequest<T>(
  path: string,
  { method = "GET", body, token, signal }: RequestOptions = {},
): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData
  const headers = new Headers(isFormData ? undefined : { "Content-Type": "application/json" })
  const authToken = token || getStoredToken()
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`)

  const response = await fetch(path, {
    method,
    headers,
    body: body ? (isFormData ? (body as FormData) : JSON.stringify(body)) : undefined,
    signal,
    cache: "no-store",
  })

  const payload = (await response.json().catch(() => null)) as ApiSuccess<T> | null

  if (!response.ok || !payload || typeof payload.code !== "number" || payload.code !== 0) {
    const message = payload?.message || `请求失败(${response.status})`
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

  const response = await fetch(path, {
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
