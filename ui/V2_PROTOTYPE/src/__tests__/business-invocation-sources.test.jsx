import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import BusinessInputForm from '../pages/AiHomeWorkbench/components/BusinessInputForm.jsx'
import SkillInvocationDialog from '../pages/AiHomeWorkbench/components/SkillInvocationDialog.jsx'
import * as api from '../api/businessExecutions.js'
vi.mock('../api/businessExecutions.js', () => ({ listExecutionCatalog: vi.fn(), listExecutionTemplates: vi.fn(), uploadExecutionSource: vi.fn(), startBusinessExecution: vi.fn() }))
const target = { kind: 'workflow', id: 'actual-flow', name: '需求评估', inputSchema: { type: 'object', required: ['templateId'], properties: { templateId: { type: 'string', title: '评估模板' } } } }
const template = { templateId: 'actual-template', templateVersion: 'V3', templateName: '交付评估' }
const attachment = { attachmentId: 'real-file', name: '需求.md', sourceAvailable: true, sourceDigest: 'digest', sourceCharCount: 4 }
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function mount(extra = {}) {
  const props = { open: true, onClose: vi.fn(), onStarted: vi.fn(), ensureSession: vi.fn(async () => props.session || { sessionId: 'session-a' }), session: { sessionId: 'session-a' }, ...extra }
  const host = render(<SkillInvocationDialog {...props} />)
  return { ...host, props, update: patch => { Object.assign(props, patch); host.rerender(<SkillInvocationDialog {...props} />) } }
}
async function choose() {
  await screen.findByRole('option', { name: '工作流 · 需求评估' })
  fireEvent.change(screen.getByLabelText('选择 Skill 或工作流'), { target: { value: 'workflow:actual-flow' } })
}
async function pickTemplate() {
  await screen.findByRole('option', { name: '交付评估 · V3' })
  fireEvent.change(screen.getByRole('combobox', { name: '评估模板' }), { target: { value: 'actual-template' } })
}
function upload(file = new File(['真实需求'], '需求.md', { type: 'text/markdown' })) {
  fireEvent.change(screen.getByLabelText('上传需求材料'), { target: { files: [file] } })
  return file
}
beforeEach(() => {
  vi.resetAllMocks()
  api.listExecutionCatalog.mockResolvedValue([target])
  api.listExecutionTemplates.mockResolvedValue([template])
  api.uploadExecutionSource.mockResolvedValue(attachment)
  api.startBusinessExecution.mockResolvedValue({ runId: 'run-new', sessionId: 'session-a' })
})
it('先创建并保留会话再上传实际文件，上传完成不会自动执行，显式启动传真实来源和模板资产', async () => {
  const created = { sessionId: 'session-a' }
  function Host() {
    const [session, setSession] = useState(null)
    return <SkillInvocationDialog open session={session} ensureSession={async () => { setSession(created); return created }} onClose={() => {}} />
  }
  render(<Host />)
  await choose(); await pickTemplate()
  const file = upload()
  await waitFor(() => expect(api.uploadExecutionSource).toHaveBeenCalledWith('session-a', file))
  expect(await screen.findByRole('checkbox', { name: '需求.md' })).toBeChecked()
  expect(api.startBusinessExecution).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '启动执行' }))
  await waitFor(() => expect(api.startBusinessExecution).toHaveBeenCalledTimes(1))
  expect(api.startBusinessExecution.mock.calls[0][1].execution).toEqual({ kind: 'workflow', workflowId: 'actual-flow', input: { templateId: 'actual-template' }, sources: [{ kind: 'file', id: 'real-file' }], assets: [{ kind: 'assessment-catalog', templateId: 'actual-template' }] })
})
it('旧摘要材料明确不可作原始来源，选择模板前不能发送伪造ID', async () => {
  mount({ session: { sessionId: 'session-a', attachments: [{ attachmentId: 'old-file', name: '旧摘要.xlsx', sourceAvailable: false }] } })
  await choose()
  expect(screen.getByRole('checkbox', { name: /旧摘要.xlsx/ })).toBeDisabled()
  expect(screen.getByText(/原文不可用/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '启动执行' }))
  expect(api.startBusinessExecution).not.toHaveBeenCalled()
  await pickTemplate()
  fireEvent.click(screen.getByRole('button', { name: '启动执行' }))
  await waitFor(() => expect(api.startBusinessExecution).toHaveBeenCalledTimes(1))
  expect(api.startBusinessExecution.mock.calls[0][1].execution).not.toHaveProperty('sources')
})
it.each([401, 413, 409, 500])('上传失败%s保留输入、解锁并能选择同一文件重试，未知服务端内容不显示', async status => {
  api.uploadExecutionSource.mockRejectedValueOnce(Object.assign(new Error('secret-internal-error'), { status }))
  const host = mount(); await choose(); await pickTemplate()
  const file = upload()
  await screen.findByRole('alert')
  expect(screen.queryByText('secret-internal-error')).not.toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: '评估模板' })).toHaveValue('actual-template')
  expect(screen.getByLabelText('上传需求材料')).toBeEnabled()
  expect(screen.getByLabelText('上传需求材料')).toHaveValue('')
  expect(host.props.onStarted).not.toHaveBeenCalled()
  upload(file)
  expect(await screen.findByRole('checkbox', { name: '需求.md' })).toBeChecked()
})
it('超过2MiB在创建会话前拒绝，上传中禁止关闭和启动', async () => {
  const pending = defer(); api.uploadExecutionSource.mockReturnValue(pending.promise)
  const host = mount(); await choose(); await pickTemplate()
  upload(new File([new Uint8Array(2 * 1024 * 1024 + 1)], '过大.md'))
  expect(await screen.findByRole('alert')).toHaveTextContent('2 MiB')
  expect(host.props.ensureSession).not.toHaveBeenCalled()
  upload()
  await waitFor(() => expect(api.uploadExecutionSource).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('button', { name: '启动执行' })).toBeDisabled()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(host.props.onClose).not.toHaveBeenCalled()
  await act(async () => pending.resolve(attachment))
})
it.each([false, true])('跨会话迟到上传不能显示、勾选或启动新会话（ABA %s）', async aba => {
  const pending = defer(); api.uploadExecutionSource.mockReturnValue(pending.promise)
  const host = mount(); await choose(); upload()
  await waitFor(() => expect(api.uploadExecutionSource).toHaveBeenCalledTimes(1))
  host.update({ session: { sessionId: 'session-b' } })
  if (aba) host.update({ session: { sessionId: 'session-a' } })
  await choose(); await pickTemplate()
  await act(async () => pending.resolve(attachment))
  expect(screen.queryByRole('checkbox', { name: '需求.md' })).not.toBeInTheDocument()
  expect(api.startBusinessExecution).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '启动执行' }))
  await waitFor(() => expect(api.startBusinessExecution).toHaveBeenCalledTimes(1))
  expect(api.startBusinessExecution.mock.calls[0][0]).toBe(aba ? 'session-a' : 'session-b')
  expect(api.startBusinessExecution.mock.calls[0][1].execution).not.toHaveProperty('sources')
})
it('会话切换使迟到启动结果失效，不关闭新会话弹窗', async () => {
  const pending = defer(); api.startBusinessExecution.mockReturnValue(pending.promise)
  const host = mount(); await choose(); await pickTemplate()
  fireEvent.click(screen.getByRole('button', { name: '启动执行' }))
  await waitFor(() => expect(api.startBusinessExecution).toHaveBeenCalledTimes(1))
  host.update({ session: { sessionId: 'session-b' } })
  await act(async () => pending.resolve({ runId: 'old-run' }))
  expect(host.props.onStarted).not.toHaveBeenCalled()
  expect(host.props.onClose).not.toHaveBeenCalled()
})
it('模板列表失败不阻止没有模板字段的通用Skill', async () => {
  api.listExecutionTemplates.mockRejectedValue(new Error('internal'))
  api.listExecutionCatalog.mockResolvedValue([{ ...target, inputSchema: { type: 'object', additionalProperties: false } }])
  mount(); await choose()
  fireEvent.click(screen.getByRole('button', { name: '启动执行' }))
  await waitFor(() => expect(api.startBusinessExecution).toHaveBeenCalledTimes(1))
})

