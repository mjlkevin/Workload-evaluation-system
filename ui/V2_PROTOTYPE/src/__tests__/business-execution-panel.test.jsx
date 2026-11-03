import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BusinessExecutionPanel from '../pages/AiHomeWorkbench/components/BusinessExecutionPanel.jsx'
import useBusinessExecution from '../pages/AiHomeWorkbench/hooks/useBusinessExecution.js'
import * as api from '../api/businessExecutions.js'
import { cancelRun, getRunSnapshot } from '../api/aiRuns.js'
vi.mock('../api/businessExecutions.js')
vi.mock('../api/aiRuns.js', () => ({ cancelRun: vi.fn(), getRunSnapshot: vi.fn() }))
const pending = { actionId: 'server-input', kind: 'userInput', stepId: 'review', contentHash: 'hash-original', prompt: '补充组织数量', outputSchema: { type: 'object', required: ['count'], properties: { count: { type: 'integer', title: '组织数量', minimum: 1 } } }, displayInput: { title: '订单' } }
const execution = { kind: 'workflow', target: { id: 'flow-a', versionId: 'v1', name: '需求整理' }, steps: [{ id: 'extract', name: '整理需求', type: 'skill' }, { id: 'review', name: '确认范围', type: 'userInput' }], currentStep: { id: 'review', status: 'waiting' }, pendingInput: pending, results: { steps: [{ stepId: 'extract', status: 'succeeded', output: { requirements: [{ title: '销售订单' }] } }], effects: [{ toolName: 'createAssessment', result: { title: '已经创建的评估' } }] } }
const run = { runId: 'run-a', sessionId: 'session-a', status: 'waiting', businessExecution: execution }
function props(extra = {}) { return { runs: [run], onRefresh: vi.fn(), onInput: vi.fn().mockResolvedValue(), onDecision: vi.fn().mockResolvedValue(), onRetry: vi.fn().mockResolvedValue(), onStop: vi.fn().mockResolvedValue(), ...extra } }
beforeEach(() => {
  vi.clearAllMocks()
  api.listBusinessRuns.mockResolvedValue([{ runId: 'run-a', sessionId: 'session-a', status: 'waiting', hasBusinessExecution: true }])
  getRunSnapshot.mockResolvedValue(run)
})
describe('业务执行等待与结果', () => {
  it('保留已完成结果并按服务端schema补输入，错误字段不提交', async () => {
    const actions = props(); render(<BusinessExecutionPanel {...actions} />)
    expect(screen.getByText('需求整理')).toBeInTheDocument()
    expect(screen.getByText('销售订单')).toBeInTheDocument()
    expect(screen.getByText('已经创建的评估')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '提交补充信息' }))
    expect(actions.onInput).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/组织数量/)).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(screen.getByLabelText(/组织数量/), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '提交补充信息' }))
    await waitFor(() => expect(actions.onInput).toHaveBeenCalledWith('run-a', pending, { count: 3 }))
    expect(screen.queryByText('hash-original')).not.toBeInTheDocument()
  })
  it('等待回答解析服务端本地Schema引用并发送数值而非字符串', async () => {
    const referenced = { ...pending, outputSchema: { type: 'object', required: ['count'], $defs: { count: { type: 'integer', title: '组织数量', minimum: 1 } }, properties: { count: { $ref: '#/$defs/count' } } } }
    const actions = props({ runs: [{ ...run, businessExecution: { ...execution, pendingInput: referenced } }] })
    render(<BusinessExecutionPanel {...actions} />)
    fireEvent.change(screen.getByRole('spinbutton', { name: '组织数量' }), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '提交补充信息' }))
    await waitFor(() => expect(actions.onInput).toHaveBeenCalledWith('run-a', referenced, { count: 2 }))
  })
  it('等待回答的无type布尔枚举与const保持JSON布尔类型', async () => {
    const typed = { ...pending, outputSchema: { type: 'object', required: ['enabled', 'fixed'], properties: { enabled: { title: '是否纳入', enum: [true, false] }, fixed: { title: '固定确认', const: true } } } }
    const actions = props({ runs: [{ ...run, businessExecution: { ...execution, pendingInput: typed } }] })
    render(<BusinessExecutionPanel {...actions} />)
    const select = screen.getByRole('combobox', { name: '是否纳入' })
    const option = [...select.options].find(item => item.textContent === 'false')
    fireEvent.change(select, { target: { value: option.value } })
    fireEvent.click(screen.getByRole('button', { name: '提交补充信息' }))
    await waitFor(() => expect(actions.onInput).toHaveBeenCalledWith('run-a', typed, { enabled: false, fixed: true }))
  })
  it('确认与拒绝必须显式点击并携带所展示等待的原始摘要', async () => {
    const confirmation = { ...pending, kind: 'confirmation', prompt: '确认创建评估', displayInput: { name: '销售评估' } }
    const actions = props({ runs: [{ ...run, businessExecution: { ...execution, pendingInput: confirmation } }] })
    render(<BusinessExecutionPanel {...actions} />)
    expect(actions.onDecision).not.toHaveBeenCalled()
    expect(screen.getByText('销售评估')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认继续' }))
    await waitFor(() => expect(actions.onDecision).toHaveBeenCalledWith('run-a', confirmation, 'confirm'))
    fireEvent.click(screen.getByRole('button', { name: '拒绝本次操作' }))
    await waitFor(() => expect(actions.onDecision).toHaveBeenCalledWith('run-a', confirmation, 'reject'))
  })
  it('操作确认展示工具参数而不以聊天内容推导授权', async () => {
    const operation = { actionId: 'operation-action', confirmationHash: 'op-hash', toolName: 'createAssessment', parameters: { title: '正式评估' }, status: 'pending' }
    const actions = props({ runs: [{ ...run, businessExecution: { ...execution, pendingInput: undefined, pendingOperation: operation } }] })
    render(<BusinessExecutionPanel {...actions} />)
    expect(screen.getByText('正式评估')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认继续' }))
    await waitFor(() => expect(actions.onDecision).toHaveBeenCalledWith('run-a', operation, 'confirm'))
  })
  it.each([['approved', '恢复已确认操作', 'confirm'], ['rejected', '恢复已拒绝操作', 'reject']])('等待中的%s只提供原决定的幂等恢复入口', async (status, name, decision) => {
    const operation = { actionId: 'stored-decision', confirmationHash: 'same-server-hash', toolName: 'createAssessment', parameters: { title: '正式评估' }, status }
    const actions = props({ runs: [{ ...run, businessExecution: { ...execution, pendingInput: undefined, pendingOperation: operation } }] })
    render(<BusinessExecutionPanel {...actions} />)
    expect(screen.queryByRole('button', { name: '确认继续' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '拒绝本次操作' })).not.toBeInTheDocument()
    expect(actions.onDecision).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name }))
    await waitFor(() => expect(actions.onDecision).toHaveBeenCalledWith('run-a', operation, decision))
    expect(screen.getByText('正式评估')).toBeInTheDocument()
  })
  it.each(['queued', 'running', 'recovering'])('%s中的pending等待不提供首次确认入口', status => {
    const operation = { actionId: 'pending', confirmationHash: 'server-hash', toolName: 'createAssessment', parameters: {}, status: 'pending' }
    const actions = props({ runs: [{ ...run, status, businessExecution: { ...execution, pendingInput: { ...pending, kind: 'confirmation' }, pendingOperation: operation } }] })
    render(<BusinessExecutionPanel {...actions} />)
    expect(screen.queryByRole('button', { name: '确认继续' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '拒绝本次操作' })).not.toBeInTheDocument()
    expect(actions.onDecision).not.toHaveBeenCalled()
  })
  it('重试同原因网络重发保持key，原因变化才换key', async () => {
    const actions = props({ runs: [{ ...run, status: 'failed' }], onRetry: vi.fn().mockRejectedValue(new Error('网络请求失败')) })
    render(<BusinessExecutionPanel {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: '重试执行' }))
    fireEvent.change(screen.getByLabelText('重试原因'), { target: { value: ' 环境恢复 ' } })
    fireEvent.click(screen.getByRole('button', { name: '确认重试' }))
    await screen.findByText('网络请求失败')
    const firstKey = actions.onRetry.mock.calls[0][1].submissionKey
    fireEvent.change(screen.getByLabelText('重试原因'), { target: { value: '环境恢复' } })
    fireEvent.click(screen.getByRole('button', { name: '确认重试' }))
    await waitFor(() => expect(actions.onRetry).toHaveBeenCalledTimes(2))
    expect(actions.onRetry.mock.calls[1][1]).toEqual({ submissionKey: firstKey, reason: '环境恢复' })
    await screen.findByText('网络请求失败')
    fireEvent.change(screen.getByLabelText('重试原因'), { target: { value: '修正输入后重试' } })
    fireEvent.click(screen.getByRole('button', { name: '确认重试' }))
    await waitFor(() => expect(actions.onRetry).toHaveBeenCalledTimes(3))
    expect(actions.onRetry.mock.calls[2][1].submissionKey).not.toBe(firstKey)
  })
  it('重试原因的必填错误与字段关联', () => {
    render(<BusinessExecutionPanel {...props({ runs: [{ ...run, status: 'failed' }] })} />)
    fireEvent.click(screen.getByRole('button', { name: '重试执行' }))
    fireEvent.click(screen.getByRole('button', { name: '确认重试' }))
    const field = screen.getByLabelText('重试原因')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    const error = document.getElementById(field.getAttribute('aria-describedby'))
    expect(error).toHaveTextContent('请填写重试原因')
  })
  it('重试原因在Escape与取消关闭时受保护，继续编辑保留输入', () => {
    const actions = props({ runs: [{ ...run, status: 'failed' }] })
    render(<BusinessExecutionPanel {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: '重试执行' }))
    fireEvent.change(screen.getByLabelText('重试原因'), { target: { value: '环境已恢复' } })
    fireEvent.keyDown(screen.getByRole('dialog', { name: '重试执行' }), { key: 'Escape' })
    expect(screen.getByText('重试原因尚未提交，确定放弃吗？')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '继续填写' }))
    expect(screen.getByLabelText('重试原因')).toHaveValue('环境已恢复')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByText('重试原因尚未提交，确定放弃吗？')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '放弃重试' }))
    expect(screen.queryByRole('dialog', { name: '重试执行' })).not.toBeInTheDocument()
    expect(actions.onRetry).not.toHaveBeenCalled()
  })
  it('停止只由显式二次确认触发，取消保留任务', async () => {
    const actions = props(); render(<BusinessExecutionPanel {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: '停止执行' }))
    expect(actions.onStop).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '继续执行' }))
    expect(actions.onStop).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '停止执行' }))
    fireEvent.click(screen.getByRole('button', { name: '确认停止' }))
    await waitFor(() => expect(actions.onStop).toHaveBeenCalledWith('run-a'))
  })
  it('失败结果保留效果，显式重试和停止均要先确认', async () => {
    const actions = props({ runs: [{ ...run, status: 'failed' }] }); render(<BusinessExecutionPanel {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: '重试执行' }))
    expect(actions.onRetry).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('重试原因'), { target: { value: '确认环境恢复' } })
    fireEvent.click(screen.getByRole('button', { name: '确认重试' }))
    await waitFor(() => expect(actions.onRetry).toHaveBeenCalledWith('run-a', expect.objectContaining({ reason: '确认环境恢复', submissionKey: expect.any(String) })))
    expect(screen.getByText('已经创建的评估')).toBeInTheDocument()
  })
})
describe('服务器恢复与过期确认', () => {
  function Host({ sessionId = 'session-a' }) {
    const state = useBusinessExecution(sessionId)
    return <BusinessExecutionPanel runs={state.runs} loading={state.loading} error={state.error} busy={state.busy} onRefresh={state.refresh} onInput={state.submitInput} onDecision={state.decide} onRetry={state.retry} onStop={state.stop} />
  }
  it('重挂载只读取当前会话安全快照，恢复等待与结果，不重建或自动批准', async () => {
    const first = render(<Host />)
    await screen.findByText('补充组织数量')
    first.unmount(); render(<Host />)
    await screen.findByText('补充组织数量')
    expect(api.listBusinessRuns).toHaveBeenCalledWith('session-a')
    expect(getRunSnapshot).toHaveBeenCalledWith('run-a')
    expect(api.startBusinessExecution).not.toHaveBeenCalled()
    expect(api.decideBusinessAction).not.toHaveBeenCalled()
    expect(cancelRun).not.toHaveBeenCalled()
  })
  it('409后重拉最新摘要并要求再次显式确认，不自动重发旧批准', async () => {
    const confirmation = { ...pending, kind: 'confirmation' }
    getRunSnapshot.mockResolvedValue({ ...run, businessExecution: { ...execution, pendingInput: confirmation } })
    api.decideBusinessAction.mockImplementation(async () => {
      getRunSnapshot.mockResolvedValue({ ...run, businessExecution: { ...execution, pendingInput: { ...confirmation, contentHash: 'new-server-hash', prompt: '范围已更新，请重新确认' } } })
      throw Object.assign(new Error('内容已变化'), { status: 409 })
    })
    render(<Host />)
    fireEvent.click(await screen.findByRole('button', { name: '确认继续' }))
    await screen.findByText('范围已更新，请重新确认')
    expect(api.decideBusinessAction).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '确认继续' }))
    await waitFor(() => expect(api.decideBusinessAction).toHaveBeenCalledTimes(2))
    expect(api.decideBusinessAction.mock.calls[1][1].contentHash).toBe('new-server-hash')
  })
  it('切换会话后迟到的旧会话快照不能覆盖当前会话', async () => {
    let release
    api.listBusinessRuns.mockImplementation(id => id === 'session-a' ? new Promise(resolve => { release = resolve }) : Promise.resolve([]))
    const host = render(<Host />)
    host.rerender(<Host sessionId="session-b" />)
    await waitFor(() => expect(api.listBusinessRuns).toHaveBeenCalledWith('session-b'))
    release([{ runId: 'run-a' }])
    await waitFor(() => expect(screen.queryByText('补充组织数量')).not.toBeInTheDocument())
  })
})

