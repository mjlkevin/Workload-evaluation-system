import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'
import useRequirementDetail from '../hooks/useRequirementDetail.js'
import { mockRequirement } from './mocks/data.js'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

describe('useRequirementDetail', () => {
  test('loads requirement detail and maps 6+1 regions', async () => {
    const { result } = renderHook(() => useRequirementDetail({ id: 'REQ-1', fallbackData: mockRequirement }))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.project).toBe('利民集团数字化二期')
    expect(result.current.basicFields.length).toBeGreaterThanOrEqual(6)
    expect(result.current.valueItems).toHaveLength(3)
    expect(result.current.scopeRows).toHaveLength(3)
    expect(result.current.extraCards).toHaveLength(4)
    expect(result.current.versionTimeline.length).toBeGreaterThanOrEqual(1)
  })

  test('calculates completionStats on client', async () => {
    const { result } = renderHook(() => useRequirementDetail({ id: 'REQ-1', fallbackData: mockRequirement }))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.completionStats.structuredCount).toBe(1)
    expect(result.current.completionStats.totalCount).toBe(2)
    expect(result.current.completionStats.percent).toBe(50)
    expect(result.current.completionStats.dslViolations).toBe(1)
  })

  test('enabled=false returns fallback requirement', async () => {
    const { result } = renderHook(() => useRequirementDetail({ id: 'REQ-1', enabled: false, fallbackData: mockRequirement }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.code).toBe('RQ-04001')
  })

  // ISS-2026-08-18-005（档 1 改造项 1）：主请求 5xx 必须可见失败态，
  // 不得被 .catch(() => null) 静默吞掉（500 与 404 语义不同：404 是新建，500 是故障）。
  test('main request 500 surfaces error instead of silent null', async () => {
    server.use(http.get(`${BASE}/presales/requirement-packs/:id`, () => HttpResponse.json({ message: 'boom' }, { status: 500 })))

    const { result } = renderHook(() => useRequirementDetail({ id: 'REQ-1', fallbackData: mockRequirement }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBeTruthy()
  })

  // ISS-2026-08-18-005（档 1 改造项 1）：主请求 404 是「真新建」的结构化信号，
  // 必须保持无 error 新建语义（走空 VM 分支），与加载失败严格区分。
  test('404 on main requests keeps new-record semantics without error', async () => {
    server.use(
      http.get(`${BASE}/presales/requirement-packs/:id`, () => HttpResponse.json({ message: 'missing' }, { status: 404 })),
      http.get(`${BASE}/versions/:id`, () => HttpResponse.json({ message: 'missing' }, { status: 404 })),
    )

    const { result } = renderHook(() => useRequirementDetail({ id: 'REQ-NEW-404', fallbackData: mockRequirement }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBeNull()
    expect(result.current.code).toBe('')
  })
})
