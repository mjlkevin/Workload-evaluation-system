/**
 * DEF-2026-08-27-003：带文件发送超时导致消息与附件一起丢失 —— 顺序倒转回归守护。
 *
 * 缺陷实证：useChatMessages.sendMessage 里 `/ai/parse-basic-info` 的同步阻塞解析
 * 排在 createSession 之前，新会话首次带文件发送一旦解析超时，会话从未被创建，
 * 用户刚输入的文字与刚上传的文件一起消失——无痕迹、不可恢复。
 *
 * 修复契约（方案①顺序倒转）：
 * - 会话创建必须先于附件解析调用（不变式，不是代码形态）；
 * - 解析失败/超时时用户消息（含附件占位）已落库，本地视图仍显示附件卡片；
 * - 失败气泡带「点击重试」入口，且重试免重选（复用同一个 File 对象）；
 * - 解析调用必须带客户端有界超时（apiClient 默认 timeoutMs=0 即永不超时，是无限等待根因）；
 * - 成功路径不得由前端重复落用户消息（后端 Run 链路按 run 维度 dedup 自行追加，双份即回归）。
 *
 * 断言口径：全部无条件执行，不存在 if (x.ok) { assert } 形态。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { apiClient } from '../api/client.js'
import { submitRun } from '../api/aiRuns.js'
import { sessionRuntimeStore } from '../hooks/useSessionRuntimeStore.js'
import MessageBubble from '../pages/AiHomeWorkbench/components/ChatArea/MessageBubble.jsx'
import useChatMessages from '../pages/AiHomeWorkbench/hooks/useChatMessages.js'

vi.mock('../api/client.js', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
}))

vi.mock('../api/aiRuns.js', () => ({
  submitRun: vi.fn(),
}))

vi.mock('../hooks/useBackgroundRuns.jsx', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useRunEventStream: () => undefined }
})

const SESSION_ID = 's-def003'
const FILE_NAME = '需求清单.xlsx'
const USER_TEXT = '帮我评估这个项目的实施工作量'
const TIMEOUT_ERROR = new Error('请求超时，请稍后重试')
const PARSED_OK = {
  code: 0,
  message: 'ok',
  data: { basicInfo: { fileName: FILE_NAME, projectName: 'DEF-003 测试项目' } },
}

function parseTimeout() {
  return () => Promise.reject(TIMEOUT_ERROR)
}

function parseSucceeds() {
  return () => Promise.resolve(PARSED_OK)
}

/** 第 1 次解析失败、其后成功：用于验证「点击重试免重选」. */
function parseFailsOnceThenSucceeds() {
  return () => (apiClient.upload.mock.calls.length === 1
    ? Promise.reject(TIMEOUT_ERROR)
    : Promise.resolve(PARSED_OK))
}

