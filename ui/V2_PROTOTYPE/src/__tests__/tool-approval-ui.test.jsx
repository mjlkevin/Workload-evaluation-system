/**
 * 批次 1b · 审批前端界面 + 工具痕迹留存 —— 常驻回归资产。
 *
 * 锁死四件事：
 * 1) 状态机：开始 → 等你确认 →（已同意）执行中 → 完成/失败/已拒绝，
 *    由 tool.call.awaiting_approval / tool.call.rejected 两个批次 1a 新事件驱动；
 * 2) 参数唯一来源：按钮上显示的关键参数只能来自同 callId 的 tool.call.started 那一份，
 *    且**不得**随终态帧留在列表里、更不得经 normalizeToolCalls 落进会话消息；
 * 3) actionId 逐字透传：确认/拒绝请求里的 actionId 必须等于事件里的那一个，前端不得自拼；
 * 4) 痕迹重建：刷新后经「按 run 读取工具事件」的只读接口还原出同状态的 chip，
 *    只读工具（allow 档）永远拿不到同意/拒绝按钮。
 */
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { sessionRuntimeStore } from '../hooks/useSessionRuntimeStore.js'
import useChatMessages from '../pages/AiHomeWorkbench/hooks/useChatMessages.js'
import ThinkingTrace from '../pages/AiHomeWorkbench/components/ChatArea/ThinkingTrace.jsx'
import {
  applyToolCallEventToList,
  createToolCallArgsCache,
  normalizeToolCalls,
  reduceToolCallTrail,
  TOOL_CALL_STATUS,
} from '../pages/AiHomeWorkbench/utils/messageFormatter.js'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

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

/** 与 tool-call-visibility.test.jsx 同款：事件帧构造器 */
function toolEvent(sequence, eventType, payload) {
  return { sequence, eventType, payload, createdAt: `2026-09-05T00:00:0${sequence}.000Z` }
}

/** 服务端批次 1a 冻结的载荷形状：started 带参数，审批事件只带标识 */
function startedEvent(sequence, { callIndex, name, callId, args }) {
  return toolEvent(sequence, 'tool.call.started', {
    callIndex, name, ...(callId ? { callId } : {}), arguments: args,
  })
}

function awaitingEvent(sequence, { callId, actionId, toolName, ordinal = 1 }) {
  return toolEvent(sequence, 'tool.call.awaiting_approval', { callId, actionId, ordinal, toolName })
}

/** 每次跑都换一个 cache，避免用例间串味 */
function ctx(runId = 'run-1b') {
  return { runId, argsCache: createToolCallArgsCache() }
}

function fold(events, context = ctx()) {
  let list = []
  for (const event of events) {
    const next = applyToolCallEventToList(list, event, context)
    if (next !== null) list = next
  }
  return list
}

