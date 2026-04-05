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
