import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'
import useReviewDetail from '../hooks/useReviewDetail.js'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

describe('useReviewDetail', () => {
  test('loads review detail VM from PM endpoints', async () => {
    const { result } = renderHook(() => useReviewDetail('REV-1'))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.header.versionLabel).toContain('付款')
    expect(result.current.checklist).toHaveLength(5)
    expect(result.current.deliverables).toHaveLength(2)
    expect(result.current.comments).toHaveLength(1)
    expect(result.current.seals).toHaveLength(1)
  })

  test('approveReview calls PATCH and updates status', async () => {
    let patched = null
    server.use(http.patch(`${BASE}/pm/reviews/:id`, async ({ request }) => {
      patched = await request.json()
      return HttpResponse.json({ success: true, data: patched })
    }))
    const { result } = renderHook(() => useReviewDetail('REV-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.actions.approveReview()
    })

    expect(patched).toEqual({ verdict: 'pass' })
    expect(result.current.reviewStatus).toBe('approved')
  })

  test('rejectReview calls PATCH and updates status', async () => {
    let patched = null
    server.use(http.patch(`${BASE}/pm/reviews/:id`, async ({ request }) => {
      patched = await request.json()
      return HttpResponse.json({ success: true, data: patched })
    }))
    const { result } = renderHook(() => useReviewDetail('REV-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.actions.rejectReview('资料不完整')
    })

    expect(patched.verdict).toBe('reject')
    expect(result.current.reviewStatus).toBe('rejected')
  })

  test('generateAll posts selected deliverables and updates local state', async () => {
    let body = null
    server.use(http.post(`${BASE}/pm/deliverables/generate`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ success: true, data: [] })
    }))
    const { result } = renderHook(() => useReviewDetail('REV-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.actions.generateAll()
    })

    expect(body.deliverableIds).toEqual(['D1', 'D2'])
    expect(result.current.deliverables.every((item) => item.status === 'generated')).toBe(true)
  })

  test('addComment appends a new comment', async () => {
    const { result } = renderHook(() => useReviewDetail('REV-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const before = result.current.comments.length

    await act(async () => {
      await result.current.actions.addComment('新增评论')
    })

    expect(result.current.comments).toHaveLength(before + 1)
    expect(result.current.comments.at(-1).text).toBe('新增评论')
  })
})
