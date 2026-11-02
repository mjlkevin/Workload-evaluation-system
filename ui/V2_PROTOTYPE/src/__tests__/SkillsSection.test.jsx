import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, test } from 'vitest'
import SkillsSection from '../pages/system/SkillsSection.jsx'
import { server } from './mocks/server.js'

const BASE = '/api/v1/skills'
const schema = { type: 'object', properties: {}, additionalProperties: false }
const definition = { name: '需求拆解', description: '提取业务诉求', category: '需求', instructions: '依据原文拆解', roles: ['pre_sales'], references: [], inputSchema: schema, outputSchema: schema, model: { scenario: 'assessment', temperature: 0.1, maxTokens: 4000, timeoutMs: 60000 }, tools: [], examples: [] }
const version = (id, checkoutStatus = 'checked_in') => ({ skillVersionId: id, versionCode: id === 'v1' ? 'A.1' : 'A.0', status: 'draft', checkoutStatus, checkedOutBy: checkoutStatus === 'checked_out' ? 'admin-1' : null, definition: structuredClone(definition), hash: 'hash-1', createdAt: '2026-11-02', updatedAt: '2026-11-02' })
let record
let writes
beforeEach(() => {
  record = { skillId: 'skill-1', enabled: true, archived: false, activeVersionId: null, currentVersionId: 'v1', revision: 1, versions: [version('v0'), version('v1')], audit: [{ id: 'a1', action: 'create', actorName: '管理员', createdAt: '2026-11-02', versionId: 'v1' }] }
  writes = []
  server.use(
    http.get(BASE, () => HttpResponse.json({ code: 0, data: { items: [record] } })),
    http.get(`${BASE}/metadata`, () => HttpResponse.json({ code: 0, data: { viewerId: 'admin-1', roles: ['pre_sales', 'delivery'], modelScenarios: ['assessment', 'generation'], tools: [{ name: 'query', description: '查询', parameters: { type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'] } }], publishAvailable: false } })),
    http.get(`${BASE}/:id/release`, () => HttpResponse.json({ code: 0, data: readiness() })),
    http.get(`${BASE}/:id/influences`, () => HttpResponse.json({ code: 0, data: { items: [] } })),
    http.get(`${BASE}/:id`, () => HttpResponse.json({ code: 0, data: { record } })),
    http.post(`${BASE}/:id/checkout`, () => { record = { ...record, revision: 2, versions: [version('v0'), version('v1', 'checked_out')] }; return HttpResponse.json({ code: 0, data: { record } }) }),
    http.patch(`${BASE}/:id/save-draft`, async ({ request }) => { const body = await request.json(); writes.push(body); record = { ...record, revision: 3, versions: [version('v0'), { ...version('v1', 'checked_out'), definition: body.definition }] }; return HttpResponse.json({ code: 0, data: { record } }) }),
  )
})
function readiness(extra = {}) { return { revision: record.revision, versionId: record.currentVersionId, hash: 'hash-1', contextHash: 'ctx-1', trials: [], review: null, blockers: ['SKILL_MODEL_TRIAL_REQUIRED', 'SKILL_REVIEW_REQUIRED'], publishAvailable: false, reviewAvailable: false, activeVersion: record.versions.find(v => v.skillVersionId === record.activeVersionId) || null, rollbackVersions: [], events: [], ...extra } }
function trial(extra = {}) { return { id: 'eval-1', hash: 'hash-1', contextHash: 'ctx-1', current: true, createdAt: '2026-11-02', result: { mode: 'model', modelExecuted: true, passed: true, releaseEligible: true, cases: [{ title: '原文拆解', passed: true, output: { ok: true }, failures: [], providers: [{ provider: 'kimi', model: 'k2' }], toolSteps: [] }], failures: [], simulatedSteps: [], usage: { modelAttempts: 1, outputTokens: 30, toolCalls: 0, elapsedMs: 120 }, ...extra } } }
async function open() {
  render(<SkillsSection />)
  fireEvent.click(await screen.findByRole('button', { name: '查看 需求拆解' }))
  return screen.findByRole('dialog', { name: 'Skill 定义' })
}
async function edit() { const dialog = await open(); fireEvent.click(within(dialog).getByRole('button', { name: '检出' })); await waitFor(() => expect(within(dialog).getByLabelText('名称')).toBeEnabled()); return dialog }

describe('Skill 管理', () => {
  test('已检入只读，检出后允许编辑，发布明确禁用', async () => {
    const dialog = await open()
    expect(within(dialog).getByLabelText('名称')).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: '发布' })).toBeDisabled()
    expect(within(dialog).getByText(/样例测试与审核门禁尚未完成/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '检出' }))
    await waitFor(() => expect(within(dialog).getByLabelText('名称')).toBeEnabled())
  })
  test('保存冲突时保留所有输入并显示错误', async () => {
    server.use(http.patch(`${BASE}/:id/save-draft`, () => HttpResponse.json({ code: 'CONFLICT', message: '版本已更新，请重新读取' }, { status: 409 })))
    const dialog = await edit()
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: '保留的新名称' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存草稿' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('版本已更新')
    expect(within(dialog).getByLabelText('名称')).toHaveValue('保留的新名称')
  })
  test('JSON 错误阻止写请求并可继续编辑', async () => {
    const dialog = await edit()
    fireEvent.change(within(dialog).getByLabelText('输入 Schema (JSON)'), { target: { value: '{invalid' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存草稿' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('输入 Schema')
    expect(writes).toHaveLength(0)
    expect(within(dialog).getByLabelText('输入 Schema (JSON)')).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByLabelText('输入 Schema (JSON)')).toHaveAccessibleDescription(/输入 Schema JSON 格式错误/)
    expect(within(dialog).getByLabelText('输入 Schema (JSON)')).toHaveValue('{invalid')
  })
  test('完整定义字段经编辑后保存，并携带 revision', async () => {
    const dialog = await edit()
    for (const [label, value] of [['名称', '新 Skill'], ['描述', '新简介'], ['分类', '交付'], ['指令', '新指令']]) fireEvent.change(within(dialog).getByLabelText(label), { target: { value } })
    const references = [{ label: '说明', uri: 'https://example.com/doc', version: '1' }]
    const tools = [{ toolName: 'query', inputMapping: { keyword: '$.keyword' }, requiresConfirmation: true }]
    const examples = [{ title: '例一', input: { keyword: '项目' }, expected: {}, assertions: [{ path: '$.items', op: 'exists' }] }]
    const inputSchema = { type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'] }
    for (const [label, value] of [['参考资料 (JSON)', references], ['输入 Schema (JSON)', inputSchema], ['输出 Schema (JSON)', schema], ['工具配置 (JSON)', tools], ['样例 (JSON)', examples]]) fireEvent.change(within(dialog).getByLabelText(label), { target: { value: JSON.stringify(value) } })
    fireEvent.click(within(dialog).getByLabelText('delivery'))
    fireEvent.change(within(dialog).getByLabelText('模型场景'), { target: { value: 'generation' } })
    fireEvent.change(within(dialog).getByLabelText('Temperature'), { target: { value: '0.3' } })
    fireEvent.change(within(dialog).getByLabelText('最大 Tokens'), { target: { value: '8000' } })
    fireEvent.change(within(dialog).getByLabelText('超时 (ms)'), { target: { value: '90000' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toEqual({ revision: 2, definition: { ...definition, name: '新 Skill', description: '新简介', category: '交付', instructions: '新指令', roles: ['pre_sales', 'delivery'], references, inputSchema, tools, examples, model: { scenario: 'generation', temperature: 0.3, maxTokens: 8000, timeoutMs: 90000 } } })
  })
  test('历史版本不可编辑且没有变更操作', async () => {
    const dialog = await edit()
    fireEvent.change(within(dialog).getByLabelText('查看版本'), { target: { value: 'v0' } })
    expect(within(dialog).getByLabelText('名称')).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: '保存草稿' })).not.toBeInTheDocument()
    expect(within(dialog).getByText('历史版本，只读')).toBeInTheDocument()
  })
  test('动作失败明确显示，未保存关闭沿用放弃确认', async () => {
    server.use(http.post(`${BASE}/:id/checkin`, () => HttpResponse.json({ code: 'FAILED', message: '检入失败，请重试' }, { status: 500 })))
    const dialog = await edit()
    fireEvent.click(within(dialog).getByRole('button', { name: '检入' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('检入失败')
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: '尚未保存' } })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.click(within(dialog).getByRole('button', { name: '继续编辑' }))
    expect(within(dialog).getByLabelText('名称')).toHaveValue('尚未保存')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.click(within(dialog).getByRole('button', { name: '放弃修改' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  test('创建完整定义后显示服务端标识与版本', async () => {
    server.use(http.post(BASE, async ({ request }) => {
      const body = await request.json(); writes.push(body)
      record = { ...record, skillId: 'skill-created', versions: [version('v1', 'checked_out')] }
      record.versions[0].definition = body.definition
      return HttpResponse.json({ code: 0, data: { record } })
    }))
    render(<SkillsSection />)
    fireEvent.click(await screen.findByRole('button', { name: '新建 Skill' }))
    const dialog = screen.getByRole('dialog', { name: '新建 Skill' })
    for (const [label, value] of [['名称', '创建的 Skill'], ['分类', '需求'], ['指令', '提取原文']]) fireEvent.change(within(dialog).getByLabelText(label), { target: { value } })
    fireEvent.click(within(dialog).getByRole('button', { name: '创建 Skill' }))
    await screen.findByRole('dialog', { name: 'Skill 定义' })
    expect(writes[0].definition).toEqual({ ...definition, name: '创建的 Skill', description: '', instructions: '提取原文' })
    expect(screen.getAllByText('skill-created').length).toBeGreaterThan(0)
  })
  test('检入、升版、撤销与启停使用服务端最新 revision，审计可查看', async () => {
    const called = []
    const respond = (action, body) => {
      called.push([action, body.revision])
      const next = structuredClone(record)
      next.revision += 1
      if (action === 'checkin' || action === 'undo-checkout') { next.versions[1].checkoutStatus = 'checked_in'; next.versions[1].checkedOutBy = null }
      if (action === 'promote') { next.versions[1].checkoutStatus = 'checked_out'; next.versions[1].checkedOutBy = 'admin-1' }
      if (action === 'status') next.enabled = body.enabled
      record = next
      return HttpResponse.json({ code: 0, data: { record } })
    }
    for (const action of ['checkin', 'promote', 'undo-checkout']) server.use(http.post(`${BASE}/:id/${action}`, async ({ request }) => respond(action, await request.json())))
    server.use(http.patch(`${BASE}/:id/status`, async ({ request }) => respond('status', await request.json())))
    const dialog = await edit()
    fireEvent.click(within(dialog).getByRole('button', { name: '检入' }))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '升版' })).toBeEnabled())
    fireEvent.click(within(dialog).getByRole('button', { name: '升版' }))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '撤销检出' })).toBeEnabled())
    fireEvent.click(within(dialog).getByRole('button', { name: '撤销检出' }))
    const confirm = screen.getByRole('dialog', { name: '撤销检出' })
    fireEvent.click(within(confirm).getByRole('button', { name: '确认撤销检出' }))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '检出' })).toBeEnabled())
    fireEvent.click(within(dialog).getByRole('button', { name: '停用' }))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '启用' })).toBeEnabled())
    expect(called).toEqual([['checkin', 2], ['promote', 3], ['undo-checkout', 4], ['status', 5]])
    fireEvent.click(within(dialog).getByText('操作审计（1）'))
    expect(within(dialog).getByText(/create · 管理员/)).toBeVisible()
  })
  test('其他管理员检出的定义只读，强制解锁需确认', async () => {
    record.versions[1] = { ...version('v1', 'checked_out'), checkedOutBy: 'another-admin' }
    let unlocked = false
    server.use(http.post(`${BASE}/:id/force-unlock`, () => { unlocked = true; record.versions[1] = version('v1'); return HttpResponse.json({ code: 0, data: { record } }) }))
    const dialog = await open()
    expect(within(dialog).getByLabelText('名称')).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: '保存草稿' })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '管理员强制解锁' }))
    expect(unlocked).toBe(false)
    fireEvent.click(within(screen.getByRole('dialog', { name: '管理员强制解锁' })).getByRole('button', { name: '确认管理员强制解锁' }))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '检出' })).toBeEnabled())
    expect(unlocked).toBe(true)
  })

  test('管理清单首次加载与重新进入均取归档项，默认隐藏且可取消归档', async () => {
    record.archived = true
    const queries = []
    server.use(
      http.get(BASE, ({ request }) => {
        const includeArchived = new URL(request.url).searchParams.get('includeArchived')
        queries.push(includeArchived)
        return HttpResponse.json({ code: 0, data: { items: includeArchived === 'true' ? [record] : [] } })
      }),
      http.patch(`${BASE}/:id/status`, async ({ request }) => {
        const body = await request.json()
        writes.push(body)
        record = { ...record, ...body, revision: record.revision + 1 }
        return HttpResponse.json({ code: 0, data: { record } })
      }),
    )
    const first = render(<SkillsSection />)
    await waitFor(() => expect(screen.getByRole('button', { name: '新建 Skill' })).toBeEnabled())
    expect(queries).toEqual(['true'])
    expect(screen.queryByRole('button', { name: '查看 需求拆解' })).not.toBeInTheDocument()
    first.unmount()
    render(<SkillsSection />)
    await waitFor(() => expect(screen.getByRole('button', { name: '新建 Skill' })).toBeEnabled())
    expect(queries).toEqual(['true', 'true'])
    expect(screen.getByLabelText('显示归档')).not.toBeChecked()
    expect(screen.queryByRole('button', { name: '查看 需求拆解' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('显示归档'))
    fireEvent.click(await screen.findByRole('button', { name: '查看 需求拆解' }))
    const dialog = await screen.findByRole('dialog', { name: 'Skill 定义' })
    fireEvent.click(within(dialog).getByRole('button', { name: '取消归档' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '取消归档' })).getByRole('button', { name: '确认取消归档' }))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '归档' })).toBeEnabled())
    expect(writes).toEqual([{ revision: 1, archived: false }])
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    fireEvent.click(screen.getByLabelText('显示归档'))
    expect(screen.getByRole('button', { name: '查看 需求拆解' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await screen.findByRole('button', { name: '查看 需求拆解' })
    expect(queries).toEqual(['true', 'true', 'true'])
  })
  test.each([
    ['definition/name', '名称'],
    ['/definition/name', '名称'],
    ['inputSchema/properties/name', '输入 Schema (JSON)'],
    ['/definition/inputSchema/properties/name', '输入 Schema (JSON)'],
    ['definition/model/temperature', 'Temperature'],
    ['/definition/model/scenario', '模型场景'],
    ['definition.model.maxTokens', '最大 Tokens'],
    ['model/timeoutMs', '超时 (ms)'],
    ['definition/description', '描述'],
    ['/definition/roles/0', '可用角色', 'group'],
  ])('后端字段路径 %s 定位到对应编辑字段', async (field, label, role) => {
    server.use(http.patch(`${BASE}/:id/save-draft`, () => HttpResponse.json({ code: 'INVALID_DEFINITION', message: '定义有误', details: [{ field, reason: 'invalid' }] }, { status: 400 })))
    const dialog = await edit()
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: '保留输入' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存草稿' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('定义有误')
    const input = role ? within(dialog).getByRole(role, { name: label }) : within(dialog).getByLabelText(label)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(/定义有误/)
    expect(within(dialog).getByLabelText('名称')).toHaveValue('保留输入')
  })

  test('详情加载期间名称与查看入口均禁用，第二条请求不能覆盖编辑内容', async () => {
    record.versions[1] = version('v1', 'checked_out')
    const other = structuredClone(record)
    other.skillId = 'skill-2'
    other.versions[1].definition.name = '项目分析'
    const requested = []
    const completed = []
    server.use(
      http.get(BASE, () => HttpResponse.json({ code: 0, data: { items: [record, other] } })),
      http.get(/\/api\/v1\/skills\/skill-[12]$/, async ({ request }) => {
        const id = new URL(request.url).pathname.split('/').pop()
        requested.push(id)
        if (id === 'skill-1') await delay(80)
        completed.push(id)
        return HttpResponse.json({ code: 0, data: { record: id === 'skill-1' ? record : other } })
      }),
    )
    render(<SkillsSection />)
    fireEvent.click(await screen.findByRole('button', { name: '需求拆解', exact: true }))
    const secondName = screen.getByRole('button', { name: '项目分析', exact: true })
    const nameWasDisabled = secondName.disabled
    expect(screen.getByRole('button', { name: '查看 项目分析' })).toBeDisabled()
    fireEvent.click(secondName)
    await waitFor(() => expect(completed).toContain('skill-1'))
    const dialog = await screen.findByRole('dialog', { name: 'Skill 定义' })
    expect(nameWasDisabled).toBe(true)
    expect(requested).toEqual(['skill-1'])
    expect(within(dialog).getByLabelText('名称')).toHaveValue('需求拆解')
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: '正在编辑的内容' } })
    expect(within(dialog).getByLabelText('名称')).toHaveValue('正在编辑的内容')
    expect(requested).toHaveLength(1)
  })

})