describe('跨会话迟到命令隔离', () => {
  const confirmation = { ...pending, kind: 'confirmation' }
  function CommandHost({ sessionId, outcomes }) {
    const state = useBusinessExecution(sessionId)
    return <><button onClick={() => state.decide('run-a', confirmation, 'confirm').then(result => outcomes.push(result))}>发出确认</button>{state.error && <p role="alert">{state.error}</p>}<output>{state.busy ? '处理中' : '可操作'}</output></>
  }
  it.each([false, true])('409刷新迟到后不污染新会话错误（返回A：%s）', async returnToA => {
    let release
    let aCalls = 0
    const outcomes = []
    api.listBusinessRuns.mockImplementation(id => {
      if (id === 'session-a' && ++aCalls === 2) return new Promise(resolve => { release = resolve })
      return Promise.resolve([])
    })
    api.decideBusinessAction.mockRejectedValue(Object.assign(new Error('旧会话冲突'), { status: 409 }))
    const host = render(<CommandHost sessionId="session-a" outcomes={outcomes} />)
    await waitFor(() => expect(api.listBusinessRuns).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: '发出确认' }))
    await waitFor(() => expect(release).toBeTypeOf('function'))
    host.rerender(<CommandHost sessionId="session-b" outcomes={outcomes} />)
    await waitFor(() => expect(api.listBusinessRuns).toHaveBeenCalledWith('session-b'))
    if (returnToA) {
      host.rerender(<CommandHost sessionId="session-a" outcomes={outcomes} />)
      await waitFor(() => expect(aCalls).toBe(3))
    }
    await act(async () => { release([]) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(outcomes).toEqual([false])
  })
  it('A→B→A后旧成功命令不能返回成功或再次刷新新一代会话', async () => {
    let release
    const outcomes = []
    api.listBusinessRuns.mockResolvedValue([])
    api.decideBusinessAction.mockImplementation(() => new Promise(resolve => { release = resolve }))
    const host = render(<CommandHost sessionId="session-a" outcomes={outcomes} />)
    await waitFor(() => expect(api.listBusinessRuns).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: '发出确认' }))
    await waitFor(() => expect(release).toBeTypeOf('function'))
    host.rerender(<CommandHost sessionId="session-b" outcomes={outcomes} />)
    await waitFor(() => expect(api.listBusinessRuns).toHaveBeenCalledTimes(2))
    host.rerender(<CommandHost sessionId="session-a" outcomes={outcomes} />)
    await waitFor(() => expect(api.listBusinessRuns).toHaveBeenCalledTimes(3))
    await act(async () => { release({}) })
    expect(outcomes).toEqual([false])
    expect(api.listBusinessRuns).toHaveBeenCalledTimes(3)
    expect(screen.getByText('可操作')).toBeInTheDocument()
  })
})
