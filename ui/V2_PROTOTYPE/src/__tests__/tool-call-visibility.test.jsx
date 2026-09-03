/**
 * 批次 0.5 · ③ 工具调用可视化前端消费守护测试（异步 Run 通道）。
 *
 * 常驻回归资产：
 * 1) SSE 四类 tool.call.* 事件必须落到**既有** toolCalls 通道（不建新通道）；
 * 2) 三种状态各自可见：started → running、completed、failed；
 * 3) progress 只更新已存在 running 项的耗时，不得凭空造出 running；
 * 4) 完整工具参数不得进入消息持久列表（体积与模型可见面同源约束）；
 * 5) 重放/历史会话口径：后端 metadata 顶层 toolCalls 带状态时前端可还原；
 * 6) 零回归：无 toolCalls 时组件仍 null，存量只有 name 的数据渲染保持不变。
 */
import { act, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { sessionRuntimeStore } from '../hooks/useSessionRuntimeStore.js'
import useChatMessages from '../pages/AiHomeWorkbench/hooks/useChatMessages.js'
import MessageBubble from '../pages/AiHomeWorkbench/components/ChatArea/MessageBubble.jsx'
import {
  applyToolCallEventToList,
  mapSessionMessages,
  normalizeToolCalls,
  TOOL_CALL_STATUS,
} from '../pages/AiHomeWorkbench/utils/messageFormatter.js'

/**
 * 与 streaming-ux.test.jsx 同款手法：直接捕获 useRunEventStream 注册的 onEvent，
 * 绕开 SSE 管道聚焦 handleStreamEvent 分支语义。
 */
let capturedStreamHandlers = null
vi.mock('../hooks/useBackgroundRuns.jsx', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useRunEventStream: (runId, handlers) => {
      capturedStreamHandlers = handlers || null
    },
  }
})

function createHookWorkbench() {
  return {
    activeSession: {
      sessionId: 'session-b05',
      title: '批次0.5 会话',
      workflowKey: 'free_chat',
      status: 'temporary_chat',
      messages: [],
      attachments: [],
      artifacts: [],
    },
    unifiedView: { runs: [{ runId: 'run-b05', sessionId: 'session-b05', status: 'running' }] },
    composer: '',
    selectedFile: null,
    setComposer: () => {},
    clearComposerDraft: () => {},
    setDraftBeforeLogin: () => {},
    setSelectedFile: () => {},
    loadSessions: async () => {},
    refreshUnifiedView: async () => {},
    upsertSession: () => {},
  }
}

function renderChatHookWithLoading() {
  const hook = renderHook(() => useChatMessages(createHookWorkbench()))
  act(() => {
    hook.result.current.appendMessage({ id: 'u1', role: 'user', text: '先看看历史估算记录' })
    hook.result.current.appendMessage({ id: 'loading-1', role: 'assistant', text: '正在理解你的问题', loading: true })
  })
  return hook
}

function emitStreamEvent(frame) {
  act(() => {
    capturedStreamHandlers.onEvent(frame)
  })
}

function toolEvent(sequence, eventType, payload) {
  return { sequence, eventType, payload, createdAt: `2026-09-03T00:00:0${sequence}.000Z` }
}