describe('批次1b · 审批状态机归约（applyToolCallEventToList）', () => {
  test('started → awaiting_approval：chip 进入等你确认，带上 actionId 与 started 那份参数', () => {
    const context = ctx()
    let list = fold([
      startedEvent(1, { callIndex: 1, name: 'create_project', callId: 'call_a', args: { projectName: '可味达ERP' } }),
    ], context)
    expect(list).toEqual([{ name: 'create_project', callIndex: 1, status: 'running', elapsedMs: 0, callId: 'call_a' }])

    list = applyToolCallEventToList(list, awaitingEvent(2, {
      callId: 'call_a', actionId: 'act-1', toolName: 'create_project',
    }), context)

    expect(list).toHaveLength(1)
    expect(list[0].status).toBe(TOOL_CALL_STATUS.AWAITING_APPROVAL)
    expect(list[0].approval).toEqual({
      actionId: 'act-1',
      runId: 'run-1b',
      toolName: 'create_project',
      arguments: { projectName: '可味达ERP' },
    })
  })

  test('审批事件晚于 started 到达（订阅晚了）也要能建出 chip，不丢待确认态', () => {
    const list = fold([awaitingEvent(1, { callId: 'call_x', actionId: 'act-x', toolName: 'create_project' })], ctx())
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: 'create_project', status: 'awaiting_approval' })
    expect(list[0].approval.actionId).toBe('act-x')
  })

  test('run_action_confirmed：等你确认 → 执行中（已同意），actionId 仍可对上', () => {
    const context = ctx()
    const list = fold([
      startedEvent(1, { callIndex: 1, name: 'create_project', callId: 'call_a', args: { projectName: '可味达ERP' } }),
      awaitingEvent(2, { callId: 'call_a', actionId: 'act-1', toolName: 'create_project' }),
      toolEvent(3, 'run_action_confirmed', { actionId: 'act-1', callId: 'call_a', confirmedBy: 'u1', toolName: 'create_project' }),
    ], context)
    expect(list).toHaveLength(1)
    expect(list[0].status).toBe(TOOL_CALL_STATUS.RUNNING)
    expect(list[0].approval.approved).toBe(true)
    expect(list[0].approval.actionId).toBe('act-1')
  })

  test('tool.call.rejected：chip 落到已拒绝终态，保留参数供回看', () => {
    const context = ctx()
    const list = fold([
      startedEvent(1, { callIndex: 1, name: 'create_project', callId: 'call_a', args: { projectName: '可味达ERP' } }),
      awaitingEvent(2, { callId: 'call_a', actionId: 'act-1', toolName: 'create_project' }),
      toolEvent(3, 'tool.call.rejected', { actionId: 'act-1', callId: 'call_a', rejectedBy: 'u1', toolName: 'create_project' }),
    ], context)
    expect(list).toHaveLength(1)
    expect(list[0].status).toBe(TOOL_CALL_STATUS.REJECTED)
    expect(list[0].approval.actionId).toBe('act-1')
  })

  test('重放吸收：确认后重新发起的同名调用不新建 chip，收口后参数即被丢弃', () => {
    const context = ctx()
    const list = fold([
      startedEvent(1, { callIndex: 1, name: 'create_project', callId: 'call_a', args: { projectName: '可味达ERP' } }),
      awaitingEvent(2, { callId: 'call_a', actionId: 'act-1', toolName: 'create_project' }),
      toolEvent(3, 'run_action_confirmed', { actionId: 'act-1', callId: 'call_a', confirmedBy: 'u1', toolName: 'create_project' }),
      // worker 续跑：服务端重新走一遍工具循环，callId 与 callIndex 都可能重来
      startedEvent(4, { callIndex: 1, name: 'create_project', callId: 'call_b', args: { projectName: '可味达ERP' } }),
      toolEvent(5, 'tool.call.completed', { callIndex: 1, name: 'create_project', elapsedMs: 800, resultPreview: '{}' }),
    ], context)
    expect(list).toHaveLength(1)
    expect(list[0].status).toBe(TOOL_CALL_STATUS.COMPLETED)
    expect(list[0].elapsedMs).toBe(800)
    expect(list[0].approval.approved).toBe(true)
    // 终态后不得把参数继续留在列表里（体积与模型可见面同源约束）
    expect(JSON.stringify(list)).not.toContain('可味达ERP')
  })

  test('拒绝后的重放：同一次调用只留一个已拒绝 chip，回填的失败帧不改写状态', () => {
    const context = ctx()
    const list = fold([
      startedEvent(1, { callIndex: 1, name: 'create_project', callId: 'call_a', args: { projectName: '可味达ERP' } }),
      awaitingEvent(2, { callId: 'call_a', actionId: 'act-1', toolName: 'create_project' }),
      toolEvent(3, 'tool.call.rejected', { actionId: 'act-1', callId: 'call_a', rejectedBy: 'u1', toolName: 'create_project' }),
      startedEvent(4, { callIndex: 1, name: 'create_project', callId: 'call_b', args: { projectName: '可味达ERP' } }),
      toolEvent(5, 'tool.call.failed', {
        callIndex: 1, name: 'create_project', elapsedMs: 5, error: '用户拒绝了本次写操作，未执行任何变更',
      }),
    ], context)
    expect(list).toHaveLength(1)
    expect(list[0].status).toBe(TOOL_CALL_STATUS.REJECTED)
    expect(list[0].errorPreview).toBe('用户拒绝了本次写操作，未执行任何变更')
  })

  test('参数漂移：同名第二次审批就地替换 actionId，按钮指向最新那一次', () => {
    const context = ctx()
    const list = fold([
      startedEvent(1, { callIndex: 1, name: 'create_project', callId: 'call_a', args: { projectName: 'A' } }),
      awaitingEvent(2, { callId: 'call_a', actionId: 'act-1', toolName: 'create_project' }),
      toolEvent(3, 'tool.call.rejected', { actionId: 'act-1', callId: 'call_a', rejectedBy: 'u1', toolName: 'create_project' }),
      startedEvent(4, { callIndex: 1, name: 'create_project', callId: 'call_b', args: { projectName: 'B' } }),
      awaitingEvent(5, { callId: 'call_b', actionId: 'act-2', toolName: 'create_project' }),
    ], context)
    expect(list).toHaveLength(1)
    expect(list[0].status).toBe(TOOL_CALL_STATUS.AWAITING_APPROVAL)
    expect(list[0].approval.actionId).toBe('act-2')
    expect(list[0].approval.arguments).toEqual({ projectName: 'B' })
  })

  test('只读工具（allow 档）全程不产生 approval 对象', () => {
    const list = fold([
      startedEvent(1, { callIndex: 1, name: 'project_list', callId: 'call_r', args: { page: 1 } }),
      toolEvent(2, 'tool.call.completed', { callIndex: 1, name: 'project_list', elapsedMs: 20, resultPreview: '{}' }),
    ], ctx())
    expect(list).toHaveLength(1)
    expect(list[0].approval).toBeUndefined()
    expect(list[0].status).toBe(TOOL_CALL_STATUS.COMPLETED)
  })

  test('normalizeToolCalls 白名单：callId / approval 一律不落进会话消息', () => {
    const context = ctx()
    const live = fold([
      startedEvent(1, { callIndex: 1, name: 'create_project', callId: 'call_a', args: { projectName: '可味达ERP' } }),
      awaitingEvent(2, { callId: 'call_a', actionId: 'act-1', toolName: 'create_project' }),
    ], context)
    expect(JSON.stringify(live)).toContain('可味达ERP') // 待确认时必须可见（用户要看清批准的是什么）
    const persisted = normalizeToolCalls(live)
    expect(persisted).toEqual([{ name: 'create_project', callIndex: 1, status: 'awaiting_approval', elapsedMs: 0 }])
    expect(JSON.stringify(persisted)).not.toContain('act-1')
    expect(JSON.stringify(persisted)).not.toContain('可味达ERP')
    expect(JSON.stringify(persisted)).not.toContain('callId')
  })

  test('迟到的 progress 不得把等你确认改回运行中', () => {
    const context = ctx()
    const list = fold([
      startedEvent(1, { callIndex: 1, name: 'create_project', callId: 'call_a', args: { projectName: 'A' } }),
      awaitingEvent(2, { callId: 'call_a', actionId: 'act-1', toolName: 'create_project' }),
    ], context)
    expect(applyToolCallEventToList(list, toolEvent(3, 'tool.call.progress', {
      callIndex: 1, name: 'create_project', elapsedMs: 9000,
    }), context)).toBeNull()
  })
})

