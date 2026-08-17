// SP-2026-007 MS2-PATCH + MS3：AI 工作台记忆可见性与工具调用 trace
// ① 待确认记忆提示条（draft > 0 渲染 + 跳转 /system/memory?status=draft）
// ② ThinkingTrace 通用「工具调用」chip（list_tools 发现后可折叠展示）
// ③ ThinkingTrace「引用记忆」标记（与工具调用 chip 统一设计语言）
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { server } from './mocks/server.js'
import ChatArea from '../pages/AiHomeWorkbench/components/ChatArea/index.jsx'
import ThinkingTrace from '../pages/AiHomeWorkbench/components/ChatArea/ThinkingTrace.jsx'

// ---------- ChatArea 提示条 ----------

const preset = {
  systemPrompt: 'sys',
  label: '自由问答',
  headline: 'headline',
  emptyHint: 'hint',
  placeholder: '输入',
}

function makeProps(overrides = {}) {
  return {
    preset,
    workbench: {
      loadingSessions: false,
      sessionsError: '',
      clearSessionsError: () => {},
      unifiedView: { runs: [] },
      activeSession: { sessionId: 's-1' },
      composer: '',
      setComposer: () => {},
      selectedFile: null,
      backgroundRuns: { cancelRun: () => {} },
    },
    chat: {
      sending: false,
      messages: [],
      messagePaneRef: { current: null },
      handleInteractiveOptionSelect: () => {},
      handleInteractiveFormSubmit: () => {},
      handleSuggestedAction: () => {},
      goLogin: () => {},
      copyDraft: () => {},
      toggleThought: () => {},
      chooseFile: () => {},
      fileInputRef: { current: null },
      attachFile: () => {},
      removeSelectedFile: () => {},
      sendMessage: () => {},
    },
    harness: {
      confirmingActionId: '',
      handleHarnessAction: () => {},
      handleStructuredSupplement: () => {},
    },
    ...overrides,
  }
}

function mockMemoryApi({ draftAtoms = 0, draftScenes = 0 } = {}) {
  let lastQuery = null
  server.use(
    http.get('/api/v1/memory', ({ request }) => {
      lastQuery = Object.fromEntries(new URL(request.url).searchParams.entries())
      return HttpResponse.json({
        code: 'OK',
        message: 'success',
        data: {
          atoms: [],
          scenes: [],
          totalAtoms: draftAtoms,
          totalScenes: draftScenes,
          page: 1,
          pageSize: 50,
        },
      })
    }),
  )
  return () => lastQuery
}

describe('待确认记忆提示条（MS2-PATCH）', () => {
  it('draft 记忆存在时渲染提示条并可跳转到记忆管理面板 draft 筛选', async () => {
    const getQuery = mockMemoryApi({ draftAtoms: 2, draftScenes: 1 })
    render(
      <MemoryRouter>
        <ChatArea {...makeProps()} />
      </MemoryRouter>,
    )

    const banner = await screen.findByRole('status', { name: '待确认记忆提示' })
    expect(banner).toHaveTextContent('3 条待确认记忆')

    const link = screen.getByRole('link', { name: /去确认/ })
    expect(link).toHaveAttribute('href', '/system/memory?status=draft')

    // 拉取时必须带 status=draft 过滤
    await waitFor(() => expect(getQuery()?.status).toBe('draft'))
  })

  it('无 draft 记忆时不渲染提示条', async () => {
    mockMemoryApi({ draftAtoms: 0, draftScenes: 0 })
    render(
      <MemoryRouter>
        <ChatArea {...makeProps()} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.queryByRole('status', { name: '待确认记忆提示' })).not.toBeInTheDocument()
    })
  })

  it('run 终态（sending true→false）后重新拉取 draft 数量', async () => {
    let drafts = 0
    server.use(
      http.get('/api/v1/memory', () =>
        HttpResponse.json({
          code: 'OK',
          message: 'success',
          data: { atoms: [], scenes: [], totalAtoms: drafts, totalScenes: 0, page: 1, pageSize: 50 },
        }),
      ),
    )
    const props = makeProps()
    const { rerender } = render(
      <MemoryRouter>
        <ChatArea {...props} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('status', { name: '待确认记忆提示' })).not.toBeInTheDocument()

    // 模拟一轮发送完成，蒸馏产出 2 条 draft
    drafts = 2
    rerender(
      <MemoryRouter>
        <ChatArea {...makeProps({ chat: { ...props.chat, sending: true } })} />
      </MemoryRouter>,
    )
    rerender(
      <MemoryRouter>
        <ChatArea {...props} />
      </MemoryRouter>,
    )

    const banner = await screen.findByRole('status', { name: '待确认记忆提示' })
    expect(banner).toHaveTextContent('2 条待确认记忆')
  })
})

// ---------- ThinkingTrace 扩展 chip ----------

const knowledgeToolFixture = {
  toolId: 'knowledge_base.query_product_knowledge',
  available: true,
  retrievalTriggered: true,
  confidence: 'high',
  model: 'glm-4.6',
  fallbackReason: '',
  contextRef: 'ctx-1',
}

describe('ThinkingTrace 通用 chip（MS3 工具发现 + MS2-PATCH 引用记忆）', () => {
  it('既有知识库 chip 行为保持不变', () => {
    render(<ThinkingTrace messageId="t1" knowledgeTool={knowledgeToolFixture} />)

    expect(screen.getByLabelText('知识库参考')).toBeInTheDocument()
    expect(screen.getByText('知识库参考')).toBeInTheDocument()
    expect(screen.queryByLabelText('工具调用')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('引用记忆')).not.toBeInTheDocument()
  })

  it('工具发现 trace chip：默认折叠，展开可见经 list_tools 选中的工具', () => {
    render(
      <ThinkingTrace
        messageId="t2"
        knowledgeTool={knowledgeToolFixture}
        toolCalls={[
          { name: 'knowledge_query', source: 'list_tools' },
          { name: 'project_list', source: 'list_tools' },
        ]}
      />,
    )

    const chip = screen.getByLabelText('工具调用')
    expect(chip).toBeInTheDocument()
    expect(screen.queryByText('knowledge_query')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /工具调用/ }))
    expect(screen.getByText('knowledge_query')).toBeInTheDocument()
    expect(screen.getByText('project_list')).toBeInTheDocument()
  })

  it('仅有工具调用数据（无知识库 trace）时也应渲染 chip', () => {
    render(<ThinkingTrace messageId="t3" toolCalls={[{ name: 'estimate_history', source: 'list_tools' }]} />)

    expect(screen.getByLabelText('工具调用')).toBeInTheDocument()
    expect(screen.queryByLabelText('知识库参考')).not.toBeInTheDocument()
  })

  it('引用记忆标记：与工具调用 chip 统一设计语言', () => {
    render(
      <ThinkingTrace
        messageId="t4"
        knowledgeTool={knowledgeToolFixture}
        memoryRef={{ scenesCount: 2, atomsCount: 3 }}
      />,
    )

    const marker = screen.getByLabelText('引用记忆')
    expect(marker).toBeInTheDocument()
    expect(marker).toHaveTextContent('引用记忆')
    expect(marker).toHaveTextContent('2 场景')
    expect(marker).toHaveTextContent('3 事实')
  })

  it('引用记忆计数为 0 时不渲染标记', () => {
    render(
      <ThinkingTrace
        messageId="t5"
        knowledgeTool={knowledgeToolFixture}
        memoryRef={{ scenesCount: 0, atomsCount: 0 }}
      />,
    )

    expect(screen.queryByLabelText('引用记忆')).not.toBeInTheDocument()
  })
})
