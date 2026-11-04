import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import AiHomeWorkbench from '../pages/AiHomeWorkbench/index.jsx'
import useWorkbenchState from '../pages/AiHomeWorkbench/hooks/useWorkbenchState.js'
import useChatMessages from '../pages/AiHomeWorkbench/hooks/useChatMessages.js'
import useBusinessExecution from '../pages/AiHomeWorkbench/hooks/useBusinessExecution.js'
import MessageList from '../pages/AiHomeWorkbench/components/ChatArea/MessageList.jsx'

vi.mock('../pages/AiHomeWorkbench/hooks/useWorkbenchState.js')
vi.mock('../pages/AiHomeWorkbench/hooks/useChatMessages.js')
vi.mock('../pages/AiHomeWorkbench/hooks/useBusinessExecution.js')
vi.mock('../pages/AiHomeWorkbench/hooks/useHarnessRun.js', () => ({ default: () => ({}) }))
vi.mock('../hooks/useBackgroundRuns.jsx', () => ({ useBackgroundRuns: () => ({ runs: [], notifyRunsChanged() {} }) }))
vi.mock('../components/AiWorkbench/SessionRail.jsx', () => ({ default: () => null }))

const pending = { kind: 'userInput', stepId: 'review', actionId: 'ask', contentHash: 'hash', prompt: '请补充实际组织数', outputSchema: { type: 'object', properties: { count: { type: 'integer', title: '组织数量' } } } }
const fact = (id, kind, content, extra = {}) => ({ id, kind, title: id, role: ['answer', 'decision'].includes(kind) ? 'user' : 'assistant', status: 'succeeded', runId: 'run-a', content, ...extra })
const snapshot = () => ({ runId: 'run-a', sessionId: 's1', status: 'waiting', businessExecution: {
  target: { name: '实际业务任务', versionId: 'actual-version' }, currentStep: { id: 'review', name: '当前核对阶段' }, pendingInput: pending,
  timeline: { version: 1, rootRunId: 'root-a', coverage: 'complete', entries: [
    fact('实际分析阶段', 'stage', { summary: '真实分析依据' }, { stageId: '实际分析阶段' }),
    fact('实际工具', 'tool_result', { value: 7 }, { stageId: '实际分析阶段' }),
    fact('旧问题', 'question', { prompt: '原先的问题' }, { status: 'answered' }),
    fact('旧回答', 'answer', { count: 2 }), fact('旧决定', 'decision', { approved: false }, { status: 'rejected' }),
  ] }, results: {},
} })
let workbench, chat, business
beforeEach(() => {
  workbench = { activeSession: { sessionId: 's1' }, sessions: [], unifiedView: { runs: [] }, workspacePanelCollapsed: false,
    preset: { label: '业务角色', workflows: [{ key: 'role-template', title: '原角色模板' }] }, outputState: { title: '旧输出占位', activeTitle: '旧输出占位', outputs: [] },
    composer: '', setComposer: vi.fn(), startWorkflow: vi.fn(), refreshUnifiedView: vi.fn(), toggleWorkspacePanel: vi.fn(),
  }
  chat = { messages: [{ id: 'ordinary', role: 'user', text: '普通消息原文' }], bindHarness() {}, sendMessage: vi.fn(), chooseFile: vi.fn(), messagePaneRef: { current: null } }
  business = { runs: [snapshot()], submitInput: vi.fn(), decide: vi.fn(), refresh: vi.fn(), stop: vi.fn(), retry: vi.fn() }
  useWorkbenchState.mockImplementation(() => workbench)
  useChatMessages.mockImplementation(() => chat)
  useBusinessExecution.mockImplementation(() => business)
})
const mount = () => render(<MemoryRouter><AiHomeWorkbench /></MemoryRouter>)
it('实际中央消息混排普通消息、真实阶段、回答与拒绝；只有当前问题开放表单', async () => {
  mount()
  const pane = screen.getByTestId('ai-home-message-pane')
  expect(within(pane).getByText('普通消息原文')).toBeInTheDocument()
  for (const text of ['实际分析阶段', '原先的问题', '旧回答', '已拒绝', '请补充实际组织数']) expect(within(pane).getAllByText(text).length).toBeGreaterThan(0)
  expect(within(pane).getAllByRole('spinbutton')).toHaveLength(1)
  expect(within(pane).getAllByRole('button', { name: '停止执行' })).toHaveLength(1)
  expect(screen.getAllByRole('button', { name: '停止执行' })).toHaveLength(1)
  expect(within(pane).getByText('执行信息').closest('details')).not.toHaveAttribute('open')
  expect(within(pane).getByText('版本：actual-version')).toBeInTheDocument()
  expect(within(pane).queryByText('真实分析依据')).not.toBeInTheDocument()
  expect(within(pane).getByText('分析与工具明细').closest('details')).not.toHaveAttribute('open')
  fireEvent.change(within(pane).getByRole('spinbutton'), { target: { value: '4' } })
  fireEvent.click(within(pane).getByRole('button', { name: '提交补充信息' }))
  await waitFor(() => expect(business.submitInput).toHaveBeenCalledWith('run-a', pending, { count: 4 }))
})
it('右侧仅摘要，定位当前问题后中央记录获得焦点；角色模板与附件入口保留', () => {
  mount()
  const right = screen.getByRole('complementary', { name: 'AI 工作区' })
  expect(within(right).getByText('任务摘要')).toBeInTheDocument()
  expect(within(right).getByText('实际业务任务')).toBeInTheDocument()
  expect(within(right).getByText('当前核对阶段')).toBeInTheDocument()
  expect(within(right).queryByRole('spinbutton')).not.toBeInTheDocument()
  expect(within(right).queryByText('实际分析阶段')).not.toBeInTheDocument()
  expect(within(right).queryByText('旧输出占位')).not.toBeInTheDocument()
  fireEvent.click(within(right).getByRole('button', { name: '定位待处理（1）' }))
  expect(document.activeElement.closest('[data-testid="ai-home-message-pane"]')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '原角色模板' }))
  expect(workbench.startWorkflow).toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '附加文件' }))
  expect(chat.chooseFile).toHaveBeenCalled()
})
it('最终结果只在中央呈现，摘要定位最终结果；每个执行根仅有一组当前动作', () => {
  const parent = snapshot(), child = snapshot()
  parent.status = 'failed'; child.runId = 'run-b'; child.status = 'completed'; child.createdAt = '2026-11-04T00:00:02Z'
  child.businessExecution = { ...child.businessExecution, pendingInput: undefined, results: { output: { title: '实际最终结果' } } }
  business.runs = [parent, child]
  mount()
  const right = screen.getByRole('complementary', { name: 'AI 工作区' })
  expect(screen.getByTestId('ai-home-message-pane')).toHaveTextContent('实际最终结果')
  expect(within(right).queryByText('实际最终结果')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '重试执行' })).not.toBeInTheDocument()
  fireEvent.click(within(right).getByRole('button', { name: '定位结果' }))
  expect(document.activeElement).toHaveTextContent('实际最终结果')
})
it('业务加载错误在中央仅显示一次，已有业务标识时隐藏旧占位且保留普通消息', () => {
  business.runs = []; business.error = '快照暂不可用'; business.loading = true
  workbench.unifiedView.runs = [{ runId: 'failed-read', sessionId: 's1', hasBusinessExecution: true }]
  mount()
  expect(screen.getAllByText('快照暂不可用')).toHaveLength(1)
  expect(screen.getByTestId('ai-home-message-pane')).toHaveTextContent('快照暂不可用')
  expect(screen.getByText('普通消息原文')).toBeInTheDocument()
  expect(screen.queryByText('旧输出占位')).not.toBeInTheDocument()
})
it('普通会话继续使用旧工作区，不受其他会话业务标识影响', () => {
  business.runs = []
  workbench.unifiedView.runs = [{ runId: 'foreign', sessionId: 'other', hasBusinessExecution: true }]
  mount()
  expect(screen.getByText('旧输出占位')).toBeInTheDocument()
  expect(screen.queryByText('任务摘要')).not.toBeInTheDocument()
})
it('轮询和展开不把阅读旧记录的用户拉到底部；回到底部后继续跟随，切换会话重置', () => {
  const paneRef = { current: null }, message = { id: 'chat', role: 'user', text: '旧消息' }
  const props = { paneRef, messages: [message], outputState: { outputs: [] }, bubbleProps: {}, sessionId: 's1' }
  const host = render(<MessageList {...props} />), pane = paneRef.current
  Object.defineProperties(pane, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 } })
  pane.scrollTop = 100; fireEvent.scroll(pane)
  host.rerender(<MessageList {...props} messages={[message, { ...message, id: 'next' }]} />)
  expect(pane.scrollTop).toBe(100)
  pane.scrollTop = 790; fireEvent.scroll(pane)
  host.rerender(<MessageList {...props} messages={[{ ...message, text: '新消息' }]} />)
  expect(pane.scrollTop).toBe(1000)
  pane.scrollTop = 100; fireEvent.scroll(pane)
  host.rerender(<MessageList {...props} sessionId="s2" />)
  expect(pane.scrollTop).toBe(1000)
})
it.each([1, 0])('用户激活summary（click.detail=%s）展开延迟挂载长明细后，未滚动位置跨轮询保持；主动到底或折叠后恢复跟随', clickDetail => {
  const longAnalysis = '实际分析依据。'.repeat(100)
  business.runs[0].businessExecution.timeline.entries[0].content = { summary: longAnalysis }
  const host = mount(), pane = chat.messagePaneRef.current
  const details = within(pane).getByText('分析与工具明细').closest('details')
  Object.defineProperties(pane, {
    // Collapsed mounts its children only after onToggle. At capture time, height is still short.
    scrollHeight: { configurable: true, get: () => details.open && within(details).queryByText(longAnalysis) ? 1800 : 1000 },
    clientHeight: { configurable: true, value: 200 },
  })
  const poll = () => {
    business.runs = [...business.runs]
    host.rerender(<MemoryRouter><AiHomeWorkbench /></MemoryRouter>)
  }
  pane.scrollTop = 800; fireEvent.scroll(pane)
  fireEvent.click(details.querySelector('summary'), { detail: clickDetail })
  fireEvent(details, new Event('toggle'))
  expect(within(details).getByText(longAnalysis)).toBeInTheDocument()
  expect(pane.scrollHeight).toBe(1800)
  // No scroll event occurs between expanding and the server snapshot refresh.
  poll()
  expect(pane.scrollTop).toBe(800)
  pane.scrollTop = 1600; fireEvent.scroll(pane)
  poll()
  expect(pane.scrollTop).toBe(1800)
  pane.scrollTop = 800
  fireEvent.click(details.querySelector('summary'), { detail: clickDetail })
  fireEvent(details, new Event('toggle'))
  poll()
  expect(pane.scrollTop).toBe(1000)
})
it('初始默认展开的输入范围不关闭跟随：未溢出的会话无滚动事件，后续轮询新增内容仍跟随到底', () => {
  business.runs[0].businessExecution.pendingInput = { ...pending, displayInput: { scope: '真实默认展开范围' } }
  const host = mount(), pane = chat.messagePaneRef.current
  const details = within(pane).getByText('本次范围与输入').closest('details')
  let height = 200
  Object.defineProperties(pane, {
    scrollHeight: { configurable: true, get: () => height },
    clientHeight: { configurable: true, value: 400 },
  })
  expect(details).toHaveAttribute('open')
  expect(pane.scrollTop).toBe(0)
  // Native details fires toggle for initial `open`; there was no user summary activation or scroll.
  fireEvent(details, new Event('toggle'))
  height = 1200
  business.runs = [...business.runs]
  host.rerender(<MemoryRouter><AiHomeWorkbench /></MemoryRouter>)
  expect(pane.scrollTop).toBe(1200)
})
it('已发送提示词显示服务端绑定的Skill标签；刷新回放不依赖本地选择', () => {
  const run=snapshot(); run.businessExecution.kind='skill'
  chat.messages=[{id:'sent',role:'user',text:'请处理这份需求',projectionSource:{runId:run.runId,eventType:'user_message',deduplicationKey:`${run.runId}:user:1`}}]
  business.runs=[run];mount()
  const message=screen.getByText('请处理这份需求').closest('article')
  expect(within(message).getByLabelText('已调用 Skill 实际业务任务')).toBeInTheDocument()
})
