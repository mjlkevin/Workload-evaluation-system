import { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import BusinessExecutionPanel from '../pages/AiHomeWorkbench/components/BusinessExecutionPanel.jsx'
import BusinessInputForm from '../pages/AiHomeWorkbench/components/BusinessInputForm.jsx'
const report = { requirements: [
  { id: 'REQ-004', title: '订单查询', description: '按客户查询订单', role: '客服', action: '查询', object: '订单', constraints: ['仅本人订单'], openQuestions: ['跨组织吗？'], assumptions: ['暂按单组织'], sources: [{ sourceId: 'source-real', quote: '查询订单原话', start: 3, end: 9 }] },
  { id: 'REQ-009', title: '外部对账', description: '对账', role: '财务', action: '核对', object: '账单', constraints: [], openQuestions: [], assumptions: [], sources: [] },
], relations: [{ kind: 'conflict', leftId: 'REQ-004', rightId: 'REQ-009', reason: '范围存在冲突' }] }
const catalog = { template: { templateId: 'real-template', templateName: '真实实施目录', items: [
  { templateItemId: 'actual-query', itemName: '查询实施', standardDays: 2 },
  { templateItemId: 'actual-export', itemName: '导出实施', standardDays: 4 },
] } }
const matching = { matches: [{ reqId: 'REQ-004', templateItemIds: ['actual-query'], scope: 'review', rationale: '待核实查询边界' }], unmatched: [{ reqId: 'REQ-009', reason: '目录没有外部对账' }], aiAdjustments: [{ reqId: 'REQ-004', proposedDays: 99, basis: '估算建议' }] }
const params = { userCount: { type: 'integer', title: '用户数量', minimum: 0 }, orgCount: { type: 'integer', title: '组织数量', minimum: 0 }, difficultyFactor: { type: 'number', title: '难度系数', minimum: 0 }, orgSimilarityFactor: { type: 'number', title: '组织相似系数', minimum: 0, maximum: 1 } }
const schema = { type: 'object', required: ['selectedItemIds', 'params'], properties: { selectedItemIds: { type: 'array', title: '实施范围', uniqueItems: true, items: { type: 'string' }, minItems: 0 }, params: { type: 'object', properties: params, required: Object.keys(params), default: { userCount: 1, orgCount: 1, difficultyFactor: 1, orgSimilarityFactor: 1 } } } }
function mount({ displayInput, outputSchema = schema, kind = 'userInput', status = 'waiting', results = {}, resourceOptions } = {}) {
  const pending = { actionId: 'actual-action', stepId: 'arbitrary-step', contentHash: 'server-hash', kind, prompt: '核对本次内容', displayInput, outputSchema }
  const onInput = vi.fn().mockResolvedValue()
  const onDecision = vi.fn().mockResolvedValue()
  render(<BusinessExecutionPanel runs={[{ runId: 'actual-run', status, businessExecution: { target: { name: '任意业务执行', versionId: 'v2' }, steps: [], pendingInput: pending, results } }]} onInput={onInput} onDecision={onDecision} resourceOptions={resourceOptions} />)
  return { onInput, onDecision, pending }
}
it('需求报告展示稳定编号、原话、待澄清项、假设和冲突，原始材料折叠', () => {
  mount({ kind: 'confirmation', displayInput: { report, sources: [{ id: 'source-real', text: '巨大的原始材料正文' }] } })
  expect(screen.getByRole('heading', { name: '需求报告' })).toBeInTheDocument()
  expect(screen.getByText('REQ-004 · 订单查询')).toBeInTheDocument()
  expect(screen.getByText('查询订单原话')).toBeInTheDocument()
  expect(screen.getByText('跨组织吗？')).toBeInTheDocument()
  expect(screen.getByText('暂按单组织')).toBeInTheDocument()
  expect(screen.getByText(/范围存在冲突/)).toBeInTheDocument()
  expect(screen.queryByText('巨大的原始材料正文')).not.toBeInTheDocument()
  expect(screen.getByText('原始材料（1）').closest('details')).not.toHaveAttribute('open')
})
it('匹配报告关联真实条目名称和编号，所有未匹配及原因均保持可见，AI建议独立标识', () => {
  mount({ kind: 'confirmation', displayInput: { report, catalog, matching } })
  const section = screen.getByRole('region', { name: '实施匹配' })
  expect(within(section).getByText('REQ-004 · 订单查询')).toBeInTheDocument()
  expect(within(section).getByText('查询实施 · actual-query')).toBeInTheDocument()
  expect(within(section).getByText('已匹配 1 项；未匹配 1 项')).toBeInTheDocument()
  expect(within(section).getByText('REQ-009 · 外部对账')).toBeInTheDocument()
  expect(within(section).getByText('目录没有外部对账')).toBeInTheDocument()
  expect(within(section).getByText('AI 建议工期（未计入正式计算）')).toBeInTheDocument()
  expect(screen.queryByText('正式计算工期：99 人天')).not.toBeInTheDocument()
})
it('585项中间目录只显示摘要，展开才挂载真实条目，通用结果仍保留', () => {
  const large = { template: { templateName: '大目录', items: Array.from({ length: 585 }, (_, i) => ({ templateItemId: `real-${i}`, itemName: `目录项${i}` })) } }
  mount({ status: 'completed', results: { steps: [{ stepId: 'anything', status: 'succeeded', output: large }, { stepId: 'other', status: 'succeeded', output: { title: '通用步骤内容' } }] } })
  expect(screen.queryByText('实施目录：大目录（585 项）')).not.toBeInTheDocument()
  const stepSummaries = screen.getAllByText('步骤结果 · 已完成')
  stepSummaries[0].closest('details').open = true
  fireEvent(stepSummaries[0].closest('details'), new Event('toggle'))
  const summary = screen.getByText('实施目录：大目录（585 项）')
  expect(summary.closest('details')).not.toHaveAttribute('open')
  expect(screen.queryByText('目录项584')).not.toBeInTheDocument()
  summary.closest('details').open = true
  fireEvent(summary.closest('details'), new Event('toggle'))
  expect(screen.getByText('目录项584')).toBeInTheDocument()
  expect(screen.queryByText('通用步骤内容')).not.toBeInTheDocument()
  stepSummaries[1].closest('details').open = true
  fireEvent(stepSummaries[1].closest('details'), new Event('toggle'))
  expect(screen.getByText('通用步骤内容')).toBeInTheDocument()
})
it('实际等待目录提供checkbox，显式选中后提交真实ID和数值参数，不自动提交', async () => {
  const { onInput, pending } = mount({ displayInput: { catalog, matching } })
  expect(screen.getByRole('checkbox', { name: '查询实施 · actual-query' })).not.toBeChecked()
  expect(onInput).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox', { name: '查询实施 · actual-query' }))
  fireEvent.change(screen.getByRole('spinbutton', { name: '用户数量' }), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: '提交补充信息' }))
  await waitFor(() => expect(onInput).toHaveBeenCalledWith('actual-run', pending, { selectedItemIds: ['actual-query'], params: { userCount: 0, orgCount: 1, difficultyFactor: 1, orgSimilarityFactor: 1 } }))
})
it('资源数组按items的enum和const共同收窄，不能输入任意ID', () => {
  function Form() {
    const [value, setValue] = useState({ selectedItemIds: [] })
    return <BusinessInputForm schema={{ type: 'object', properties: { selectedItemIds: { type: 'array', title: '实施范围', items: { type: 'string', enum: ['actual-query', 'actual-export'], const: 'actual-query' } } } }} value={value} onChange={setValue} resourceOptions={{ byPath: { selectedItemIds: [{ id: 'actual-query', name: '实际查询' }, { id: 'actual-export', name: '实际导出' }, { id: 'invented', name: '越界' }] } }} />
  }
  render(<Form />)
  expect(screen.getByRole('checkbox', { name: '实际查询' })).toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: '实际导出' })).not.toBeInTheDocument()
  expect(screen.queryByText('越界')).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: '实际查询' }))
  expect(screen.getByRole('checkbox', { name: '实际查询' })).toBeChecked()
})
it('数组资源保留boolean值并且遵循数组enum整组约束', async () => {
  const { onInput } = mount({ displayInput: {}, outputSchema: { type: 'object', properties: { flags: { type: 'array', title: '标记', enum: [[true]], items: { type: 'boolean' } } }, required: ['flags'] }, resourceOptions: { byPath: { flags: [{ id: 'yes', name: '启用', value: true }, { id: 'no', name: '不启用', value: false }] } } })
  fireEvent.click(screen.getByRole('checkbox', { name: '不启用' }))
  fireEvent.click(screen.getByRole('button', { name: '提交补充信息' }))
  expect(onInput).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('请选择有效选项')
  fireEvent.click(screen.getByRole('checkbox', { name: '不启用' })); fireEvent.click(screen.getByRole('checkbox', { name: '启用' }))
  fireEvent.click(screen.getByRole('button', { name: '提交补充信息' }))
  await waitFor(() => expect(onInput.mock.calls[0][2]).toEqual({ flags: [true] }))
})
it('空范围明示警示，显式提交只能传空数组不能默认为整个目录', async () => {
  const { onInput } = mount({ displayInput: { catalog } })
  expect(screen.getByText('未选择任何实施项；提交后将使用空范围。')).toBeInTheDocument()
  expect(onInput).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '提交补充信息' }))
  await waitFor(() => expect(onInput.mock.calls[0][2].selectedItemIds).toEqual([]))
})
it('仅匹配ID没有真实目录时不能伪造选项，保留缺少目录提示', () => {
  mount({ displayInput: { matching } })
  expect(screen.queryByRole('checkbox', { name: /actual-query/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /添加实施范围/ })).not.toBeInTheDocument()
  expect(screen.getByText('暂无可选资源，请刷新任务后重试。')).toBeInTheDocument()
})
it('真实原生草稿给出本地结果链接与实际计算工期，AI提案不冒充工期', () => {
  mount({ status: 'completed', results: { output: { assessmentId: 'real/id ?#', totalDays: 12.5, matching }, effects: [{ toolName: 'create_assessment_draft', result: { assessmentId: 'real/id ?#', totalDays: 12.5 } }] } })
  const links = screen.getAllByRole('link', { name: '打开评估草稿' })
  expect(links.length).toBeGreaterThan(0)
  links.forEach(link => expect(link).toHaveAttribute('href', '/assessments/real%2Fid%20%3F%23'))
  expect(screen.getAllByText('正式计算工期：12.5 人天').length).toBeGreaterThan(0)
  expect(screen.queryByText('正式计算工期：99 人天')).not.toBeInTheDocument()
})
it('缺少或非法实际工期不补造零人天，伪造resultLink不会被使用', () => {
  mount({ status: 'completed', results: { effects: [{ toolName: 'create_assessment_draft', result: { assessmentId: 'actual-id', totalDays: '99', resultLink: 'https://external.invalid' } }] } })
  expect(screen.getByRole('link', { name: '打开评估草稿' })).toHaveAttribute('href', '/assessments/actual-id')
  expect(screen.queryByText(/正式计算工期/)).not.toBeInTheDocument()
})
it('未知形状仍用通用字段展示，不以近似字段伪装正式报告', () => {
  mount({ status: 'completed', results: { output: { requirements: '普通文本', matching: '普通匹配', title: '通用输出' } } })
  expect(screen.getByText('普通文本')).toBeInTheDocument()
  expect(screen.getByText('普通匹配')).toBeInTheDocument()
  expect(screen.getByText('通用输出')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '需求报告' })).not.toBeInTheDocument()
})

