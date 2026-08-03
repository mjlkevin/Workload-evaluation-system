import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'
import { apiClient } from '../api/client.js'
import ToastContainer from '../components/ui/ToastContainer.jsx'
import { ToastProvider } from '../hooks/useToast.jsx'
import SystemManagement from '../pages/SystemManagement.jsx'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

async function renderKnowledgeBase() {
  render(
    <ToastProvider>
      <ToastContainer />
      <MemoryRouter>
        <SystemManagement sectionId="kb" />
      </MemoryRouter>
    </ToastProvider>
  )
  await waitFor(() => {
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled()
  })
}

describe('KnowledgeBase · 保存草稿不双重反馈', () => {
  test('保存草稿成功仅显示内联 status，不触发 alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert')
    await renderKnowledgeBase()

    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/知识库配置草稿已保存/)
    expect(alertSpy).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })
})

describe('KnowledgeBase · 生效配置内联反馈', () => {
  test('生效配置成功显示内联 status，不触发 alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert')
    server.use(
      http.post(`${BASE}/system/knowledge-base-config/activate`, () =>
        HttpResponse.json({ success: true, data: { version: 2 } })),
    )
    await renderKnowledgeBase()

    fireEvent.click(screen.getByRole('button', { name: /生效配置/ }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/知识库配置已生效/)
    expect(alertSpy).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })

  test('生效配置失败显示内联错误，不触发 alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert')
    server.use(
      http.post(`${BASE}/system/knowledge-base-config/activate`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 })),
    )
    await renderKnowledgeBase()

    fireEvent.click(screen.getByRole('button', { name: /生效配置/ }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Internal Server Error|生效失败/)
    expect(alertSpy).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })
})

describe('KnowledgeBase · 连通性测试 ARIA live region', () => {
  test('连通性测试成功结果区域带 role="status"', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
      data: { ok: true, testedSource: 'mock', retrievalTriggered: true },
    })
    await renderKnowledgeBase()

    fireEvent.click(screen.getByRole('button', { name: '测试连通性' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('连通性测试通过')
  })

  test('连通性测试失败结果区域带 role="alert"', async () => {
    server.use(
      http.post(`${BASE}/system/knowledge-base-config/test`, () =>
        HttpResponse.json({ code: 'UPSTREAM_UNAVAILABLE', message: '上游服务暂不可用' }, { status: 503 })),
    )
    await renderKnowledgeBase()

    fireEvent.click(screen.getByRole('button', { name: '测试连通性' }))

    await screen.findByText('连通性测试失败')
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