describe('Skill 试运行与发布', () => {
  test('HTTP 200 的模型试运行失败仍显示失败与逐例输出，不开放发布', async () => {
    const failed = trial({ passed: false, releaseEligible: false, failures: [{ category: 'provider', code: 'MODEL_REQUEST_FAILED' }] })
    server.use(http.post(`${BASE}/:id/trial`, async ({ request }) => {
      writes.push(await request.json()); record.revision++
      return HttpResponse.json({ code: 0, data: { record, evaluation: failed } })
    }))
    const dialog = await open()
    fireEvent.click(await within(dialog).findByRole('button', { name: '模型试运行' }))
    expect(await within(dialog).findByText('试运行失败')).toBeInTheDocument()
    expect(within(dialog).getByText(/MODEL_REQUEST_FAILED/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '发布' })).toBeDisabled()
    expect(writes).toEqual([{ revision: 1, mode: 'model' }])
    fireEvent.click(within(dialog).getByText('原文拆解 · 通过'))
    expect(within(dialog).getByText(/kimi · k2/)).toBeVisible()
    expect(within(dialog).getByText(/"ok": true/)).toBeVisible()
  })
  test('模拟清楚标示未调用模型，不把内部计数当真实 Tokens', async () => {
    const simulated = trial({ mode: 'simulation', modelExecuted: false, releaseEligible: false, usage: { modelAttempts: 1, outputTokens: 1, toolCalls: 0, elapsedMs: 2 } })
    server.use(http.get(`${BASE}/:id/release`, () => HttpResponse.json({ code: 0, data: readiness({ trials: [simulated] }) })))
    const dialog = await open()
    expect((await within(dialog).findAllByText(/未调用模型/)).length).toBeGreaterThan(0)
    expect(within(dialog).queryByText(/输出 Tokens：1/)).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '发布' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: '复核通过' })).toBeDisabled()
  })
  test('复核须填写理由并明确确认隔离工具；409 保留输入', async () => {
    const proof = trial({ simulatedSteps: [{ toolName: 'send', simulated: true, reason: 'write', arguments: { text: 'x' }, result: { simulated: true } }] })
    server.use(
      http.get(`${BASE}/:id/release`, () => HttpResponse.json({ code: 0, data: readiness({ trials: [proof], reviewAvailable: true }) })),
      http.post(`${BASE}/:id/review`, async ({ request }) => { writes.push(await request.json()); return HttpResponse.json({ code: 40901, message: '依赖已变化，请重新测试' }, { status: 409 }) }),
    )
    const dialog = await open()
    const review = await within(dialog).findByRole('button', { name: '复核通过' })
    expect(review).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('复核理由'), { target: { value: '业务断言已检查' } })
    expect(review).toBeDisabled()
    fireEvent.click(within(dialog).getByLabelText(/我已确认这些工具仅模拟执行/))
    expect(review).toBeEnabled()
    fireEvent.click(review)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('依赖已变化')
    expect(within(dialog).getByLabelText('复核理由')).toHaveValue('业务断言已检查')
    expect(within(dialog).getByLabelText(/我已确认这些工具仅模拟执行/)).toBeChecked()
    expect(within(dialog).getByRole('button', { name: '复核通过' })).toBeDisabled()
    expect(writes).toEqual([{ revision: 1, evaluationId: 'eval-1', reason: '业务断言已检查', acknowledgeSimulation: true }])
  })
  test('发布只接受当前精确证明；确认展示候选与生效版本', async () => {
    record.activeVersionId = 'v0'
    const proof = trial()
    server.use(http.get(`${BASE}/:id/release`, () => HttpResponse.json({ code: 0, data: readiness({ trials: [proof], review: { evaluationId: proof.id, versionId: 'v1', hash: 'hash-1', contextHash: 'ctx-1' }, publishAvailable: true, blockers: [] }) })))
    const dialog = await open()
    const publish = within(dialog).getByRole('button', { name: '发布' })
    await waitFor(() => expect(publish).toBeEnabled())
    fireEvent.click(publish)
    const confirm = screen.getByRole('dialog', { name: '发布 Skill' })
    expect(within(confirm).getByText(/候选版本：A.1/)).toBeInTheDocument()
    expect(within(confirm).getByText(/当前生效版本：A.0/)).toBeInTheDocument()
    fireEvent.keyDown(confirm, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '发布 Skill' })).not.toBeInTheDocument()
  })
  test('不匹配 revision 或过期 trial 即使服务端开关为真也不可发布', async () => {
    server.use(http.get(`${BASE}/:id/release`, () => HttpResponse.json({ code: 0, data: readiness({ revision: 99, publishAvailable: true, trials: [trial()], blockers: [] }) })))
    const dialog = await open()
    await within(dialog).findByText(/发布状态与当前记录不一致/)
    expect(within(dialog).getByRole('button', { name: '发布' })).toBeDisabled()
  })
  test('未保存修改禁用试运行；过期的试运行证据仍可查看', async () => {
    server.use(http.get(`${BASE}/:id/release`, () => HttpResponse.json({ code: 0, data: readiness({ trials: [{ ...trial(), current: false }] }) })))
    const dialog = await edit()
    expect(await within(dialog).findByText(/已过期，不用于发布/)).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('指令'), { target: { value: '修改中的指令' } })
    expect(within(dialog).getByRole('button', { name: '模型试运行' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: '样例模拟' })).toBeDisabled()
  })
  test('回滚失败保留目标、理由和生效指针', async () => {
    record.activeVersionId = 'v1'
    server.use(
      http.get(`${BASE}/:id/release`, () => HttpResponse.json({ code: 0, data: readiness({ rollbackVersions: [{ versionId: 'v0', versionCode: 'A.0' }] }) })),
      http.post(`${BASE}/:id/rollback`, async ({ request }) => { writes.push(await request.json()); return HttpResponse.json({ code: 40901, message: '回滚冲突' }, { status: 409 }) }),
    )
    const dialog = await open()
    await within(dialog).findByRole('option', { name: 'A.0' })
    fireEvent.change(within(dialog).getByLabelText('回滚目标'), { target: { value: 'v0' } })
    fireEvent.change(within(dialog).getByLabelText('回滚理由'), { target: { value: '恢复已验收版本' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '回滚生效版本' }))
    const confirm = screen.getByRole('dialog', { name: '回滚生效版本' })
    fireEvent.click(within(confirm).getByRole('button', { name: '确认回滚生效版本' }))
    expect(await within(confirm).findByRole('alert')).toHaveTextContent('回滚冲突')
    expect(within(dialog).getByLabelText('回滚理由')).toHaveValue('恢复已验收版本')
    expect(within(dialog).getByLabelText('回滚目标')).toHaveValue('v0')
    expect(record.activeVersionId).toBe('v1')
    expect(writes).toEqual([{ revision: 1, targetVersionId: 'v0', reason: '恢复已验收版本' }])
  })
  test('历史版本仅查看影响；迟到的旧版本影响不能覆盖新选择', async () => {
    const queries = []
    server.use(http.get(`${BASE}/:id/influences`, async ({ request }) => {
      const id = new URL(request.url).searchParams.get('skillVersionId'); queries.push(id)
      if (id === 'v1') await delay(80)
      return HttpResponse.json({ code: 0, data: { items: [{ workflowId: 'wf1', workflowVersionId: id, workflowName: id === 'v0' ? '历史依赖流程' : '迟到流程', versionCode: id, stepId: 'extract', binding: 'fixed', history: true, archived: true, current: false, active: false, upgradePath: 'promote → checkout' }] } })
    }))
    const dialog = await open()
    fireEvent.change(within(dialog).getByLabelText('查看版本'), { target: { value: 'v0' } })
    expect(await within(dialog).findByText('历史依赖流程')).toBeInTheDocument()
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(within(dialog).queryByText('迟到流程')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: '模型试运行' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: '发布' })).not.toBeInTheDocument()
    expect(queries).toContain('v0')
  })
})