it('模板异步响应不能在切换会话再返回后填入新表单', async () => {
  const pending = defer(); api.listExecutionTemplates.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([template])
  const host = mount(); await choose()
  host.update({ session: { sessionId: 'session-b' } })
  await choose()
  await screen.findByRole('option', { name: '交付评估 · V3' })
  await act(async () => pending.resolve([{ templateId: 'stale-template', templateName: '旧会话模板', templateVersion: 'V1' }]))
  expect(screen.queryByRole('option', { name: /旧会话模板/ })).not.toBeInTheDocument()
})
it('关闭再打开后迟到目录不覆盖当前目录', async () => {
  const pending = defer(); api.listExecutionCatalog.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([target])
  const host = mount()
  host.update({ open: false }); host.update({ open: true })
  await choose()
  await act(async () => pending.resolve([{ ...target, id: 'old-flow', name: '旧目录' }]))
  expect(screen.queryByRole('option', { name: /旧目录/ })).not.toBeInTheDocument()
})
it('同一材料和模板失败重试复用key，变更模板或材料后换key', async () => {
  api.listExecutionTemplates.mockResolvedValue([template, { ...template, templateId: 'second-template', templateName: '另一模板' }])
  api.startBusinessExecution.mockRejectedValue(new Error('网络请求失败'))
  mount(); await choose(); await pickTemplate(); upload()
  await screen.findByRole('checkbox', { name: '需求.md' })
  async function start(count) {
    fireEvent.click(screen.getByRole('button', { name: '启动执行' }))
    await waitFor(() => expect(api.startBusinessExecution).toHaveBeenCalledTimes(count))
    await waitFor(() => expect(screen.getByRole('button', { name: '启动执行' })).toBeEnabled())
    return api.startBusinessExecution.mock.calls[count - 1][1].submissionKey
  }
  const first = await start(1)
  expect(await start(2)).toBe(first)
  fireEvent.change(screen.getByRole('combobox', { name: '评估模板' }), { target: { value: 'second-template' } })
  const second = await start(3); expect(second).not.toBe(first)
  fireEvent.click(screen.getByRole('checkbox', { name: '需求.md' }))
  expect(await start(4)).not.toBe(second)
})