function makeXlsx() {
  return new File(['sheet-bytes'], FILE_NAME, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/**
 * 忠实模拟 useAiSessions.createSession：落库后 upsertSession 会把会话置为激活态，
 * 失败气泡的 writeArrivalMessage 归属判断依赖该事实。
 */
function createWorkbench(overrides = {}) {
  const workbench = {
    activeSession: null,
    activeWorkflowKey: '',
    unifiedView: { runs: [] },
    composer: '',
    selectedFile: null,
    setComposer: vi.fn(),
    clearComposerDraft: vi.fn(),
    setDraftBeforeLogin: vi.fn(),
    setSelectedFile: vi.fn(),
    loadSessions: vi.fn(async () => undefined),
    refreshUnifiedView: vi.fn(async () => undefined),
    upsertSession: vi.fn(),
    createSession: vi.fn(async (input) => {
      const session = { sessionId: SESSION_ID, ...input }
      workbench.activeSession = session
      return session
    }),
    ...overrides,
  }
  return workbench
}

/**
 * 渲染工作台 hook 并发出一条带文件的消息。
 * parse 决定附件解析的成败，standardDraftPost 决定标准治理解析端点的成败。
 */
async function sendWithFile({ parse = parseTimeout(), file = makeXlsx(), selectedFile = file, text = USER_TEXT } = {}) {
  apiClient.upload.mockImplementation(parse)
  apiClient.post.mockImplementation(async () => ({ code: 0, data: {} }))
  submitRun.mockResolvedValue({ runId: 'run-def003' })
  const workbench = createWorkbench({ selectedFile })
  const hook = renderHook(() => useChatMessages(workbench))
  await act(async () => {
    await hook.result.current.sendMessage(text)
  })
  return { hook, workbench, file }
}

function userEventAppends() {
  return apiClient.post.mock.calls
    .filter(([path, body]) => path === `/ai-sessions/${SESSION_ID}/events` && body?.message?.role === 'user')
}

function failureBubbles(hook) {
  return hook.result.current.messages.filter((message) => message.action === 'retry_parse')
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionRuntimeStore.resetAllSessionViews()
})

describe('DEF-003 顺序倒转：新会话带文件发送超时不得丢会话与消息', () => {
  test('会话创建先于附件解析调用（顺序不变式）', async () => {
    const { workbench } = await sendWithFile()

    expect(workbench.createSession).toHaveBeenCalledTimes(1)
    expect(apiClient.upload).toHaveBeenCalledTimes(1)
    expect(workbench.createSession.mock.invocationCallOrder[0])
      .toBeLessThan(apiClient.upload.mock.invocationCallOrder[0])
  })

  test('解析超时后用户消息与附件占位已落库，且落库发生在解析失败之后', async () => {
    const file = makeXlsx()
    const { hook } = await sendWithFile({ file })

    const appends = userEventAppends()
    expect(appends).toHaveLength(1)
    expect(appends[0][1].message.content).toBe(USER_TEXT)
    expect(appends[0][1].attachments).toHaveLength(1)
    expect(appends[0][1].attachments[0].name).toBe(FILE_NAME)
    expect(appends[0][1].attachments[0].size).toBe(file.size)

    const appendIndex = apiClient.post.mock.calls.indexOf(appends[0])
    expect(apiClient.upload.mock.invocationCallOrder[0])
      .toBeLessThan(apiClient.post.mock.invocationCallOrder[appendIndex])
    expect(failureBubbles(hook)).toHaveLength(1)
  })

  test('解析超时后本地视图仍可见用户消息与附件卡片（无痕迹 → 有痕迹）', async () => {
    const { hook } = await sendWithFile()

    const userBubble = hook.result.current.messages.find((message) => message.role === 'user')
    expect(userBubble).toBeTruthy()
    expect(userBubble.text).toBe(USER_TEXT)
    expect(userBubble.file?.name).toBe(FILE_NAME)
  })

  test('失败气泡提供重试入口，且入口带可寻址的 retryId', async () => {
    const { hook } = await sendWithFile()

    const failures = failureBubbles(hook)
    expect(failures).toHaveLength(1)
    expect(failures[0].error).toBe(true)
    expect(typeof failures[0].retryId).toBe('string')
    expect(failures[0].retryId.length).toBeGreaterThan(0)
    expect(typeof hook.result.current.retryAttachmentParse).toBe('function')
    // loading 占位不得继续伪装「正在处理」
    expect(failures[0].loading).toBeFalsy()
    expect(hook.result.current.messages.some((message) => message.loading)).toBe(false)
  })

  test('解析调用带客户端有界超时（默认 0＝永不超时是无限等待根因）', async () => {
    await sendWithFile()

    const options = apiClient.upload.mock.calls[0][2]
    expect(Number.isFinite(options.timeoutMs)).toBe(true)
    expect(options.timeoutMs).toBeGreaterThan(0)
  })

  test('点击重试免重选：复用同一个 File 对象，不重复建会话', async () => {
    const file = makeXlsx()
    const { hook, workbench } = await sendWithFile({ file, parse: parseFailsOnceThenSucceeds() })

    await act(async () => {
      await hook.result.current.retryAttachmentParse(failureBubbles(hook)[0].retryId)
    })

    expect(apiClient.upload).toHaveBeenCalledTimes(2)
    expect(apiClient.upload.mock.calls[1][1].get('file')).toBe(file)
    // 会话复用本轮已创建的会话，未二次建会话
    expect(workbench.createSession).toHaveBeenCalledTimes(1)
    expect(submitRun).toHaveBeenCalledTimes(1)
    expect(submitRun.mock.calls[0][0]).toBe(SESSION_ID)
  })

  test('重试再次失败仍可继续重试（失败态不一次性耗尽，File 仍免重选）', async () => {
    const file = makeXlsx()
    const { hook } = await sendWithFile({ file })

    await act(async () => {
      await hook.result.current.retryAttachmentParse(failureBubbles(hook)[0].retryId)
    })
    expect(apiClient.upload).toHaveBeenCalledTimes(2)

    const retryable = failureBubbles(hook)
    expect(retryable).toHaveLength(1)
    await act(async () => {
      await hook.result.current.retryAttachmentParse(retryable[0].retryId)
    })

    expect(apiClient.upload).toHaveBeenCalledTimes(3)
    expect(apiClient.upload.mock.calls[1][1].get('file')).toBe(file)
    expect(apiClient.upload.mock.calls[2][1].get('file')).toBe(file)
  })

  test('失败落库幂等：多次重试不重复追加同一条用户消息', async () => {
    const { hook } = await sendWithFile()

    await act(async () => {
      await hook.result.current.retryAttachmentParse(failureBubbles(hook)[0].retryId)
    })
    await act(async () => {
      await hook.result.current.retryAttachmentParse(failureBubbles(hook)[0].retryId)
    })

    expect(userEventAppends()).toHaveLength(1)
  })

  test('解析成功路径不由前端落用户消息（后端 Run 链路自行追加，双份即回归）', async () => {
    const { hook } = await sendWithFile({ parse: parseSucceeds() })

    expect(apiClient.upload).toHaveBeenCalledTimes(1)
    expect(submitRun).toHaveBeenCalledTimes(1)
    expect(userEventAppends()).toHaveLength(0)
    expect(failureBubbles(hook)).toHaveLength(0)
  })

  test('解析阶段 401 仍走登录过期入口，不被重试态抢走', async () => {
    const unauthorized = Object.assign(new Error('登录已过期'), { status: 401 })
    const { hook } = await sendWithFile({ parse: () => Promise.reject(unauthorized) })

    expect(failureBubbles(hook)).toHaveLength(0)
    const loginBubble = hook.result.current.messages.find((message) => message.error && message.role === 'assistant')
    expect(loginBubble).toBeTruthy()
    expect(loginBubble.action).toBe('login_required')
    expect(loginBubble.text).toContain('登录已过期')
  })

  test('解析失败气泡文案带上真实错误原因（不只说「未完成」）', async () => {
    const badFile = Object.assign(new Error('参数错误'), { status: 400, details: [{ field: 'file', reason: 'not_a_workbook' }] })
    const { hook } = await sendWithFile({ parse: () => Promise.reject(badFile) })

    const failures = failureBubbles(hook)
    expect(failures).toHaveLength(1)
    expect(failures[0].text).toContain('参数错误')
    expect(failures[0].text).toContain('无需重新选择文件')
  })

  test('不带文件发送：行为不变（不触发解析、不落失败事件）', async () => {
    const { hook, workbench } = await sendWithFile({ selectedFile: null })

    expect(apiClient.upload).not.toHaveBeenCalled()
    expect(workbench.createSession).toHaveBeenCalledTimes(1)
    expect(submitRun).toHaveBeenCalledTimes(1)
    expect(failureBubbles(hook)).toHaveLength(0)
  })
})

describe('DEF-003 §3.1：L470 标准治理建会话点同口径可恢复', () => {
  /** 该点 createSession 已在网络调用之前，缺口只在失败态无免重选重试入口。 */
  function attachStandardFile() {
    const file = makeXlsx()
    apiClient.post.mockRejectedValueOnce(new Error('标准文件解析失败'))
    const workbench = createWorkbench({ activeWorkflowKey: 'standard_governance' })
    const hook = renderHook(() => useChatMessages(workbench))
    act(() => {
      hook.result.current.attachFile(file)
    })
    return { hook, workbench, file }
  }

  test('标准文件解析失败气泡带重试入口', async () => {
    const { hook } = attachStandardFile()

    await waitFor(() => {
      expect(failureBubbles(hook)).toHaveLength(1)
    })
    expect(apiClient.post).toHaveBeenCalledWith(
      `/ai-sessions/${SESSION_ID}/standard-drafts`,
      expect.objectContaining({ fileName: FILE_NAME }),
      expect.anything(),
    )
    const failures = failureBubbles(hook)
    expect(failures).toHaveLength(1)
    expect(failures[0].error).toBe(true)
    expect(typeof failures[0].retryId).toBe('string')
  })

  test('标准文件重试免重选：沿用同一文件名重新发起解析，成功后失败气泡不驻留', async () => {
    const { hook, file } = attachStandardFile()
    await waitFor(() => {
      expect(failureBubbles(hook)).toHaveLength(1)
    })

    apiClient.post.mockResolvedValue({ code: 0, data: {} })
    await act(async () => {
      await hook.result.current.retryAttachmentParse(failureBubbles(hook)[0].retryId)
    })

    expect(apiClient.post).toHaveBeenCalledTimes(2)
    expect(apiClient.post.mock.calls[1][0]).toBe(`/ai-sessions/${SESSION_ID}/standard-drafts`)
    expect(apiClient.post.mock.calls[1][1]).toEqual(expect.objectContaining({
      fileName: FILE_NAME,
      fileSize: file.size,
    }))
    expect(failureBubbles(hook)).toHaveLength(0)
  })
})

describe('DEF-003 重试入口的可达性', () => {
  test('失败气泡渲染出可点击、有无障碍名称的「重试」按钮', () => {
    const onRetryParse = vi.fn()
    render(
      <MessageBubble
        index={0}
        message={{ id: 'm1', role: 'assistant', text: '文件解析未完成', error: true, action: 'retry_parse', retryId: 'retry-1' }}
        sending={false}
        confirmingActionId={null}
        onRetryParse={onRetryParse}
      />,
    )

    const button = screen.getByRole('button', { name: /重试/ })
    fireEvent.click(button)
    expect(onRetryParse).toHaveBeenCalledWith('retry-1')
  })

  test('非重试态气泡不渲染重试按钮（零噪声）', () => {
    render(
      <MessageBubble
        index={0}
        message={{ id: 'm2', role: 'assistant', text: '普通失败', error: true }}
        sending={false}
        confirmingActionId={null}
        onRetryParse={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: /重试/ })).toBeNull()
  })
})
