import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BackgroundRunProvider, useBackgroundRuns } from '../hooks/useBackgroundRuns.jsx'
import { sessionRuntimeStore } from '../hooks/useSessionRuntimeStore.js'
import AiHomeWorkbench from '../pages/AiHomeWorkbench/index.jsx'
import useWorkbenchState from '../pages/AiHomeWorkbench/hooks/useWorkbenchState.js'
import * as runsApi from '../api/aiRuns.js'
import * as businessApi from '../api/businessExecutions.js'

vi.mock('../api/aiRuns.js', () => ({ listActiveRuns: vi.fn(), getRunSnapshot: vi.fn(), subscribeRunEvents: vi.fn(), cancelRun: vi.fn(), isTerminalRunEvent: type => ['run_completed', 'run_failed', 'run_cancelled'].includes(type) }))
vi.mock('../api/businessExecutions.js')
vi.mock('../pages/AiHomeWorkbench/hooks/useWorkbenchState.js', () => ({ default: vi.fn() }))
vi.mock('../pages/AiHomeWorkbench/hooks/useChatMessages.js', () => ({ default: () => ({ messages: [], bindHarness() {} }) }))
vi.mock('../pages/AiHomeWorkbench/hooks/useHarnessRun.js', () => ({ default: () => ({}) }))
vi.mock('../components/AiWorkbench/SessionRail.jsx', () => ({ default: () => null }))
vi.mock('../pages/AiHomeWorkbench/components/ChatArea/WorkflowTemplates.jsx', () => ({ default: () => null }))
vi.mock('../pages/AiHomeWorkbench/components/WorkspacePanel/index.jsx', () => ({ default: ({ children }) => children }))
vi.mock('../pages/AiHomeWorkbench/components/SkillInvocationDialog.jsx', () => ({ default: ({ open, onStarted }) => open && <button onClick={onStarted}>模拟服务端启动成功</button> }))
vi.mock('../pages/AiHomeWorkbench/components/ChatArea/index.jsx', () => ({ default: ({ business, invocation }) => {
  const { runs, refresh: onRefresh, submitInput: onInput, decide: onDecision, retry: onRetry, stop: onStop } = business
  return <>
  <button onClick={() => invocation.selectTask({kind:"skill",id:"skill-a",name:"测试",inputSchema:{type:"object",properties:{}}})}>选择测试任务</button><button onClick={invocation.send}>发送测试任务</button>
  <output data-testid="business-status">{runs.map(run => run.status).join(',')}</output>
  <button onClick={onRefresh}>刷新业务状态</button>
  <button onClick={() => onInput('business-1', {}, {})}>业务输入</button>
  <button onClick={() => onDecision('business-1', {}, 'confirm')}>业务确认</button>
  <button onClick={() => onRetry('business-1', {})}>业务重试</button>
  <button onClick={() => onStop('business-1')}>业务停止</button>
</> } }))

const activeRun = { runId: 'business-1', sessionId: 'session-a', title: '业务流程', status: 'queued' }
let subscriptions
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionRuntimeStore.resetAllSessionViews()
  subscriptions = new Map()
  runsApi.listActiveRuns.mockResolvedValue({ enabled: true, failed: false, runs: [activeRun] })
  runsApi.getRunSnapshot.mockResolvedValue({ run: activeRun, businessExecution: { kind: 'workflow', target: { name: '业务流程' } } })
  runsApi.subscribeRunEvents.mockImplementation((id, callbacks) => {
    subscriptions.set(id, callbacks)
    return { abort: vi.fn() }
  })
  businessApi.listBusinessRuns.mockResolvedValue([])
})

describe('业务等待事件同步现有后台任务状态', () => {
  function Probe() {
    const { runs, notifyRunsChanged } = useBackgroundRuns()
    return <><output>{runs[0]?.status || 'empty'}</output><button onClick={notifyRunsChanged}>刷新后台任务</button></>
  }
  async function mountProvider() {
    const host = render(<BackgroundRunProvider><Probe /></BackgroundRunProvider>)
    await screen.findByText('queued')
    await waitFor(() => expect(subscriptions.has('business-1')).toBe(true))
    return host
  }
  function emit(eventType, sequence) {
    act(() => subscriptions.get('business-1').onEvent({ eventType, sequence, payload: {} }))
  }
  it.each(['workflow.awaiting_input', 'workflow.awaiting_confirmation'])('%s立即更新会话等待徽标，回答后回到排队', async eventType => {
    await mountProvider()
    emit(eventType, 1)
    await screen.findByText('waiting')
    expect(sessionRuntimeStore.getSessionView('session-a').runStatus).toBe('waiting')
    emit('workflow.answer_recorded', 2)
    await screen.findByText('queued')
    expect(sessionRuntimeStore.getSessionView('session-a').runStatus).toBe('queued')
    expect(runsApi.cancelRun).not.toHaveBeenCalled()
  })
  it('迟到的初始快照不能覆盖较新的等待事件', async () => {
    let release
    runsApi.getRunSnapshot.mockImplementation(() => new Promise(resolve => { release = resolve }))
    await mountProvider()
    emit('workflow.awaiting_input', 3)
    await screen.findByText('waiting')
    await act(async () => release({ run: activeRun }))
    expect(screen.getByText('waiting')).toBeInTheDocument()
  })
  it('等待事件发生前发出的列表请求不能把状态倒回排队', async () => {
    let release
    await mountProvider()
    runsApi.listActiveRuns.mockImplementation(() => new Promise(resolve => { release = resolve }))
    fireEvent.click(screen.getByRole('button', { name: '刷新后台任务' }))
    await waitFor(() => expect(release).toBeTypeOf('function'))
    emit('workflow.awaiting_confirmation', 5)
    await act(async () => release({ enabled: true, failed: false, runs: [activeRun] }))
    expect(screen.getByText('waiting')).toBeInTheDocument()
  })
  it('较新的列表状态不能被迟到的初始快照覆盖', async () => {
    let release
    runsApi.getRunSnapshot.mockImplementation(() => new Promise(resolve => { release = resolve }))
    await mountProvider()
    runsApi.listActiveRuns.mockResolvedValue({ enabled: true, failed: false, runs: [{ ...activeRun, status: 'waiting' }] })
    fireEvent.click(screen.getByRole('button', { name: '刷新后台任务' }))
    await screen.findByText('waiting')
    await act(async () => release({ run: activeRun }))
    expect(screen.getByText('waiting')).toBeInTheDocument()
  })
  it('卸载后迟到事件和快照不再写会话状态或刷新', async () => {
    let release
    runsApi.getRunSnapshot.mockImplementation(() => new Promise(resolve => { release = resolve }))
    const host = await mountProvider()
    host.unmount()
    emit('workflow.awaiting_input', 6)
    emit('workflow.answer_recorded', 7)
    await act(async () => release({ run: { ...activeRun, status: 'waiting' } }))
    expect(sessionRuntimeStore.getSessionView('session-a').runStatus).toBe('queued')
    expect(runsApi.listActiveRuns).toHaveBeenCalledTimes(1)
  })
})

