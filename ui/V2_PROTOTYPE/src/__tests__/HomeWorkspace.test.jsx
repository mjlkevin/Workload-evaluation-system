import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test } from 'vitest'
import HomeWorkspace from '../pages/HomeWorkspace.jsx'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

describe('HomeWorkspace', () => {
  beforeEach(() => {
    localStorage.removeItem('wes_home_view')
  })

  test('defaults to AI workbench', async () => {
    render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

    await waitFor(() => expect(screen.getByRole('button', { name: 'AI 工作台' })).toBeInTheDocument())
    expect(screen.getByText(/按登录账号业务角色预置对话工作流/)).toBeInTheDocument()
  })

  test('switches to traditional dashboard', async () => {
    render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: '传统工作台' }))
    await waitFor(() => expect(screen.getByText('评估方案列表')).toBeInTheDocument())
  })

  test('sends AI home message to backend and renders model answer', async () => {
    render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '请分析这份需求材料' } })
    fireEvent.click(screen.getByRole('button', { name: '➤' }))

    expect(await screen.findByText('模型回复：请分析这份需求材料')).toBeInTheDocument()
  })

  test('shows loading bubble while waiting for AI answer and replaces it', async () => {
    let releaseAnswer
    const pendingAnswer = new Promise((resolve) => {
      releaseAnswer = resolve
    })
    server.use(http.post(`${BASE}/ai/home-workbench/chat`, async () => {
      await pendingAnswer
      return HttpResponse.json({
        success: true,
        data: { answer: '模型回复：加载结束', businessRole: 'pre_sales', roleLabel: '售前顾问', model: 'kimi-k2.5' },
      })
    }))

    render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '帮我看看' } })
    fireEvent.click(screen.getByRole('button', { name: '➤' }))

    expect(await screen.findByText('正在理解你的问题')).toBeInTheDocument()

    releaseAnswer()

    expect(await screen.findByText('模型回复：加载结束')).toBeInTheDocument()
    expect(screen.queryByText('正在理解你的问题')).not.toBeInTheDocument()
  })

  test('pressing Enter sends AI home message', async () => {
    render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '你好' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    expect(await screen.findByText('模型回复：你好')).toBeInTheDocument()
  })

  test('pressing Shift Enter does not send AI home message', async () => {
    render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '第一行' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', shiftKey: true })

    expect(screen.queryByText('模型回复：第一行')).not.toBeInTheDocument()
  })
})
