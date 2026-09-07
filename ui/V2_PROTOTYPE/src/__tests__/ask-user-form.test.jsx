/**
 * 批次 9 · ask_user 前端链路 —— 常驻回归资产。
 *
 * 锁死四件事：
 * 1) 状态机：tool.call.awaiting_input 把 chip 推进「等你回答」，重放的 tool.call.started
 *    必须吸收进同一个槽位（不得裂成两个 chip），收口后表单结构即被丢弃；
 * 2) 恢复只走 inputs：提交必须打 POST /ai-runs/:runId/inputs，且**不得**打任何
 *    发消息的口子（会话有活跃 Run 时那一条路必然 409，见 aiRuns.js 注释）；
 * 3) 控件的可渲染事实来自事件里那份契约校验后的 formBlock，前端不猜不拼；
 * 4) 两份产出各得其所：结构化 values 进 inputs，模板渲染出的人话进对话成为用户发言。
 */
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { sessionRuntimeStore } from '../hooks/useSessionRuntimeStore.js'
import useChatMessages from '../pages/AiHomeWorkbench/hooks/useChatMessages.js'
import MessageBubble from '../pages/AiHomeWorkbench/components/ChatArea/MessageBubble.jsx'
import {
  applyToolCallEventToList,
  createToolCallArgsCache,
  pendingInteractiveForms,
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

const FORM_BLOCK = {
  blockId: 'clarify-scope',
  title: '请补充项目信息',
  submitLabel: '提交补充',
  submitMessageTemplate: '补充项目信息：行业={{industry}}，规模={{scale}}',
  fields: [
    {
      id: 'industry',
      label: '客户行业',
      type: 'single_select',
      required: true,
      options: [{ label: '制造业', value: 'manufacturing' }, { label: '零售', value: 'retail' }],
    },
    { id: 'scale', label: '实施规模', type: 'number', required: true },
  ],
}

function toolEvent(sequence, eventType, payload) {
  return { sequence, eventType, payload, createdAt: `2026-09-07T00:00:0${sequence}.000Z` }
}

function startedEvent(sequence, { callIndex, name, callId, args }) {
  return toolEvent(sequence, 'tool.call.started', { callIndex, name, ...(callId ? { callId } : {}), arguments: args })
}

/** 服务端批次 9 的形状：等待事件必须自带契约校验后的表单结构 */
function awaitingInputEvent(sequence, { callId, actionId, toolName = 'ask_user', ordinal = 1, formBlock = FORM_BLOCK }) {
  return toolEvent(sequence, 'tool.call.awaiting_input', { actionId, callId, ordinal, toolName, formBlock })
}

function ctx(runId = 'run-b9') {
  return { runId, argsCache: createToolCallArgsCache() }
}

describe('批次9 · 交互表单的痕迹归约', () => {
  test('started → awaiting_input 进入等你回答，控件拿到事件里那份 formBlock', () => {
    let calls = applyToolCallEventToList([], startedEvent(1, { callIndex: 1, name: 'ask_user', callId: 'call_a', args: FORM_BLOCK }), ctx())
    calls = applyToolCallEventToList(calls, awaitingInputEvent(2, { callId: 'call_a', actionId: 'act-a1' }), ctx())

    expect(calls).toHaveLength(1)
    expect(calls[0].status).toBe(TOOL_CALL_STATUS.AWAITING_INPUT)
    expect(calls[0].input.actionId).toBe('act-a1')
    expect(calls[0].input.runId).toBe('run-b9')
    expect(calls[0].input.formBlock).toEqual(FORM_BLOCK)
    expect(pendingInteractiveForms(calls)).toHaveLength(1)
  })

  test('重放的 started 吸收进同一槽位（一次提问裂成两个 chip 即为缺陷）', () => {
    let calls = applyToolCallEventToList([], startedEvent(1, { callIndex: 1, name: 'ask_user', callId: 'call_a', args: FORM_BLOCK }), ctx())
    calls = applyToolCallEventToList(calls, awaitingInputEvent(2, { callId: 'call_a', actionId: 'act-a1' }), ctx())
    // 用户提交后 worker 续跑，模型重放同一次调用（callIndex 从头计、callId 重新给）
    calls = applyToolCallEventToList(calls, startedEvent(3, { callIndex: 1, name: 'ask_user', callId: 'call_a2', args: FORM_BLOCK }), ctx())

    expect(calls).toHaveLength(1)
    expect(calls[0].status).toBe(TOOL_CALL_STATUS.RUNNING)
    expect(calls[0].input.actionId).toBe('act-a1', '重放不得丢掉这一次提问的归属')
  })

  test('收口为 completed 后控件消失，且结构不随会话消息持久化', () => {
    let calls = applyToolCallEventToList([], startedEvent(1, { callIndex: 1, name: 'ask_user', callId: 'call_a', args: FORM_BLOCK }), ctx())
    calls = applyToolCallEventToList(calls, awaitingInputEvent(2, { callId: 'call_a', actionId: 'act-a1' }), ctx())
    calls = applyToolCallEventToList(
      calls,
      toolEvent(3, 'tool.call.completed', { callIndex: 1, name: 'ask_user', elapsedMs: 10 }),
      ctx(),
    )

    expect(calls[0].status).toBe(TOOL_CALL_STATUS.COMPLETED)
    expect(pendingInteractiveForms(calls)).toHaveLength(0)
    expect(calls[0].input.formBlock).toBeUndefined()
    expect(JSON.stringify(calls)).not.toContain('请补充项目信息')
  })

  test('刷新后按事件序列重建，仍能得到同一个待填控件', () => {
    const calls = reduceToolCallTrail(
      [
        startedEvent(1, { callIndex: 1, name: 'ask_user', callId: 'call_a', args: FORM_BLOCK }),
        awaitingInputEvent(2, { callId: 'call_a', actionId: 'act-a1' }),
      ],
      ctx(),
    )
    expect(pendingInteractiveForms(calls)).toHaveLength(1)
    expect(calls[0].input.formBlock.blockId).toBe('clarify-scope')
  })

  test('审批与表单是两种等待，互不顶替', () => {
    let calls = applyToolCallEventToList([], startedEvent(1, { callIndex: 1, name: 'create_project', callId: 'c1', args: {} }), ctx())
    calls = applyToolCallEventToList(calls, toolEvent(2, 'tool.call.awaiting_approval', { callId: 'c1', actionId: 'a1', ordinal: 1, toolName: 'create_project' }), ctx())
    expect(calls[0].status).toBe(TOOL_CALL_STATUS.AWAITING_APPROVAL)
    expect(pendingInteractiveForms(calls)).toHaveLength(0, '审批不是表单，不该渲染控件')

    let formCalls = applyToolCallEventToList([], startedEvent(1, { callIndex: 1, name: 'ask_user', callId: 'c2', args: FORM_BLOCK }), ctx())
    formCalls = applyToolCallEventToList(formCalls, awaitingInputEvent(2, { callId: 'c2', actionId: 'a2' }), ctx())
    expect(formCalls[0].approval).toBeUndefined('表单不该长出同意/拒绝按钮')
  })
})

describe('批次9 · useChatMessages 接线', () => {
  function createWorkbench(overrides = {}) {
    return {
      activeSession: {
        sessionId: 'session-b9',
        title: '批次9 会话',
        workflowKey: 'free_chat',
        status: 'temporary_chat',
        messages: [],
        attachments: [],
        artifacts: [],
      },
      unifiedView: { runs: [{ runId: 'run-b9', sessionId: 'session-b9', status: 'waiting' }] },
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
      hook.result.current.appendMessage({ id: 'u1', role: 'user', text: '帮我评估这个项目的工作量' })
      hook.result.current.appendMessage({ id: 'loading-1', role: 'assistant', text: '正在理解你的问题', loading: true })
    })
    return hook
  }

  /** 记录本轮打过的所有写请求，用于证明「没有偷偷去发消息」 */
  let postedUrls
  beforeEach(() => {
    localStorage.clear()
    sessionRuntimeStore.resetAllSessionViews()
    capturedStreamHandlers = null
    postedUrls = []
    const track = (path) => () => postedUrls.push(path)
    server.use(
      http.get(`${BASE}/ai-runs/:runId/tool-events`, () => HttpResponse.json({ success: true, data: { items: [] } })),
      http.post(`${BASE}/ai-runs/:runId/inputs`, async ({ request }) => {
        track('/ai-runs/:runId/inputs')()
        const body = await request.json()
        return HttpResponse.json({ code: 0, message: 'ok', data: { runId: 'run-b9', status: 'queued', _body: body } })
      }),
      http.post(`${BASE}/ai-sessions/:sessionId/runs`, () => {
        postedUrls.push('/ai-sessions/:sessionId/runs')
        return HttpResponse.json({ code: 0, data: { runId: 'run-b9', status: 'queued' } })
      }),
      http.post(`${BASE}/ai/home-workbench/chat`, () => {
        postedUrls.push('/ai/home-workbench/chat')
        return HttpResponse.json({ code: 0, data: { answer: '不该走到这里' } })
      }),
      http.post(`${BASE}/ai-runs/:runId/actions/:actionId/confirm`, () => {
        postedUrls.push('/confirm')
        return HttpResponse.json({ code: 0, data: {} })
      }),
    )
  })

  test('SSE 收到 awaiting_input → 当前助手消息挂上待填控件', () => {
    const hook = renderChat({})
    act(() => {
      capturedStreamHandlers.onEvent(startedEvent(1, { callIndex: 1, name: 'ask_user', callId: 'call_a', args: FORM_BLOCK }))
      capturedStreamHandlers.onEvent(awaitingInputEvent(2, { callId: 'call_a', actionId: 'act-a1' }))
    })
    const last = hook.result.current.messages[hook.result.current.messages.length - 1]
    expect(pendingInteractiveForms(last.toolCalls)).toHaveLength(1)
  })

  test('提交 → 结构化 values 走 inputs 端点恢复 Run，且一次消息都没发', async () => {
    const hook = renderChat({})
    act(() => {
      capturedStreamHandlers.onEvent(startedEvent(1, { callIndex: 1, name: 'ask_user', callId: 'call_a', args: FORM_BLOCK }))
      capturedStreamHandlers.onEvent(awaitingInputEvent(2, { callId: 'call_a', actionId: 'act-a1' }))
    })
    const last = hook.result.current.messages[hook.result.current.messages.length - 1]
    const [entry] = pendingInteractiveForms(last.toolCalls)

    await act(async () => {
      await hook.result.current.submitInteractiveForm(
        entry,
        '补充项目信息：行业=制造业，规模=120',
        { industry: 'manufacturing', scale: '120', note: '' },
      )
    })

    expect(postedUrls).toEqual(['/ai-runs/:runId/inputs'])
    expect(postedUrls).not.toContain('/ai-sessions/:sessionId/runs')
    expect(postedUrls).not.toContain('/ai/home-workbench/chat')
    expect(postedUrls).not.toContain('/confirm')

    // 提交后控件立即撤下（不留着诱导第二次提交撞上 409）
    await waitFor(() => {
      const after = hook.result.current.messages[hook.result.current.messages.length - 1]
      expect(pendingInteractiveForms(after.toolCalls)).toHaveLength(0)
    })
  })

  test('渲染后的模板文本作为用户这一轮的可见发言进对话（否则会话读起来是用户没说话）', async () => {
    const hook = renderChat({})
    act(() => {
      capturedStreamHandlers.onEvent(startedEvent(1, { callIndex: 1, name: 'ask_user', callId: 'call_a', args: FORM_BLOCK }))
      capturedStreamHandlers.onEvent(awaitingInputEvent(2, { callId: 'call_a', actionId: 'act-a1' }))
    })
    const [entry] = pendingInteractiveForms(
      hook.result.current.messages[hook.result.current.messages.length - 1].toolCalls,
    )

    await act(async () => {
      await hook.result.current.submitInteractiveForm(entry, '补充项目信息：行业=制造业，规模=120', { industry: 'manufacturing', scale: '120' })
    })

    const userTurns = hook.result.current.messages.filter((message) => message.role === 'user')
    expect(userTurns.map((message) => message.text)).toContain('补充项目信息：行业=制造业，规模=120')
  })

  test('缺 actionId 的控件不提交（actionId 只能逐字来自事件，前端不得自拼）', async () => {
    const hook = renderChat({})
    await act(async () => {
      await hook.result.current.submitInteractiveForm({ input: { runId: 'run-b9' } }, 'x', {})
    })
    expect(postedUrls).toEqual([])
  })
})