describe('批次1b · 痕迹重建（reduceToolCallTrail）', () => {
  test('按 run 事件序列折叠出与实时链路同形的 chip 列表', () => {
    const events = [
      { sequence: 3, eventType: 'tool.call.started', payload: { callIndex: 1, name: 'create_project', callId: 'call_a', arguments: { projectName: '可味达ERP' } } },
      { sequence: 4, eventType: 'tool.call.awaiting_approval', payload: { actionId: 'act-1', callId: 'call_a', ordinal: 1, toolName: 'create_project' } },
    ]
    const list = reduceToolCallTrail(events, { runId: 'run-restore' })
    expect(list).toHaveLength(1)
    expect(list[0].status).toBe(TOOL_CALL_STATUS.AWAITING_APPROVAL)
    expect(list[0].approval).toMatchObject({
      actionId: 'act-1', runId: 'run-restore', arguments: { projectName: '可味达ERP' },
    })
  })

  test('空/非法事件数组一律得到空列表，不抛错', () => {
    expect(reduceToolCallTrail(undefined, { runId: 'r' })).toEqual([])
    expect(reduceToolCallTrail([null, { eventType: 'text.delta', payload: { delta: 'x' } }], { runId: 'r' })).toEqual([])
  })
})

describe('批次1b · chip 渲染与按钮（ThinkingTrace）', () => {
  function awaitingCall(overrides = {}) {
    return {
      name: 'create_project',
      callIndex: 1,
      status: TOOL_CALL_STATUS.AWAITING_APPROVAL,
      elapsedMs: 0,
      approval: { actionId: 'act-1', runId: 'run-1b', toolName: 'create_project', arguments: { projectName: '可味达ERP' } },
      ...overrides,
    }
  }

  test('等你确认：免点击即可见，且按钮上带得出工具名与关键参数', () => {
    render(<ThinkingTrace toolCalls={[awaitingCall()]} streaming={false} />)
    expect(screen.getByText('create_project')).toBeInTheDocument()
    expect(screen.getByText(/等你确认/)).toBeInTheDocument()
    expect(screen.getByText('可味达ERP')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /同意 create_project/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /拒绝 create_project/ })).toBeInTheDocument()
  })

  test('点同意 → 回调拿到的是事件里的 actionId 与 runId，前端不另拼', () => {
    const onApprove = vi.fn()
    const call = awaitingCall()
    render(<ThinkingTrace toolCalls={[call]} streaming={false} onApproveToolCall={onApprove} />)
    fireEvent.click(screen.getByRole('button', { name: /同意 create_project/ }))
    expect(onApprove).toHaveBeenCalledWith(call)
  })

  test('点拒绝 → 回调走拒绝分支', () => {
    const onReject = vi.fn()
    const call = awaitingCall()
    render(<ThinkingTrace toolCalls={[call]} streaming={false} onRejectToolCall={onReject} />)
    fireEvent.click(screen.getByRole('button', { name: /拒绝 create_project/ }))
    expect(onReject).toHaveBeenCalledWith(call)
  })

  test('已同意但未收口：显示「已同意 · 执行中」，不再给按钮', () => {
    render((
      <ThinkingTrace
        toolCalls={[{
          ...awaitingCall(),
          status: TOOL_CALL_STATUS.RUNNING,
          approval: { ...awaitingCall().approval, approved: true },
        }]}
        streaming={false}
        onApproveToolCall={vi.fn()}
      />
    ))
    expect(screen.getByText(/已同意 · 执行中/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /同意 create_project/ })).not.toBeInTheDocument()
  })

  test('已拒绝：免点击仍显示状态，且不再给按钮', () => {
    render((
      <ThinkingTrace
        toolCalls={[awaitingCall({ status: TOOL_CALL_STATUS.REJECTED })]}
        streaming={false}
        onApproveToolCall={vi.fn()}
      />
    ))
    // 拒绝后服务端会立刻重放并回填失败；若按「终态默认收起」处理，
    // 用户点完拒绝不到一秒就看不到自己的决定，会以为按钮没生效。
    expect(screen.getByText(/已拒绝/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /同意 create_project/ })).not.toBeInTheDocument()
  })

  test('只读工具：不出现同意/拒绝按钮', () => {
    render((
      <ThinkingTrace
        toolCalls={[{ name: 'project_list', callIndex: 1, status: TOOL_CALL_STATUS.COMPLETED, elapsedMs: 20 }]}
        streaming
      />
    ))
    fireEvent.click(screen.getByRole('button', { name: /工具调用/ }))
    expect(screen.getByText('project_list')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /同意/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /拒绝/ })).not.toBeInTheDocument()
  })
})

