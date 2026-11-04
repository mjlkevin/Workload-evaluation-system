import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useWorkbenchState from '../pages/AiHomeWorkbench/hooks/useWorkbenchState.js'
import { getWorkbenchView } from '../api/workbenchView.js'
import { useAiSessions } from '../hooks/useAiSessions.js'

vi.mock('../api/workbenchView.js', () => ({ getWorkbenchView: vi.fn() }))
vi.mock('../hooks/useAiSessions.js', () => ({ useAiSessions: vi.fn() }))
const user = { id: 'user-a', businessRole: 'pre_sales' }
const view = status => ({ runs: [{ runId: 'business-1', sessionId: 'session-a', status }] })
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
let sessions
beforeEach(() => {
  vi.clearAllMocks()
  sessions = { activeSession: { sessionId: 'session-a' }, loadSessions: vi.fn().mockResolvedValue([]) }
  useAiSessions.mockImplementation(() => sessions)
  getWorkbenchView.mockResolvedValue(view('queued'))
})
async function mount() {
  const host = renderHook(({ currentUser }) => useWorkbenchState(currentUser), { initialProps: { currentUser: user } })
  await act(async () => {})
  return host
}
describe('真实工作台Hook的统一视图刷新顺序', () => {
  it('completed刷新先完成后，迟到的waiting响应不能倒退状态', async () => {
    const host = await mount()
    const waiting = deferred(), completed = deferred()
    getWorkbenchView.mockReturnValueOnce(waiting.promise).mockReturnValueOnce(completed.promise)
    let oldRequest, newRequest
    act(() => {
      oldRequest = host.result.current.refreshUnifiedView()
      newRequest = host.result.current.refreshUnifiedView()
    })
    await act(async () => { completed.resolve(view('completed')); await newRequest })
    expect(host.result.current.unifiedView.runs[0].status).toBe('completed')
    await act(async () => { waiting.resolve(view('waiting')); await oldRequest })
    expect(host.result.current.unifiedView.runs[0].status).toBe('completed')
  })
  it('旧请求结束不会关闭新请求的loading或写入旧错误', async () => {
    const host = await mount()
    const old = deferred(), current = deferred()
    getWorkbenchView.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    let oldRequest, newRequest
    act(() => {
      oldRequest = host.result.current.refreshUnifiedView()
      newRequest = host.result.current.refreshUnifiedView()
    })
    await act(async () => { old.reject(new Error('旧请求失败')); await oldRequest })
    expect(host.result.current.unifiedViewError).toBe('')
    expect(host.result.current.unifiedViewLoading).toBe(true)
    await act(async () => { current.resolve(view('completed')); await newRequest })
    expect(host.result.current.unifiedViewLoading).toBe(false)
  })
  it.each([false, true])('会话切换后旧请求失效，包含A→B→A（%s）', async returnToA => {
    const host = await mount()
    const old = deferred()
    getWorkbenchView.mockReturnValueOnce(old.promise)
    let request
    act(() => { request = host.result.current.refreshUnifiedView() })
    sessions.activeSession = { sessionId: 'session-b' }
    host.rerender({ currentUser: user })
    if (returnToA) {
      sessions.activeSession = { sessionId: 'session-a' }
      host.rerender({ currentUser: user })
    }
    let outcome
    await act(async () => { old.resolve(view('waiting')); outcome = await request })
    expect(outcome).toBeNull()
    expect(host.result.current.unifiedView.runs[0].status).toBe('queued')
    expect(host.result.current.unifiedViewLoading).toBe(false)
  })
  it('卸载后迟到的请求返回失效，不再提交统一视图', async () => {
    const host = await mount()
    const old = deferred()
    getWorkbenchView.mockReturnValueOnce(old.promise)
    let request
    act(() => { request = host.result.current.refreshUnifiedView() })
    host.unmount()
    let outcome
    await act(async () => { old.resolve(view('completed')); outcome = await request })
    expect(outcome).toBeNull()
  })
  it('初始读取期间切换会话会补拉当前视图，避免旧请求失效后一直空白', async () => {
    const old = deferred()
    getWorkbenchView.mockReturnValueOnce(old.promise).mockResolvedValueOnce(view('completed'))
    const host = await mount()
    sessions.activeSession = { sessionId: 'session-b' }
    host.rerender({ currentUser: user })
    await act(async () => {})
    expect(getWorkbenchView).toHaveBeenCalledTimes(2)
    expect(host.result.current.unifiedView.runs[0].status).toBe('completed')
    await act(async () => old.resolve(view('waiting')))
    expect(host.result.current.unifiedView.runs[0].status).toBe('completed')
  })
})
