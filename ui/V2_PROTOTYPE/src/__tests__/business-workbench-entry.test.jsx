import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { expect, it } from 'vitest'
import HomePage from '../pages/HomePage.jsx'
import { ToastProvider } from '../hooks/useToast.jsx'
import { server } from './mocks/server.js'
it('真实工作台路由保留普通对话入口，业务执行仅由独立按钮打开', async () => {
  let starts = 0
  server.use(
    http.get('/api/v1/ai-executions/runs', () => HttpResponse.json({ data: { items: [] } })),
    http.get('/api/v1/ai-executions/catalog', () => HttpResponse.json({ data: { items: [{ kind: 'skill', id: 'skill-a', name: '整理需求', inputSchema: { type: 'object', properties: {} } }] } })),
    http.post('/api/v1/ai-sessions/:id/runs', () => { starts++; return HttpResponse.json({ data: { runId: 'run-a' } }) }),
  )
  render(<ToastProvider><MemoryRouter><HomePage /></MemoryRouter></ToastProvider>)
  const entry = await screen.findByRole('button', { name: '启动 Skill / 工作流' })
  expect(screen.getByRole('textbox')).toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '好的，继续聊天' } })
  expect(starts).toBe(0)
  fireEvent.click(entry)
  await screen.findByRole('dialog', { name: '启动 Skill / 工作流' })
  expect(screen.getByLabelText('选择 Skill 或工作流')).toBeInTheDocument()
  expect(starts).toBe(0)
})
