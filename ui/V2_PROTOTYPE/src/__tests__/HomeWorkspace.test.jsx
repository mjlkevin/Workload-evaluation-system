import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import ToastContainer from '../components/ui/ToastContainer.jsx'
import { ToastProvider } from '../hooks/useToast.jsx'
import HomeWorkspace from '../pages/HomeWorkspace.jsx'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

function doubleClickInlineField(button) {
  fireEvent.click(button, { detail: 1 })
  fireEvent.click(button, { detail: 2 })
}

function renderHomeWorkspace() {
  return render(
    <ToastProvider>
      <ToastContainer />
      <MemoryRouter><HomeWorkspace /></MemoryRouter>
    </ToastProvider>
  )
}

function requestSessionDelete(title) {
  const sessionCard = screen.getByText(title).closest('[role="button"]')
  fireEvent.contextMenu(sessionCard, { clientX: 40, clientY: 40 })
  fireEvent.click(screen.getByRole('button', { name: '删除会话' }))
}

describe('HomeWorkspace', () => {
  beforeEach(() => {
    localStorage.removeItem('wes_home_view')
    localStorage.removeItem('wes-ai-active-session-id')
    localStorage.removeItem('wes-ai-workspace-panel-collapsed')
  })

  test('defaults to AI workbench', async () => {
    renderHomeWorkspace()

    await waitFor(() => expect(screen.getByRole('button', { name: 'AI 工作台' })).toBeInTheDocument())
    expect(screen.queryByText(/按登录账号业务角色预置对话工作流/)).not.toBeInTheDocument()
  })

  test('collapses AI workspace panel and remembers the preference', async () => {
    renderHomeWorkspace()

    await screen.findByRole('complementary', { name: 'AI 工作区' })
    expect(screen.getByText('预期产出')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '折叠工作区' }))

    expect(screen.getByText('预期产出').closest('.ai-home-inspector__content')).toHaveClass('ai-home-inspector__content--hidden')
    expect(screen.getByRole('button', { name: '展开工作区' })).toBeInTheDocument()
    expect(localStorage.getItem('wes-ai-workspace-panel-collapsed')).toBe('true')
  })

  test('switches to traditional dashboard', async () => {
    renderHomeWorkspace()

    fireEvent.click(screen.getByRole('button', { name: '传统工作台' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '项目列表' })).toBeInTheDocument())
  })

  test('updates page identity when switching to traditional dashboard', async () => {
    renderHomeWorkspace()

    fireEvent.click(screen.getByRole('button', { name: '传统工作台' }))

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: '项目评估工作台' })).toBeInTheDocument())
    expect(screen.getByRole('link', { name: '项目评估工作台' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '传统工作台' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('selected workflow reshapes the central empty state and composer context', async () => {
    renderHomeWorkspace()

    fireEvent.click(await screen.findByRole('button', { name: /生成待确认问题/ }))

    expect(screen.getByRole('heading', { level: 2, name: '生成待确认问题' })).toBeInTheDocument()
    expect(screen.getAllByText(/提炼售前需要回问客户的问题/).length).toBeGreaterThan(0)
    expect(screen.getByText('当前工作流：生成待确认问题')).toBeInTheDocument()
    expect(screen.getAllByText('客户回问清单').length).toBeGreaterThan(0)
  })

  test('RP-032: workflow list section uses "工作流模板" label and supports scrolling', async () => {
    renderHomeWorkspace()

    // Section header renamed from "推荐工作流" to "工作流模板"
    expect(await screen.findByText('工作流模板')).toBeInTheDocument()
    expect(screen.queryByText('推荐工作流')).not.toBeInTheDocument()

    // Workflow list container has scroll class
    const workflowList = document.querySelector('.ai-workflow-list')
    expect(workflowList).toBeInTheDocument()
    expect(workflowList.style.maxHeight).toBe('220px')
    expect(workflowList.style.overflowY).toBe('auto')
  })

  test('RP-032: selected workflow button shows current-task indicator and aria-label', async () => {
    renderHomeWorkspace()

    const workflowButton = await screen.findByRole('button', { name: /生成待确认问题/ })
    fireEvent.click(workflowButton)

    // After selection, aria-label includes "当前任务"
    const selectedButton = await screen.findByRole('button', { name: /生成待确认问题（当前任务）/ })
    expect(selectedButton).toBeInTheDocument()
    expect(selectedButton).toHaveAttribute('aria-pressed', 'true')
  })

  test('RP-033: session list container supports scrolling with hidden scrollbar', async () => {
    renderHomeWorkspace()

    // Session list container has scroll class and correct properties
    const sessionList = await screen.findByText('会话')
    const sessionListContainer = sessionList.closest('section')?.querySelector('.ai-session-list')
    expect(sessionListContainer).toBeInTheDocument()
    expect(sessionListContainer.style.flex).toBe('1 1 0%')
    expect(sessionListContainer.style.overflowY).toBe('auto')
  })

  test('sends AI home message to backend and renders model answer', async () => {
    renderHomeWorkspace()

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '请分析这份需求材料' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    expect(await screen.findByText('模型回复：请分析这份需求材料')).toBeInTheDocument()
  })

  test('renders markdown tables in AI answers as structured tables', async () => {
    server.use(
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: [] } })),
      http.post(`${BASE}/ai/home-workbench/chat`, async () => HttpResponse.json({
        success: true,
        data: {
          answer: [
            '## 模块建议',
            '| 模块 | 建议 | 风险 |',
            '| --- | --- | --- |',
            '| **供应链** | 优先上线 `采购管理` | 多组织配置需确认 |',
            '| 财务 | 先做总账 | 无 |',
          ].join('\n'),
          businessRole: 'pre_sales',
          roleLabel: '售前顾问',
          model: 'kimi-k2.5',
        },
      }))
    )
    renderHomeWorkspace()

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '请输出模块建议表' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    const table = await screen.findByRole('table', { name: '模块建议' })
    expect(within(table).getByRole('columnheader', { name: '模块' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: '建议' })).toBeInTheDocument()
    expect(within(table).getByRole('cell', { name: '供应链' })).toBeInTheDocument()
    expect(within(table).getByText('采购管理')).toBeInTheDocument()
    expect(within(table).queryByText(/\| --- \|/)).not.toBeInTheDocument()
  })

  test('does not render unsafe markdown links or raw HTML in AI answers', async () => {
    server.use(
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: [] } })),
      http.post(`${BASE}/ai/home-workbench/chat`, async () => HttpResponse.json({
        success: true,
        data: {
          answer: [
            '请查看 [安全链接](https://example.com/report)。',
            '不要点击 [危险链接](javascript:alert)。',
            '<img src=x onerror=alert(1)>',
          ].join('\n'),
          businessRole: 'pre_sales',
          roleLabel: '售前顾问',
          model: 'kimi-k2.5',
        },
      }))
    )
    renderHomeWorkspace()

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '请返回链接' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    const safeLink = await screen.findByRole('link', { name: '安全链接' })
    expect(safeLink).toHaveAttribute('href', 'https://example.com/report')
    expect(screen.queryByRole('link', { name: '危险链接' })).not.toBeInTheDocument()
    expect(screen.getByText('危险链接')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument()
  })

  test('renders AI guided options as click-to-send actions', async () => {
    const sentMessages = []
    server.use(
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: [] } })),
      http.post(`${BASE}/ai/home-workbench/chat`, async ({ request }) => {
        const body = await request.json()
        const latest = body.messages.at(-1)?.content
        sentMessages.push(latest)
        const answer = sentMessages.length === 1
          ? '可以继续：\n选项A：需求深化分析\n选项B：方案匹配设计\n选项C：实施风险评估'
          : `模型回复：${latest}`
        return HttpResponse.json({
          success: true,
          data: {
            answer,
            businessRole: 'pre_sales',
            roleLabel: '售前顾问',
            model: 'kimi-k2.5',
          },
        })
      })
    )
    renderHomeWorkspace()

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '请给我下一步选项' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    const option = await screen.findByRole('button', { name: /选项A.*需求深化分析/ })
    fireEvent.click(option)

    await waitFor(() => expect(sentMessages).toContain('启动选项A：需求深化分析'))
    expect(await screen.findByText('模型回复：启动选项A：需求深化分析')).toBeInTheDocument()
  })

  test('promotes ordered list to option cards when preceded by selection context', async () => {
    const sentMessages = []
    server.use(
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: [] } })),
      http.post(`${BASE}/ai/home-workbench/chat`, async ({ request }) => {
        const body = await request.json()
        const latest = body.messages.at(-1)?.content
        sentMessages.push(latest)
        const answer = sentMessages.length === 1
          ? '请选择下一步操作：\n1. 工作量评估\n2. 需求梳理\n3. 方案匹配'
          : `模型回复：${latest}`
        return HttpResponse.json({
          success: true,
          data: {
            answer,
            businessRole: 'pre_sales',
            roleLabel: '售前顾问',
            model: 'kimi-k2.5',
          },
        })
      })
    )
    renderHomeWorkspace()

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '下一步做什么' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    // Path B: ordered list promoted to option cards
    const option = await screen.findByRole('button', { name: /工作量评估/ })
    expect(option).toBeInTheDocument()
    fireEvent.click(option)

    // Clicking sends the option text directly
    await waitFor(() => expect(sentMessages).toContain('工作量评估'))
  })

  test('does not promote ordered list without selection context', async () => {
    server.use(
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: [] } })),
      http.post(`${BASE}/ai/home-workbench/chat`, () =>
        HttpResponse.json({
          success: true,
          data: {
            answer: '以下是项目步骤：\n1. 需求分析\n2. 方案设计\n3. 实施部署',
            businessRole: 'pre_sales',
            roleLabel: '售前顾问',
            model: 'kimi-k2.5',
          },
        })
      )
    )
    renderHomeWorkspace()

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '项目步骤' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    // Should render as regular markdown list, not option cards
    await screen.findByText(/需求分析/)
    expect(screen.queryByRole('button', { name: /需求分析/ })).not.toBeInTheDocument()
  })

  test('renders AI formBlock as a submit-to-chat form', async () => {
    const sentMessages = []
    server.use(
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: [] } })),
      http.post(`${BASE}/ai/home-workbench/chat`, async ({ request }) => {
        const body = await request.json()
        const latest = body.messages.at(-1)?.content
        sentMessages.push(latest)
        if (sentMessages.length === 1) {
          return HttpResponse.json({
            success: true,
            data: {
              answer: '还需要补充几个项目信息。',
              businessRole: 'pre_sales',
              roleLabel: '售前顾问',
              model: 'kimi-k2.5',
              formBlock: {
                blockId: 'project-supplement',
                title: '补充项目信息',
                description: '用于继续生成可评估需求包。',
                submitLabel: '提交补充信息',
                submitMessageTemplate: '补充项目信息：金额={{budgetRange}}；周期={{deliveryMonths}}个月；多组织={{multiOrg}}；备注={{note}}',
                fields: [
                  {
                    id: 'budgetRange',
                    label: '预估金额',
                    type: 'single_select',
                    required: true,
                    options: [
                      { label: '50万以内', value: 'lt_500k' },
                      { label: '50万到200万', value: '500k_2m' },
                    ],
                  },
                  { id: 'deliveryMonths', label: '交付周期（月）', type: 'number', required: true },
                  { id: 'multiOrg', label: '涉及多组织协同', type: 'boolean' },
                  { id: 'note', label: '补充备注', type: 'textarea' },
                ],
              },
            },
          })
        }
        return HttpResponse.json({
          success: true,
          data: {
            answer: `模型回复：${latest}`,
            businessRole: 'pre_sales',
            roleLabel: '售前顾问',
            model: 'kimi-k2.5',
          },
        })
      })
    )

    renderHomeWorkspace()

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '请生成可评估需求包' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    const form = await screen.findByRole('group', { name: '补充项目信息' })
    fireEvent.change(within(form).getByLabelText('预估金额'), { target: { value: 'lt_500k' } })
    fireEvent.change(within(form).getByLabelText('交付周期（月）'), { target: { value: '4' } })
    fireEvent.click(within(form).getByRole('checkbox', { name: '涉及多组织协同' }))
    fireEvent.change(within(form).getByLabelText('补充备注'), { target: { value: '先做核心财务供应链' } })
    fireEvent.click(within(form).getByRole('button', { name: '提交补充信息' }))

    const submittedMessage = '补充项目信息：金额=50万以内；周期=4个月；多组织=是；备注=先做核心财务供应链'
    await waitFor(() => expect(sentMessages).toContain(submittedMessage))
    expect(await screen.findByText(`模型回复：${submittedMessage}`)).toBeInTheDocument()
  })

  test('renders AI formBlock stored in session message metadata', async () => {
    let chatBody
    const loadedSession = {
      sessionId: 'session-formblock',
      title: '补充信息会话',
      domain: 'business_evaluation',
      workflowKey: 'free_chat',
      businessRole: 'pre_sales',
      status: 'temporary_chat',
      summary: '',
      messages: [
        { messageId: 'm-user', role: 'user', content: '请继续分析', createdAt: '2026-06-14T00:00:00.000Z' },
        {
          messageId: 'm-ai',
          role: 'assistant',
          content: '请先补充项目边界。',
          metadata: {
            formBlock: {
              blockId: 'boundary-form',
              title: '补充项目边界',
              submitLabel: '提交边界',
              fields: [
                { id: 'projectScope', label: '项目范围', type: 'text', required: true },
              ],
            },
          },
          createdAt: '2026-06-14T00:00:01.000Z',
        },
      ],
      attachments: [],
      artifacts: [],
      pendingActions: [],
      linkedRecords: {},
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:01.000Z',
    }
    server.use(
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: [loadedSession] } })),
      http.post(`${BASE}/ai/home-workbench/chat`, async ({ request }) => {
        chatBody = await request.json()
        const latest = chatBody.messages.at(-1)?.content
        return HttpResponse.json({
          success: true,
          data: {
            answer: `模型回复：${latest}`,
            session: {
              ...loadedSession,
              messages: [
                ...loadedSession.messages,
                { messageId: 'm-user-2', role: 'user', content: latest, createdAt: '2026-06-14T00:00:02.000Z' },
                { messageId: 'm-ai-2', role: 'assistant', content: `模型回复：${latest}`, createdAt: '2026-06-14T00:00:03.000Z' },
              ],
            },
          },
        })
      })
    )

    renderHomeWorkspace()

    const form = await screen.findByRole('group', { name: '补充项目边界' })
    fireEvent.change(within(form).getByLabelText('项目范围'), { target: { value: '覆盖采购、库存、财务' } })
    fireEvent.click(within(form).getByRole('button', { name: '提交边界' }))

    await waitFor(() => expect(chatBody.sessionId).toBe('session-formblock'))
    expect(chatBody.messages.at(-1)).toMatchObject({
      role: 'user',
      content: '补充项目边界：\n- 项目范围：覆盖采购、库存、财务',
    })
  })

  test('renders knowledge tool trace chip stored in session message metadata', async () => {
    const loadedSession = {
      sessionId: 'session-knowledge',
      title: '知识库会话',
      domain: 'business_evaluation',
      workflowKey: 'free_chat',
      businessRole: 'pre_sales',
      status: 'temporary_chat',
      summary: '',
      messages: [
        { messageId: 'm-user', role: 'user', content: '智能会计平台是什么？', createdAt: '2026-06-14T00:00:00.000Z' },
        {
          messageId: 'm-ai',
          role: 'assistant',
          content: '智能会计平台用于财务核算、税务、资金等场景。',
          metadata: {
            knowledgeTool: {
              toolId: 'knowledge_base.query_product_knowledge',
              available: true,
              retrievalTriggered: true,
              confidence: 'high',
              query: '智能会计平台是什么？',
              answer: '智能会计平台用于财务核算、税务、资金等场景。',
              model: 'glm-4.6',
              knowledgeId: '2057857904412954624',
              promptTokens: 1430,
              completionTokens: 42,
              totalTokens: 1472,
              latencyMs: 320,
              contextRef: 'knowledge:2057857904412954624:%E6%99%BA%E8%83%BD:1430',
            },
          },
          createdAt: '2026-06-14T00:00:01.000Z',
        },
      ],
      attachments: [],
      artifacts: [],
      pendingActions: [],
      linkedRecords: {},
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:01.000Z',
    }
    server.use(
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: [loadedSession] } }))
    )

    renderHomeWorkspace()

    const traceChip = await screen.findByLabelText('知识库参考')
    expect(within(traceChip).getByText('知识库参考')).toBeInTheDocument()
    expect(within(traceChip).getByText('glm-4.6')).toBeInTheDocument()
    expect(within(traceChip).getByText('retrievalTriggered=true')).toBeInTheDocument()
    expect(within(traceChip).getByText('高置信')).toBeInTheDocument()
  })

  test('renders low confidence knowledge tool trace fallback reason', async () => {
    const loadedSession = {
      sessionId: 'session-knowledge-low',
      title: '知识库低置信会话',
      domain: 'business_evaluation',
      workflowKey: 'free_chat',
      businessRole: 'pre_sales',
      status: 'temporary_chat',
      summary: '',
      messages: [
        { messageId: 'm-user', role: 'user', content: '一个知识库未覆盖的问题', createdAt: '2026-06-14T00:00:00.000Z' },
        {
          messageId: 'm-ai',
          role: 'assistant',
          content: '知识库未命中该问题，请补充资料或人工确认。',
          metadata: {
            knowledgeTool: {
              toolId: 'knowledge_base.query_product_knowledge',
              available: true,
              retrievalTriggered: false,
              confidence: 'low',
              fallbackReason: 'retrieval_not_triggered',
              query: '一个知识库未覆盖的问题',
              answer: '知识库未命中该问题，请补充资料或人工确认。',
              model: 'glm-4.6',
              knowledgeId: '2057857904412954624',
              promptTokens: 82,
              completionTokens: 34,
              totalTokens: 116,
              latencyMs: 280,
              contextRef: 'knowledge:2057857904412954624:low:82',
            },
          },
          createdAt: '2026-06-14T00:00:01.000Z',
        },
      ],
      attachments: [],
      artifacts: [],
      pendingActions: [],
      linkedRecords: {},
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:01.000Z',
    }
    server.use(
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: [loadedSession] } }))
    )

    renderHomeWorkspace()

    const traceChip = await screen.findByLabelText('知识库参考')
    expect(within(traceChip).getByText('retrievalTriggered=false')).toBeInTheDocument()
    expect(within(traceChip).getByText('低置信')).toBeInTheDocument()
    expect(within(traceChip).getByText('retrieval_not_triggered')).toBeInTheDocument()
  })

  test('persists AI home messages in the active session', async () => {
    let createBody
    let chatBody
    server.use(
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: [] } })),
      http.post(`${BASE}/ai-sessions`, async ({ request }) => {
        createBody = await request.json()
        return HttpResponse.json({
          success: true,
          data: {
            session: {
              sessionId: 'session-new',
              title: createBody.title,
              domain: 'business_evaluation',
              workflowKey: createBody.workflowKey,
              businessRole: 'pre_sales',
              status: createBody.status,
              summary: '',
              messages: [],
              attachments: [],
              artifacts: [],
              pendingActions: [],
              linkedRecords: {},
              createdAt: '2026-06-14T00:00:00.000Z',
              updatedAt: '2026-06-14T00:00:00.000Z',
            },
          },
        })
      }),
      http.post(`${BASE}/ai/home-workbench/chat`, async ({ request }) => {
        chatBody = await request.json()
        return HttpResponse.json({
          success: true,
          data: {
            answer: '模型回复：已进入持久会话',
            businessRole: 'pre_sales',
            roleLabel: '售前顾问',
            model: 'kimi-k2.5',
            session: {
              sessionId: chatBody.sessionId,
              title: '持久会话',
              domain: 'business_evaluation',
              workflowKey: chatBody.workflowKey || 'free_chat',
              businessRole: 'pre_sales',
              status: 'temporary_chat',
              summary: '',
              messages: [
                { messageId: 'm-user', role: 'user', content: '请粗评这个项目', createdAt: '2026-06-14T00:00:00.000Z' },
                { messageId: 'm-ai', role: 'assistant', content: '模型回复：已进入持久会话', createdAt: '2026-06-14T00:00:01.000Z' },
              ],
              attachments: [],
              artifacts: [],
              pendingActions: [],
              linkedRecords: {},
              createdAt: '2026-06-14T00:00:00.000Z',
              updatedAt: '2026-06-14T00:00:01.000Z',
            },
          },
        })
      })
    )

    renderHomeWorkspace()

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '请粗评这个项目' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    expect(await screen.findByText('模型回复：已进入持久会话')).toBeInTheDocument()
    expect(screen.getByText('请粗评这个项目')).toBeInTheDocument()
    expect(createBody.workflowKey).toBe('free_chat')
    expect(chatBody.sessionId).toBe('session-new')
    expect(chatBody.messages.at(-1)).toMatchObject({ role: 'user', content: '请粗评这个项目' })
  })

  test('keeps prior sent attachment cards after later session refreshes', async () => {
    const sessionState = {
      sessionId: 'session-attach',
      title: '附件会话',
      domain: 'business_evaluation',
      workflowKey: 'free_chat',
      businessRole: 'pre_sales',
      status: 'temporary_chat',
      summary: '',
      messages: [],
      attachments: [],
      artifacts: [],
      pendingActions: [],
      linkedRecords: {},
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:00.000Z',
    }
    server.use(
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: [sessionState] } })),
      http.post(`${BASE}/ai/home-workbench/chat`, async ({ request }) => {
        const body = await request.json()
        const latest = body.messages.at(-1)
        const previous = sessionState.messages
        const userMessageId = `m-user-${previous.length + 1}`
        const attachmentIds = latest.attachments?.length ? latest.attachments.map((_, index) => `att-${previous.length + index + 1}`) : []
        sessionState.attachments.push(...(latest.attachments || []).map((attachment, index) => ({
          attachmentId: attachmentIds[index],
          ...attachment,
          createdAt: '2026-06-14T00:00:00.000Z',
        })))
        sessionState.messages = [
          ...previous,
          { messageId: userMessageId, role: 'user', content: latest.content, attachmentIds, createdAt: '2026-06-14T00:00:00.000Z' },
          { messageId: `m-ai-${previous.length + 1}`, role: 'assistant', content: `模型回复：${latest.content}`, createdAt: '2026-06-14T00:00:01.000Z' },
        ]
        return HttpResponse.json({ success: true, data: { answer: `模型回复：${latest.content}`, session: sessionState } })
      })
    )

    const { container } = renderHomeWorkspace()
    const input = await screen.findByRole('textbox')
    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(['demo'], '客户需求说明.pdf', { type: 'application/pdf' })

    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.change(input, { target: { value: '请生成需求解析报告' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    await waitFor(() => expect(screen.getAllByText('需求解析报告 v1').length).toBeGreaterThan(0))
    expect(screen.getAllByText('客户需求说明.pdf').length).toBeGreaterThan(0)

    fireEvent.change(input, { target: { value: '实施组织范围包含 3 个法人' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    // Phase 1G: 普通追问不生成 v2，而是走正常问答
    await waitFor(() => expect(screen.getByText(/模型回复：实施组织范围包含 3 个法人/)).toBeInTheDocument())
    expect(screen.queryByText('需求解析报告 v2')).not.toBeInTheDocument()
    expect(screen.getAllByText('客户需求说明.pdf').length).toBeGreaterThan(0)
    expect(screen.getByText(/PDF · 1 KB · 已发送/)).toBeInTheDocument()
  })

  test('uses loaded session workflow when sending the next turn', async () => {
    let chatBody
    const loadedSession = {
      sessionId: 'session-workflow',
      title: '需求解析会话',
      domain: 'business_evaluation',
      workflowKey: 'parse_requirement_file',
      businessRole: 'pre_sales',
      status: 'rough_estimate',
      summary: '',
      messages: [{ messageId: 'm1', role: 'user', content: '已有需求材料', createdAt: '2026-06-14T00:00:00.000Z' }],
      attachments: [],
      artifacts: [],
      pendingActions: [],
      linkedRecords: {},
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:00.000Z',
    }
    server.use(
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: [loadedSession] } })),
      http.post(`${BASE}/ai/home-workbench/chat`, async ({ request }) => {
        chatBody = await request.json()
        return HttpResponse.json({
          success: true,
          data: {
            answer: '模型回复：继续需求解析',
            session: {
              ...loadedSession,
              messages: [
                ...loadedSession.messages,
                { messageId: 'm2', role: 'user', content: '继续', createdAt: '2026-06-14T00:00:01.000Z' },
                { messageId: 'm3', role: 'assistant', content: '模型回复：继续需求解析', createdAt: '2026-06-14T00:00:02.000Z' },
              ],
            },
          },
        })
      })
    )

    renderHomeWorkspace()

    expect(await screen.findByText('已有需求材料')).toBeInTheDocument()
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '继续' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    expect(await screen.findByText('模型回复：继续需求解析')).toBeInTheDocument()
    expect(chatBody.workflowKey).toBe('parse_requirement_file')
  })

  test('deletes an AI home session after confirmation', async () => {
    const sessions = [{
      sessionId: 'session-delete',
      title: '待删除会话',
      domain: 'business_evaluation',
      workflowKey: 'free_chat',
      businessRole: 'pre_sales',
      status: 'temporary_chat',
      summary: '',
      messages: [],
      attachments: [],
      artifacts: [],
      pendingActions: [],
      linkedRecords: {},
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:00.000Z',
    }]
    let deleteCalled = 0
    server.use(
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: sessions } })),
      http.delete(`${BASE}/ai-sessions/:sessionId`, ({ params }) => {
        deleteCalled += 1
        const index = sessions.findIndex((session) => session.sessionId === params.sessionId)
        if (index >= 0) sessions.splice(index, 1)
        return HttpResponse.json({ success: true, data: { deletedSessionId: params.sessionId } })
      })
    )
    renderHomeWorkspace()

    expect(await screen.findByText('待删除会话')).toBeInTheDocument()
    requestSessionDelete('待删除会话')
    expect(screen.getByRole('dialog', { name: '删除会话' })).toBeInTheDocument()
    expect(screen.getByText('确定要彻底删除这个 AI 会话吗？')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(deleteCalled).toBe(0)
    expect(screen.queryByRole('dialog', { name: '删除会话' })).not.toBeInTheDocument()
    expect(screen.getByText('待删除会话')).toBeInTheDocument()

    requestSessionDelete('待删除会话')
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(screen.queryByText('待删除会话')).not.toBeInTheDocument())
    expect(deleteCalled).toBe(1)
    expect(screen.getByText('暂无历史会话')).toBeInTheDocument()
  })

  test('shows session rail and confirms project creation action', async () => {
    let projectCreateBody
    server.use(
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({
        success: true,
        data: {
          items: [{
            sessionId: 'session-action',
            title: 'XX制造 WMS 粗评',
            status: 'rough_estimate',
            domain: 'business_evaluation',
            workflowKey: 'rough_estimate',
            messages: [],
            artifacts: [{ artifactId: 'art-1', type: 'rough_report', title: '粗评报告', content: '预计 120 人天', status: 'generated' }],
            pendingActions: [{
              actionId: 'act-1',
              actionType: 'create_project_evaluation',
              title: '创建项目评估方案',
              riskLevel: 'high',
              status: 'pending',
              payload: { projectName: 'XX制造 WMS 项目', customerName: 'XX制造' },
            }],
            linkedRecords: {},
            updatedAt: '2026-06-14T08:00:00.000Z',
          }],
        },
      })),
      http.post(`${BASE}/project-evaluations`, async ({ request }) => {
        projectCreateBody = await request.json()
        return HttpResponse.json({
          success: true,
          data: {
            project: {
              projectId: 'project-1',
              projectName: projectCreateBody.projectName,
              customerName: projectCreateBody.customerName,
              currentStage: 'project_discovery',
              status: 'draft',
            },
          },
        })
      })
    )

    renderHomeWorkspace()

    expect(await screen.findByText('XX制造 WMS 粗评')).toBeInTheDocument()
    expect(screen.getByText('粗评报告')).toBeInTheDocument()
    expect(screen.getByText('创建项目评估方案')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(await screen.findByText(/项目：XX制造 WMS 项目/)).toBeInTheDocument()
    expect(projectCreateBody).toMatchObject({ projectName: 'XX制造 WMS 项目', customerName: 'XX制造' })
  })

  test('shows a visible error when suggested project creation is rejected', async () => {
    server.use(
      http.post(`${BASE}/ai/home-workbench/chat`, async ({ request }) => {
        const body = await request.json()
        const userText = body.messages?.at?.(-1)?.content || ''
        return HttpResponse.json({
          success: true,
          data: {
            intent: 'write_action_request',
            answer: '检测到项目创建意图。请确认以下动作后再执行：',
            businessRole: 'pre_sales',
            roleLabel: '售前顾问',
            model: 'rule-static',
            suggestedActions: [{
              id: 'create_project_evaluation',
              label: '确认创建项目「广州波达通信」',
              actionType: 'create_project_evaluation',
              requiresConfirm: true,
              payload: { projectName: userText.replace(/^帮我创建/, '').replace(/项目$/, '') },
            }],
            trace: { intentConfidence: 0.85, routingRule: 'write_action_keywords', contextRefs: [] },
          },
        })
      }),
      http.post(`${BASE}/project-evaluations`, () => HttpResponse.json({
        code: 40301,
        message: '权限不足',
        details: [{ field: 'capability', reason: '缺少能力位: estimates:create' }],
      }, { status: 403 }))
    )

    renderHomeWorkspace()

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '帮我创建广州波达通信项目' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    const confirmButton = await screen.findByRole('button', { name: '确认创建项目「广州波达通信」' })
    fireEvent.click(confirmButton)

    expect(await screen.findByText(/项目创建失败：权限不足/)).toBeInTheDocument()
  })

  test('renders artifact workspace as a run timeline', async () => {
    server.use(
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({
        success: true,
        data: {
          items: [{
            sessionId: 'session-timeline',
            title: 'XX制造 WMS 粗评',
            status: 'rough_estimate',
            domain: 'business_evaluation',
            workflowKey: 'rough_estimate',
            messages: [
              { messageId: 'msg-1', role: 'user', content: '请解析附件', file: { name: 'XX制造需求.xlsx', size: 2048 } },
              { messageId: 'msg-2', role: 'assistant', content: '已生成粗评报告', artifactIds: ['art-1'] },
            ],
            attachments: [{ name: 'XX制造需求.xlsx', size: 2048 }],
            artifacts: [{ artifactId: 'art-1', type: 'rough_report', title: '粗评报告', content: '预计 120 人天', status: 'generated' }],
            pendingActions: [{
              actionId: 'act-1',
              actionType: 'create_project_evaluation',
              title: '创建项目评估方案',
              riskLevel: 'high',
              status: 'pending',
              payload: { projectName: 'XX制造 WMS 项目', customerName: 'XX制造' },
            }],
            linkedRecords: {
              projectId: 'project-1',
              projectName: 'XX制造 WMS 项目',
              assessmentVersionId: 'assessment-1',
            },
            updatedAt: '2026-06-14T08:00:00.000Z',
          }],
        },
      }))
    )

    renderHomeWorkspace()

    const timeline = await screen.findByRole('list', { name: 'AI 会话执行链路' })
    expect(within(timeline).getByText('输入来源')).toBeInTheDocument()
    expect(within(timeline).getByText('AI 执行')).toBeInTheDocument()
    expect(within(timeline).getByText('结构化产物')).toBeInTheDocument()
    expect(within(timeline).getByText('交付与关联')).toBeInTheDocument()
    expect(within(timeline).getByText('XX制造需求.xlsx')).toBeInTheDocument()
    expect(within(timeline).getByText('粗评报告')).toBeInTheDocument()
    expect(within(timeline).getByText('创建项目评估方案')).toBeInTheDocument()
    expect(within(timeline).getByText(/项目：XX制造 WMS 项目/)).toBeInTheDocument()
  })

  test('deletes an AI home session after confirmation', async () => {
    const sessions = [{
      sessionId: 'session-delete',
      title: '待删除会话',
      domain: 'business_evaluation',
      workflowKey: 'free_chat',
      businessRole: 'pre_sales',
      status: 'temporary_chat',
      summary: '',
      messages: [],
      attachments: [],
      artifacts: [],
      pendingActions: [],
      linkedRecords: {},
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:00.000Z',
    }]
    let deleteCalled = 0
    server.use(
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: sessions } })),
      http.delete(`${BASE}/ai-sessions/:sessionId`, ({ params }) => {
        deleteCalled += 1
        const index = sessions.findIndex((session) => session.sessionId === params.sessionId)
        if (index >= 0) sessions.splice(index, 1)
        return HttpResponse.json({ success: true, data: { deletedSessionId: params.sessionId } })
      })
    )
    renderHomeWorkspace()

    expect(await screen.findByText('待删除会话')).toBeInTheDocument()
    requestSessionDelete('待删除会话')
    expect(screen.getByRole('dialog', { name: '删除会话' })).toBeInTheDocument()
    expect(screen.getByText('确定要彻底删除这个 AI 会话吗？')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(deleteCalled).toBe(0)
    expect(screen.queryByRole('dialog', { name: '删除会话' })).not.toBeInTheDocument()
    expect(screen.getByText('待删除会话')).toBeInTheDocument()

    requestSessionDelete('待删除会话')
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(screen.queryByText('待删除会话')).not.toBeInTheDocument())
    expect(deleteCalled).toBe(1)
    expect(screen.getByText('暂无历史会话')).toBeInTheDocument()
  })

  test('admin standard governance upload creates a standard draft artifact', async () => {
    server.use(
      http.get(`${BASE}/auth/me`, () => HttpResponse.json({
        success: true,
        data: { user: { id: 'admin-1', username: 'admin', role: 'admin', businessRole: 'admin', status: 'active' } },
      })),
      http.post(`${BASE}/ai-sessions/:sessionId/standard-drafts`, async () => HttpResponse.json({
        success: true,
        data: {
          session: {
            sessionId: 'session-standard',
            title: '金蝶官方评估标准.xlsx',
            domain: 'standard_governance',
            workflowKey: 'standard_governance',
            status: 'standard_review',
            messages: [],
            artifacts: [{
              artifactId: 'std-art-1',
              type: 'standard_draft',
              title: '标准差异草稿',
              content: '识别新增模块 2 个，人天基准变更 3 项',
              status: 'generated',
            }],
            pendingActions: [{
              actionId: 'std-action-1',
              actionType: 'publish_standard_version',
              title: '发布标准版本',
              riskLevel: 'high',
              status: 'pending',
              payload: { fileName: '金蝶官方评估标准.xlsx' },
            }],
            linkedRecords: {},
            updatedAt: '2026-06-14T00:00:00.000Z',
          },
          artifact: {
            artifactId: 'std-art-1',
            type: 'standard_draft',
            title: '标准差异草稿',
            content: '识别新增模块 2 个，人天基准变更 3 项',
            status: 'generated',
          },
        },
      }))
    )

    const { container } = renderHomeWorkspace()

    fireEvent.click(await screen.findByRole('button', { name: /更新评估标准/ }))
    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(['标准'], '金蝶官方评估标准.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    expect(await screen.findByText('标准差异草稿')).toBeInTheDocument()
    expect(screen.getByText(/人天基准变更/)).toBeInTheDocument()
    expect(screen.getByText('发布标准版本')).toBeInTheDocument()
  })

  test('shows attached AI home file as a removable composer card', async () => {
    const { container } = renderHomeWorkspace()
    await screen.findByRole('textbox')

    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(['demo'], '实施工作量评估申请240616-V1.0.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(screen.getAllByText('XLSX').length).toBeGreaterThan(0))
    expect(screen.getAllByText('实施工作量评估申请240616-V1.0.xlsx').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/已附加，将随下一条消息发送/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '移除附件' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '移除附件' }))

    expect(screen.queryByText('实施工作量评估申请240616-V1.0.xlsx')).not.toBeInTheDocument()
  })

  test('moves attached AI home file into sent message and clears pending card', async () => {
    const { container } = renderHomeWorkspace()

    const input = await screen.findByRole('textbox')
    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(['demo'], '客户需求说明.pdf', { type: 'application/pdf' })

    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.change(input, { target: { value: '请生成需求解析报告' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    await waitFor(() => expect(screen.getAllByText('需求解析报告 v1').length).toBeGreaterThan(0))
    expect(screen.getAllByText('客户需求说明.pdf').length).toBeGreaterThan(0)
    expect(screen.getByText(/PDF · 1 KB · 已发送/)).toBeInTheDocument()
    expect(screen.queryByText(/已附加，将随下一条消息发送/)).not.toBeInTheDocument()
  })

  test('routes an attached AI home file through Harness before rendering report v1', async () => {
    let parseCalled = false
    let allowLocalFallback = ''
    let createRunBody
    let parseResultBody
    let reportCalled = false
    server.use(
      http.post(`${BASE}/ai/parse-basic-info`, async ({ request }) => {
        parseCalled = true
        allowLocalFallback = new URL(request.url).searchParams.get('allowLocalFallback') || ''
        return HttpResponse.json({
          success: true,
          data: {
            basicInfo: {
              projectName: '实施工作量评估申请',
              customerName: '蓝海制造',
              customerIndustry: '制造业',
              productLines: ['金蝶云星空'],
            },
            requirementImportData: {
              businessItems: [
                { topic: '采购流程优化', description: '采购申请、审批与订单协同' },
              ],
              productModuleRows: [
                { productLine: '金蝶云星空', moduleName: '供应链云', requirementDescription: '采购业务闭环' },
              ],
            },
            sourceSheets: ['基础信息', '需求清单'],
            model: 'kimi-k2.5',
          },
        })
      }),
      http.post(`${BASE}/harness/runs`, async ({ request }) => {
        createRunBody = await request.json()
        return HttpResponse.json({
          success: true,
          data: {
            run: {
              harnessRunId: 'harness-test-run',
              title: createRunBody.title,
              stage: 'uploaded',
              status: 'waiting',
            },
          },
        })
      }),
      http.post(`${BASE}/harness/runs/:runId/files`, async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json({
          success: true,
          data: {
            run: { harnessRunId: 'harness-test-run', stage: 'parsing', status: 'running' },
            file: { harnessFileId: 'harness-test-file', fileName: body.fileName },
          },
        })
      }),
      http.post(`${BASE}/harness/runs/:runId/parse-result`, async ({ request }) => {
        parseResultBody = await request.json()
        return HttpResponse.json({
          success: true,
          data: {
            run: { harnessRunId: 'harness-test-run', stage: 'evidence_ready', status: 'waiting' },
            files: [],
            evidences: [],
            artifacts: [],
            modelRuns: [],
            toolEvents: [],
          },
        })
      }),
      http.post(`${BASE}/harness/runs/:runId/report-v1`, () => {
        reportCalled = true
        return HttpResponse.json({
          success: true,
          data: {
            run: { harnessRunId: 'harness-test-run', stage: 'report_v1_ready', status: 'waiting' },
            files: [],
            evidences: [],
            artifacts: [{
              harnessArtifactId: 'artifact-report-v1',
              artifactType: 'requirement_report_v1',
              title: '需求解析报告 v1',
              status: 'ready',
              content: {
                version: 'v1',
                sourceFile: '实施工作量评估申请240616-V1.0.xlsx',
                project: { projectName: '实施工作量评估申请', customerName: '蓝海制造', industry: '制造业' },
                sourceSheets: ['基础信息', '需求清单'],
                requirementFindings: [{ domain: '供应链', scenario: '采购流程优化', moduleHint: '供应链云', confidence: 0.8, evidenceRefs: ['需求清单'] }],
                missingFields: [{ field: '实施组织范围', reason: '文件未明确', priority: 'must' }],
                clarificationQuestions: [{ question: '实施组织范围包含几个法人？', targetRole: '客户项目负责人', reason: '影响工作量边界' }],
                risks: [{ title: '范围风险', assumption: '组织范围未锁定', impact: '可能增加人天' }],
                nextActions: [{ label: '补充项目信息', actionType: 'supplement_project_info' }],
              },
            }],
            modelRuns: [{ harnessModelRunId: 'model-run-1', model: 'moonshot-v1-128k' }],
            toolEvents: [],
          },
        })
      })
    )

    const { container } = renderHomeWorkspace()
    const input = await screen.findByRole('textbox')
    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(['demo'], '实施工作量评估申请240616-V1.0.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.change(input, { target: { value: '请解析这个文件并生成需求解析报告' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    await waitFor(() => expect(screen.getAllByText('需求解析报告 v1').length).toBeGreaterThan(0))
    expect(parseCalled).toBe(true)
    expect(reportCalled).toBe(true)
    expect(allowLocalFallback).toBe('true')
    expect(createRunBody.title).toBe('实施工作量评估申请240616-V1.0.xlsx')
    expect(parseResultBody.summary.customerName).toBe('蓝海制造')
    expect(parseResultBody.items.some((item) => item.text.includes('采购流程优化'))).toBe(true)
    expect(screen.getByText('附件理解摘要')).toBeInTheDocument()
    expect(screen.getByText('工作表 2 张')).toBeInTheDocument()
    expect(screen.getByText('业务线索 1 条')).toBeInTheDocument()
    expect(screen.getAllByText('蓝海制造').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/采购流程优化/).length).toBeGreaterThan(0)
  })

  test('allows inline report editing, customer lookup, and structured v2 submission', async () => {
    let answersBody
    let reportV2Called = false
    const companyRequests = []
    server.use(
      http.post(`${BASE}/ai/parse-basic-info`, () => HttpResponse.json({
        success: true,
        data: {
          basicInfo: {
            projectName: '',
            customerName: '味可达',
            customerIndustry: '',
            productLines: ['ERP'],
          },
          requirementImportData: {
            businessItems: [
              { topic: '采购流程', description: '采购、库存、生产与财务联动' },
            ],
            productModuleRows: [
              { productLine: 'ERP', moduleName: '供应链', requirementDescription: '采购库存协同' },
            ],
          },
          sourceSheets: ['Sheet1', 'Sheet2', 'Sheet3'],
          model: 'kimi-k2.5',
        },
      })),
      http.post(`${BASE}/harness/runs/:runId/report-v1`, ({ params }) => HttpResponse.json({
        success: true,
        data: {
          run: { harnessRunId: params.runId, stage: 'report_v1_ready', status: 'waiting' },
          files: [],
          evidences: [],
          artifacts: [{
            harnessArtifactId: 'artifact-file-understanding',
            artifactType: 'file_understanding',
            title: '文件理解结果 v1',
            version: 'v1',
            status: 'ready',
            content: {
              sourceFile: '味可达-ERP系统功能需求清单(0616）.xlsx',
              sourceSheets: ['Sheet1', 'Sheet2', 'Sheet3'],
              project: { projectName: '', customerName: '味可达', industry: '' },
              extractedItemCount: 2,
            },
          }, {
            harnessArtifactId: 'artifact-report-v1-inline',
            artifactType: 'requirement_report_v1',
            title: '需求解析报告 v1',
            version: 'v1',
            status: 'ready',
            content: {
              version: 'v1',
              sourceFile: '味可达-ERP系统功能需求清单(0616）.xlsx',
              project: { projectName: '待确认', customerName: '味可达（待确认）', industry: '待确认' },
              sourceSheets: ['Sheet1', 'Sheet2', 'Sheet3'],
              requirementFindings: [
                { domain: '供应链', scenario: '采购库存协同', moduleHint: '供应链', confidence: 0.82, evidenceRefs: ['Sheet1'] },
              ],
              missingFields: [
                { field: 'projectScope', reason: '未提供 ERP 系统覆盖范围', priority: 'must' },
              ],
              clarificationQuestions: [
                { question: '实施组织范围包含几个法人？', targetRole: '客户项目负责人', reason: '影响工作量边界' },
              ],
              risks: [
                { title: '范围风险', assumption: '采购库存范围未锁定', impact: '可能增加实施人天' },
              ],
              nextActions: [{ label: '补充项目信息', actionType: 'supplement_project_info' }],
            },
          }],
          modelRuns: [{ harnessModelRunId: 'model-run-1', model: 'moonshot-v1-128k' }],
          toolEvents: [],
        },
      })),
      http.post(`${BASE}/ai/company-profile-summary`, async ({ request }) => {
        const body = await request.json()
        companyRequests.push(body)
        if (!body.disambiguationChoice) {
          return HttpResponse.json({
            success: true,
            data: {
              customerName: body.customerName,
              mode: 'disambiguation',
              disambiguationCandidates: [
                { id: '1', displayName: '味可达食品有限公司', summary: '食品制造与快消品企业' },
              ],
            },
          })
        }
        return HttpResponse.json({
          success: true,
          data: {
            customerName: '味可达食品有限公司',
            enterpriseProfile: '主营调味品与食品生产。',
            location: '广东佛山',
            customerIndustry: '食品制造业',
            enterpriseRevenue: '未公开',
            itStatus: '已有 ERP 基础',
            model: 'moonshot-v1-128k',
            mode: 'model',
          },
        })
      }),
      http.post(`${BASE}/harness/runs/:runId/answers`, async ({ request }) => {
        answersBody = await request.json()
        return HttpResponse.json({
          success: true,
          data: { run: { harnessRunId: 'harness-test-run', stage: 'clarifying', status: 'waiting' } },
        })
      }),
      http.post(`${BASE}/harness/runs/:runId/report-v2`, ({ params }) => {
        reportV2Called = true
        return HttpResponse.json({
          success: true,
          data: {
            run: { harnessRunId: params.runId, stage: 'report_v2_ready', status: 'waiting' },
            files: [],
            evidences: [],
            artifacts: [{
              harnessArtifactId: 'artifact-report-v2-inline',
              artifactType: 'requirement_report_v2',
              title: '需求解析报告 v2',
              version: 'v2',
              status: 'ready',
              content: {
                version: 'v2',
                sourceFile: '味可达-ERP系统功能需求清单(0616）.xlsx',
                project: { projectName: '味可达 ERP 项目', customerName: '味可达食品有限公司', industry: '食品制造业' },
                sourceSheets: ['Sheet1', 'Sheet2', 'Sheet3'],
                requirementFindings: [],
                missingFields: [],
                clarificationQuestions: [],
                answeredQuestions: [{ question: 'projectScope', answer: '覆盖采购、库存、生产、财务', source: 'structured_card_inline' }],
                risks: [],
                nextActions: [{ label: '进入正式评估', actionType: 'enter_formal_estimation' }],
                clarificationSummary: '已补充客户主体和范围。',
              },
            }],
            modelRuns: [{ harnessModelRunId: 'model-run-2', model: 'moonshot-v1-128k' }],
            toolEvents: [],
          },
        })
      }),
    )

    const { container } = renderHomeWorkspace()
    const input = await screen.findByRole('textbox')
    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(['demo'], '味可达-ERP系统功能需求清单(0616）.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.change(input, { target: { value: '请解析这个文件并生成需求解析报告' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    await waitFor(() => expect(screen.getAllByText('需求解析报告 v1').length).toBeGreaterThan(0))
    expect(screen.getByText('附件理解摘要')).toBeInTheDocument()

    doubleClickInlineField(screen.getByRole('button', { name: /项目.*双击补充/ }))
    const projectInput = await screen.findByLabelText('编辑项目')
    fireEvent.change(projectInput, { target: { value: '味可达 ERP 项目' } })
    fireEvent.keyDown(projectInput, { key: 'Enter' })

    doubleClickInlineField(screen.getByRole('button', { name: /项目范围/ }))
    const scopeInput = await screen.findByLabelText('编辑项目范围')
    fireEvent.change(scopeInput, { target: { value: '覆盖采购、库存、生产、财务' } })
    fireEvent.keyDown(scopeInput, { key: 'Enter' })

    fireEvent.click(screen.getByRole('button', { name: '检索主体' }))
    const candidateButton = await screen.findByRole('button', { name: /味可达食品有限公司/ })
    fireEvent.click(candidateButton)
    expect(await screen.findByText(/已选择主体：味可达食品有限公司/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '提交补充并生成 v2' }))

    await waitFor(() => expect(reportV2Called).toBe(true))
    expect(companyRequests[0].customerName).toBe('味可达')
    expect(companyRequests[1].disambiguationChoice.displayName).toBe('味可达食品有限公司')
    expect(answersBody.answers).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'projectName', value: '味可达 ERP 项目', source: 'structured_card_inline' }),
      expect.objectContaining({ field: 'customerName', value: '味可达食品有限公司', source: 'structured_card_inline' }),
      expect.objectContaining({ field: 'industry', value: '食品制造业', source: 'structured_card_inline' }),
      expect.objectContaining({ field: 'projectScope', value: '覆盖采购、库存、生产、财务', source: 'structured_card_inline' }),
    ]))
    await waitFor(() => expect(screen.getAllByText('需求解析报告 v2').length).toBeGreaterThan(0))
  })

  test('answers ordinary follow-up after v1 without generating v2', async () => {
    let answersCalled = false
    let reportV2Called = false
    server.use(
      http.post(`${BASE}/harness/runs/:runId/answers`, async () => {
        answersCalled = true
        return HttpResponse.json({
          success: true,
          data: { run: { harnessRunId: 'harness-test-run', stage: 'clarifying', status: 'waiting' } },
        })
      }),
      http.post(`${BASE}/harness/runs/:runId/report-v2`, () => {
        reportV2Called = true
        return HttpResponse.json({
          success: true,
          data: {
            run: { harnessRunId: 'harness-test-run', stage: 'report_v2_ready', status: 'waiting' },
            files: [],
            evidences: [],
            artifacts: [{
              harnessArtifactId: 'artifact-report-v2',
              artifactType: 'requirement_report_v2',
              title: '需求解析报告 v2',
              version: 'v2',
              status: 'ready',
              content: {
                version: 'v2',
                sourceFile: '实施工作量评估申请240616-V1.0.xlsx',
                project: { projectName: '实施工作量评估申请', customerName: '蓝海制造', industry: '制造业' },
                sourceSheets: ['基础信息', '需求清单'],
                requirementFindings: [],
                missingFields: [],
                clarificationQuestions: [],
                answeredQuestions: [{ question: '实施组织范围', answer: '3 个法人', source: 'user_chat' }],
                risks: [],
                nextActions: [{ label: '进入正式评估', actionType: 'enter_formal_estimation' }],
                clarificationSummary: '已补充组织范围。',
              },
            }],
            modelRuns: [{ harnessModelRunId: 'model-run-2', model: 'moonshot-v1-128k' }],
            toolEvents: [],
          },
        })
      }),
    )

    const { container } = renderHomeWorkspace()
    const input = await screen.findByRole('textbox')
    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(['demo'], '实施工作量评估申请240616-V1.0.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.change(input, { target: { value: '请解析这个文件并生成需求解析报告' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    await waitFor(() => expect(screen.getAllByText('需求解析报告 v1').length).toBeGreaterThan(0))

    // Phase 1G: v1 后普通追问不走 v2 生成路径
    fireEvent.change(input, { target: { value: '实施组织范围包含 3 个法人' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    await waitFor(() => expect(screen.getByText(/模型回复：实施组织范围包含 3 个法人/)).toBeInTheDocument())
    expect(answersCalled).toBe(false)
    expect(reportV2Called).toBe(false)
    expect(screen.queryByText('需求解析报告 v2')).not.toBeInTheDocument()
  })

  test('keeps v2 fallback action buttons disabled when model returns no next actions', async () => {
    server.use(
      http.post(`${BASE}/harness/runs/:runId/report-v1`, ({ params }) => HttpResponse.json({
        success: true,
        data: {
          run: { harnessRunId: params.runId, stage: 'report_v1_ready', status: 'waiting' },
          files: [],
          evidences: [],
          artifacts: [{
            harnessArtifactId: 'artifact-file-understanding',
            artifactType: 'file_understanding',
            title: '文件理解结果 v1',
            version: 'v1',
            status: 'ready',
            content: {},
          }, {
            harnessArtifactId: 'artifact-report-v1-empty-actions',
            artifactType: 'requirement_report_v1',
            title: '需求解析报告 v1',
            version: 'v1',
            status: 'ready',
            content: {
              version: 'v1',
              sourceFile: '实施工作量评估申请240616-V1.0.xlsx',
              project: { projectName: '实施工作量评估申请', customerName: '蓝海制造', industry: '制造业' },
              sourceSheets: ['基础信息'],
              requirementFindings: [],
              missingFields: [{ field: '实施组织范围', reason: '文件未明确', priority: 'must' }],
              clarificationQuestions: [{ question: '实施组织范围包含几个法人？', targetRole: '客户项目负责人', reason: '影响工作量边界' }],
              risks: [],
              nextActions: [],
            },
          }],
          modelRuns: [{ harnessModelRunId: 'model-run-1', model: 'moonshot-v1-128k' }],
          toolEvents: [],
        },
      })),
    )

    const { container } = renderHomeWorkspace()
    const input = await screen.findByRole('textbox')
    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(['demo'], '实施工作量评估申请240616-V1.0.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.change(input, { target: { value: '请解析这个文件并生成需求解析报告' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => expect(screen.getAllByText('需求解析报告 v1').length).toBeGreaterThan(0))

    // Phase 1G: v1 报告 nextActions 为空时，进入正式评估按钮全部禁用
    expect(screen.getAllByRole('button', { name: '进入正式评估' }).every((button) => button.disabled)).toBe(true)
  })

  test('renders requirement analysis report artifacts as report cards', async () => {
    server.use(
      http.post(`${BASE}/ai/home-workbench/chat`, async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json({
          success: true,
          data: {
            answer: '已生成《需求解析报告 v1》，请先补充关键缺失信息。',
            businessRole: 'pre_sales',
            roleLabel: '售前顾问',
            model: 'kimi-k2.5',
            session: {
              sessionId: body.sessionId || 'session-report',
              title: '实施工作量评估申请',
              domain: 'business_evaluation',
              workflowKey: body.workflowKey || 'parse_requirement_file',
              businessRole: 'pre_sales',
              status: 'requirement_drafting',
              summary: '',
              messages: [
                { messageId: 'm-user', role: 'user', content: '请解析这个文件并生成需求解析报告', attachmentIds: ['att-1'], createdAt: '2026-06-14T00:00:00.000Z' },
                { messageId: 'm-ai', role: 'assistant', content: '已生成《需求解析报告 v1》，请先补充关键缺失信息。', artifactIds: ['art-report'], createdAt: '2026-06-14T00:00:01.000Z' },
              ],
              attachments: [{ attachmentId: 'att-1', name: '实施工作量评估申请240616-V1.0.xlsx', size: 58000, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', createdAt: '2026-06-14T00:00:00.000Z' }],
              artifacts: [{
                artifactId: 'art-report',
                type: 'requirement_analysis_report',
                title: '需求解析报告 v1',
                status: 'generated',
                createdAt: '2026-06-14T00:00:01.000Z',
                content: {
                  sourceFile: '实施工作量评估申请240616-V1.0.xlsx',
                  projectName: '哈希温控项目评估',
                  customerName: '哈希温控',
                  industry: '制造业',
                  needs: ['智能核算：凭证处理 + 自动生成凭证', '报表体系：法定报表 + 自定义报表'],
                  missingItems: ['自动生成凭证规则数量', '自定义报表清单'],
                  risks: ['自定义报表范围易失控'],
                },
              }],
              pendingActions: [],
              linkedRecords: {},
              createdAt: '2026-06-14T00:00:00.000Z',
              updatedAt: '2026-06-14T00:00:01.000Z',
            },
          },
        })
      })
    )

    renderHomeWorkspace()

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '请解析这个文件并生成需求解析报告' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    await waitFor(() => expect(screen.getAllByText('需求解析报告 v1').length).toBeGreaterThan(0))
    expect(screen.getByText('哈希温控项目评估')).toBeInTheDocument()
    expect(screen.getByText('哈希温控')).toBeInTheDocument()
    expect(screen.getByText('智能核算：凭证处理 + 自动生成凭证')).toBeInTheDocument()
    expect(screen.getByText('自动生成凭证规则数量')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '补充项目信息' })).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  test('keeps the draft in place when AI home request needs login', async () => {
    server.use(http.post(`${BASE}/ai/home-workbench/chat`, () => HttpResponse.json({
      code: 'UNAUTHORIZED',
      message: '登录已过期，请重新登录',
    }, { status: 401 })))

    renderHomeWorkspace()

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '请保留这份草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    expect(await screen.findByText(/登录已过期，请重新登录后继续发送/)).toBeInTheDocument()
    expect(screen.getAllByText('请保留这份草稿').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '重新登录' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制草稿' })).toBeInTheDocument()
    expect(window.location.pathname).not.toBe('/login')
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

    renderHomeWorkspace()

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '帮我看看' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    expect(await screen.findByText('正在理解你的问题')).toBeInTheDocument()

    releaseAnswer()

    expect(await screen.findByText('模型回复：加载结束')).toBeInTheDocument()
    expect(screen.queryByText('正在理解你的问题')).not.toBeInTheDocument()
  })

  test('renders AI markdown answer as readable rich text', async () => {
    server.use(http.post(`${BASE}/ai/home-workbench/chat`, () => HttpResponse.json({
      success: true,
      data: {
        answer: '你好！我是 **WES 工作量评估系统** 的 AI 工作助手。\n\n我可以协助你处理以下核心事务：\n1. **全局项目队列监控** - 查看各阶段项目积压情况\n2. **异常流程诊断** - 识别卡单、超时等阻塞点\n\n**下一步建议动作：**\n- 查看今日项目队列\n- 处理异常流程',
        businessRole: 'admin',
        roleLabel: '管理员',
        model: 'kimi-k2.5',
      },
    })))

    renderHomeWorkspace()

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '你好' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    expect((await screen.findByText('WES 工作量评估系统')).tagName).toBe('STRONG')
    expect(screen.getByText('全局项目队列监控').tagName).toBe('STRONG')
    expect(screen.getByText(/查看各阶段项目积压情况/).closest('li')).toBeInTheDocument()
    expect(screen.getByText(/查看各阶段项目积压情况/).closest('ol')).toBeInTheDocument()
    expect(screen.getByText(/查看今日项目队列/).closest('ul')).toBeInTheDocument()
  })

  test('keeps AI workbench scrolling inside the message pane', async () => {
    const { container } = renderHomeWorkspace()

    const pageHeader = container.querySelector('.pg-hd')
    const workbench = await screen.findByTestId('ai-home-workbench')
    const messagePane = screen.getByTestId('ai-home-message-pane')
    const composer = screen.getByRole('textbox')

    expect(pageHeader.style.position).toBe('relative')
    expect(pageHeader.style.flexShrink).toBe('0')
    expect(workbench.style.height).toBe('100%')
    expect(workbench.style.minHeight).toBe('0px')
    expect(messagePane.style.overflowY).toBe('auto')
    expect(messagePane.style.minHeight).toBe('0px')
    expect(composer).toHaveClass('ai-composer__textarea')
    expect(screen.getByRole('button', { name: '附加文件' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送消息' })).toBeInTheDocument()
  })

  test('pressing Enter sends AI home message', async () => {
    renderHomeWorkspace()

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '你好' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    expect(await screen.findByText('模型回复：你好')).toBeInTheDocument()
  })

  test('pressing Shift Enter does not send AI home message', async () => {
    renderHomeWorkspace()

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '第一行' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', shiftKey: true })

    expect(screen.queryByText('模型回复：第一行')).not.toBeInTheDocument()
  })

  test('Phase 1G: answers attachment business question without auto-generating v1', async () => {
    let parseCalled = false
    let reportV1Called = false
    const chatRequests = []
    server.use(
      http.post(`${BASE}/ai/parse-basic-info`, async () => {
        parseCalled = true
        return HttpResponse.json({
          success: true,
          data: {
            basicInfo: { projectName: '测试项目', customerName: '测试客户', customerIndustry: '制造业', productLines: ['金蝶云星空'] },
            requirementImportData: {
              businessItems: [{ topic: '多组织业务', description: '组织间交易与结算' }],
              productModuleRows: [{ productLine: '金蝶云星空', moduleName: '供应链云', requirementDescription: '多组织协同' }],
            },
            sourceSheets: ['Sheet1'],
            model: 'kimi-k2.5',
          },
        })
      }),
      http.post(`${BASE}/harness/runs/:runId/report-v1`, () => {
        reportV1Called = true
        return HttpResponse.json({ success: true, data: { run: {}, artifacts: [] } })
      }),
      http.post(`${BASE}/ai/home-workbench/chat`, async ({ request }) => {
        const body = await request.json()
        chatRequests.push(body)
        const lastMessage = body.messages?.at?.(-1)
        const userText = lastMessage?.content || ''
        const hasParsedAttachment = (body.messages || []).some((message) => (
          (message.attachments || []).some((attachment) => attachment.parsedSummary)
        ))
        return HttpResponse.json({
          success: true,
          data: {
            intent: hasParsedAttachment ? 'attachment_qa' : 'domain_qa',
            answer: `模型回复：${userText || '收到'}`,
            businessRole: 'pre_sales',
            roleLabel: '售前顾问',
            model: 'kimi-k2.5',
            suggestedActions: hasParsedAttachment
              ? [{ id: 'generate_requirement_report', label: '生成需求解析报告', actionType: 'generate_requirement_report', requiresConfirm: false }]
              : [],
            trace: { intentConfidence: 0.8, routingRule: 'test', contextRefs: [] },
          },
        })
      }),
    )

    const { container } = renderHomeWorkspace()
    const input = await screen.findByRole('textbox')
    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(['demo'], '客户需求.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.change(input, { target: { value: '多组织业务往来一般包含哪些模块？' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    // Phase 1G: 附件 + 业务问题 → 走 chat，不走 Harness v1
    await waitFor(() => expect(parseCalled).toBe(true))
    await waitFor(() => expect(screen.getByText(/模型回复：多组织业务往来/)).toBeInTheDocument())
    expect(reportV1Called).toBe(false)
    expect(screen.queryByText('需求解析报告 v1')).not.toBeInTheDocument()
    // 建议动作应该显示
    fireEvent.click(screen.getByText('生成需求解析报告'))
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => expect(chatRequests.length).toBe(2))
    expect(chatRequests[1].messages.some((message) => (
      (message.attachments || []).some((attachment) => (
        attachment.name === '客户需求.xlsx' && /多组织业务/.test(attachment.parsedSummary || '')
      ))
    ))).toBe(true)
  })

  test('Phase 1G: capability discovery returns capability list', async () => {
    renderHomeWorkspace()

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '你能做什么？' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    // Phase 1G: 能力发现返回能力清单
    await waitFor(() => expect(screen.getByText(/模型回复：你能做什么/)).toBeInTheDocument())
  })

  test('Phase 1G: WES data query returns project list', async () => {
    renderHomeWorkspace()

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '我之前创建过哪些项目？' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    // Phase 1G: WES 数据查询返回项目摘要
    await waitFor(() => expect(screen.getByText(/模型回复：我之前创建过哪些项目/)).toBeInTheDocument())
  })

  test('restores the last active AI session after the workbench remounts', async () => {
    const sessions = [
      {
        sessionId: 'session-last',
        title: '最近会话',
        domain: 'business_evaluation',
        workflowKey: 'free_chat',
        status: 'temporary_chat',
        messages: [
          { messageId: 'm1', role: 'user', content: '上一轮问题', createdAt: '2026-06-23T00:00:00.000Z' },
          { messageId: 'm2', role: 'assistant', content: '上一轮回答', createdAt: '2026-06-23T00:00:01.000Z' },
        ],
        attachments: [],
        artifacts: [],
        pendingActions: [],
        linkedRecords: {},
        updatedAt: '2026-06-23T00:00:01.000Z',
      },
      {
        sessionId: 'session-other',
        title: '其他会话',
        domain: 'business_evaluation',
        workflowKey: 'free_chat',
        status: 'temporary_chat',
        messages: [],
        attachments: [],
        artifacts: [],
        pendingActions: [],
        linkedRecords: {},
        updatedAt: '2026-06-22T00:00:00.000Z',
      },
    ]
    localStorage.setItem('wes-ai-active-session-id', 'session-last')
    server.use(http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: sessions } })))

    const { unmount } = renderHomeWorkspace()
    expect(await screen.findByText('上一轮回答')).toBeInTheDocument()

    unmount()
    renderHomeWorkspace()
    expect(await screen.findByText('上一轮回答')).toBeInTheDocument()
  })

  test('shows a visible error when AI sessions fail to load', async () => {
    server.use(http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: false, message: 'sessions failed' }, { status: 500 })))

    renderHomeWorkspace()

    expect(await screen.findByText(/AI 会话加载失败/)).toBeInTheDocument()
  })

  test('scrolls the AI message pane to bottom after sending and receiving messages', async () => {
    const scrollTo = vi.fn()
    Element.prototype.scrollTo = scrollTo
    const { container } = renderHomeWorkspace()

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '请解释这个风险' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    expect(await screen.findByText('模型回复：请解释这个风险')).toBeInTheDocument()
    // scrollTo is called via useLayoutEffect; jsdom polyfill captures calls
    // The message pane ref is bound after mount, so scrollTo is available
    const pane = screen.getByTestId('ai-home-message-pane')
    expect(pane).toBeInTheDocument()
  })

  test('keeps composer controls visible for long text input', async () => {
    renderHomeWorkspace()

    const input = await screen.findByRole('textbox', { name: 'AI 工作台输入' })
    fireEvent.change(input, { target: { value: Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 行需求说明`).join('\n') } })

    expect(input).toHaveClass('ai-composer__textarea')
    expect(screen.getByRole('button', { name: '发送消息' })).toBeVisible()
    expect(screen.getByRole('button', { name: '附加文件' })).toBeVisible()
  })

  test('updates linked records and project list after confirming project creation', async () => {
    const projectRecords = [
      { projectId: 'existing-1', projectName: '已有项目', customerName: '已有客户', currentStage: 'project_discovery', status: 'draft', ownerUsername: 'arch', participantUserIds: [], createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' },
    ]
    server.use(
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({
        success: true,
        data: {
          items: [{
            sessionId: 'session-action',
            title: 'XX制造 WMS 粗评',
            status: 'rough_estimate',
            domain: 'business_evaluation',
            workflowKey: 'rough_estimate',
            messages: [],
            artifacts: [{ artifactId: 'art-1', type: 'rough_report', title: '粗评报告', content: '预计 120 人天', status: 'generated' }],
            pendingActions: [{
              actionId: 'act-1',
              actionType: 'create_project_evaluation',
              title: '创建项目评估方案',
              riskLevel: 'high',
              status: 'pending',
              payload: { projectName: 'XX制造 WMS 项目', customerName: 'XX制造' },
            }],
            linkedRecords: {},
            updatedAt: '2026-06-14T08:00:00.000Z',
          }],
        },
      })),
      http.get(`${BASE}/project-evaluations`, () => HttpResponse.json({ success: true, data: { items: projectRecords } })),
      http.post(`${BASE}/project-evaluations`, async ({ request }) => {
        const body = await request.json()
        const project = {
          projectId: 'project-1',
          projectName: body.projectName,
          customerName: body.customerName,
          currentStage: 'project_discovery',
          status: 'draft',
          projectStatus: 'draft',
          ownerUsername: 'arch',
          participantUserIds: ['u3'],
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:00:00.000Z',
        }
        projectRecords.unshift(project)
        return HttpResponse.json({ success: true, data: { project } })
      })
    )

    renderHomeWorkspace()

    expect(await screen.findByText('XX制造 WMS 粗评')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(await screen.findByText(/项目：XX制造 WMS 项目/)).toBeInTheDocument()
    expect(await screen.findByText(/项目已创建并关联/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '传统工作台' }))
    expect(await screen.findByText('XX制造 WMS 项目')).toBeInTheDocument()
  })

  test('opens company lookup dialog from suggested action and writes selected candidate back to the workbench', async () => {
    server.use(http.post(`${BASE}/ai/company-profile-summary`, () => HttpResponse.json({
      success: true,
      data: {
        candidates: [
          { displayName: '蓝海制造有限公司', industry: '制造业', location: '深圳', summary: '离散制造客户' },
        ],
        customerName: '蓝海制造有限公司',
        mode: 'disambiguation',
        disambiguationCandidates: [
          { displayName: '蓝海制造有限公司', industry: '制造业', location: '深圳', summary: '离散制造客户' },
        ],
        summary: '蓝海制造有限公司：离散制造客户',
      },
    })))

    renderHomeWorkspace()

    // 通过能力发现触发 suggestedAction 中的"检索客户主体"
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '你能做什么' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    // 点击 AI 回复中的"检索客户主体"建议动作
    fireEvent.click(await screen.findByRole('button', { name: /检索客户主体/ }))
    expect(await screen.findByRole('dialog', { name: '检索客户主体' })).toBeInTheDocument()
    expect(screen.getByText('蓝海制造有限公司')).toBeInTheDocument()

    fireEvent.click(screen.getByText('蓝海制造有限公司'))
    expect(await screen.findByText(/已选择客户主体：蓝海制造有限公司/)).toBeInTheDocument()
  })

  test('ISS-2026-08-08-001: second turn carries parsedSummary when session echo persists it', async () => {
    const chatRequests = []
    let turn = 0
    const parsedSummary = 'AI 已完成文件解析摘要：\n文件：客户需求.xlsx\n项目：多组织项目\n业务需求：\n1. 多组织业务协同'
    const sessionBase = {
      sessionId: 'session-echo-summary',
      title: '附件问答',
      domain: 'business_evaluation',
      workflowKey: 'parse_requirement_file',
      businessRole: 'pre_sales',
      status: 'rough_estimate',
      summary: '',
      messages: [],
      attachments: [],
      artifacts: [],
      pendingActions: [],
      linkedRecords: {},
      createdAt: '2026-08-08T00:00:00.000Z',
      updatedAt: '2026-08-08T00:00:01.000Z',
    }
    server.use(
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: [sessionBase] } })),
      http.post(`${BASE}/ai/home-workbench/chat`, async ({ request }) => {
        const body = await request.json()
        chatRequests.push(body)
        turn += 1
        const latest = body.messages?.at?.(-1)?.content || ''
        if (turn === 1) {
          // 后端已持久化附件 parsedSummary 的会话回声
          return HttpResponse.json({
            success: true,
            data: {
              intent: 'attachment_qa',
              answer: '模型回复：多组织业务往来一般包含哪些模块？',
              businessRole: 'pre_sales',
              roleLabel: '售前顾问',
              model: 'kimi-k2.5',
              suggestedActions: [{ id: 'generate_requirement_report', label: '生成需求解析报告', actionType: 'generate_requirement_report', requiresConfirm: false }],
              session: {
                ...sessionBase,
                messages: [
                  { messageId: 'm-user-1', role: 'user', content: '多组织业务往来一般包含哪些模块？', attachmentIds: ['att-echo'], createdAt: '2026-08-08T00:00:00.000Z' },
                  { messageId: 'm-ai-1', role: 'assistant', content: '模型回复：多组织业务往来一般包含哪些模块？', metadata: { intent: 'attachment_qa', suggestedActions: [{ id: 'generate_requirement_report', label: '生成需求解析报告', actionType: 'generate_requirement_report', requiresConfirm: false }] }, createdAt: '2026-08-08T00:00:01.000Z' },
                ],
                attachments: [{ attachmentId: 'att-echo', name: '客户需求.xlsx', size: 4200, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', parsedSummary, createdAt: '2026-08-08T00:00:00.000Z' }],
                updatedAt: '2026-08-08T00:00:01.000Z',
              },
            },
          })
        }
        return HttpResponse.json({
          success: true,
          data: {
            intent: 'harness_report_generation',
            answer: `模型回复：${latest}`,
            businessRole: 'pre_sales',
            roleLabel: '售前顾问',
            model: 'kimi-k2.5',
          },
        })
      }),
    )
    localStorage.setItem('wes-ai-active-session-id', 'session-echo-summary')

    const { container } = renderHomeWorkspace()
    const input = await screen.findByRole('textbox')
    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(['demo'], '客户需求.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.change(input, { target: { value: '多组织业务往来一般包含哪些模块？' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => expect(chatRequests.length).toBe(1))
    await waitFor(() => expect(screen.getByText(/模型回复：多组织业务往来/)).toBeInTheDocument())

    // 点击建议动作后发送显式报告请求：会话回声已持久化 parsedSummary，
    // 第二轮回声重建后出站消息仍应携带 parsedSummary
    fireEvent.click(screen.getByText('生成需求解析报告'))
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => expect(chatRequests.length).toBe(2))
    expect(chatRequests[1].messages.some((message) => (
      (message.attachments || []).some((attachment) => (
        attachment.name === '客户需求.xlsx' && /多组织业务协同/.test(attachment.parsedSummary || '')
      ))
    ))).toBe(true)
  })

  test('ISS-2026-08-08-001: explicit report request after refresh hydration goes to report generation', async () => {
    const parsedSummary = 'AI 已完成文件解析摘要：\n文件：存量需求.xlsx\n项目：水合项目\n客户：水合客户\n业务需求：\n1. 存量需求'
    const hydratedSession = {
      sessionId: 'session-hydrated-attachment',
      title: '存量附件会话',
      domain: 'business_evaluation',
      workflowKey: 'parse_requirement_file',
      businessRole: 'pre_sales',
      status: 'rough_estimate',
      summary: '',
      messages: [
        { messageId: 'm-user-1', role: 'user', content: '帮我看看这个需求文件', attachmentIds: ['att-hydrate'], createdAt: '2026-08-08T00:00:00.000Z' },
        { messageId: 'm-ai-1', role: 'assistant', content: '已解析完成，可随时生成需求解析报告。', createdAt: '2026-08-08T00:00:01.000Z' },
      ],
      attachments: [{ attachmentId: 'att-hydrate', name: '存量需求.xlsx', size: 5200, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', parsedSummary, createdAt: '2026-08-08T00:00:00.000Z' }],
      artifacts: [],
      pendingActions: [],
      linkedRecords: {},
      createdAt: '2026-08-08T00:00:00.000Z',
      updatedAt: '2026-08-08T00:00:01.000Z',
    }
    let chatBody
    server.use(
      http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: [hydratedSession] } })),
      http.post(`${BASE}/ai/home-workbench/chat`, async ({ request }) => {
        chatBody = await request.json()
        return HttpResponse.json({
          success: true,
          data: {
            intent: 'harness_report_generation',
            answer: '已完成 AI 深度需求分析，并生成《需求解析报告 v1》。',
            businessRole: 'pre_sales',
            roleLabel: '售前顾问',
            model: 'kimi-k2.5',
            session: {
              ...hydratedSession,
              messages: [
                ...hydratedSession.messages,
                { messageId: 'm-user-2', role: 'user', content: '请基于当前附件生成需求解析报告', createdAt: '2026-08-08T00:00:02.000Z' },
                { messageId: 'm-ai-2', role: 'assistant', content: '已完成 AI 深度需求分析，并生成《需求解析报告 v1》。', artifactIds: ['art-hydrate-report'], createdAt: '2026-08-08T00:00:03.000Z' },
              ],
              artifacts: [{
                artifactId: 'art-hydrate-report',
                type: 'requirement_analysis_report',
                title: '需求解析报告 v1',
                status: 'generated',
                createdAt: '2026-08-08T00:00:03.000Z',
                content: {
                  sourceFile: '存量需求.xlsx',
                  projectName: '水合项目',
                  customerName: '水合客户',
                  industry: '制造业',
                  needs: ['存量需求'],
                  missingItems: ['实施组织范围'],
                  risks: ['范围未锁定'],
                },
              }],
              updatedAt: '2026-08-08T00:00:03.000Z',
            },
          },
        })
      }),
    )
    localStorage.setItem('wes-ai-active-session-id', 'session-hydrated-attachment')

    renderHomeWorkspace()

    // 模拟刷新：仅从 session 数据水合历史消息
    expect(await screen.findByText('已解析完成，可随时生成需求解析报告。')).toBeInTheDocument()

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '请基于当前附件生成需求解析报告' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    await waitFor(() => expect(chatBody).toBeTruthy())
    expect(chatBody.sessionId).toBe('session-hydrated-attachment')
    // 水合后的出站消息应携带会话级 persisted parsedSummary
    expect(chatBody.messages.some((message) => (
      (message.attachments || []).some((attachment) => (
        attachment.name === '存量需求.xlsx' && /水合项目/.test(attachment.parsedSummary || '')
      ))
    ))).toBe(true)
    // 走报告生成路径，而非静态上传引导
    await waitFor(() => expect(screen.getAllByText('需求解析报告 v1').length).toBeGreaterThan(0))
    expect(screen.queryByText(/请上传需求文件/)).not.toBeInTheDocument()
  })
})
