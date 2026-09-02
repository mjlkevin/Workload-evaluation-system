import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { apiClient } from '../api/client.js'
import ToastContainer from '../components/ui/ToastContainer.jsx'
import { ToastProvider } from '../hooks/useToast.jsx'
import SystemManagement from '../pages/SystemManagement.jsx'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

afterEach(() => vi.restoreAllMocks())

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

// 断言反馈落在标准 toast 容器内，而不是页面常驻横幅；role 语义由调用方单独断言。
function expectInToastContainer(node) {
  expect(node.closest('.wes-toast-container')).not.toBeNull()
}

describe('KnowledgeBase · 保存草稿不双重反馈', () => {
  test('保存草稿成功只显示 toast（role="status"），不触发 alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert')
    await renderKnowledgeBase()

    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    const status = await screen.findByRole('status')
    expectInToastContainer(status)
    expect(status).toHaveTextContent(/知识库配置草稿已保存/)
    expect(alertSpy).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })
})

describe('KnowledgeBase · 生效配置反馈', () => {
  test('生效配置成功显示 toast（role="status"），不触发 alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert')
    server.use(
      http.post(`${BASE}/system/knowledge-base-config/activate`, () =>
        HttpResponse.json({ success: true, data: { version: 2 } })),
    )
    await renderKnowledgeBase()

    fireEvent.click(screen.getByRole('button', { name: /生效配置/ }))

    const status = await screen.findByRole('status')
    expectInToastContainer(status)
    expect(status).toHaveTextContent(/知识库配置已生效/)
    expect(alertSpy).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })

  test('生效配置失败显示 error toast（role="alert"），不触发 alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert')
    server.use(
      http.post(`${BASE}/system/knowledge-base-config/activate`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 })),
    )
    await renderKnowledgeBase()

    fireEvent.click(screen.getByRole('button', { name: /生效配置/ }))

    const alert = await screen.findByRole('alert')
    expectInToastContainer(alert)
    expect(alert).toHaveTextContent(/Internal Server Error|生效失败/)
    expect(alertSpy).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })
})

describe('KnowledgeBase · 连通性测试 ARIA live region', () => {
  test('连通性测试通过显示 toast（role="status"）', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
      data: { ok: true, profileId: 'solutions', testedSource: 'mock', retrievalTriggered: true },
    })
    await renderKnowledgeBase()

    fireEvent.click(screen.getByRole('button', { name: /测试 金蝶解决方案知识库/ }))

    const status = await screen.findByRole('status')
    expectInToastContainer(status)
    expect(status).toHaveTextContent('连通性测试通过')
  })

  test('连通性测试未通过显示 error toast（role="alert"，语义不得因换组件而丢失）', async () => {
    server.use(
      http.post(`${BASE}/system/knowledge-base-config/test`, () =>
        HttpResponse.json({ code: 'UPSTREAM_UNAVAILABLE', message: '上游服务暂不可用' }, { status: 503 })),
    )
    await renderKnowledgeBase()

    fireEvent.click(screen.getByRole('button', { name: /测试 金蝶解决方案知识库/ }))

    const alert = await screen.findByRole('alert')
    expectInToastContainer(alert)
    expect(alert).toHaveTextContent('连通性测试未通过')
    expect(alert).not.toHaveClass('sys-banner')
  })
})
