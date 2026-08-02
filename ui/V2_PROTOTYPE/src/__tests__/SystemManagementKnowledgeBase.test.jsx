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
  test('keeps a stored key on ordinary save and clears it only after explicit confirmation', async () => {
    const payloads = []
    server.use(
      http.get(`${BASE}/system/knowledge-base-config`, () => HttpResponse.json({ success: true, data: {
        version: 3,
        draft: {
          model: 'glm-4.6',
          apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          credentials: { apiKey: '', apiHint: '····1234', knowledgeId: 'kb-1' },
          retrievalParams: { topK: 8, topN: 20, recallMethod: 'mixed', rerankStatus: 1, rerankModel: 'rerank', fractionalThreshold: 0.2 },
          promptProfile: { id: 'rag-answer', version: 1 },
        },
        active: { credentials: { apiKey: '', apiHint: '····1234', knowledgeId: 'kb-1', resolvedFrom: 'store' } },
      } })),
      http.patch(`${BASE}/system/knowledge-base-config/draft`, async ({ request }) => {
        payloads.push(await request.json())
        return HttpResponse.json({ success: true, data: {} })
      }),
    )
    await renderKnowledgeBase()

    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(payloads).toHaveLength(1))
    expect(payloads[0].credentials).not.toHaveProperty('apiKey')

    fireEvent.click(screen.getByRole('button', { name: '清除已保存密钥' }))
    expect(screen.getByRole('dialog', { name: '清除已保存密钥' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认清除' }))
    await waitFor(() => expect(payloads).toHaveLength(2))
    expect(payloads[1]).toEqual({ credentials: { apiKey: null } })
  })

  test('saves configured retrieval parameters in the draft payload', async () => {
    let payload
    server.use(
      http.patch(`${BASE}/system/knowledge-base-config/draft`, async ({ request }) => {
        payload = await request.json()
        return HttpResponse.json({ success: true, data: {} })
      }),
    )
    await renderKnowledgeBase()
    fireEvent.change(screen.getByLabelText('Top K'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('召回方式'), { target: { value: 'keyword' } })
    fireEvent.change(screen.getByLabelText('相似度阈值'), { target: { value: '0.35' } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(payload).toBeTruthy())
    expect(payload.retrievalParams).toMatchObject({ topK: 12, recallMethod: 'keyword', fractionalThreshold: 0.35 })
  })

  test('turns an activation gate conflict into an actionable retest message', async () => {
    server.use(
      http.post(`${BASE}/system/knowledge-base-config/activate`, () => HttpResponse.json({
        code: 40901,
        message: '知识库配置尚未通过有效连通性验证',
        details: [{ field: 'probe', reason: 'config_changed_after_probe' }],
      }, { status: 409 })),
    )
    await renderKnowledgeBase()
    fireEvent.click(screen.getByRole('button', { name: /生效配置/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('配置已变更，请重新测试连通性后再生效')
  })

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
