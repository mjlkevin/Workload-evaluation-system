import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'
import { apiClient } from '../api/client.js'
import SystemManagement from '../pages/SystemManagement.jsx'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

async function renderKnowledgeBase() {
  render(
    <MemoryRouter>
      <SystemManagement />
    </MemoryRouter>
  )
  fireEvent.click(screen.getByRole('tab', { name: '知识库' }))
  await waitFor(() => {
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '测试连通性' })).toBeEnabled()
  })
}

describe('SystemManagement knowledge base feedback', () => {
  test('shows saving state and a terminal success message after PATCH succeeds', async () => {
    server.use(
      http.patch(`${BASE}/system/knowledge-base-config/draft`, async ({ request }) => {
        const body = await request.json()
        await delay(50)
        return HttpResponse.json({ success: true, data: { version: 2, draft: body } })
      })
    )
    await renderKnowledgeBase()

    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    expect(screen.getByRole('button', { name: '保存中...' })).toBeDisabled()
    expect(await screen.findByRole('status')).toHaveTextContent('知识库配置草稿已保存')
  })

  test('shows testing state and a terminal error when connectivity fails', async () => {
    server.use(
      http.post(`${BASE}/system/knowledge-base-config/test`, () => {
        return HttpResponse.json({ code: 'UPSTREAM_UNAVAILABLE', message: '上游服务暂不可用' }, { status: 503 })
      })
    )
    await renderKnowledgeBase()

    fireEvent.click(screen.getByRole('button', { name: '测试连通性' }))

    expect(screen.getByRole('button', { name: '测试中...' })).toBeDisabled()
    expect(await screen.findByText('连通性测试失败')).toBeInTheDocument()
  })

  test('shows connectivity success with an empty-retrieval notice', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
      data: {
        ok: true,
        warning: 'retrieval_empty',
        model: 'glm-test',
        knowledgeId: 'knowledge-unit-test-id',
        retrievalTriggered: false,
      },
    })
    await renderKnowledgeBase()

    fireEvent.click(screen.getByRole('button', { name: '测试连通性' }))

    expect(await screen.findByText('连通性测试通过')).toBeInTheDocument()
    expect(screen.getByText('连接成功，但固定测试语句未检索到文档')).toBeInTheDocument()
  })
})
