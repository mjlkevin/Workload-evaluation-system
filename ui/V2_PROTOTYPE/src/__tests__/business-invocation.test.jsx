import { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SkillInvocationDialog from '../pages/AiHomeWorkbench/components/SkillInvocationDialog.jsx'
import BusinessInputForm, { initialBusinessInput, validateBusinessInput } from '../pages/AiHomeWorkbench/components/BusinessInputForm.jsx'
import * as executions from '../api/businessExecutions.js'
vi.mock('../api/businessExecutions.js')
const schema = { type: 'object', required: ['title', 'count'], properties: {
  title: { type: 'string', title: '需求名称', minLength: 2 },
  count: { type: 'integer', title: '组织数量', minimum: 1 },
  enabled: { type: 'boolean', title: '包含明细' },
  mode: { type: 'string', title: '处理方式', enum: ['快速', '完整'] },
  params: { type: 'object', title: '计算参数', properties: { rate: { type: 'number', title: '相似系数' } } },
  answers: { type: 'array', title: '补充回答', items: { type: 'string' } },
} }
const catalog = [{ kind: 'workflow', id: 'flow-a', versionId: 'v-server', name: '需求整理', description: '整理需求并确认范围', inputSchema: schema }]
function openDialog(extra = {}) {
  const onClose = vi.fn()
  const onStarted = vi.fn()
  const ensureSession = vi.fn().mockResolvedValue({ sessionId: 'session-a' })
  render(<SkillInvocationDialog open onClose={onClose} onStarted={onStarted} ensureSession={ensureSession} session={{ sessionId: 'session-a', attachments: [{ attachmentId: 'owned-file', name: '需求.xlsx' }] }} {...extra} />)
  return { onClose, onStarted, ensureSession }
}
beforeEach(() => {
  vi.clearAllMocks()
  executions.listExecutionCatalog.mockResolvedValue(catalog)
  executions.startBusinessExecution.mockResolvedValue({ runId: 'run-a', status: 'queued', sessionId: 'session-a' })
})
async function chooseAndFill() {
  await screen.findByRole('option', { name: '工作流 · 需求整理' })
  fireEvent.change(await screen.findByLabelText('选择 Skill 或工作流'), { target: { value: 'workflow:flow-a' } })
  fireEvent.change(screen.getByLabelText(/需求名称/), { target: { value: '销售订单' } })
  fireEvent.change(screen.getByLabelText(/组织数量/), { target: { value: '2' } })
}
describe('业务执行启动', () => {
  it('加载已授权目录，按schema输入，并只在明确启动时提交', async () => {
    const { ensureSession, onStarted } = openDialog()
    await chooseAndFill()
    expect(executions.startBusinessExecution).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: /需求.xlsx/ }))
    fireEvent.click(screen.getByRole('button', { name: '启动执行' }))
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-a' })))
    expect(ensureSession).toHaveBeenCalledTimes(1)
    const [sessionId, command] = executions.startBusinessExecution.mock.calls[0]
    expect(sessionId).toBe('session-a')
    expect(command).toMatchObject({ submissionKey: expect.any(String), execution: { kind: 'workflow', workflowId: 'flow-a', input: { title: '销售订单', count: 2 }, sources: [{ kind: 'file', id: 'owned-file' }] } })
    expect(command.execution).not.toHaveProperty('versionId')
    expect(command).not.toHaveProperty('approved')
  })
  it('只选择当前会话已有消息作为对话来源，不生成来源标识', async () => {
    openDialog({ session: { sessionId: 'session-a', messages: [{ messageId: 'owned-message', role: 'user', content: '需要导出销售订单' }], attachments: [] } })
    await chooseAndFill()
    fireEvent.click(screen.getByRole('checkbox', { name: /需要导出销售订单/ }))
    fireEvent.click(screen.getByRole('button', { name: '启动执行' }))
    await waitFor(() => expect(executions.startBusinessExecution).toHaveBeenCalledTimes(1))
    expect(executions.startBusinessExecution.mock.calls[0][1].execution.sources).toEqual([{ kind: 'conversation', id: 'owned-message' }])
  })
  it('相同输入网络重试复用submissionKey，改变输入后新启动使用新key', async () => {
    executions.startBusinessExecution.mockRejectedValue(new Error('网络请求失败'))
    openDialog()
    await chooseAndFill()
    fireEvent.click(screen.getByRole('button', { name: '启动执行' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '启动执行' }))
    await waitFor(() => expect(executions.startBusinessExecution).toHaveBeenCalledTimes(2))
    expect(executions.startBusinessExecution.mock.calls[1][1].submissionKey).toBe(executions.startBusinessExecution.mock.calls[0][1].submissionKey)
    await waitFor(() => expect(screen.getByRole('button', { name: '启动执行' })).toBeEnabled())
    fireEvent.change(screen.getByLabelText(/需求名称/), { target: { value: '采购订单' } })
    fireEvent.click(screen.getByRole('button', { name: '启动执行' }))
    await waitFor(() => expect(executions.startBusinessExecution).toHaveBeenCalledTimes(3))
    expect(executions.startBusinessExecution.mock.calls[2][1].submissionKey).not.toBe(executions.startBusinessExecution.mock.calls[0][1].submissionKey)
  })
  it('阻止重复提交且保留必填字段错误', async () => {
    executions.startBusinessExecution.mockReturnValue(new Promise(() => {}))
    openDialog()
    await screen.findByRole('option', { name: '工作流 · 需求整理' })
    fireEvent.change(await screen.findByLabelText('选择 Skill 或工作流'), { target: { value: 'workflow:flow-a' } })
    fireEvent.click(screen.getByRole('button', { name: '启动执行' }))
    expect(screen.getByLabelText(/需求名称/)).toHaveAttribute('aria-invalid', 'true')
    expect(executions.startBusinessExecution).not.toHaveBeenCalled()
    await chooseAndFill()
    fireEvent.click(screen.getByRole('button', { name: '启动执行' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '启动中…' })).toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '启动中…' }))
    expect(executions.startBusinessExecution).toHaveBeenCalledTimes(1)
  })
  it('Escape保护已输入表单并允许继续编辑，键盘焦点留在共享Dialog内', async () => {
    const { onClose } = openDialog()
    await chooseAndFill()
    const dialog = screen.getByRole('dialog', { name: '启动 Skill / 工作流' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('有未提交的输入，确定放弃吗？')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))
    expect(screen.getByLabelText(/需求名称/)).toHaveValue('销售订单')
    const last = within(dialog).getByRole('button', { name: '启动执行' })
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(dialog).toContainElement(document.activeElement)
  })
})
describe('Schema业务输入', () => {
  it('支持嵌套参数、数值、布尔、枚举与数组而无需编辑JSON', () => {
    function Host() { const [value, setValue] = useState(initialBusinessInput(schema)); return <><BusinessInputForm schema={schema} value={value} onChange={setValue} /><output data-testid="value">{JSON.stringify(value)}</output></> }
    render(<Host />)
    fireEvent.change(screen.getByLabelText('相似系数'), { target: { value: '0.75' } })
    fireEvent.click(screen.getByLabelText('包含明细'))
    fireEvent.change(screen.getByLabelText('处理方式'), { target: { value: '完整' } })
    fireEvent.click(screen.getByRole('button', { name: '添加补充回答' }))
    fireEvent.change(screen.getByLabelText('补充回答 1'), { target: { value: '支持导出' } })
    expect(JSON.parse(screen.getByTestId('value').textContent)).toMatchObject({ enabled: true, mode: '完整', params: { rate: 0.75 }, answers: ['支持导出'] })
  })
  it('按服务端schema检查必填与数值范围', () => {
    expect(validateBusinessInput(schema, { title: '', count: 0 })).toMatchObject({ title: expect.any(String), count: expect.any(String) })
    expect(validateBusinessInput(schema, { title: '销售订单', count: 1 })).toEqual({})
  })
})

