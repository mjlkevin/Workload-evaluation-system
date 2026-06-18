import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import useRequirementDetail from '../hooks/useRequirementDetail.js'
import { mockRequirement } from './mocks/data.js'

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
})
