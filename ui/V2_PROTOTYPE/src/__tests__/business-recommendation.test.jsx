import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import SkillInvocationDialog from '../pages/AiHomeWorkbench/components/SkillInvocationDialog.jsx'
import * as api from '../api/businessExecutions.js'
vi.mock('../api/businessExecutions.js', () => ({ listExecutionCatalog: vi.fn(), recommendBusinessExecutions: vi.fn(), listExecutionTemplates: vi.fn(), uploadExecutionSource: vi.fn(), startBusinessExecution: vi.fn() }))
const target = { kind: 'skill', id: 'actual-skill', versionId: 'v1', name: '需求拆解', description: '拆解已选材料', inputSchema: {
  type: 'object', required: ['text'], properties: { text: { type: 'string', title: '需求正文', minLength: 1 } }, additionalProperties: false,
} }
const other = { ...target, id: 'other-skill', name: '另一技能' }
const card = ({ kind, id, versionId, name, description }) => ({ kind, id, versionId, name, description })
const result = { outcome: 'recommended', message: '请选择候选项，补齐输入后明确启动。', items: [card(target)] }
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function mount(extra = {}) {
  const props = { open: true, onClose: vi.fn(), onStarted: vi.fn(), ensureSession: vi.fn(async () => props.session), session: { sessionId: 'session-a' }, ...extra }
  const host = render(<SkillInvocationDialog {...props} />)
  return { ...host, props, update: patch => { Object.assign(props, patch); host.rerender(<SkillInvocationDialog {...props} />) } }
}
async function ready() { await screen.findByRole('option', { name: 'Skill · 需求拆解' }) }
function goal(value = '拆解订单需求') { fireEvent.change(screen.getByLabelText('本次业务目标'), { target: { value } }) }
function requestRecommendation() { fireEvent.click(screen.getByRole('button', { name: '获取推荐' })) }
async function recommend() { await ready(); goal(); requestRecommendation(); return screen.findByRole('button', { name: '选择并补齐输入' }) }
function manual(id = 'actual-skill') { fireEvent.change(screen.getByLabelText('选择 Skill 或工作流'), { target: { value: `skill:${id}` } }) }
beforeEach(() => {
  vi.resetAllMocks(); api.listExecutionCatalog.mockResolvedValue([target, other]); api.recommendBusinessExecutions.mockResolvedValue(result)
  api.listExecutionTemplates.mockResolvedValue([]); api.startBusinessExecution.mockResolvedValue({ runId: 'r1' })
})
it('同一启动Dialog仅显式请求推荐，卡片只预选，填表和最终启动仍明确分开', async () => {
  const host = mount(); await ready(); expect(api.recommendBusinessExecutions).not.toHaveBeenCalled()
  goal(); expect(api.recommendBusinessExecutions).not.toHaveBeenCalled(); requestRecommendation()
  fireEvent.click(await screen.findByRole('button', { name: '选择并补齐输入' }))
  await waitFor(() => expect(screen.getByLabelText('选择 Skill 或工作流')).toHaveValue('skill:actual-skill'))
  expect(screen.getByLabelText('选择 Skill 或工作流')).toHaveFocus()
  expect(api.recommendBusinessExecutions).toHaveBeenCalledWith('拆解订单需求')
  expect(api.listExecutionCatalog).toHaveBeenCalledTimes(3); expect(host.props.ensureSession).not.toHaveBeenCalled()
  expect(api.uploadExecutionSource).not.toHaveBeenCalled(); expect(api.startBusinessExecution).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '启动执行' })); expect(api.startBusinessExecution).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText(/需求正文/), { target: { value: '客户订单需求' } })
  fireEvent.click(screen.getByRole('button', { name: '启动执行' }))
  await waitFor(() => expect(api.startBusinessExecution).toHaveBeenCalledTimes(1))
  expect(api.startBusinessExecution.mock.calls[0][1].execution).toEqual({ kind: 'skill', skillId: 'actual-skill', input: { text: '客户订单需求' } })
})
it.each(['error', 'no_match'])('推荐%s保留手动选择；关闭弹窗可继续原会话，不自动发送聊天', async mode => {
  if (mode === 'error') api.recommendBusinessExecutions.mockRejectedValue(new Error('PRIVATE_PROVIDER_TEXT'))
  else api.recommendBusinessExecutions.mockResolvedValue({ outcome: 'no_match', items: [], message: 'PRIVATE_MODEL_TEXT' })
  const host = mount(); await ready(); goal(); requestRecommendation()
  await screen.findByText(mode === 'error' ? '推荐暂不可用，请重试或手动选择。' : '请补充希望完成的业务目标，或继续普通对话。')
  expect(screen.queryByText(/PRIVATE_/)).not.toBeInTheDocument(); manual()
  expect(screen.getByLabelText(/需求正文/)).toBeInTheDocument(); expect(api.startBusinessExecution).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '取消' })); fireEvent.click(screen.getByRole('button', { name: '放弃输入' }))
  expect(host.props.onClose).toHaveBeenCalledTimes(1); expect(host.props.ensureSession).not.toHaveBeenCalled()
})
it('推荐目标最多4000字且错误关联字段，不发送超过上限的目标', async () => {
  mount(); await ready(); expect(screen.getByLabelText('本次业务目标')).toHaveAttribute('maxlength', '4000')
  goal('x'.repeat(4001)); requestRecommendation()
  expect(await screen.findByRole('alert')).toHaveTextContent('4000')
  expect(screen.getByLabelText('本次业务目标')).toHaveAttribute('aria-invalid', 'true'); expect(api.recommendBusinessExecutions).not.toHaveBeenCalled()
})
it.each([null, { outcome: 'recommended', items: 'invalid' }, { outcome: 'recommended', items: [] },
  { ...result, items: [card(target), card(target)] }, { ...result, items: [{ ...card(target), id: 'unknown' }] },
  { ...result, items: [{ ...card(target), versionId: 'old' }] }, { outcome: 'no_match', items: [card(target)] }])('异常或目录外推荐不成为可选卡片 %j', async response => {
  api.recommendBusinessExecutions.mockResolvedValue(response); mount(); await ready(); goal(); requestRecommendation()
  expect(await screen.findByRole('alert')).toHaveTextContent('推荐结果已失效，请重新获取或手动选择。')
  expect(screen.queryByRole('button', { name: '选择并补齐输入' })).not.toBeInTheDocument(); expect(api.startBusinessExecution).not.toHaveBeenCalled()
})
it('推荐卡片用途只采用已授权目录文本，忽略服务端额外自由文本', async () => {
  api.recommendBusinessExecutions.mockResolvedValue({ ...result, message: 'PRIVATE_RAW', items: [{ ...card(target), name: 'PRIVATE_NAME', description: 'PRIVATE_REASON' }] })
  mount(); await recommend(); expect(screen.getByRole('heading', { name: '需求拆解' })).toBeInTheDocument()
  expect(screen.getByText('拆解已选材料')).toBeInTheDocument(); expect(screen.queryByText(/PRIVATE_/)).not.toBeInTheDocument()
})
it.each(['revoked', 'version', 'scope'])('点击卡片重新读取当前目录，%s变化清空旧选择并提示手动选择', async mode => {
  mount(); const choose = await recommend()
  api.listExecutionCatalog.mockResolvedValue(mode === 'revoked' ? [other] : [{ ...target, ...(mode === 'version' ? { versionId: 'v2' } : { kind: 'workflow' }) }, other])
  fireEvent.click(choose); expect(await screen.findByText('目录已变化，请手动重新选择。')).toBeInTheDocument()
  expect(screen.getByLabelText('选择 Skill 或工作流')).toHaveValue(''); expect(api.startBusinessExecution).not.toHaveBeenCalled()
})
it('卡片目录读取失败保留当前手动输入和材料，不展示底层错误', async () => {
  mount({ session: { sessionId: 'session-a', attachments: [{ attachmentId: 'f1', name: '真实材料.md', sourceAvailable: true }] } })
  await ready(); manual(); fireEvent.change(screen.getByLabelText(/需求正文/), { target: { value: '已填输入' } })
  fireEvent.click(screen.getByRole('checkbox', { name: '真实材料.md' })); goal(); requestRecommendation()
  const choose = await screen.findByRole('button', { name: '选择并补齐输入' }); api.listExecutionCatalog.mockRejectedValue(new Error('PRIVATE_DB_DETAIL')); fireEvent.click(choose)
  expect(await screen.findByText('推荐暂不可用，请重试或手动选择。')).toBeInTheDocument()
  expect(screen.getByLabelText(/需求正文/)).toHaveValue('已填输入'); expect(screen.getByRole('checkbox', { name: '真实材料.md' })).toBeChecked()
  expect(api.uploadExecutionSource).not.toHaveBeenCalled(); expect(api.startBusinessExecution).not.toHaveBeenCalled()
})
for (const change of ['session', 'aba', 'reopen', 'goal', 'goal-aba', 'target', 'target-aba']) {
  it(`推荐迟到响应在${change}变更后失效`, async () => {
    const pending = defer(); api.recommendBusinessExecutions.mockReturnValueOnce(pending.promise)
    const host = mount(); await ready(); goal(); requestRecommendation(); expect(api.recommendBusinessExecutions).toHaveBeenCalledTimes(1)
    if (change === 'session' || change === 'aba') { host.update({ session: { sessionId: 'session-b' } }); if (change === 'aba') host.update({ session: { sessionId: 'session-a' } }); await ready() }
    if (change === 'reopen') { host.update({ open: false }); host.update({ open: true }); await ready() }
    if (change.startsWith('goal')) { goal('另一目标'); if (change === 'goal-aba') goal('拆解订单需求') }
    if (change.startsWith('target')) { manual('other-skill'); if (change === 'target-aba') manual() }
    const beforeResolve = api.listExecutionCatalog.mock.calls.length
    await act(async () => pending.resolve(result))
    expect(api.listExecutionCatalog).toHaveBeenCalledTimes(beforeResolve)
    expect(screen.queryByRole('button', { name: '选择并补齐输入' })).not.toBeInTheDocument(); expect(api.startBusinessExecution).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '获取推荐' })).toBeEnabled()
  })
}
it('较新推荐请求先返回时，旧请求返回不能覆盖卡片', async () => {
  const old = defer(); api.recommendBusinessExecutions.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...result, items: [card(other)] })
  mount(); await ready(); goal(); requestRecommendation(); goal('另一目标'); requestRecommendation()
  await screen.findByRole('heading', { name: '另一技能' }); const beforeOld = api.listExecutionCatalog.mock.calls.length
  await act(async () => old.resolve(result)); expect(api.listExecutionCatalog).toHaveBeenCalledTimes(beforeOld)
  expect(screen.getByRole('heading', { name: '另一技能' })).toBeInTheDocument(); expect(screen.queryByRole('heading', { name: '需求拆解' })).not.toBeInTheDocument()
})
it.each(['goal', 'target', 'reopen', 'aba'])('卡片目录迟到读取不能在%s变更后替换新表单', async change => {
  const host = mount(); const choose = await recommend(); const pending = defer(); api.listExecutionCatalog.mockReturnValueOnce(pending.promise)
  fireEvent.click(choose); expect(api.listExecutionCatalog).toHaveBeenCalledTimes(3)
  if (change === 'goal') goal('新的目标')
  if (change === 'target') manual('other-skill')
  if (change === 'reopen') { host.update({ open: false }); host.update({ open: true }); await ready() }
  if (change === 'aba') { host.update({ session: { sessionId: 'session-b' } }); host.update({ session: { sessionId: 'session-a' } }); await ready() }
  await act(async () => pending.resolve([target, other]))
  expect(screen.getByLabelText('选择 Skill 或工作流')).toHaveValue(change === 'target' ? 'skill:other-skill' : '')
  expect(api.startBusinessExecution).not.toHaveBeenCalled()
})
it('明确启动期间迟到的推荐被丢弃，启动失败后推荐控件自行恢复', async () => {
  const pending = defer(); let rejectStart
  api.recommendBusinessExecutions.mockReturnValueOnce(pending.promise)
  api.startBusinessExecution.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectStart = reject }))
  mount(); await ready(); manual(); fireEvent.change(screen.getByLabelText(/需求正文/), { target: { value: '已确认输入' } })
  goal(); requestRecommendation(); fireEvent.click(screen.getByRole('button', { name: '启动执行' }))
  await waitFor(() => expect(api.startBusinessExecution).toHaveBeenCalledTimes(1))
  await act(async () => pending.resolve(result)); await act(async () => rejectStart(new Error('网络请求失败')))
  expect(screen.queryByRole('button', { name: '选择并补齐输入' })).not.toBeInTheDocument()
  expect(screen.getByLabelText(/需求正文/)).toHaveValue('已确认输入')
  expect(screen.getByRole('button', { name: '获取推荐' })).toBeEnabled()
})
it('推荐期间A升为B时按新目录展示B卡片，明确选卡前保留A输入，选卡后使用B契约启动', async () => {
  const upgraded = { ...target, versionId: 'v2', name: '需求拆解新版', description: '当前发布用途', inputSchema: {
    type: 'object', required: ['detail'], properties: { detail: { type: 'string', title: '新版需求内容' } }, additionalProperties: false,
  } }
  const pending = defer(); api.recommendBusinessExecutions.mockReturnValueOnce(pending.promise)
  mount(); await ready(); manual(); fireEvent.change(screen.getByLabelText(/需求正文/), { target: { value: '保留A的手动输入' } })
  goal(); requestRecommendation(); api.listExecutionCatalog.mockResolvedValue([upgraded, other])
  await act(async () => pending.resolve({ ...result, items: [card(upgraded)] }))
  expect(await screen.findByRole('heading', { name: '需求拆解新版' })).toBeInTheDocument()
  expect(screen.getByText('当前发布用途')).toBeInTheDocument(); expect(screen.getByLabelText(/需求正文/)).toHaveValue('保留A的手动输入')
  expect(screen.getByRole('option', { name: 'Skill · 需求拆解' })).toBeInTheDocument()
  expect(api.listExecutionCatalog).toHaveBeenCalledTimes(2); expect(api.startBusinessExecution).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '选择并补齐输入' }))
  const input = await screen.findByLabelText(/新版需求内容/)
  expect(api.listExecutionCatalog).toHaveBeenCalledTimes(3); expect(screen.queryByLabelText(/需求正文/)).not.toBeInTheDocument()
  expect(api.startBusinessExecution).not.toHaveBeenCalled(); fireEvent.change(input, { target: { value: 'B契约输入' } })
  fireEvent.click(screen.getByRole('button', { name: '启动执行' }))
  await waitFor(() => expect(api.startBusinessExecution).toHaveBeenCalledTimes(1))
  expect(api.startBusinessExecution.mock.calls[0][1].execution).toEqual({ kind: 'skill', skillId: 'actual-skill', input: { detail: 'B契约输入' } })
})
it.each(['goal', 'session', 'reopen'])('推荐后目录读取迟到在%s变化后不展示旧卡片', async change => {
  const pending = defer(); const host = mount(); await ready()
  api.listExecutionCatalog.mockReturnValueOnce(pending.promise); goal(); requestRecommendation()
  await waitFor(() => expect(api.listExecutionCatalog).toHaveBeenCalledTimes(2))
  if (change === 'goal') goal('新目标')
  if (change === 'session') { host.update({ session: { sessionId: 'session-b' } }); await ready() }
  if (change === 'reopen') { host.update({ open: false }); host.update({ open: true }); await ready() }
  await act(async () => pending.resolve([target, other]))
  expect(screen.queryByRole('button', { name: '选择并补齐输入' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '获取推荐' })).toBeEnabled(); expect(api.startBusinessExecution).not.toHaveBeenCalled()
})
