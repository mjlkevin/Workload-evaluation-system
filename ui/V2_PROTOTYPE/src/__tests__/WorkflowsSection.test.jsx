import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { beforeEach, expect, test } from 'vitest'
import WorkflowsSection from '../pages/system/WorkflowsSection.jsx'
import { server } from './mocks/server.js'
const BASE = '/api/v1/workflows'
const schema = { type: 'object', properties: {}, additionalProperties: false }
const step = (id = 's1') => ({ id, name: id, type: 'userInput', prompt: '填写说明', inputSchema: schema, outputSchema: schema, inputMapping: [], onFailure: 'wait' })
const definition = { name: '交付流程', description: '', category: '交付', roles: ['delivery'], inputSchema: schema, outputSchema: schema, steps: [step()], outputMapping: [] }
let record, writes, publishedSkills
const version = (id, extra = {}) => ({ workflowVersionId: id, versionCode: id, definition: structuredClone(definition), hash: id, status: 'draft', checkoutStatus: 'checked_in', checkedOutBy: null, ...extra })
const proof = (id = 'p') => ({ id, versionId: 'v1', hash: 'v1', dependencyHash: 'dep', mode: 'static', executionPerformed: false })
function readiness(extra = {}) { return { revision: record.revision, versionId: record.currentVersionId, hash: record.versions.at(-1).hash, dependencyHash: 'dep', mode: 'static', executionPerformed: false, validation: null, review: null, blockers: ['WORKFLOW_STATIC_VALIDATION_REQUIRED'], publishAvailable: false, rollbackVersions: [], ...extra } }
const ok = data => HttpResponse.json({ code: 0, data })
beforeEach(() => {
  writes = []; publishedSkills = []
  record = { workflowId: 'wf1', currentVersionId: 'v1', activeVersionId: null, revision: 1, enabled: true, archived: false, versions: [version('v0'), version('v1')], audit: [] }
  server.use(http.get(BASE, () => ok({ items: [record] })), http.get(`${BASE}/metadata`, () => ok({ viewerId: 'a1', roles: ['delivery', 'pm'], tools: [{ name: 'query', mutates: true, requiresConfirmation: true, parameters: schema, allowedRoles: ['delivery'], policy: { enabled: true } }], publishedSkills })), http.get(`${BASE}/:id`, () => ok({ record })), http.get(`${BASE}/:id/release`, () => ok(readiness())), http.get(`${BASE}/:id/dependencies`, ({ request }) => ok({ versionId: new URL(request.url).searchParams.get('versionId'), frozen: false, snapshot: { skills: [], tools: [] }, issues: [] })), http.post(`${BASE}/:id/checkout`, () => { record = { ...record, revision: record.revision + 1, versions: [version('v0'), version('v1', { checkoutStatus: 'checked_out', checkedOutBy: 'a1' })] }; return ok({ record }) }), http.patch(`${BASE}/:id/save-draft`, async ({ request }) => { const body = await request.json(); writes.push(body); record = { ...record, revision: record.revision + 1, versions: [version('v0'), version('v1', { definition: body.definition, checkoutStatus: 'checked_out', checkedOutBy: 'a1' })] }; return ok({ record }) }), http.post(BASE, async ({ request }) => { writes.push(await request.json()); return ok({ record }) }))
})
async function open() { render(<WorkflowsSection />); fireEvent.click(await screen.findByRole('button', { name: '查看 交付流程' })); return screen.findByRole('dialog', { name: 'Workflow 定义' }) }
async function edit() { const d = await open(); fireEvent.click(within(d).getByRole('button', { name: '检出' })); await waitFor(() => expect(within(d).getByLabelText('名称')).toBeEnabled()); return d }
test('已检入/历史只读，owner 检出可编辑，dirty 版本切换与关闭需放弃确认', async () => {
  const d = await edit(); fireEvent.change(within(d).getByLabelText('名称'), { target: { value: '未保存' } })
  fireEvent.change(within(d).getByLabelText('查看版本'), { target: { value: 'v0' } })
  expect(within(d).getByText('有未保存的修改，确定放弃并切换版本吗？')).toBeInTheDocument()
  fireEvent.click(within(d).getByRole('button', { name: '继续编辑' })); expect(within(d).getByLabelText('名称')).toHaveValue('未保存')
  fireEvent.keyDown(d, { key: 'Escape' }); fireEvent.click(within(d).getByRole('button', { name: '放弃修改' })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
test('JSON 和后端字段错误保留输入，保存携带最新 revision', async () => {
  const d = await edit(); const field = within(d).getByLabelText('输入 Schema (JSON)')
  fireEvent.change(field, { target: { value: '{bad' } }); fireEvent.click(within(d).getByRole('button', { name: '保存草稿' }))
  expect(field).toHaveAttribute('aria-invalid', 'true'); expect(writes).toHaveLength(0)
  fireEvent.change(field, { target: { value: JSON.stringify(schema) } })
  server.use(http.patch(`${BASE}/:id/save-draft`, () => HttpResponse.json({ message: '定义不合法', details: [{ field: 'definition/steps/0/prompt', reason: 'prompt_required' }] }, { status: 409 })))
  fireEvent.change(within(d).getByLabelText('名称'), { target: { value: '保留值' } }); fireEvent.click(within(d).getByRole('button', { name: '保存草稿' }))
  expect(await within(d).findByRole('alert')).toHaveTextContent('definition/steps/0/prompt'); expect(within(d).getByLabelText('名称')).toHaveValue('保留值')
})
test('步骤用弹窗编辑，固定 published Skill ID，可排序删除并保存', async () => {
  publishedSkills = [{ skillId: 'sk1', skillVersionId: 'exact-v2', name: '拆解', versionCode: 'A.2', active: true, enabled: true, archived: false, roles: ['delivery'] }, { skillId: 'sk1', skillVersionId: 'exact-v1', name: '拆解', versionCode: 'A.1', active: false, enabled: false, archived: false, roles: ['delivery'] }]
  const d = await edit(); fireEvent.click(within(d).getByRole('button', { name: '添加步骤' })); const sd = await screen.findByRole('dialog', { name: '添加步骤' })
  fireEvent.change(within(sd).getByLabelText('步骤类型'), { target: { value: 'skill' } }); fireEvent.change(within(sd).getByLabelText('步骤名称'), { target: { value: '拆解步骤' } })
  expect(within(sd).getByLabelText('固定 Skill 版本')).toHaveValue('exact-v2'); expect(within(sd).queryByRole('option', { name: /A.1/ })).not.toBeInTheDocument()
  fireEvent.click(within(sd).getByRole('button', { name: '应用步骤' })); fireEvent.click(within(d).getByRole('button', { name: '上移 拆解步骤' })); fireEvent.click(within(d).getByRole('button', { name: '保存草稿' }))
  await waitFor(() => expect(writes).toHaveLength(1)); expect(writes[0].revision).toBe(2); expect(writes[0].definition.steps[0]).toMatchObject({ type: 'skill', skillId: 'sk1', skillVersionId: 'exact-v2' })
  fireEvent.click(within(d).getByRole('button', { name: '移除 s1' })); expect(within(d).queryByRole('button', { name: '编辑 s1' })).not.toBeInTheDocument()
})
test('无 published Skill 可创建人工作流且不会虚构依赖', async () => {
  render(<WorkflowsSection />); fireEvent.click(await screen.findByRole('button', { name: '新建 Workflow' })); const d = screen.getByRole('dialog', { name: '新建 Workflow' })
  fireEvent.change(within(d).getByLabelText('名称'), { target: { value: '人工流程' } }); fireEvent.click(within(d).getByRole('button', { name: '创建' })); await waitFor(() => expect(writes).toHaveLength(1)); expect(writes[0].definition.steps[0].type).toBe('userInput')
})
test('静态证明未执行，理由必填，发布需要当前 revision/hash/dependencyHash 及确认', async () => {
  server.use(http.get(`${BASE}/:id/release`, () => ok(readiness({ validation: proof(), review: { ...proof('r'), validationId: 'p' }, blockers: [], publishAvailable: true }))), http.post(`${BASE}/:id/publish`, async ({ request }) => { writes.push(await request.json()); return ok({ record: { ...record, revision: 2 } }) }))
  const d = await open(); expect(await within(d).findByText('已校验（未执行）')).toBeInTheDocument(); expect(within(d).getByRole('button', { name: '复核通过' })).toBeDisabled()
  await waitFor(() => expect(within(d).getByRole('button', { name: '发布' })).toBeEnabled()); fireEvent.click(within(d).getByRole('button', { name: '发布' })); const c = screen.getByRole('dialog', { name: '发布 Workflow' }); fireEvent.click(within(c).getByRole('button', { name: '确认发布' })); await waitFor(() => expect(writes).toEqual([{ revision: 1 }]))
})
test('错误依赖证明和迟到 release 响应不能启用发布', async () => {
  server.use(http.get(`${BASE}/:id/release`, async () => { await delay(100); return ok(readiness({ validation: proof(), review: { ...proof('r'), dependencyHash: 'old', validationId: 'p' }, publishAvailable: true })) }))
  const d = await open(); await act(() => delay(150)); expect(within(d).getByRole('button', { name: '发布' })).toBeDisabled()
  fireEvent.change(within(d).getByLabelText('查看版本'), { target: { value: 'v0' } }); await act(() => delay(150)); expect(within(d).getByLabelText('名称')).toBeDisabled(); expect(within(d).getByRole('button', { name: '发布' })).toBeDisabled()
})
test('其他管理员检出不能保存或配置校验；服务端 403 明确显示', async () => {
  record.versions[1] = version('v1', { checkoutStatus: 'checked_out', checkedOutBy: 'other' }); const d = await open()
  expect(within(d).getByLabelText('名称')).toBeDisabled(); expect(within(d).queryByRole('button', { name: '保存草稿' })).not.toBeInTheDocument(); expect(within(d).getByRole('button', { name: '配置校验' })).toBeDisabled()
})
test('回滚错误保留目标和理由，不改变生效指针', async () => {
  record.activeVersionId = 'v1'; server.use(http.get(`${BASE}/:id/release`, () => ok(readiness({ rollbackVersions: [{ versionId: 'v0', versionCode: 'v0' }] }))), http.post(`${BASE}/:id/rollback`, () => HttpResponse.json({ message: '依赖不可用' }, { status: 409 })))
  const d = await open(); await waitFor(() => expect(within(d).getByRole('option', { name: 'v0' })).toBeInTheDocument()); fireEvent.change(within(d).getByLabelText('回滚目标'), { target: { value: 'v0' } }); fireEvent.change(within(d).getByLabelText('回滚理由'), { target: { value: '恢复稳定版' } }); fireEvent.click(within(d).getByRole('button', { name: '回滚生效版本' })); const c = screen.getByRole('dialog', { name: '回滚 Workflow' }); fireEvent.click(within(c).getByRole('button', { name: '确认回滚' })); expect(await within(c).findByRole('alert')).toHaveTextContent('依赖不可用'); expect(within(d).getByLabelText('回滚理由')).toHaveValue('恢复稳定版'); expect(record.activeVersionId).toBe('v1')
})
test('非管理员 API 403 不显示可操作表单', async () => {
  server.use(http.get(BASE, () => HttpResponse.json({ message: '仅管理员可管理工作流' }, { status: 403 }))); render(<WorkflowsSection />); expect(await screen.findByRole('alert')).toHaveTextContent('仅管理员'); expect(screen.getByRole('button', { name: '新建 Workflow' })).toBeDisabled()
})
test('后端步骤字段错误可定位到弹窗提示语并保持输入', async () => {
  const d = await edit()
  server.use(http.patch(`${BASE}/:id/save-draft`, () => HttpResponse.json({ message: '定义不合法', details: [{ field: 'definition/steps/0/prompt', reason: 'prompt_required' }] }, { status: 400 })))
  fireEvent.click(within(d).getByRole('button', { name: '保存草稿' }))
  fireEvent.click(await within(d).findByRole('button', { name: '定位步骤错误' }))
  const sd = screen.getByRole('dialog', { name: '编辑步骤' })
  expect(within(sd).getByLabelText('提示语')).toHaveValue('填写说明')
  expect(within(sd).getByLabelText('提示语')).toHaveAttribute('aria-invalid', 'true')
  expect(within(sd).getByLabelText('提示语')).toHaveAccessibleDescription(/prompt_required/)
})
test('完整编辑人工确认和原生工具，工具确认下限不能关闭', async () => {
  const d = await edit()
  fireEvent.click(within(d).getByRole('button', { name: '添加步骤' }))
  let sd = screen.getByRole('dialog', { name: '添加步骤' })
  fireEvent.change(within(sd).getByLabelText('步骤类型'), { target: { value: 'confirmation' } })
  fireEvent.change(within(sd).getByLabelText('步骤名称'), { target: { value: '审批' } })
  expect(within(sd).getByText(/approved: boolean/)).toBeInTheDocument()
  fireEvent.click(within(sd).getByRole('button', { name: '应用步骤' }))
  fireEvent.click(within(d).getByRole('button', { name: '添加步骤' }))
  sd = screen.getByRole('dialog', { name: '添加步骤' })
  fireEvent.change(within(sd).getByLabelText('步骤类型'), { target: { value: 'tool' } })
  fireEvent.change(within(sd).getByLabelText('步骤名称'), { target: { value: '查询' } })
  expect(within(sd).getByRole('checkbox', { name: /需要人工确认/ })).toBeChecked()
  expect(within(sd).getByRole('checkbox', { name: /需要人工确认/ })).toBeDisabled()
  fireEvent.click(within(sd).getByRole('button', { name: '应用步骤' }))
  fireEvent.click(within(d).getByRole('button', { name: '保存草稿' }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].definition.steps[1]).toMatchObject({ type: 'confirmation', prompt: '请填写所需信息' })
  expect(writes[0].definition.steps[1]).not.toHaveProperty('outputSchema')
  expect(writes[0].definition.steps[2]).toMatchObject({ type: 'tool', toolName: 'query', requiresConfirmation: true })
})
test('高级分支只向后、循环受限且 JSON 错误不应用步骤', async () => {
  const d = await edit(); fireEvent.click(within(d).getByRole('button', { name: '编辑 s1' }))
  const sd = screen.getByRole('dialog', { name: '编辑步骤' })
  fireEvent.change(within(sd).getByLabelText('有限循环 (JSON)'), { target: { value: '{"while":[],"maxIterations":11,"onLimit":"wait"}' } })
  fireEvent.click(within(sd).getByRole('button', { name: '应用步骤' }))
  expect(within(sd).getByRole('alert')).toHaveTextContent('1–10')
  fireEvent.change(within(sd).getByLabelText('有限循环 (JSON)'), { target: { value: '' } })
  fireEvent.change(within(sd).getByLabelText('后续分支 (JSON)'), { target: { value: '[{"when":[],"target":"s1"}]' } })
  fireEvent.click(within(sd).getByRole('button', { name: '应用步骤' }))
  expect(within(sd).getByRole('alert')).toHaveTextContent('后续步骤')
})
test('静态校验与复核依次推进 revision，检入前禁止校验', async () => {
  server.use(http.post(`${BASE}/:id/validate`, async ({ request }) => { writes.push(await request.json()); record = { ...record, revision: 2 }; return ok({ record }) }), http.get(`${BASE}/:id/release`, () => ok(readiness({ validation: record.revision >= 2 ? proof() : null }))), http.post(`${BASE}/:id/review`, async ({ request }) => { writes.push(await request.json()); record = { ...record, revision: 3 }; return ok({ record }) }))
  const d = await open(); fireEvent.click(within(d).getByRole('button', { name: '配置校验' }))
  await within(d).findByText('已校验（未执行）')
  fireEvent.change(within(d).getByLabelText('复核理由'), { target: { value: '定义与映射符合业务范围' } })
  fireEvent.click(within(d).getByRole('button', { name: '复核通过' }))
  await waitFor(() => expect(writes).toEqual([{ revision: 1 }, { revision: 2, reason: '定义与映射符合业务范围' }]))
})
test('晚到依赖与发布响应不能跨版本或跨关闭重新打开恢复证明', async () => {
  server.use(http.get(`${BASE}/:id/release`, async () => { const data = readiness({ validation: proof(), review: { ...proof('r'), validationId: 'p' }, publishAvailable: true }); await delay(100); return ok(data) }))
  const d = await open()
  fireEvent.change(within(d).getByLabelText('查看版本'), { target: { value: 'v0' } })
  await act(() => delay(150))
  expect(within(d).getByRole('button', { name: '发布' })).toBeDisabled()
  fireEvent.keyDown(d, { key: 'Escape' })
  fireEvent.click(await screen.findByRole('button', { name: '查看 交付流程' }))
  const reopened = await screen.findByRole('dialog', { name: 'Workflow 定义' })
  expect(within(reopened).getByRole('button', { name: '发布' })).toBeDisabled()
})
test('嵌套步骤弹窗的 Escape 只关闭步骤，并恢复编辑入口焦点', async () => {
  const d = await edit(); const trigger = within(d).getByRole('button', { name: '编辑 s1' }); trigger.focus(); fireEvent.click(trigger)
  const sd = screen.getByRole('dialog', { name: '编辑步骤' }); fireEvent.keyDown(sd, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: '编辑步骤' })).not.toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: 'Workflow 定义' })).toBeInTheDocument(); expect(trigger).toHaveFocus()
})
test('列表带归档查询且支持搜索和状态筛选', async () => {
  let includeArchived
  const archived = { ...record, workflowId: 'wf2', archived: true, enabled: false, versions: [version('v1', { definition: { ...definition, name: '归档流程' } })] }
  server.use(http.get(BASE, ({ request }) => { includeArchived = new URL(request.url).searchParams.get('includeArchived'); return ok({ items: [record, archived] }) }))
  render(<WorkflowsSection />); await screen.findByRole('button', { name: '查看 交付流程' }); expect(includeArchived).toBe('true')
  expect(screen.queryByRole('button', { name: '查看 归档流程' })).not.toBeInTheDocument(); fireEvent.click(screen.getByLabelText('显示归档')); expect(screen.getByRole('button', { name: '查看 归档流程' })).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('搜索Workflow'), { target: { value: '归档' } }); expect(screen.queryByRole('button', { name: '查看 交付流程' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('筛选Workflow'), { target: { value: 'enabled' } }); expect(screen.getByText('没有匹配的Workflow')).toBeInTheDocument()
})
test('检入和升版发送 server revision 并接受后端状态', async () => {
  const d = await edit()
  const actions = []
  server.use(http.post(`${BASE}/:id/:action`, async ({ params, request }) => { actions.push([params.action, await request.json()]); record = { ...record, revision: record.revision + 1, versions: [version('v0'), version('v1')] }; return ok({ record }) }))
  fireEvent.click(within(d).getByRole('button', { name: '检入' })); await waitFor(() => expect(within(d).getByRole('button', { name: '检出' })).toBeEnabled())
  expect(within(d).getByLabelText('名称')).toBeDisabled()
  fireEvent.click(within(d).getByRole('button', { name: '升版' })); const c = screen.getByRole('dialog', { name: '升版' }); fireEvent.click(within(c).getByRole('button', { name: '确认升版' }))
  await waitFor(() => expect(actions).toEqual([['checkin', { revision: 2 }], ['promote', { revision: 3 }]]))
})
test('发布快照依赖严格查询所选版本，迟到旧版本响应被丢弃', async () => {
  record.versions[0].status = 'published'
  const requested = []
  server.use(http.get(`${BASE}/:id/dependencies`, async ({ request }) => { const versionId = new URL(request.url).searchParams.get('versionId'); requested.push(versionId); if (versionId === 'v1') await delay(100); return ok({ versionId, frozen: versionId === 'v0', snapshot: { skills: [{ skillId: 'sk1', skillVersionId: `exact-${versionId}`, hash: `hash-${versionId}` }], tools: [] }, issues: [] }) }))
  const d = await open(); fireEvent.change(within(d).getByLabelText('查看版本'), { target: { value: 'v0' } }); fireEvent.click(within(d).getByText('当前依赖与配置问题'))
  expect(await within(d).findByText(/exact-v0/)).toBeInTheDocument(); await waitFor(() => expect(requested).toEqual(['v1', 'v0']))
  expect(within(d).getByText('已发布固定依赖快照')).toBeInTheDocument(); expect(within(d).queryByText(/exact-v1/)).not.toBeInTheDocument()
})
test.each([false, true])('正常/空列表可主动刷新，刷新期间禁用（empty=%s）', async empty => {
  let reads = 0
  server.use(http.get(BASE, async () => { reads++; if (reads > 1) await delay(30); return ok({ items: empty ? [] : [record] }) }))
  render(<WorkflowsSection />)
  await waitFor(() => expect(screen.getByRole('button', { name: '新建 Workflow' })).toBeEnabled())
  const refresh = screen.getByRole('button', { name: '刷新 Workflow 列表' })
  fireEvent.click(refresh); expect(refresh).toBeDisabled()
  await waitFor(() => expect(refresh).toBeEnabled()); expect(reads).toBe(2)
})
test.each([
  { dependencyHash: 'old-dependency' }, { versionId: 'old-version' }, { hash: 'old-hash' },
  { mode: 'model' }, { executionPerformed: true },
])('旧静态证明保留并标明失效，无法复核和发布：%j', async mismatch => {
  const stale = { ...proof(), ...mismatch }
  server.use(http.get(`${BASE}/:id/release`, () => ok(readiness({ validation: stale, review: { ...stale, id: 'old-review', validationId: stale.id, reason: '旧依赖复核' }, publishAvailable: true, blockers: [] }))))
  const d = await open()
  await within(d).findByText('复核：旧依赖复核')
  expect(within(d).getByText(/配置校验证明.*p.*已失效/)).toBeInTheDocument()
  expect(within(d).getByText(/复核证明.*old-review.*已失效/)).toBeInTheDocument()
  expect(within(d).getByRole('button', { name: '发布' })).toBeDisabled()
  expect(within(d).getByRole('button', { name: '复核通过' })).toBeDisabled()
})
test('首次发布状态请求未完成时校验失败仍可刷新，保留理由并拒绝晚到旧证明', async () => {
  let releaseReads = 0
  let finishOldRead
  const oldRead = new Promise(resolve => { finishOldRead = resolve })
  server.use(
    http.get(`${BASE}/:id/release`, async () => {
      releaseReads++
      if (releaseReads === 1) {
        await oldRead
        return ok(readiness({ validation: proof(), review: { ...proof('old-review'), validationId: 'p' }, publishAvailable: true, blockers: [] }))
      }
      return ok(readiness())
    }),
    http.post(`${BASE}/:id/validate`, () => HttpResponse.json({ message: '配置校验暂不可用，请重试' }, { status: 503 })),
  )
  const d = await open()
  await waitFor(() => expect(releaseReads).toBe(1))
  fireEvent.change(within(d).getByLabelText('复核理由'), { target: { value: '保留复核依据' } })
  fireEvent.click(within(d).getByRole('button', { name: '配置校验' }))
  expect(await within(d).findByRole('alert')).toHaveTextContent('配置校验暂不可用')
  expect(within(d).getByRole('button', { name: '刷新发布状态' })).toBeEnabled()
  expect(within(d).getByLabelText('复核理由')).toHaveValue('保留复核依据')
  await act(async () => { finishOldRead(); await delay(20) })
  expect(within(d).getByRole('button', { name: '发布' })).toBeDisabled()
  expect(within(d).queryByText('已校验（未执行）')).not.toBeInTheDocument()
  fireEvent.click(within(d).getByRole('button', { name: '刷新发布状态' }))
  await waitFor(() => expect(releaseReads).toBe(2))
  await waitFor(() => expect(within(d).getByRole('button', { name: '刷新发布状态' })).toBeEnabled())
  expect(within(d).getByLabelText('复核理由')).toHaveValue('保留复核依据')
})
test.each([{ otherBlockers: [] }, { otherBlockers: ['WORKFLOW_DISABLED'] }])('已发布版本显示完成状态，其他限制仍可查看：%j', async ({ otherBlockers }) => {
  record.versions[1].status = 'published'; record.activeVersionId = 'v1'
  server.use(http.get(`${BASE}/:id/release`, () => ok(readiness({ validation: proof(), review: { ...proof('r'), validationId: 'p' }, blockers: ['WORKFLOW_ALREADY_PUBLISHED', ...otherBlockers] }))))
  const d = await open()
  await within(d).findByText('已校验（未执行）')
  expect(within(d).getByText('当前版本已发布，维护请升版。')).toBeInTheDocument()
  expect(within(d).queryByText('发布门禁尚未完成')).not.toBeInTheDocument()
  expect(within(d).getByRole('button', { name: '发布' })).toBeDisabled()
  if (otherBlockers.length) expect(within(d).getByText('工作流已停用或归档')).toBeInTheDocument()
  else expect(within(d).queryByText('当前状态限制')).not.toBeInTheDocument()
})
