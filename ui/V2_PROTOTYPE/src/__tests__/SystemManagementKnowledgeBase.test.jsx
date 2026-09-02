import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
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
    const testButtons = screen.getAllByRole('button', { name: /测试 .*知识库/ })
    expect(testButtons.length).toBeGreaterThan(0)
    testButtons.forEach((button) => expect(button).toBeEnabled())
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

  test('identifies the knowledge base whose profile probe became stale', async () => {
    server.use(
      http.get(`${BASE}/system/knowledge-base-config`, () => HttpResponse.json({ code: 0, data: {
        version: 4,
        draft: {
          model: 'glm-4.6', apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          credentials: { apiKey: '', apiHint: '····1234', knowledgeId: '' },
          knowledgeBases: [
            { id: 'solutions', name: '金蝶解决方案知识库', description: '产品方案', knowledgeId: 'kb-solutions', routingKeywords: ['产品方案'], allowedBusinessRoles: [], enabled: true, isDefault: true, priority: 100 },
            { id: 'treasury', name: '司库与银企知识库', description: '资金与网银', knowledgeId: 'kb-treasury', routingKeywords: ['资金计划'], allowedBusinessRoles: ['pre_sales'], enabled: true, isDefault: false, priority: 10 },
          ],
        },
        active: { credentials: { apiKey: '', apiHint: '····1234', knowledgeId: 'kb-solutions', resolvedFrom: 'store' }, knowledgeBases: [] },
        probes: {},
      } })),
      http.post(`${BASE}/system/knowledge-base-config/activate`, () => HttpResponse.json({
        code: 40901,
        message: '知识库配置尚未通过有效连通性验证',
        details: [{ field: 'knowledgeBases.treasury.probe', reason: 'config_changed_after_probe', profileId: 'treasury' }],
      }, { status: 409 })),
    )
    await renderKnowledgeBase()

    fireEvent.click(screen.getByRole('button', { name: /生效配置/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('司库与银企知识库配置已变更，请重新测试后再生效')
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

    fireEvent.click(screen.getByRole('button', { name: /测试 .*知识库/ }))

    expect(screen.getByRole('button', { name: '测试中...' })).toBeDisabled()
    expect(await screen.findByText('连通性测试失败')).toBeInTheDocument()
  })

  test('shows connectivity success with an empty-retrieval notice', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
      data: {
        ok: true,
        profileId: 'solutions',
        warning: 'retrieval_empty',
        model: 'glm-test',
        knowledgeId: 'knowledge-unit-test-id',
        retrievalTriggered: false,
      },
    })
    await renderKnowledgeBase()

    fireEvent.click(screen.getByRole('button', { name: /测试 .*知识库/ }))

    expect(await screen.findByText(/连通性测试通过.*未检索到文档/)).toBeInTheDocument()
  })

  test('renders multiple knowledge base profiles with route and access summaries', async () => {
    server.use(
      http.get(`${BASE}/system/knowledge-base-config`, () => HttpResponse.json({ code: 0, data: {
        version: 4,
        draft: {
          model: 'glm-4.6', apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          credentials: { apiKey: '', apiHint: '····1234', knowledgeId: '' },
          knowledgeBases: [
            { id: 'solutions', name: '金蝶解决方案知识库', description: '产品方案', knowledgeId: 'kb-solutions', routingKeywords: ['产品方案'], allowedBusinessRoles: [], enabled: true, isDefault: true, priority: 100 },
            { id: 'treasury', name: '司库与银企知识库', description: '资金与网银', knowledgeId: 'kb-treasury', routingKeywords: ['资金计划', '网上银行'], allowedBusinessRoles: ['pre_sales', 'pm'], enabled: true, isDefault: false, priority: 10 },
          ],
        },
        active: { credentials: { apiKey: '', apiHint: '····1234', knowledgeId: 'kb-solutions', resolvedFrom: 'store' }, knowledgeBases: [] },
        probes: { treasury: { status: 'success', checkedAt: '2026-08-03T00:00:00.000Z' } },
      } })),
    )
    await renderKnowledgeBase()

    expect(screen.getByText('金蝶解决方案知识库')).toBeInTheDocument()
    expect(screen.getByText('司库与银企知识库')).toBeInTheDocument()
    expect(screen.getByText('资金计划 · 网上银行')).toBeInTheDocument()
    expect(screen.getByText('售前顾问 · 项目经理')).toBeInTheDocument()
    expect(screen.getByText('已验证')).toBeInTheDocument()
  })

  test('adds a profile in a dialog and includes routing and role fields in the draft payload', async () => {
    let payload
    server.use(
      http.patch(`${BASE}/system/knowledge-base-config/draft`, async ({ request }) => {
        payload = await request.json()
        return HttpResponse.json({ code: 0, data: { version: 2, draft: payload } })
      }),
    )
    await renderKnowledgeBase()

    fireEvent.click(screen.getByRole('button', { name: '新增知识库' }))
    expect(screen.getByRole('dialog', { name: '新增知识库' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('知识库名称'), { target: { value: '司库与银企知识库' } })
    fireEvent.change(screen.getByLabelText('内部标识'), { target: { value: 'treasury' } })
    fireEvent.change(screen.getByLabelText('知识库 ID'), { target: { value: 'kb-treasury' } })
    fireEvent.change(screen.getByLabelText('路由关键词'), { target: { value: '资金计划，网上银行' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '售前顾问' }))
    fireEvent.click(screen.getByRole('button', { name: '保存档案' }))
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    await waitFor(() => expect(payload).toBeTruthy())
    expect(payload.knowledgeBases).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'treasury',
        name: '司库与银企知识库',
        knowledgeId: 'kb-treasury',
        routingKeywords: ['资金计划', '网上银行'],
        allowedBusinessRoles: ['pre_sales'],
      }),
    ]))
  })

  test('tests one selected profile instead of sending all knowledge bases', async () => {
    let payload
    vi.spyOn(apiClient, 'post').mockImplementationOnce(async (_path, body) => {
      payload = body
      return { code: 0, data: { ok: true, profileId: body.profileId, retrievalTriggered: true } }
    })
    await renderKnowledgeBase()

    fireEvent.click(screen.getByRole('button', { name: '测试 金蝶解决方案知识库' }))
    await waitFor(() => expect(payload).toEqual(expect.objectContaining({ profileId: 'solutions' })))
  })

  test('rerank checkbox defaults off with an explanatory hint (DEF-2026-09-02-001)', async () => {
    await renderKnowledgeBase()

    const checkbox = screen.getByRole('checkbox', { name: '启用检索重排' })
    expect(checkbox).not.toBeChecked()
    expect(screen.getByText(/开启需账号具备重排权限且填写供应商认可的重排模型名，否则连通性测试会失败/)).toBeInTheDocument()
  })

  test('shows a human-readable provider reason when the failure carries details (DEF-2026-09-02-001)', async () => {
    server.use(
      http.post(`${BASE}/system/knowledge-base-config/test`, () => {
        return HttpResponse.json({
          code: 40001,
          message: '知识库连通性测试未通过',
          details: [{ field: 'knowledgeBase', reason: 'provider_unspecified_rejection', providerCode: 500 }],
        }, { status: 400 })
      })
    )
    await renderKnowledgeBase()

    fireEvent.click(screen.getByRole('button', { name: /测试 .*知识库/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('供应商拒绝（智谱 code=500，常见于重排未授权），可尝试关闭检索重排')
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 400')
  })

  test('shows provider message alongside classified reason when details include it (DEF-2026-09-02-001)', async () => {
    server.use(
      http.post(`${BASE}/system/knowledge-base-config/test`, () => {
        return HttpResponse.json({
          code: 40001,
          message: '知识库连通性测试未通过',
          details: [{ field: 'knowledgeBase', reason: 'authentication_failed', providerCode: 401, providerMessage: '令牌已过期或验证不正确' }],
        }, { status: 400 })
      })
    )
    await renderKnowledgeBase()

    fireEvent.click(screen.getByRole('button', { name: /测试 .*知识库/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('供应商鉴权失败（智谱 code=401，供应商：令牌已过期或验证不正确），请检查 API 密钥是否有效')
  })

  test('falls back to the backend message without details (DEF-2026-09-02-001)', async () => {
    server.use(
      http.post(`${BASE}/system/knowledge-base-config/test`, () => {
        return HttpResponse.json({ code: 'UPSTREAM_UNAVAILABLE', message: '上游服务暂不可用' }, { status: 503 })
      })
    )
    await renderKnowledgeBase()

    fireEvent.click(screen.getByRole('button', { name: /测试 .*知识库/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('上游服务暂不可用')
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 503')
  })

  test('marks the profile probe as failed when the connectivity test fails (DEF-2026-09-02-001)', async () => {
    server.use(
      http.post(`${BASE}/system/knowledge-base-config/test`, () => {
        return HttpResponse.json({ code: 40001, message: '知识库连通性测试未通过' }, { status: 400 })
      })
    )
    await renderKnowledgeBase()

    expect(screen.getAllByText('待测试').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /测试 .*知识库/ }))

    expect(await screen.findByText('验证失败')).toBeInTheDocument()
    expect(screen.queryByText('已验证')).not.toBeInTheDocument()
  })
})
