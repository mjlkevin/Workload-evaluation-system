import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { apiClient } from '../api/client.js'
import DevAssessmentList from '../pages/DevAssessmentList.jsx'

function renderDevAssessments() {
  return render(
    <MemoryRouter initialEntries={['/dev-assessments']}>
      <Routes>
        <Route path="/dev-assessments" element={<DevAssessmentList />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('DevAssessmentList 加载失败', () => {
  beforeEach(() => {
    localStorage.setItem('wes_token', 'mock-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  // 后端 400 时接口返回空列表，此前页面只取 rows，把失败渲染成「暂无数据」——
  // 用户以为没有数据，实际是请求没成功。
  test('接口失败时给出可重试的错误提示，而不是空态', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValueOnce(new Error('bad request'))

    renderDevAssessments()

    expect(await screen.findByRole('alert')).toHaveTextContent('加载开发评估列表失败')
    expect(screen.getByRole('button', { name: '重试' })).toBeEnabled()
    expect(screen.queryByText('暂无数据')).not.toBeInTheDocument()
  })

  test('加载中给出进度提示，不提前判定为空', async () => {
    let resolveGet
    vi.spyOn(apiClient, 'get').mockImplementationOnce(
      () => new Promise((res) => { resolveGet = res }),
    )

    renderDevAssessments()

    expect(screen.getByText('正在加载开发评估列表…')).toBeInTheDocument()
    await act(async () => {
      resolveGet({ code: 0, data: { items: [] } })
    })
    expect(screen.queryByText('正在加载开发评估列表…')).not.toBeInTheDocument()
  })

  // 创建失败与加载失败得分开念：共用一个 error 时，创建失败会被说成「加载列表失败」。
  test('创建失败只报创建，不冒充加载失败', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ code: 0, data: { items: [] } })
    vi.spyOn(apiClient, 'post').mockRejectedValueOnce(new Error('bad request'))

    renderDevAssessments()

    await screen.findByText(/共 0 条/)
    fireEvent.click(screen.getByRole('button', { name: '+ 新建' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('创建开发评估失败')
    expect(screen.queryByText('加载开发评估列表失败，请检查网络后重试')).not.toBeInTheDocument()
  })
})