describe('批次0.5·③ 前端消费 tool.call.* 四类事件', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionRuntimeStore.resetAllSessionViews()
    capturedStreamHandlers = null
  })

  test('四类事件按 callIndex 配对，落到既有 toolCalls 通道且三种状态各自可见', () => {
    const hook = renderChatHookWithLoading()

    emitStreamEvent(toolEvent(1, 'tool.call.started', {
      callIndex: 1, name: 'estimate_history', arguments: { page: 1, pageSize: 1 },
    }))
    emitStreamEvent(toolEvent(2, 'tool.call.progress', { callIndex: 1, name: 'estimate_history', elapsedMs: 3000 }))
    emitStreamEvent(toolEvent(3, 'tool.call.completed', {
      callIndex: 1, name: 'estimate_history', elapsedMs: 3400, resultPreview: '{"items":[]}',
    }))
    emitStreamEvent(toolEvent(4, 'tool.call.started', {
      callIndex: 2, name: 'create_project', arguments: { projectName: '批次0.5落库探针' },
    }))
    emitStreamEvent(toolEvent(5, 'tool.call.failed', {
      callIndex: 2, name: 'create_project', elapsedMs: 12, error: '工作台仅开放只读工具，create_project 未获准执行',
    }))

    const target = hook.result.current.messages.find((m) => m.id === 'loading-1')
    expect(target).toBeTruthy()
    // 不得额外新建消息（事件只喂数据）
    expect(hook.result.current.messages.filter((m) => m.role === 'assistant')).toHaveLength(1)

    const calls = target.toolCalls
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual({
      name: 'estimate_history', callIndex: 1, status: TOOL_CALL_STATUS.COMPLETED, elapsedMs: 3400,
    })
    expect(calls[1]).toEqual({
      name: 'create_project', callIndex: 2, status: TOOL_CALL_STATUS.FAILED, elapsedMs: 12,
      errorPreview: '工作台仅开放只读工具，create_project 未获准执行',
    })
    // 完整工具参数不得进持久列表
    expect(JSON.stringify(calls)).not.toContain('批次0.5落库探针')
    expect(JSON.stringify(calls)).not.toContain('resultPreview')
    // 工具事件不得把 loading 占位改成正文（正文归 text.delta）
    expect(target.text).toBe('正在理解你的问题')
    expect(target.loading).toBe(true)
  })

  test('只有 started 时保持 running 且 progress 更新耗时', () => {
    const hook = renderChatHookWithLoading()

    emitStreamEvent(toolEvent(1, 'tool.call.started', { callIndex: 1, name: 'knowledge_query', arguments: {} }))
    let target = hook.result.current.messages.find((m) => m.id === 'loading-1')
    expect(target.toolCalls).toEqual([{ name: 'knowledge_query', callIndex: 1, status: 'running', elapsedMs: 0 }])

    emitStreamEvent(toolEvent(2, 'tool.call.progress', { callIndex: 1, name: 'knowledge_query', elapsedMs: 6000 }))
    target = hook.result.current.messages.find((m) => m.id === 'loading-1')
    expect(target.toolCalls).toHaveLength(1)
    expect(target.toolCalls[0].elapsedMs).toBe(6000)
    expect(target.toolCalls[0].status).toBe('running')
  })

  test('终态后迟到的 progress 不得把已完成改回运行中', () => {
    const list = applyToolCallEventToList(
      applyToolCallEventToList(
        undefined,
        { eventType: 'tool.call.started', payload: { callIndex: 1, name: 'estimate_history' } },
      ),
      { eventType: 'tool.call.completed', payload: { callIndex: 1, name: 'estimate_history', elapsedMs: 900 } },
    )
    expect(list).toEqual([{ name: 'estimate_history', callIndex: 1, status: 'completed', elapsedMs: 900 }])
    // 迟到的心跳：reducer 返回 null 表示「无事发生」，既有终态保持原样
    expect(applyToolCallEventToList(list, {
      eventType: 'tool.call.progress', payload: { callIndex: 1, name: 'estimate_history', elapsedMs: 9_999 },
    })).toBeNull()
    expect(list).toEqual([{ name: 'estimate_history', callIndex: 1, status: 'completed', elapsedMs: 900 }])
  })

  test('页面中途打开（只收到终态帧）也能还原状态，不丢可视化', () => {
    const list = applyToolCallEventToList(
      undefined,
      { eventType: 'tool.call.completed', payload: { callIndex: 3, name: 'rule_lookup', elapsedMs: 220 } },
    )
    expect(list).toEqual([{ name: 'rule_lookup', callIndex: 3, status: 'completed', elapsedMs: 220 }])
  })

  test('未知 callIndex 的 progress / 非工具事件 / 非法载荷一律 no-op', () => {
    const baseline = normalizeToolCalls([{ name: 'estimate_history' }])
    expect(applyToolCallEventToList(baseline, {
      eventType: 'tool.call.progress', payload: { callIndex: 9, name: 'x', elapsedMs: 10 },
    })).toBeNull()
    expect(applyToolCallEventToList(baseline, { eventType: 'text.delta', payload: { delta: 'a' } })).toBeNull()
    expect(applyToolCallEventToList(baseline, { eventType: 'tool.call.started', payload: { name: '' } })).toBeNull()
    expect(applyToolCallEventToList(baseline, null)).toBeNull()
    // 入参不得被就地修改
    expect(baseline).toEqual([{ name: 'estimate_history' }])
  })
})

