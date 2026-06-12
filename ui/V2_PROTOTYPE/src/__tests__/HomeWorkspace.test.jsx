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
    expect(screen.getByText(/对话式工作台/)).toBeInTheDocument()
  })

  test('switches to traditional dashboard', async () => {
    render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: '传统工作台' }))
    await waitFor(() => expect(screen.getByText('评估方案列表')).toBeInTheDocument())
  })
})