describe('业务执行与统一视图计数对账', () => {
  let serverRuns, refreshUnifiedView, workbench
  beforeEach(() => {
    serverRuns = []
    refreshUnifiedView = vi.fn()
    workbench = { activeSession: { sessionId: 'session-a' }, sessions: [], preset: { workflows: [] }, workspacePanelCollapsed: false, composer: '真实提示词', setComposer: vi.fn(), setSelectedFile: vi.fn() }
    businessApi.listExecutionCatalog.mockResolvedValue([{kind:"skill",id:"skill-a",name:"测试",inputSchema:{type:"object",properties:{}}}])
    businessApi.sendSkillConversation.mockResolvedValue({action:"execute",run:{runId:"business-1"}})
    businessApi.listBusinessRuns.mockImplementation(async id => serverRuns.filter(run => run.sessionId === id))
    runsApi.getRunSnapshot.mockImplementation(async id => ({ run: serverRuns.find(run => run.runId === id), businessExecution: { kind: 'workflow', target: { name: '业务流程' } } }))
    useWorkbenchState.mockImplementation(() => {
      const [unifiedView, setView] = useState({ runs: [] })
      refreshUnifiedView.mockImplementation(async () => { setView({ runs: [...serverRuns] }); return { runs: [...serverRuns] } })
      return { ...workbench, unifiedView, refreshUnifiedView }
    })
  })
  it('启动成功立即刷新统一视图，即使业务面板列表暂未出现新任务', async () => {
    workbench.workspacePanelCollapsed = true
    workbench.toggleWorkspacePanel = vi.fn()
    render(<AiHomeWorkbench />)
    serverRuns = [activeRun]
    businessApi.listBusinessRuns.mockResolvedValue([])
    fireEvent.click(screen.getByRole('button', { name: '选择测试任务' }))
    fireEvent.click(screen.getByRole('button', { name: '发送测试任务' }))
    expect(await screen.findByText('后台任务 进行中 1 · 已完成 0')).toBeInTheDocument()
    expect(refreshUnifiedView).toHaveBeenCalled()
    expect(workbench.toggleWorkspacePanel).not.toHaveBeenCalled()
  })
  it.each(['业务输入', '业务确认', '业务重试', '业务停止'])('%s后的服务端状态更新顶部计数，重复刷新不再请求统一视图', async name => {
    serverRuns = [{ ...activeRun, status: 'waiting' }]
    const host = render(<AiHomeWorkbench />)
    await waitFor(() => expect(screen.getByTestId('business-status')).toHaveTextContent('waiting'))
    await screen.findByText('后台任务 进行中 1 · 已完成 0')
    const settle = async () => { serverRuns = [{ ...activeRun, status: 'completed' }] }
    businessApi.submitBusinessInput.mockImplementation(settle)
    businessApi.decideBusinessAction.mockImplementation(settle)
    businessApi.retryBusinessExecution.mockImplementation(settle)
    runsApi.cancelRun.mockImplementation(settle)
    fireEvent.click(screen.getByRole('button', { name }))
    await screen.findByText('后台任务 进行中 0 · 已完成 1')
    const calls = refreshUnifiedView.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '刷新业务状态' }))
    await waitFor(() => expect(businessApi.listBusinessRuns.mock.calls.length).toBe(3))
    expect(refreshUnifiedView).toHaveBeenCalledTimes(calls)
    host.unmount()
  })
  it('切换会话后迟到的旧业务状态不触发统一视图刷新', async () => {
    let release
    businessApi.listBusinessRuns.mockImplementation(id => id === 'session-a' ? new Promise(resolve => { release = resolve }) : Promise.resolve([]))
    const host = render(<AiHomeWorkbench />)
    workbench.activeSession = { sessionId: 'session-b' }
    host.rerender(<AiHomeWorkbench />)
    await waitFor(() => expect(businessApi.listBusinessRuns).toHaveBeenCalledWith('session-b'))
    await act(async () => release([activeRun]))
    expect(refreshUnifiedView).not.toHaveBeenCalled()
    expect(screen.getByTestId('business-status')).toBeEmptyDOMElement()
  })
})