describe('Skill 发布请求边界', () => {
  test('迟到的发布状态不会在关闭再打开后解锁发布', async () => {
    let requestIndex = 0
    server.use(http.get(`${BASE}/:id/release`, async () => {
      const first = requestIndex++ === 0
      if (first) await delay(100)
      return HttpResponse.json({ code: 0, data: readiness(first ? { publishAvailable: true, blockers: [], trials: [trial()], review: { evaluationId: 'eval-1', versionId: 'v1', hash: 'hash-1', contextHash: 'ctx-1' } } : {}) })
    }))
    const dialog = await open()
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    fireEvent.click(screen.getByRole('button', { name: '查看 需求拆解' }))
    const reopened = await screen.findByRole('dialog', { name: 'Skill 定义' })
    await new Promise(resolve => setTimeout(resolve, 130))
    expect(within(reopened).getByRole('button', { name: '发布' })).toBeDisabled()
  })
  test('已过期的模型结果即使 publishAvailable 为真也不可发布', async () => {
    const stale = { ...trial(), current: false }
    server.use(http.get(`${BASE}/:id/release`, () => HttpResponse.json({ code: 0, data: readiness({ publishAvailable: true, blockers: [], trials: [stale], review: { evaluationId: 'eval-1', versionId: 'v1', hash: 'hash-1', contextHash: 'ctx-1' } }) })))
    const dialog = await open()
    expect(await within(dialog).findByText(/已过期，不用于发布/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '发布' })).toBeDisabled()
  })
})