describe('服务端本地Schema引用', () => {
  it.each(['$defs', 'definitions'])('启动表单解析%s整数引用并保留数值校验', async group => {
    const referenced = { type: 'object', required: ['count'], [group]: { count: { type: 'integer', title: '组织数量', minimum: 1 } }, properties: { count: { $ref: `#/${group}/count` } } }
    executions.listExecutionCatalog.mockResolvedValue([{ ...catalog[0], inputSchema: referenced }])
    openDialog()
    await screen.findByRole('option', { name: '工作流 · 需求整理' })
    fireEvent.change(screen.getByLabelText('选择 Skill 或工作流'), { target: { value: 'workflow:flow-a' } })
    const field = screen.getByRole('spinbutton', { name: '组织数量' })
    fireEvent.change(field, { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: '启动执行' }))
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(executions.startBusinessExecution).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '启动执行' }))
    await waitFor(() => expect(executions.startBusinessExecution).toHaveBeenCalledTimes(1))
    expect(executions.startBusinessExecution.mock.calls[0][1].execution.input).toEqual({ count: 2 })
  })
  it.each([
    { $ref: 'https://example.invalid/schema' },
    { $ref: '#/$defs/missing' },
    { $ref: '#/$defs/cycle' },
  ])('无法解析的引用失败关闭且不会递归挂起：%j', ref => {
    const invalid = { type: 'object', $defs: { cycle: { $ref: '#/$defs/cycle' } }, properties: { count: ref } }
    expect(validateBusinessInput(invalid, { count: 2 })['']).toBe('输入结构暂不可用，请刷新后重试')
  })
})