describe('批次9 · 控件渲染与两份产出', () => {
  test('MessageBubble 渲染工具产生的控件，提交同时交出渲染文本与原始 values', () => {
    const onAskUserSubmit = vi.fn()
    const calls = reduceToolCallTrail(
      [
        startedEvent(1, { callIndex: 1, name: 'ask_user', callId: 'call_a', args: FORM_BLOCK }),
        awaitingInputEvent(2, { callId: 'call_a', actionId: 'act-a1' }),
      ],
      ctx(),
    )
    render(
      <MessageBubble
        message={{ id: 'm1', role: 'assistant', text: '在开始估算前，我需要你补充几项信息。', toolCalls: calls }}
        index={0}
        sending={false}
        onAskUserSubmit={onAskUserSubmit}
      />,
    )

    expect(screen.getByRole('group', { name: '请补充项目信息' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('客户行业'), { target: { value: 'manufacturing' } })
    fireEvent.change(screen.getByLabelText('实施规模'), { target: { value: '120' } })
    fireEvent.click(screen.getByRole('button', { name: '提交补充' }))

    expect(onAskUserSubmit).toHaveBeenCalledTimes(1)
    const [entry, renderedText, values] = onAskUserSubmit.mock.calls[0]
    expect(entry.input.actionId).toBe('act-a1')
    // 模板渲染：{{industry}} / {{scale}} 被替换，单选显示 label 而非 value
    expect(renderedText).toBe('补充项目信息：行业=制造业，规模=120')
    // 结构化原值：进 inputs 端点，不受显示文案影响
    expect(values).toEqual({ industry: 'manufacturing', scale: '120' })
  })

  test('遗留文本抽取控件仍按原样工作（本批不得改动其行为）', () => {
    const onFormSubmit = vi.fn()
    render(
      <MessageBubble
        message={{ id: 'm2', role: 'assistant', text: '请补充', formBlock: FORM_BLOCK }}
        index={0}
        sending={false}
        onFormSubmit={onFormSubmit}
      />,
    )
    fireEvent.change(screen.getByLabelText('客户行业'), { target: { value: 'retail' } })
    fireEvent.change(screen.getByLabelText('实施规模'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: '提交补充' }))
    expect(onFormSubmit).toHaveBeenCalledTimes(1)
    expect(typeof onFormSubmit.mock.calls[0][0]).toBe('string')
  })
})
