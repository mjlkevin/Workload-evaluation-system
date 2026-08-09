/**
 * E2 flag-off 降级守护测试（RP-047 Batch E · Step 0 缓办补测）。
 * 常驻回归资产：aiRuns.js listActiveRuns 在 503/401/网络错误时——
 * 1) 503/401 静默降级为 enabled=false，不弹 toast；
 * 2) 网络失败标记 failed=true，供调用方退避重试；
 * 3) 任何失败都不抛错。
 */
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, test } from 'vitest'
import { listActiveRuns } from '../api/aiRuns.js'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

describe('flag-fallback: E2 降级守护', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test('flag-fallback: 503 ASYNC_RUNS_DISABLED 降级为 enabled=false', async () => {
    server.use(
      http.get(`${BASE}/ai-runs`, () => HttpResponse.json(
        { code: 'ASYNC_RUNS_DISABLED', message: '异步任务已关闭' },
        { status: 503 },
      )),
    )

    const result = await listActiveRuns()
    expect(result.enabled).toBe(false)
    expect(result.runs).toEqual([])
    expect(result.failed).toBe(false)
  })

  test('flag-fallback: 401 视为功能关闭', async () => {
    server.use(
      http.get(`${BASE}/ai-runs`, () => HttpResponse.json(
        { code: 40101, message: 'Unauthorized' },
        { status: 401 },
      )),
    )

    const result = await listActiveRuns()
    expect(result.enabled).toBe(false)
    expect(result.runs).toEqual([])
    expect(result.failed).toBe(false)
  })

  test('flag-fallback: 网络失败标记 failed=true 供退避重试', async () => {
    server.use(
      http.get(`${BASE}/ai-runs`, () => HttpResponse.error()),
    )

    const result = await listActiveRuns()
    expect(result.enabled).toBe(true)
    expect(result.runs).toEqual([])
    expect(result.failed).toBe(true)
  })

  test('flag-fallback: 正常响应返回 enabled=true 与 runs', async () => {
    server.use(
      http.get(`${BASE}/ai-runs`, () => HttpResponse.json({
        success: true,
        data: { items: [{ runId: 'run-1', status: 'running' }] },
      })),
    )

    const result = await listActiveRuns()
    expect(result.enabled).toBe(true)
    expect(result.runs).toHaveLength(1)
    expect(result.failed).toBe(false)
  })
})