describe('Schema枚举与固定值的JSON类型', () => {
  async function chooseCatalog(inputSchema) {
    executions.listExecutionCatalog.mockResolvedValue([{ ...catalog[0], inputSchema }])
    openDialog()
    await screen.findByRole('option', { name: '工作流 · 需求整理' })
    fireEvent.change(screen.getByLabelText('选择 Skill 或工作流'), { target: { value: 'workflow:flow-a' } })
  }
  it('无type布尔枚举false能够启动且保持布尔值', async () => {
    await chooseCatalog({ type: 'object', required: ['enabled'], properties: { enabled: { title: '是否纳入', enum: [true, false] } } })
    const select = screen.getByRole('combobox', { name: '是否纳入' })
    const option = within(select).getByRole('option', { name: 'false' })
    fireEvent.change(select, { target: { value: option.value } })
    fireEvent.click(screen.getByRole('button', { name: '启动执行' }))
    await waitFor(() => expect(executions.startBusinessExecution).toHaveBeenCalledTimes(1))
    expect(executions.startBusinessExecution.mock.calls[0][1].execution.input).toEqual({ enabled: false })
  })
  it('const布尔值初始化为合法固定值并拒绝不同值', async () => {
    const fixed = { type: 'object', required: ['approved'], properties: { approved: { title: '固定确认', const: true } } }
    await chooseCatalog(fixed)
    fireEvent.click(screen.getByRole('button', { name: '启动执行' }))
    await waitFor(() => expect(executions.startBusinessExecution).toHaveBeenCalledTimes(1))
    expect(executions.startBusinessExecution.mock.calls[0][1].execution.input).toEqual({ approved: true })
    expect(validateBusinessInput(fixed, { approved: false })).toHaveProperty('approved')
  })
  it('必填boolean的初始未勾选值明确为false且可通过', async () => {
    await chooseCatalog({ type: 'object', required: ['enabled'], properties: { enabled: { type: 'boolean', title: '是否纳入' } } })
    expect(screen.getByRole('checkbox', { name: '是否纳入' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '启动执行' }))
    await waitFor(() => expect(executions.startBusinessExecution).toHaveBeenCalledTimes(1))
    expect(executions.startBusinessExecution.mock.calls[0][1].execution.input).toEqual({ enabled: false })
  })
  it('混合primitive枚举的相同显示内容具有不同选项值并保持原类型', () => {
    const mixed = { type: 'object', properties: { choice: { title: '处理选项', enum: [1, '1', false, 'false', null] } } }
    function Host() { const [value, setValue] = useState(initialBusinessInput(mixed)); return <><BusinessInputForm schema={mixed} value={value} onChange={setValue} /><output data-testid="mixed">{JSON.stringify(value)}</output></> }
    render(<Host />)
    const select = screen.getByRole('combobox', { name: '处理选项' })
    const options = within(select).getAllByRole('option').slice(1)
    expect(new Set(options.map(option => option.value)).size).toBe(5)
    for (const [index, expected] of [1, '1', false, 'false', null].entries()) {
      fireEvent.change(select, { target: { value: options[index].value } })
      const result = JSON.parse(screen.getByTestId('mixed').textContent)
      expect(result.choice).toEqual(expected)
      expect(validateBusinessInput(mixed, result)).toEqual({})
    }
  })
  it('对象枚举选项不使用String对象作为冲突标识并保持所选对象', () => {
    const objectChoices = { type: 'object', required: ['choice'], properties: { choice: { title: '范围选择', enum: [{ scope: '销售' }, { scope: '采购' }] } } }
    function Host() { const [value, setValue] = useState(initialBusinessInput(objectChoices)); return <><BusinessInputForm schema={objectChoices} value={value} onChange={setValue} /><output data-testid="objects">{JSON.stringify(value)}</output></> }
    render(<Host />)
    const select = screen.getByRole('combobox', { name: '范围选择' })
    const options = within(select).getAllByRole('option').slice(1)
    expect(options[0].value).not.toBe(options[1].value)
    fireEvent.change(select, { target: { value: options[1].value } })
    const result = JSON.parse(screen.getByTestId('objects').textContent)
    expect(result).toEqual({ choice: { scope: '采购' } })
    expect(validateBusinessInput(objectChoices, result)).toEqual({})
  })
})