it('按字段路径提供资源且保留const/enum的JSON类型与格式资源兼容', () => {
  const change = vi.fn()
  const schema = { type: 'object', properties: { templateId: { title: '实际模板', const: 'actual-template' }, enabled: { title: '布尔资源', enum: [false, true] }, original: { title: '原格式资源', type: 'string', format: 'legacy-resource' } } }
  render(<BusinessInputForm schema={schema} value={{}} onChange={change} resourceOptions={{ byPath: { templateId: [{ id: 'actual-template', name: '真实模板' }, { id: 'forbidden', name: '越界模板' }], enabled: [{ id: 'false-choice', name: '不启用', value: false }] }, 'legacy-resource': [{ id: 'existing-resource', name: '旧资源' }] }} />)
  expect(screen.getByRole('option', { name: '真实模板' })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: '越界模板' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('combobox', { name: '布尔资源' }), { target: { value: 'false-choice' } })
  expect(change).toHaveBeenCalledWith({ enabled: false })
  fireEvent.change(screen.getByRole('combobox', { name: '原格式资源' }), { target: { value: 'existing-resource' } })
  expect(change).toHaveBeenCalledWith({ original: 'existing-resource' })
})
it('上传成功后的真实材料在同会话重新打开时仍可选，但不保留上次启动勾选', async () => {
  const host = mount(); await choose(); upload()
  expect(await screen.findByRole('checkbox', { name: '需求.md' })).toBeChecked()
  host.update({ open: false }); host.update({ open: true })
  await choose()
  await waitFor(() => expect(screen.queryByText('评估模板加载中…')).not.toBeInTheDocument())
  expect(screen.getByRole('checkbox', { name: '需求.md' })).not.toBeChecked()
  expect(api.startBusinessExecution).not.toHaveBeenCalled()
})
it('父页面刷新后的服务端附件元数据优先于本地上传元数据', async () => {
  const host = mount(); await choose(); upload()
  expect(await screen.findByRole('checkbox', { name: '需求.md' })).toBeChecked()
  host.update({ session: { sessionId: 'session-a', attachments: [{ ...attachment, sourceAvailable: false }] } })
  expect(screen.getByRole('checkbox', { name: /需求.md/ })).toBeDisabled()
})
it('字段路径资源同时满足enum与const，只展示两项约束共同允许的模板', () => {
  render(<BusinessInputForm schema={{ type: 'object', properties: { templateId: { type: 'string', title: '受限模板', enum: ['actual-template', 'other-template'], const: 'actual-template' } } }} value={{ templateId: 'actual-template' }} onChange={vi.fn()} resourceOptions={{ byPath: { templateId: [{ id: 'actual-template', name: '允许的真实模板' }, { id: 'other-template', name: '固定值禁止的模板' }] } }} />)
  const select = screen.getByRole('combobox', { name: '受限模板' })
  expect(select).toHaveValue('actual-template')
  expect(screen.getByRole('option', { name: '允许的真实模板' })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: '固定值禁止的模板' })).not.toBeInTheDocument()
})
