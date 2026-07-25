import { apiClient } from './client'
import { clearToken, getToken } from './auth'
import { ApiError, NetworkError } from './errors'
import { unwrap } from './utils'

const HOME_WORKBENCH_STREAM_URL = '/api/v1/ai/home-workbench/chat/stream'

export async function summarizeCompanyProfile(payload) {
  return unwrap(await apiClient.post('/ai/company-profile-summary', payload, { suppressUnauthorizedRedirect: true }))
}

export async function sendHomeWorkbenchMessage(payload) {
  return unwrap(await apiClient.post('/ai/home-workbench/chat', payload, { suppressUnauthorizedRedirect: true }))
}

export async function streamHomeWorkbenchChat(payload, {
  signal,
  onEvent = () => {},
} = {}) {
  const response = await fetchStreamResponse(payload, signal)

  if (response.status === 401) {
    clearToken()
    throw new ApiError(401, 'UNAUTHORIZED', '登录已过期，请重新登录')
  }
  if (!response.ok) {
    let errorPayload
    try {
      errorPayload = await response.json()
    } catch {
      errorPayload = null
    }
    throw new ApiError(
      response.status,
      errorPayload?.code || 'UNKNOWN',
      errorPayload?.message || `请求失败 (${response.status})`,
      errorPayload?.details,
    )
  }

  const contentType = response.headers.get('Content-Type') || ''
  if (!contentType.includes('text/event-stream') || !response.body) {
    const responsePayload = response.status === 204 ? null : await response.json()
    const data = responsePayload?.data ?? responsePayload
    onEvent('done', data)
    return data
  }

  return readSseStream(response.body, onEvent)
}

async function fetchStreamResponse(payload, signal) {
  const requestInit = buildStreamRequest(payload, signal)
  try {
    return await fetch(HOME_WORKBENCH_STREAM_URL, requestInit)
  } catch (error) {
    if (isAbortError(error, signal)) throw createAbortError(error)
    if (signal && isForeignAbortSignalError(error)) {
      try {
        return await fetch(HOME_WORKBENCH_STREAM_URL, buildStreamRequest(payload))
      } catch (retryError) {
        if (isAbortError(retryError, signal)) throw createAbortError(retryError)
        throw new NetworkError('网络请求失败', retryError)
      }
    }
    throw new NetworkError('网络请求失败', error)
  }
}

function buildStreamRequest(payload, signal) {
  const headers = {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
  }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  return {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    ...(signal ? { signal } : {}),
  }
}

function isAbortError(error, signal) {
  return error?.name === 'AbortError' || signal?.aborted === true
}

function createAbortError(cause) {
  const error = new NetworkError('请求已停止', cause)
  error.aborted = true
  return error
}

function isForeignAbortSignalError(error) {
  return error instanceof TypeError
    && /expected signal|instance of AbortSignal/i.test(String(error.message || ''))
}

async function readSseStream(body, onEvent) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let lastPayload

  const emitBlock = (block) => {
    const parsed = parseSseBlock(block)
    if (!parsed) return
    lastPayload = parsed.data
    onEvent(parsed.event, parsed.data)
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() || ''
    blocks.forEach(emitBlock)
  }

  buffer += decoder.decode()
  if (buffer.trim()) emitBlock(buffer)
  return lastPayload
}

function parseSseBlock(block) {
  let event = 'message'
  const dataLines = []

  for (const rawLine of String(block || '').split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(':')) continue
    const separator = rawLine.indexOf(':')
    const field = separator < 0 ? rawLine : rawLine.slice(0, separator)
    const value = separator < 0 ? '' : rawLine.slice(separator + 1).replace(/^ /, '')
    if (field === 'event') event = value || 'message'
    if (field === 'data') dataLines.push(value)
  }

  if (!dataLines.length) return null
  const rawData = dataLines.join('\n')
  let data = rawData
  try {
    data = JSON.parse(rawData)
  } catch {
    // SSE data may legally be plain text.
  }
  return { event, data }
}
