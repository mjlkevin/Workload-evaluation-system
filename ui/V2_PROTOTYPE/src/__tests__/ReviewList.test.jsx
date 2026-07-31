import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { apiClient } from '../api/client.js'
import ReviewList from '../pages/ReviewList.jsx'

const existingReview = {
  id: 'REV-EXISTING',
  versionId: 'VER-001',
  versionCode: 'V1',
  reviewerUsername: 'reviewer-one',
  deadline: '2026-08-08T00:00:00.000Z',
  status: 'pending',
  verdict: null,
  updatedAt: '2026-07-31T10:00:00.000Z',
  contextSnapshot: { projectName: '现有评审项目' },
}

const createdReview = {
  ...existingReview,
  id: 'REV-SERVER-NEW',
  versionId: 'VER-NEW',
  versionCode: 'V2',
  contextSnapshot: { projectName: '新建评审项目' },
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="current-route">{location.pathname}</output>
}

function renderReviews() {
  return render(
    <MemoryRouter initialEntries={['/reviews']}>
      <Routes>
        <Route path="/reviews" element={<><ReviewList /><LocationProbe /></>} />
        <Route path="/reviews/:id" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ReviewList', () => {
  beforeEach(() => {
    localStorage.setItem('wes_token', 'mock-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.removeItem('wes_token')
    sessionStorage.removeItem('wes_token')
  })

  test('shows a retryable alert instead of an empty state when loading fails', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValueOnce(new Error('service unavailable'))

    renderReviews()

    expect(await screen.findByRole('alert')).toHaveTextContent('加载评审列表失败')
    expect(screen.getByRole('button', { name: '重试' })).toBeEnabled()
    expect(screen.queryByText('暂无数据')).not.toBeInTheDocument()
  })

  test('recovers real rows after retry succeeds', async () => {
    vi.spyOn(apiClient, 'get')
      .mockRejectedValueOnce(new Error('service unavailable'))
      .mockResolvedValueOnce({ data: [existingReview] })

    renderReviews()

    fireEvent.click(await screen.findByRole('button', { name: '重试' }))

    expect(await screen.findByText('REV-EXISTING')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('keeps the list and route when create fails without a local ghost record', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: [existingReview] })
    vi.spyOn(apiClient, 'post').mockRejectedValueOnce(new Error('create failed'))

    renderReviews()

    await screen.findByText('REV-EXISTING')
    fireEvent.click(screen.getByRole('button', { name: '+ 新建' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('创建评审失败')
    expect(screen.getByTestId('current-route')).toHaveTextContent('/reviews')
    expect(screen.getByText('REV-EXISTING')).toBeInTheDocument()
    expect(screen.queryByText(/REV-LOCAL-/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ 新建' })).toBeEnabled()
  })

  test('navigates only to the server id after create succeeds', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: [] })
    vi.spyOn(apiClient, 'post').mockResolvedValueOnce({ data: createdReview })

    renderReviews()

    fireEvent.click(await screen.findByRole('button', { name: '+ 新建' }))

    await waitFor(() => {
      expect(screen.getByTestId('current-route')).toHaveTextContent('/reviews/REV-SERVER-NEW')
    })
    expect(screen.queryByText(/REV-LOCAL-/)).not.toBeInTheDocument()
  })

  test('opens a review from a visible row action without requiring a double click', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: [existingReview] })

    renderReviews()

    fireEvent.click(await screen.findByRole('button', { name: '查看 REV-EXISTING 详情' }))

    expect(screen.getByTestId('current-route')).toHaveTextContent('/reviews/REV-EXISTING')
  })

  test('offers only supported bulk actions and reports unavailable history inline', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: [existingReview] })
    const nativeAlert = vi.spyOn(window, 'alert').mockImplementation(() => {})

    renderReviews()

    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 REV-EXISTING' }))

    expect(screen.getByRole('button', { name: '查看详情' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '历史' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /修改/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /删除/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '历史' }))

    expect(nativeAlert).not.toHaveBeenCalled()
    const historyStatus = screen.getByText(/暂无可展示的评审历史/)
    expect(historyStatus).toHaveAttribute('role', 'status')
  })
})
