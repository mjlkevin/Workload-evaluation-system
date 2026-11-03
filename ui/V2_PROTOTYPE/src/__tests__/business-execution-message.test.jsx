import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import BusinessExecutionMessage from '../pages/AiHomeWorkbench/components/BusinessExecutionMessage.jsx'
import { BusinessRunActions } from '../pages/AiHomeWorkbench/components/BusinessExecutionControls.jsx'
const pending = { actionId: 'actual-action', kind: 'userInput', stepId: 'review', contentHash: 'server-hash', prompt: '补充组织数量', outputSchema: { type: 'object', required: ['count'], properties: { count: { type: 'integer', title: '组织数量', minimum: 1 } } } }
const run = { runId: 'actual-run', status: 'waiting', businessExecution: { target: { name: '任意业务任务' }, currentStep: { id: 'review' }, pendingInput: pending, results: {} } }
const record = (kind, extra = {}) => ({ type: 'business', id: kind, sourceId: kind, rootRunId: 'root', currentRunId: 'actual-run', runId: 'actual-run', kind, title: '服务端阶段名称', status: 'succeeded', ...extra })
const question = record('question', { stepId: 'review', status: 'pending', pending, content: { prompt: pending.prompt } })
const actions = () => ({ onInput: vi.fn().mockResolvedValue(), onDecision: vi.fn().mockResolvedValue() })
function expand(name) { const details = screen.getByText(name, { selector: 'summary' }).closest('details'); details.open = true; fireEvent(details, new Event('toggle')) }
describe('业务消息的真实阶段与可见交互', () => {
  it('使用真实阶段名称，分析与工具明细默认折叠且按需挂载', () => {
    render(<BusinessExecutionMessage entry={record('stage', { content: { summary: '已核对输入' }, details: [record('tool_result', { title: '工具返回', content: { title: '实际工具结果' } })] })} run={run} />)
    expect(screen.getByRole('heading', { name: '服务端阶段名称' })).toBeInTheDocument()
    expect(screen.queryByText('实际工具结果')).not.toBeInTheDocument()
    expect(screen.getByText('分析与工具明细').closest('details')).not.toHaveAttribute('open')
    expand('分析与工具明细')
    expect(screen.getByText('实际工具结果')).toBeInTheDocument()
  })
  it('当前问题直接显示表单，轮询保留未提交输入并发送原始描述', async () => {
    const callbacks = actions(); const view = render(<BusinessExecutionMessage entry={question} run={run} {...callbacks} />)
    fireEvent.change(screen.getByRole('spinbutton', { name: '组织数量' }), { target: { value: '3' } })
    view.rerender(<BusinessExecutionMessage entry={{ ...question, pending: { ...pending } }} run={{ ...run, businessExecution: { ...run.businessExecution, pendingInput: { ...pending } } }} {...callbacks} />)
    expect(screen.getByRole('spinbutton', { name: '组织数量' })).toHaveValue(3)
    fireEvent.click(screen.getByRole('button', { name: '提交补充信息' }))
    await waitFor(() => expect(callbacks.onInput).toHaveBeenCalledWith('actual-run', pending, { count: 3 }))
  })
  it.each(['cancelled', 'completed', 'running'])('%s中的历史待回答记录只有只读内容', status => {
    render(<BusinessExecutionMessage entry={question} run={{ ...run, status }} {...actions()} />)
    expect(screen.getByText('补充组织数量')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '提交补充信息' })).not.toBeInTheDocument()
  })
  it.each([
    { ...question, runId: 'older-run' },
    { ...question, pending: { ...pending, contentHash: 'stale-hash' } },
    { ...question, pending: { ...pending, actionId: 'stale-action' } },
    { ...question, stepId: 'older-step' },
  ])('过期或不匹配的pending不开放表单', entry => {
    render(<BusinessExecutionMessage entry={entry} run={run} {...actions()} />)
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })
  it('真实回答和拒绝决定作为历史气泡可读，不重建授权按钮', () => {
    render(<><BusinessExecutionMessage entry={record('answer', { content: { count: 4 } })} run={run} /><BusinessExecutionMessage entry={record('decision', { status: 'rejected', content: { approved: false } })} run={run} /></>)
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('已拒绝')).toBeInTheDocument()
    expect(screen.getByText('否')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  it.each([['approved', '恢复已确认操作', 'confirm'], ['rejected', '恢复已拒绝操作', 'reject']])('实际%s操作只恢复原决定', async (status, name, decision) => {
    const operation = { actionId: 'op', operationId: 'stored-op', stepId: 'review', confirmationHash: 'op-hash', toolName: 'create_assessment_draft', status, parameters: { title: '正式草稿' } }
    const callbacks = actions()
    render(<BusinessExecutionMessage entry={record('confirmation', { stepId: 'review', pending: operation })} run={{ ...run, businessExecution: { ...run.businessExecution, pendingInput: undefined, pendingOperation: operation } }} {...callbacks} />)
    expect(screen.queryByRole('button', { name: '确认继续' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name }))
    await waitFor(() => expect(callbacks.onDecision).toHaveBeenCalledWith('actual-run', operation, decision))
  })
  it.each([409, 503])('%s错误保留表单内容，双击只提交一次', async status => {
    let fail; const onInput = vi.fn(() => new Promise((_, reject) => { fail = reject }))
    render(<BusinessExecutionMessage entry={question} run={run} onInput={onInput} />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } })
    const submit = screen.getByRole('button', { name: '提交补充信息' }); fireEvent.click(submit); fireEvent.click(submit)
    expect(onInput).toHaveBeenCalledTimes(1)
    fail(Object.assign(new Error(`真实错误${status}`), { status }))
    expect(await screen.findByRole('alert')).toHaveTextContent(`真实错误${status}`)
    expect(screen.getByRole('spinbutton')).toHaveValue(2)
  })
  it('最终结果显示真实原生工期与草稿链接，需求引用和未匹配项保留', () => {
    const report = { requirements: [{ id: 'REQ-027', title: '订单查询', description: '查询原文', role: '客服', action: '查询', object: '订单', constraints: [], openQuestions: [], assumptions: [], sources: [{ sourceId: '真实材料', quote: '实际引用原话', start: 1, end: 6 }] }], relations: [] }
    const matching = { matches: [], unmatched: [{ reqId: 'REQ-027', reason: '没有对应目录' }], aiAdjustments: [] }
    const draft = { assessmentId: 'actual/id', totalDays: 7.5 }
    render(<BusinessExecutionMessage entry={record('result', { final: true, content: { draft, report, matching } })} run={{ ...run, status: 'completed', businessExecution: { ...run.businessExecution, results: { effects: [{ toolName: 'create_assessment_draft', result: draft }] } } }} />)
    expect(screen.getAllByRole('link', { name: '打开评估草稿' })).toHaveLength(1)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/assessments/actual%2Fid')
    expect(screen.getByText('正式计算工期：7.5 人天')).toBeInTheDocument()
    expect(screen.getByText('实际引用原话')).toBeInTheDocument()
    expect(screen.getByText('没有对应目录')).toBeInTheDocument()
    expect(screen.getAllByText('REQ-027 · 订单查询')).toHaveLength(2)
  })
  it('真实timeline原生工具返回可提供草稿依据，不依赖旧effects投影', () => {
    const draft = { assessmentId: 'timeline-id', totalDays: 6 }
    render(<BusinessExecutionMessage entry={record('result', { final: true, content: { draft } })} run={{ ...run, businessExecution: { ...run.businessExecution, timeline: { version: 1, entries: [{ kind: 'tool_result', status: 'succeeded', toolName: 'create_assessment_draft', content: { parameters: {}, result: draft } }] } } }} />)
    expect(screen.getByRole('link', { name: '打开评估草稿' })).toHaveAttribute('href', '/assessments/timeline-id')
    expect(screen.getByText('正式计算工期：6 人天')).toBeInTheDocument()
  })
  it('相同草稿编号的最终输出不能覆盖原生工具返回的正式工期', () => {
    const draft = { assessmentId: 'actual-id', totalDays: 8 }
    render(<BusinessExecutionMessage entry={record('result', { final: true, content: { draft: { ...draft, totalDays: 999 } } })} run={{ ...run, businessExecution: { ...run.businessExecution, results: { effects: [{ toolName: 'create_assessment_draft', result: draft }] } } }} />)
    expect(screen.getByText('正式计算工期：8 人天')).toBeInTheDocument()
    expect(screen.queryByText('正式计算工期：999 人天')).not.toBeInTheDocument()
  })
  it('额外嵌套的同编号模型对象不继承正式草稿资格，业务值仍保留', () => {
    const draft = { assessmentId: 'actual-id', totalDays: 8 }
    const fake = { assessmentId: 'actual-id', totalDays: 999 }
    render(<BusinessExecutionMessage entry={record('result', { final: true, content: { draft: fake, extra: fake } })} run={{ ...run, businessExecution: { ...run.businessExecution, results: { effects: [{ toolName: 'create_assessment_draft', result: draft }] } } }} />)
    expect(screen.getAllByRole('link', { name: '打开评估草稿' })).toHaveLength(1)
    expect(screen.getByText('正式计算工期：8 人天')).toBeInTheDocument()
    expect(screen.queryByText('正式计算工期：999 人天')).not.toBeInTheDocument()
    expect(screen.getByText('999')).toBeInTheDocument()
  })
  it('正式草稿合并保留嵌套业务报告、引用、说明与未匹配项', () => {
    const native = { assessmentId: 'actual-id', totalDays: 8 }
    const report = { requirements: [{ id: 'REQ-031', title: '嵌套需求', description: '嵌套业务描述', role: '财务', action: '核对', object: '账单', constraints: [], openQuestions: [], assumptions: [], sources: [{ sourceId: '材料-31', quote: '嵌套引用原文', start: 2, end: 8 }] }], relations: [] }
    const matching = { matches: [], unmatched: [{ reqId: 'REQ-031', reason: '嵌套需求没有对应目录' }], aiAdjustments: [] }
    render(<BusinessExecutionMessage entry={record('result', { final: true, content: { draft: { ...native, totalDays: 999, report, note: '整理说明', matching }, extra: { ...native, totalDays: 999 } } })} run={{ ...run, businessExecution: { ...run.businessExecution, results: { effects: [{ toolName: 'create_assessment_draft', result: native }] } } }} />)
    expect(screen.getAllByRole('link', { name: '打开评估草稿' })).toHaveLength(1)
    expect(screen.getByText('正式计算工期：8 人天')).toBeInTheDocument()
    expect(screen.queryByText('正式计算工期：999 人天')).not.toBeInTheDocument()
    expect(screen.getByText('整理说明')).toBeInTheDocument()
    expect(screen.getByText('嵌套引用原文')).toBeInTheDocument()
    expect(screen.getAllByText('REQ-031 · 嵌套需求')).toHaveLength(2)
    expect(screen.getByText('嵌套需求没有对应目录')).toBeInTheDocument()
  })
  it('缺少当前运行时保留问题只读，不开放输入', () => {
    render(<BusinessExecutionMessage entry={question} />)
    expect(screen.getByText('补充组织数量')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })
  it('模型输出的近似草稿字段不会被当作原生写入结果', () => {
    render(<BusinessExecutionMessage entry={record('result', { final: true, content: { draft: { assessmentId: 'invented', totalDays: 99 } } })} run={run} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText(/正式计算工期/)).not.toBeInTheDocument()
  })
  it('部分记录提示与实际错误可读，失败详情默认收起', () => {
    render(<><BusinessExecutionMessage entry={record('coverage', { unavailable: ['timeline_missing'] })} /><BusinessExecutionMessage entry={record('failure', { content: { code: 'ACTUAL_FAILURE' } })} /></>)
    expect(screen.getByText('部分执行记录不可用')).toBeInTheDocument()
    expect(screen.queryByText('ACTUAL_FAILURE')).not.toBeInTheDocument()
    expand('查看失败详情'); expect(screen.getByText('ACTUAL_FAILURE')).toBeInTheDocument()
  })
})
it('消息级别不重复显示执行操作；独立执行操作保留原重试与停止语义', async () => {
  const onRetry = vi.fn().mockRejectedValue(new Error('原始重试失败')); const onStop = vi.fn()
  const view = render(<><BusinessExecutionMessage entry={record('stage')} run={run} /><BusinessRunActions run={{ ...run, status: 'failed' }} onRetry={onRetry} onStop={onStop} /></>)
  fireEvent.click(screen.getByRole('button', { name: '重试执行' })); fireEvent.click(screen.getByRole('button', { name: '确认重试' }))
  expect(screen.getByLabelText('重试原因')).toHaveAttribute('aria-invalid', 'true')
  fireEvent.change(screen.getByLabelText('重试原因'), { target: { value: '环境恢复' } }); fireEvent.click(screen.getByRole('button', { name: '确认重试' }))
  await screen.findByText('原始重试失败'); const key = onRetry.mock.calls[0][1].submissionKey
  fireEvent.click(screen.getByRole('button', { name: '确认重试' })); await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(2))
  expect(onRetry.mock.calls[1][1].submissionKey).toBe(key)
  view.unmount(); render(<BusinessRunActions run={run} onStop={onStop} />)
  fireEvent.click(screen.getByRole('button', { name: '停止执行' })); expect(onStop).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '确认停止' })); await waitFor(() => expect(onStop).toHaveBeenCalledWith('actual-run'))
})
