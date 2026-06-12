import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test } from 'vitest'
import HomeWorkspace from '../pages/HomeWorkspace.jsx'

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
})