it('只在模型最终输出中出现的草稿编号与工期不能作为正式计算结果', () => {
  mount({ status: 'completed', results: { output: { assessmentId: 'invented-draft', totalDays: 99 } } })
  expect(screen.queryByRole('link', { name: '打开评估草稿' })).not.toBeInTheDocument()
  expect(screen.queryByText(/正式计算工期/)).not.toBeInTheDocument()
})

it('其他工具效果即使带assessmentId也不能冒充原生草稿计算', () => {
  mount({ status: 'completed', results: { effects: [{ toolName: 'another_tool', result: { assessmentId: 'fake', totalDays: 99 } }] } })
  expect(screen.queryByRole('link', { name: '打开评估草稿' })).not.toBeInTheDocument()
  expect(screen.queryByText(/正式计算工期/)).not.toBeInTheDocument()
})

it('同一displayInput中的confirmed requirements.report提供名称上下文，不读取其他执行', () => {
  mount({ kind: 'confirmation', displayInput: { requirements: { report, confirmation: { requirementIds: ['REQ-004', 'REQ-009'] } }, catalog, matching } })
  const section = screen.getByRole('region', { name: '实施匹配' })
  expect(within(section).getByText('REQ-004 · 订单查询')).toBeInTheDocument()
  expect(within(section).getByText('REQ-009 · 外部对账')).toBeInTheDocument()
})
it('匹配参数和摘要引用保留在折叠追溯中，不污染主要业务阅读', () => {
  mount({ kind: 'confirmation', displayInput: { matching: { ...matching, snapshotDigest: 'actual-snapshot-reference', params: { userCount: 2 } } } })
  const details = screen.getByText('匹配参数与追溯').closest('details')
  expect(details).not.toHaveAttribute('open')
  expect(screen.queryByText('actual-snapshot-reference')).not.toBeInTheDocument()
  details.open = true
  fireEvent(details, new Event('toggle'))
  expect(screen.getByText('actual-snapshot-reference')).toBeInTheDocument()
  expect(screen.getByText('用户数量')).toBeInTheDocument()
})

it('普通大型中间报告折叠时不挂载正文，展开后读取，折回后卸载', () => {
  mount({ status: 'completed', results: { steps: [{ stepId: 'ordinary', status: 'succeeded', output: { paragraphs: Array.from({ length: 250 }, (_, i) => `普通报告正文${i}`) } }] } })
  const details = screen.getByText('步骤结果 · 已完成').closest('details')
  expect(details).not.toHaveAttribute('open')
  expect(screen.queryByText('普通报告正文249')).not.toBeInTheDocument()
  details.open = true
  fireEvent(details, new Event('toggle'))
  expect(screen.getByText('普通报告正文249')).toBeInTheDocument()
  details.open = false
  fireEvent(details, new Event('toggle'))
  expect(screen.queryByText('普通报告正文249')).not.toBeInTheDocument()
})
