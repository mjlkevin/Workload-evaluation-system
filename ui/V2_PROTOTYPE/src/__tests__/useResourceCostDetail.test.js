import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import useResourceCostDetail from '../hooks/useResourceCostDetail.js'
import { apiClient } from '../api/client.js'
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

  test('checkout calls POST and refreshes VCS state from backend', async () => {
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({ code: 0, data: {} })
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({
      code: 0,
      data: { record: { ...mockResourceCost, checkoutStatus: 'checked_out', checkedOutByUsername: 'mjlkevin' } },
    })
    const { result } = renderHook(() => useResourceCostDetail({ id: 'RC-1', fallbackData: mockResourceCost }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.actions.checkout()
    })

    expect(postSpy).toHaveBeenCalledWith('/versions/RC-1/checkout')
    expect(result.current.checkedOut).toBe(true)
    expect(result.current.status).toBe('已检出')
    postSpy.mockRestore()
    getSpy.mockRestore()
  })

  test('saveDraft sends current payload to save-draft endpoint', async () => {
    const spy = vi.spyOn(apiClient, 'patch').mockImplementation(async () => ({ code: 0, data: {} }))
    const { result } = renderHook(() => useResourceCostDetail({ id: 'RC-1', enabled: false, fallbackData: mockResourceCost }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.actions.saveDraft()
    })

    expect(spy).toHaveBeenCalledWith('/versions/RC-1/save-draft', { payload: mockResourceCost.payload })
    spy.mockRestore()
  })

  test('maps real backend envelope with nested record and checkout state', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({
      code: 0,
      data: {
        record: {
          ...mockResourceCost,
          checkoutStatus: 'checked_out',
          checkedOutByUsername: 'mjlkevin',
        },
      },
    })
    const { result } = renderHook(() => useResourceCostDetail({ id: 'RC-1', fallbackData: null }))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.checkedOut).toBe(true)
    expect(result.current.status).toBe('已检出')
    expect(result.current.totalDays).toBe(10)
    spy.mockRestore()
  })

  test('failed action exposes error message for UI feedback', async () => {
    const spy = vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('该版本已被检出'))
    const { result } = renderHook(() => useResourceCostDetail({ id: 'RC-1', enabled: false, fallbackData: mockResourceCost }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let res
    await act(async () => {
      res = await result.current.actions.checkout()
    })

    expect(res.success).toBe(false)
    expect(result.current.actionError).toBe('该版本已被检出')
    spy.mockRestore()
  })

  test('saveDraft returns success message for toast feedback', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({
      code: 0,
      data: { record: { ...mockResourceCost, checkoutStatus: 'checked_out', updatedAt: '2026-08-29T09:09:31.481Z' } },
    })
    const spy = vi.spyOn(apiClient, 'patch').mockImplementation(async () => ({ code: 0, data: {} }))
    const { result } = renderHook(() => useResourceCostDetail({ id: 'RC-1', fallbackData: mockResourceCost }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let res
    await act(async () => {
      res = await result.current.actions.saveDraft()
    })

    expect(res.success).toBe(true)
    expect(res.message).toContain('版本已保存')
    spy.mockRestore()
    getSpy.mockRestore()
  })

  test('enabled=false returns fallback resource cost', async () => {
    const { result } = renderHook(() => useResourceCostDetail({ id: 'RC-1', enabled: false, fallbackData: mockResourceCost }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.totalAmount).toBe(35100)
  })
})
