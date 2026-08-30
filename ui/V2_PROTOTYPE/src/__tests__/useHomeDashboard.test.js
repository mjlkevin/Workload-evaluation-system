import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'
import useHomeDashboard from '../hooks/useHomeDashboard.js'
import { server } from './mocks/server.js'
import { mockProjectEvaluations, mockVersions } from './mocks/data.js'

const BASE = '/api/v1'

describe('useHomeDashboard', () => {
  test('loads project evaluations and aggregates KPI cards', async () => {
    const { result } = renderHook(() => useHomeDashboard())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.kpi).toHaveLength(4)
    expect(result.current.kpi[0].lb).toBe('项目数')
    expect(result.current.kpi[0].num).toBe(mockProjectEvaluations.length)
    expect(result.current.kpi[1].num).toBe(1)
    expect(result.current.kpi[2].num).toBe(32)
    expect(result.current.kpi[3].num).toBe(3)
    expect(result.current.plans[0].id).toBe('project-1')
    expect(result.current.plans[0].projectName).toBe('利民集团数字化二期')
    expect(result.current.plans[0].globalVersion).toBe('PROJECT-project-1')
  })

  test('refetch reloads dashboard data', async () => {
    let projectCalls = 0
    server.use(
      http.get(`${BASE}/project-evaluations`, () => {
        projectCalls += 1
        return HttpResponse.json({ success: true, data: { items: mockProjectEvaluations } })
      }),
      http.get(`${BASE}/versions`, ({ request }) => {
        const url = new URL(request.url)
        const type = url.searchParams.get('type')
        return HttpResponse.json({ success: true, data: mockVersions.filter((record) => record.type === type) })
      })
    )

    const { result } = renderHook(() => useHomeDashboard())
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.refetch()
    })
    await waitFor(() => expect(projectCalls).toBeGreaterThanOrEqual(2))
  })

  test('enabled=false returns empty dashboard instead of fallback mock', async () => {
    const fallbackData = { kpi: [{ lb: '项目数', num: 9 }], plans: [{ id: 'p1' }], feed: [] }
    const { result } = renderHook(() => useHomeDashboard({ enabled: false, fallbackData }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.kpi[0].num).toBe(0)
    expect(result.current.plans).toEqual([])
  })

  test('create posts a project evaluation instead of a global version', async () => {
    let projectCreateBody
    let versionCreateCalls = 0
    server.use(
      http.post(`${BASE}/project-evaluations`, async ({ request }) => {
        projectCreateBody = await request.json()
        return HttpResponse.json({
          success: true,
          data: {
            project: {
              projectId: 'project-created',
              projectName: projectCreateBody.projectName,
              customerName: projectCreateBody.customerName,
              industry: projectCreateBody.industry,
              currentStage: 'rough_estimate',
              status: 'draft',
              ownerUsername: 'arch',
              participantUserIds: ['u3'],
              createdAt: '2026-06-14T00:00:00.000Z',
              updatedAt: '2026-06-14T00:00:00.000Z',
              totalDays: 0,
            },
          },
        })
      }),
      http.post(`${BASE}/versions`, () => {
        versionCreateCalls += 1
        return HttpResponse.json({ success: true, data: {} })
      })
    )

    const { result } = renderHook(() => useHomeDashboard())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.create({ projectName: '新项目', customerName: '新客户', industry: '制造业' })
    })

    expect(projectCreateBody).toMatchObject({ projectName: '新项目', customerName: '新客户', industry: '制造业' })
    expect(versionCreateCalls).toBe(0)
  })

  test('加载完成后 KPI 不再停在「加载中…」占位', async () => {
    const { result } = renderHook(() => useHomeDashboard())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.kpi.map((k) => k.sub)).not.toContain('加载中…')
    expect(result.current.kpi.every((k) => k.state === 'ok')).toBe(true)
    expect(result.current.error).toBeNull()
  })

  test('单个数据源取数失败时，该指标卡是未知而不是 0，其余照常出数', async () => {
    server.use(
      http.get(`${BASE}/auth/users`, () => HttpResponse.json({ message: 'boom' }, { status: 500 }))
    )

    const { result } = renderHook(() => useHomeDashboard())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.kpi[3].num).toBeNull()
    expect(result.current.kpi[3].state).toBe('error')
    expect(result.current.kpi[3].sub).toContain('失败')
    // 一个源挂了不能把另外三个也打成未知
    expect(result.current.kpi[0].num).toBe(mockProjectEvaluations.length)
    expect(result.current.kpi[0].state).toBe('ok')
    expect(result.current.error).toBeTruthy()
  })

  test('四个端点全挂时 error 置位，页面能出可重试提示', async () => {
    server.use(
      http.get(`${BASE}/project-evaluations`, () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
      http.get(`${BASE}/versions`, () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
      http.get(`${BASE}/auth/users`, () => HttpResponse.json({ message: 'boom' }, { status: 500 }))
    )

    const { result } = renderHook(() => useHomeDashboard())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBeTruthy()
    expect(result.current.kpi.every((k) => k.state === 'error')).toBe(true)
    expect(result.current.kpi.every((k) => k.num === null)).toBe(true)
    expect(result.current.plans).toEqual([])
  })
})