describe('批次0.5·③ normalizeToolCalls 状态字段条件透传', () => {
  test('存量只有 name/source 的数据形状逐字节不变（守护既有精确断言）', () => {
    expect(normalizeToolCalls([{ name: 'estimate_history', source: 'list_tools' }]))
      .toEqual([{ name: 'estimate_history', source: 'list_tools' }])
    expect(normalizeToolCalls([{ name: 'project_list' }])).toEqual([{ name: 'project_list' }])
  })

  test('带状态时透传 callIndex/status/elapsedMs/errorPreview，拒绝非法状态值', () => {
    expect(normalizeToolCalls([
      { name: 'a', callIndex: 1, status: 'running', elapsedMs: 0 },
      { name: 'b', status: 'weird', elapsedMs: 'x' },
    ])).toEqual([
      { name: 'a', callIndex: 1, status: 'running', elapsedMs: 0 },
      { name: 'b' },
    ])
  })
})

describe('批次0.5·③ 历史会话重放（后端 metadata 顶层 toolCalls）', () => {
  test('会话消息顶层 metadata.toolCalls 带状态时前端还原三态', () => {
    const mapped = mapSessionMessages({
      sessionId: 's1',
      messages: [
        { messageId: 'm1', role: 'user', content: '先看看历史估算记录' },
        {
          messageId: 'm2',
          role: 'assistant',
          content: '已查到 1 条记录',
          metadata: {
            toolCalls: [
              { name: 'estimate_history', callIndex: 1, status: 'completed', elapsedMs: 3400 },
              { name: 'create_project', callIndex: 2, status: 'failed', elapsedMs: 12, errorPreview: '未获准执行' },
            ],
          },
        },
      ],
    })
    expect(mapped[1].toolCalls).toEqual([
      { name: 'estimate_history', callIndex: 1, status: 'completed', elapsedMs: 3400 },
      { name: 'create_project', callIndex: 2, status: 'failed', elapsedMs: 12, errorPreview: '未获准执行' },
    ])
  })

  test('跨端契约：后端镜像形状逐字段透传，source 与三态在重后都不丢', () => {
    // 逐字节取自后端 toWorkbenchToolCallMetadata 的产出（workbench-chat.workflow.test.ts
    // 「批次0.5·③」断言的同一形状）：镜像把 trace.toolCalls 的 source 按名合并进来，
    // 前端若丢 source，重开会话后「· 经发现」就会静默消失。
    const backendMirror = [
      { callIndex: 1, name: 'estimate_history', status: 'completed', elapsedMs: 3400, source: 'list_tools' },
      {
        callIndex: 2,
        name: 'create_project',
        status: 'failed',
        elapsedMs: 12,
        errorPreview: '工作台仅开放只读工具，create_project 未获准执行',
      },
    ]
    const mapped = mapSessionMessages({
      sessionId: 's1',
      messages: [
        {
          messageId: 'm1',
          role: 'assistant',
          content: '已查到 1 条记录',
          metadata: { toolCalls: backendMirror },
        },
      ],
    })
    const reloaded = mapped[0].toolCalls
    expect(reloaded).toEqual([
      { name: 'estimate_history', source: 'list_tools', callIndex: 1, status: 'completed', elapsedMs: 3400 },
      {
        name: 'create_project',
        callIndex: 2,
        status: 'failed',
        elapsedMs: 12,
        errorPreview: '工作台仅开放只读工具，create_project 未获准执行',
      },
    ])
    // UI 事件专用面（完整参数、结果预览）不得经镜像回灌持久列表
    const serialized = JSON.stringify(reloaded)
    expect(serialized).not.toContain('arguments')
    expect(serialized).not.toContain('resultPreview')
    // 重放列表必须与流式列表同源：同一条调用序列经两条路径归一后应相等，
    // 否则「刷新前后看到的不是同一份数据」只能靠人工发现。
    // （source 只有镜像面带，工具循环的 SSE 事件不携带，比对时按口径剔除。）
    let live = applyToolCallEventToList(undefined, {
      eventType: 'tool.call.started',
      payload: { callIndex: 1, name: 'estimate_history' },
    })
    live = applyToolCallEventToList(live, {
      eventType: 'tool.call.completed',
      payload: { callIndex: 1, name: 'estimate_history', elapsedMs: 3400 },
    })
    live = applyToolCallEventToList(live, {
      eventType: 'tool.call.started',
      payload: { callIndex: 2, name: 'create_project' },
    })
    live = applyToolCallEventToList(live, {
      eventType: 'tool.call.failed',
      payload: { callIndex: 2, name: 'create_project', elapsedMs: 12, error: '工作台仅开放只读工具，create_project 未获准执行' },
    })
    const stripSource = (calls) => calls.map(({ source, ...rest }) => rest)
    expect(stripSource(normalizeToolCalls(live))).toEqual(stripSource(reloaded))
  })
})

