import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'
import useHomeDashboard from '../hooks/useHomeDashboard.js'
import { server } from './mocks/server.js'
import { mockVersions } from './mocks/data.js'

const BASE = '/api/v1'

describe('useHomeDashboard', () => {
  test('loads 4 endpoints and aggregates KPI cards', async () => {
    const { result } = renderHook(() => useHomeDashboard())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.kpi).toHaveLength(4)
    expect(result.current.kpi[0].num).toBe(1)
    expect(result.current.kpi[1].num).toBe(1)
    expect(result.current.kpi[2].num).toBe(32)
    expect(result.current.kpi[3].num).toBe(3)
    expect(result.current.plans[0].globalVersion).toBe('GL-04001')
  })

  test('refetch reloads dashboard data', async () => {
    let globalCalls = 0
    server.use(
      http.get(`${BASE}/versions`, ({ request }) => {
        const url = new URL(request.url)
        const type = url.searchParams.get('type')
        if (type === 'global') globalCalls += 1
        return HttpResponse.json({ success: true, data: mockVersions.filter((record) => record.type === type) })
      })
    )

    const { result } = renderHook(() => useHomeDashboard())
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.refetch()
    })
    await waitFor(() => expect(globalCalls).toBeGreaterThanOrEqual(2))
  })

  test('enabled=false returns empty dashboard instead of fallback mock', async () => {
    const fallbackData = { kpi: [{ lb: '方案数', num: 9 }], plans: [{ id: 'p1' }], feed: [] }
    const { result } = renderHook(() => useHomeDashboard({ enabled: false, fallbackData }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.kpi[0].num).toBe(0)
    expect(result.current.plans).toEqual([])
  })
})
