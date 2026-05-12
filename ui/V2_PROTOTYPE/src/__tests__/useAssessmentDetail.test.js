import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'
import useAssessmentDetail from '../hooks/useAssessmentDetail.js'
import { assessment as mockAssessment } from '../mock/assessmentData.js'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

describe('useAssessmentDetail', () => {
  test('builds full VM from version, template, rule set, meta and calculate', async () => {
    const { result } = renderHook(() => useAssessmentDetail('ASM-018', { fallbackData: mockAssessment }))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.projectName).toContain('利民集团')
    expect(result.current.kpi.totalDays).toBe(16)
    expect(result.current.skuGroups).toHaveLength(2)
    expect(result.current.dsl.issues[0].ruleId).toBe('R-1')
    expect(result.current.context.template).toBe('实施评估标准版')
  })

  test('reloads when versionId changes', async () => {
    let versionCalls = 0
    server.use(http.get(`${BASE}/versions/:id`, () => {
      versionCalls += 1
      return HttpResponse.json({ success: true, data: { id: `ASM-${versionCalls}`, versionCode: `IA-${versionCalls}`, checkoutStatus: 'checked_in', versionDocStatus: 'reviewed', payload: { templateId: 'tmpl-1', ruleSetId: 'DSL-2026-Q2' } } })
    }))

    const { result, rerender } = renderHook(({ id }) => useAssessmentDetail(id, { fallbackData: mockAssessment }), { initialProps: { id: 'ASM-018' } })
    await waitFor(() => expect(result.current.loading).toBe(false))
    rerender({ id: 'ASM-019' })
    await waitFor(() => expect(versionCalls).toBe(2))
  })

  test('falls back when API fails', async () => {
    server.use(http.get(`${BASE}/versions/:id`, () => HttpResponse.json({ message: 'boom' }, { status: 500 })))

    const { result } = renderHook(() => useAssessmentDetail('ASM-018', { fallbackData: mockAssessment }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBeTruthy()
    expect(result.current.projectName).toBe(mockAssessment.projectName)
  })

  test('enabled=false returns mock detail without API calls', async () => {
    const { result } = renderHook(() => useAssessmentDetail('ASM-018', { enabled: false, fallbackData: mockAssessment }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.kpi.totalDays).toBe(mockAssessment.kpi.totalDays)
  })
})
