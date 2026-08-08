/**
 * E1 删除守护前端侧测试（RP-047 Batch D · Step 5）。
 * deleteSession 命中 409 SESSION_HAS_ACTIVE_RUN 时，错误文案收敛为
 * 冻结口径「该会话仍有后台任务运行中，请先停止任务。」并保留会话；
 * 其他错误维持原有透传行为。
 */
import { http, HttpResponse } from 'msw'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { useAiSessions } from '../hooks/useAiSessions.js'
import { sessionRuntimeStore } from '../hooks/useSessionRuntimeStore.js'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

describe('delete-guard: deleteSession 409 文案（E1 前端侧）', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionRuntimeStore.resetAllSessionViews()
  })

  test('delete-guard: 409 SESSION_HAS_ACTIVE_RUN 返回冻结文案', async () => {
    server.use(
      http.delete(`${BASE}/ai-sessions/session-a`, () => HttpResponse.json({
        code: 'SESSION_HAS_ACTIVE_RUN',
        message: 'session has active run',
        data: null,
      }, { status: 409 })),
    )
    const { result } = renderHook(() => useAiSessions())

    await expect(result.current.deleteSession('session-a'))
      .rejects.toThrow('该会话仍有后台任务运行中，请先停止任务。')
  })

  test('delete-guard: 其他错误维持原有透传行为', async () => {
    server.use(
      http.delete(`${BASE}/ai-sessions/session-b`, () => HttpResponse.json({
        code: 'INTERNAL',
        message: '服务开小差',
        data: null,
      }, { status: 500 })),
    )
    const { result } = renderHook(() => useAiSessions())

    await expect(result.current.deleteSession('session-b'))
      .rejects.toThrow('服务开小差')
  })

  test('delete-guard: 删除成功后清理会话运行时视图', async () => {
    sessionRuntimeStore.setSessionRunStatus('session-c', 'running')
    server.use(
      http.delete(`${BASE}/ai-sessions/session-c`, () => HttpResponse.json({
        success: true,
        data: { deletedSessionId: 'session-c' },
      })),
    )
    const { result } = renderHook(() => useAiSessions())

    await expect(result.current.deleteSession('session-c')).resolves.toBe(true)
    expect(sessionRuntimeStore.getSessionView('session-c')).toBeUndefined()
  })
})