test('试运行、复核、发布使用逐次更新的 revision，刷新后保留生效版本', async () => {
  let evaluations = []
  let review = null
  server.use(
    http.get(`${BASE}/:id/release`, () => HttpResponse.json({ code: 0, data: readiness({ trials: evaluations, review, reviewAvailable: evaluations.length > 0, publishAvailable: Boolean(review) && record.versions[1].status !== 'published', blockers: review ? [] : ['SKILL_REVIEW_REQUIRED'] }) })),
    http.post(`${BASE}/:id/trial`, async ({ request }) => {
      writes.push(['trial', await request.json()]); evaluations = [trial()]
      record = { ...record, revision: record.revision + 1 }
      return HttpResponse.json({ code: 0, data: { record, evaluation: evaluations[0] } })
    }),
    http.post(`${BASE}/:id/review`, async ({ request }) => {
      const body = await request.json(); writes.push(['review', body])
      review = { versionId: 'v1', evaluationId: body.evaluationId, hash: 'hash-1', contextHash: 'ctx-1', reason: body.reason }
      record = { ...record, revision: record.revision + 1, versions: [record.versions[0], { ...record.versions[1], status: 'reviewed' }] }
      return HttpResponse.json({ code: 0, data: { record } })
    }),
    http.post(`${BASE}/:id/publish`, async ({ request }) => {
      writes.push(['publish', await request.json()])
      record = { ...record, revision: record.revision + 1, activeVersionId: 'v1', versions: [record.versions[0], { ...record.versions[1], status: 'published' }] }
      return HttpResponse.json({ code: 0, data: { record } })
    }),
  )
  const dialog = await open()
  const trialButton = within(dialog).getByRole('button', { name: '模型试运行' })
  await waitFor(() => expect(trialButton).toBeEnabled())
  fireEvent.click(trialButton)
  expect(await within(dialog).findByText('试运行通过')).toBeInTheDocument()
  fireEvent.change(within(dialog).getByLabelText('复核理由'), { target: { value: '核实业务输出' } })
  const reviewButton = within(dialog).getByRole('button', { name: '复核通过' })
  await waitFor(() => expect(reviewButton).toBeEnabled())
  fireEvent.click(reviewButton)
  const publish = within(dialog).getByRole('button', { name: '发布' })
  await waitFor(() => expect(publish).toBeEnabled())
  fireEvent.click(publish)
  fireEvent.click(within(screen.getByRole('dialog', { name: '发布 Skill' })).getByRole('button', { name: '确认发布 Skill' }))
  await waitFor(() => expect(record.activeVersionId).toBe('v1'))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '发布 Skill' })).not.toBeInTheDocument())
  expect(writes).toEqual([['trial', { revision: 1, mode: 'model' }], ['review', { revision: 2, evaluationId: 'eval-1', reason: '核实业务输出' }], ['publish', { revision: 3 }]])
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
  fireEvent.click(screen.getByRole('button', { name: '查看 需求拆解' }))
  const reopened = await screen.findByRole('dialog', { name: 'Skill 定义' })
  expect(within(reopened).getByText(/当前工作版本：A.1 · 当前生效版本：A.1/)).toBeInTheDocument()
  expect(within(reopened).getByLabelText('名称')).toBeDisabled()
})