describe('批次1b · useChatMessages 接线', () => {
  function createWorkbench(overrides = {}) {
    return {
      activeSession: {
        sessionId: 'session-1b',
        title: '批次1b 会话',
        workflowKey: 'free_chat',
        status: 'temporary_chat',
        messages: [],
        attachments: [],
        artifacts: [],
      },
      unifiedView: { runs: [{ runId: 'run-1b', sessionId: 'session-1b', status: 'waiting' }] },
      composer: '',
      selectedFile: null,
      setComposer: () => {},
      clearComposerDraft: () => {},
      setDraftBeforeLogin: () => {},
      setSelectedFile: () => {},
      loadSessions: async () => {},
      refreshUnifiedView: async () => {},
      upsertSession: () => {},
      ...overrides,
    }
  }

  function renderChat(workbenchOverrides) {
    const hook = renderHook(() => useChatMessages(createWorkbench(workbenchOverrides)))
    act(() => {
      hook.result.current.appendMessage({ id: 'u1', role: 'user', text: '帮我创建一个ERP项目' })
      hook.result.current.appendMessage({ id: 'loading-1', role: 'assistant', text: '正在理解你的问题', loading: true })
    })
    return hook
  }

  beforeEach(() => {
    localStorage.clear()
    sessionRuntimeStore.resetAllSessionViews()
    capturedStreamHandlers = null
    // 实时链路的用例里痕迹接口本就为空（chip 由 SSE 事件建出），仅用于满足 msw 严格模式
    server.use(
      http.get(`${BASE}/ai-runs/:runId/tool-events`, () => HttpResponse.json({
        success: true, data: { items: [] },
      })),
    )
  })

  test('waiting Run 也建立页面级订阅（否则刷新后审批事件回不来）', () => {
    renderChat({})
    expect(capturedStreamHandlers).toBeTruthy()
  })

  test('流式收到 awaiting_approval → 当前消息 chip 进入等你确认', () => {
    const hook = renderChat({})
    const contextEvents = [
      startedEvent(1, { callIndex: 1, name: 'create_project', callId: 'call_a', args: { projectName: '可味达ERP' } }),
      awaitingEvent(2, { callId: 'call_a', actionId: 'act-1', toolName: 'create_project' }),
    ]
    contextEvents.forEach((event) => act(() => capturedStreamHandlers.onEvent(event)))
    const target = hook.result.current.messages.find((m) => m.id === 'loading-1')
    expect(target.toolCalls[0].status).toBe(TOOL_CALL_STATUS.AWAITING_APPROVAL)
    expect(target.toolCalls[0].approval.actionId).toBe('act-1')
  })

  test('approveToolCall 打的是 confirm 端点，actionId 逐字取自事件', async () => {
    let requestedUrl = ''
    server.use(
      http.post(`${BASE}/ai-runs/:runId/actions/:actionId/confirm`, async ({ request }) => {
        requestedUrl = new URL(request.url).pathname
        return HttpResponse.json({ success: true, data: { runId: 'run-1b', status: 'queued' } })
      }),
    )
    const hook = renderChat({})
    const contextEvents = [
      startedEvent(1, { callIndex: 1, name: 'create_project', callId: 'call_a', args: { projectName: '可味达ERP' } }),
      awaitingEvent(2, { callId: 'call_a', actionId: 'act-1', toolName: 'create_project' }),
    ]
    contextEvents.forEach((event) => act(() => capturedStreamHandlers.onEvent(event)))
    const call = hook.result.current.messages.find((m) => m.id === 'loading-1').toolCalls[0]

    await act(async () => {
      await hook.result.current.approveToolCall(call)
    })
    expect(requestedUrl).toBe('/api/v1/ai-runs/run-1b/actions/act-1/confirm')
    await waitFor(() => {
      const updated = hook.result.current.messages.find((m) => m.id === 'loading-1')
      expect(updated.toolCalls[0].approval.approved).toBe(true)
    })
  })

  test('rejectToolCall 打的是 reject 端点，chip 落到已拒绝', async () => {
    let requestedUrl = ''
    server.use(
      http.post(`${BASE}/ai-runs/:runId/actions/:actionId/reject`, async ({ request }) => {
        requestedUrl = new URL(request.url).pathname
        return HttpResponse.json({ success: true, data: { runId: 'run-1b', status: 'queued' } })
      }),
    )
    const hook = renderChat({})
    const contextEvents = [
      startedEvent(1, { callIndex: 1, name: 'create_project', callId: 'call_a', args: { projectName: '可味达ERP' } }),
      awaitingEvent(2, { callId: 'call_a', actionId: 'act-1', toolName: 'create_project' }),
    ]
    contextEvents.forEach((event) => act(() => capturedStreamHandlers.onEvent(event)))
    const call = hook.result.current.messages.find((m) => m.id === 'loading-1').toolCalls[0]

    await act(async () => {
      await hook.result.current.rejectToolCall(call)
    })
    expect(requestedUrl).toBe('/api/v1/ai-runs/run-1b/actions/act-1/reject')
    await waitFor(() => {
      const updated = hook.result.current.messages.find((m) => m.id === 'loading-1')
      expect(updated.toolCalls[0].status).toBe(TOOL_CALL_STATUS.REJECTED)
    })
  })

  test('刷新后重建：会话有 waiting Run 时按 run 拉一次工具事件并还原待确认 chip', async () => {
    let trailRequests = 0
    server.use(
      http.get(`${BASE}/ai-runs/run-restore/tool-events`, () => {
        trailRequests += 1
        return HttpResponse.json({
          success: true,
          data: {
            runId: 'run-restore',
            items: [
              { sequence: 3, eventType: 'tool.call.started', payload: { callIndex: 1, name: 'create_project', callId: 'call_a', arguments: { projectName: '可味达ERP' } } },
              { sequence: 4, eventType: 'tool.call.awaiting_approval', payload: { actionId: 'act-9', callId: 'call_a', ordinal: 1, toolName: 'create_project' } },
            ],
          },
        })
      }),
    )
    const hook = renderHook(() => useChatMessages(createWorkbench({
      unifiedView: { runs: [{ runId: 'run-restore', sessionId: 'session-1b', status: 'waiting' }] },
    })))

    await waitFor(() => {
      expect(hook.result.current.pendingToolApprovals).toHaveLength(1)
    })
    expect(trailRequests).toBe(1)
    expect(hook.result.current.pendingToolApprovals[0]).toMatchObject({
      name: 'create_project',
      status: TOOL_CALL_STATUS.AWAITING_APPROVAL,
      approval: { actionId: 'act-9', runId: 'run-restore' },
    })
  })

  test('只取当前可见会话：无活跃 Run 时不发工具事件请求', async () => {
    let trailRequests = 0
    server.use(
      http.get(`${BASE}/ai-runs/:runId/tool-events`, () => {
        trailRequests += 1
        return HttpResponse.json({ success: true, data: { items: [] } })
      }),
    )
    const hook = renderHook(() => useChatMessages(createWorkbench({ unifiedView: { runs: [] } })))
    await waitFor(() => expect(hook.result.current.messages).toBeDefined())
    expect(trailRequests).toBe(0)
  })
})
