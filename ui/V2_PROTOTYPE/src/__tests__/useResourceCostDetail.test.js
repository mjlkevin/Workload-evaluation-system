import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import useResourceCostDetail from '../hooks/useResourceCostDetail.js'
import { mockResourceCost } from './mocks/data.js'

describe('useResourceCostDetail', () => {
  test('loads version and aggregates group subtotals', async () => {
    const { result } = renderHook(() => useResourceCostDetail({ id: 'RC-1', fallbackData: mockResourceCost }))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.groups).toHaveLength(2)
    expect(result.current.groups[0].subtotal.days).toBe(8)
    expect(result.current.totalDays).toBe(10)
    expect(result.current.monthTotals).toEqual([4, 6])
  })

  test('checkout calls POST and updates VCS state', async () => {
    const { result } = renderHook(() => useResourceCostDetail({ id: 'RC-1', fallbackData: mockResourceCost }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.actions.checkout()
    })

    expect(result.current.checkedOut).toBe(true)
    expect(result.current.status).toBe('已检出')
  })

  test('enabled=false returns fallback resource cost', async () => {
    const { result } = renderHook(() => useResourceCostDetail({ id: 'RC-1', enabled: false, fallbackData: mockResourceCost }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.totalAmount).toBe(35100)
  })
})