test('刚完成的试运行经服务器确认过期后仍明确显示过期，不能被 latest 标记遮住', async () => {
  let completed = false
  const returned = trial()
  delete returned.current
  server.use(
    http.get(`${BASE}/:id/release`, async () => {
      if (completed) await delay(30)
      return HttpResponse.json({ code: 0, data: readiness({ trials: completed ? [{ ...returned, current: false }] : [], contextHash: completed ? 'ctx-changed' : 'ctx-1' }) })
    }),
    http.post(`${BASE}/:id/trial`, () => {
      completed = true; record = { ...record, revision: record.revision + 1 }
      return HttpResponse.json({ code: 0, data: { record, evaluation: returned } })
    }),
  )
  const dialog = await open()
  const start = within(dialog).getByRole('button', { name: '模型试运行' })
  await waitFor(() => expect(start).toBeEnabled())
  fireEvent.click(start)
  expect(await within(dialog).findByText('已过期，不用于发布')).toBeInTheDocument()
  expect(within(dialog).queryByText('发布资格待刷新确认')).not.toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: '发布' })).toBeDisabled()
})

test('回滚确认内 Tab 保持焦点，Escape 只取消确认并保留详情输入和操作焦点', async () => {
  record.activeVersionId = 'v1'
  server.use(http.get(`${BASE}/:id/release`, () => HttpResponse.json({ code: 0, data: readiness({ rollbackVersions: [{ versionId: 'v0', versionCode: 'A.0' }] }) })))
  const dialog = await open()
  await within(dialog).findByRole('option', { name: 'A.0' })
  fireEvent.change(within(dialog).getByLabelText('回滚目标'), { target: { value: 'v0' } })
  fireEvent.change(within(dialog).getByLabelText('回滚理由'), { target: { value: '保留待确认的回滚理由' } })
  const opener = within(dialog).getByRole('button', { name: '回滚生效版本' })
  opener.focus()
  fireEvent.click(opener)
  const confirm = screen.getByRole('dialog', { name: '回滚生效版本' })
  const first = within(confirm).getByRole('button', { name: '关闭回滚生效版本' })
  const last = within(confirm).getByRole('button', { name: '确认回滚生效版本' })
  last.focus()
  fireEvent.keyDown(last, { key: 'Tab' })
  expect(first).toHaveFocus()
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
  expect(last).toHaveFocus()
  fireEvent.keyDown(last, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: '回滚生效版本' })).not.toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: 'Skill 定义' })).toBeInTheDocument()
  expect(within(dialog).getByLabelText('回滚理由')).toHaveValue('保留待确认的回滚理由')
  expect(within(dialog).getByLabelText('回滚目标')).toHaveValue('v0')
  expect(opener).toHaveFocus()
})
