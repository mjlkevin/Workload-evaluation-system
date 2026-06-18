import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
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
    await waitFor(() => expect(screen.getByText('项目评估方案列表')).toBeInTheDocument())
  })

  test('updates page identity when switching to traditional dashboard', async () => {
    render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: '传统工作台' }))

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: '项目评估工作台' })).toBeInTheDocument())
    expect(screen.getByRole('link', { name: '项目评估工作台' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '传统工作台' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('selected workflow reshapes the central empty state and composer context', async () => {
    render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: /生成待确认问题/ }))

    expect(screen.getByRole('heading', { level: 2, name: '生成待确认问题' })).toBeInTheDocument()
    expect(screen.getAllByText(/提炼售前需要回问客户的问题/).length).toBeGreaterThan(0)
    expect(screen.getByText('当前工作流：生成待确认问题')).toBeInTheDocument()
    expect(screen.getByText('待确认问题')).toBeInTheDocument()
  })

  test('sends AI home message to backend and renders model answer', async () => {
    render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '请分析这份需求材料' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    expect(await screen.findByText('模型回复：请分析这份需求材料')).toBeInTheDocument()
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

    render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

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

    const { container } = render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)
    const input = await screen.findByRole('textbox')
    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(['demo'], '客户需求说明.pdf', { type: 'application/pdf' })

    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.change(input, { target: { value: '请分析附件' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    expect(await screen.findByText('模型回复：请分析附件')).toBeInTheDocument()
    expect(screen.getByText('客户需求说明.pdf')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: '继续补充范围' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    expect(await screen.findByText('模型回复：继续补充范围')).toBeInTheDocument()
    expect(screen.getByText('客户需求说明.pdf')).toBeInTheDocument()
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

    render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

    expect(await screen.findByText('已有需求材料')).toBeInTheDocument()
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '继续' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    expect(await screen.findByText('模型回复：继续需求解析')).toBeInTheDocument()
    expect(chatBody.workflowKey).toBe('parse_requirement_file')
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

    render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

    expect(await screen.findByText('XX制造 WMS 粗评')).toBeInTheDocument()
    expect(screen.getByText('粗评报告')).toBeInTheDocument()
    expect(screen.getByText('创建项目评估方案')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(await screen.findByText(/项目：XX制造 WMS 项目/)).toBeInTheDocument()
    expect(projectCreateBody).toMatchObject({ projectName: 'XX制造 WMS 项目', customerName: 'XX制造' })
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
    render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

    expect(await screen.findByText('待删除会话')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除会话：待删除会话' }))
    expect(screen.getByRole('dialog', { name: '删除会话' })).toBeInTheDocument()
    expect(screen.getByText('确定要彻底删除这个 AI 会话吗？')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(deleteCalled).toBe(0)
    expect(screen.queryByRole('dialog', { name: '删除会话' })).not.toBeInTheDocument()
    expect(screen.getByText('待删除会话')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '删除会话：待删除会话' }))
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

    const { container } = render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: /更新评估标准/ }))
    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(['标准'], '金蝶官方评估标准.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    expect(await screen.findByText('标准差异草稿')).toBeInTheDocument()
    expect(screen.getByText(/人天基准变更/)).toBeInTheDocument()
    expect(screen.getByText('发布标准版本')).toBeInTheDocument()
  })

  test('shows attached AI home file as a removable composer card', async () => {
    const { container } = render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)
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
    const { container } = render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

    const input = await screen.findByRole('textbox')
    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(['demo'], '客户需求说明.pdf', { type: 'application/pdf' })

    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.change(input, { target: { value: '请分析附件' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

    expect(await screen.findByText('模型回复：请分析附件')).toBeInTheDocument()
    expect(screen.getByText('客户需求说明.pdf')).toBeInTheDocument()
    expect(screen.getByText(/PDF · 1 KB · 已发送/)).toBeInTheDocument()
    expect(screen.queryByText(/已附加，将随下一条消息发送/)).not.toBeInTheDocument()
  })

  test('keeps the draft in place when AI home request needs login', async () => {
    server.use(http.post(`${BASE}/ai/home-workbench/chat`, () => HttpResponse.json({
      code: 'UNAUTHORIZED',
      message: '登录已过期，请重新登录',
    }, { status: 401 })))

    render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

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

    render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

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

    render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

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
    const { container } = render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

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
    expect(composer.style.overflowY).toBe('auto')
    expect(screen.getByRole('button', { name: '附加文件' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送消息' })).toBeInTheDocument()
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