describe('批次0.5·③ ThinkingTrace 状态渲染', () => {
  function renderWithToolCalls(toolCalls, extra = {}) {
    return render(
      <MessageBubble
        message={{ id: 'm1', role: 'assistant', text: '回答正文', toolCalls, ...extra }}
        sending={false}
      />,
    )
  }

  test('流式期间有 running 项时列表免点击直接可见，并展示运行中/已完成/失败三态', () => {
    renderWithToolCalls([
      { name: 'estimate_history', callIndex: 1, status: 'completed', elapsedMs: 3400 },
      { name: 'create_project', callIndex: 2, status: 'failed', elapsedMs: 12, errorPreview: '未获准执行' },
      { name: 'knowledge_query', callIndex: 3, status: 'running', elapsedMs: 6000 },
    ], { streaming: true })

    expect(screen.getByText('knowledge_query')).toBeInTheDocument()
    expect(screen.getByText(/运行中/)).toBeInTheDocument()
    expect(screen.getByText('estimate_history')).toBeInTheDocument()
    expect(screen.getByText(/已完成/)).toBeInTheDocument()
    expect(screen.getByText(/失败/)).toBeInTheDocument()
    // 长耗时工具显示进度耗时
    expect(screen.getByText(/6.0s/)).toBeInTheDocument()
  })

  test('存量仅名称数据（无状态）保持既有行为：折叠，点击后才展示名称', () => {
    renderWithToolCalls([{ name: 'estimate_history', source: 'list_tools' }])
    expect(screen.queryByText('estimate_history')).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: /工具调用/ })
    act(() => { toggle.click() })
    expect(screen.getByText('estimate_history')).toBeInTheDocument()
    expect(screen.getByText('· 经发现')).toBeInTheDocument()
    expect(screen.queryByText(/运行中|已完成|失败/)).not.toBeInTheDocument()
  })

  test('无 toolCalls 时不渲染工具区块', () => {
    renderWithToolCalls(undefined)
    expect(screen.queryByRole('button', { name: /工具调用/ })).not.toBeInTheDocument()
  })

  test('流已结束（非 streaming）时残留 running 不得继续宣称运行中', () => {
    renderWithToolCalls([{ name: 'knowledge_query', callIndex: 1, status: 'running', elapsedMs: 6000 }])
    // 不臆造终态：回到存量默认折叠，且展开后也不出现「运行中」
    expect(screen.queryByText('knowledge_query')).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: /工具调用/ })
    act(() => { toggle.click() })
    expect(screen.getByText('knowledge_query')).toBeInTheDocument()
    expect(screen.queryByText(/运行中/)).not.toBeInTheDocument()
  })

  test('重开会话（全终态、非 streaming）点开即可看到三态与耗时，可视化不只活在一次 SSE 连接里', () => {
    // 形状取自后端落库镜像经 mapSessionMessages 的还原结果（非手写：避免测的 shapes 与真实链路脱节）
    const reloaded = mapSessionMessages({
      sessionId: 's1',
      messages: [
        {
          messageId: 'm1',
          role: 'assistant',
          content: '已查到 1 条记录',
          metadata: {
            toolCalls: [
              { callIndex: 1, name: 'estimate_history', status: 'completed', elapsedMs: 3400, source: 'list_tools' },
              {
                callIndex: 2,
                name: 'create_project',
                status: 'failed',
                elapsedMs: 12,
                errorPreview: '工作台仅开放只读工具，create_project 未获准执行',
              },
            ],
          },
        },
      ],
    })[0].toolCalls

    renderWithToolCalls(reloaded)
    // 全终态的历史列表默认折叠（与批次 0 经发现 chip 口径一致，保持会话区安静）
    expect(screen.queryByText('estimate_history')).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: /工具调用/ })
    act(() => { toggle.click() })

    expect(screen.getByText('estimate_history')).toBeInTheDocument()
    expect(screen.getByText('· 经发现')).toBeInTheDocument()
    expect(screen.getByText(/已完成 3\.4s/)).toBeInTheDocument()
    expect(screen.getByText(/失败 12ms/)).toBeInTheDocument()
    expect(screen.getByText(/未获准执行/)).toBeInTheDocument()
    // 重后不臆造运行中：终态数据不会再出现「运行中」标签
    expect(screen.queryByText(/运行中/)).not.toBeInTheDocument()
  })
})
