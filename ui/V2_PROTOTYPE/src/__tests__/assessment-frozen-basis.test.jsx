import React from 'react'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse, delay } from 'msw'
import { describe, expect, test } from 'vitest'
import useAssessmentDetail from '../hooks/useAssessmentDetail.js'
import AssessmentDetail from '../pages/AssessmentDetail.jsx'
import { server } from './mocks/server.js'

const BASE = '/api/v1'
const basis = {
  kind: 'frozen',
  template: { templateId: 'original', templateName: '原始模板', templateVersion: 'T1', groups: [{ groupId: 'g', groupName: '原始范围' }], items: [{ templateItemId: 'one', groupId: 'g', itemName: '原始范围', standardDays: 5, defaultIncluded: true }] },
  ruleSet: { ruleSetId: 'rules-original', ruleVersion: 'R1', pipelineVersion: 'P1', pipeline: ['itemRule', 'grouping', 'baseRule'], baseRule: { userCountTiers: [{ min: 0, max: 100, factor: 0 }], difficultyFactorList: [0] }, orgIncrementRule: { enabled: false } },
  basis: { operationId: 'op', executionId: 'execution', runId: 'run', rootRunId: 'root', manifestHash: 'manifest', workflowId: 'workflow', workflowVersionId: 'W1', workflowHash: 'hash', templateId: 'original', templateVersion: 'T1', ruleSetId: 'rules-original', ruleVersion: 'R1', pipelineVersion: 'P1', snapshotDigest: 'digest' },
}
function setupFrozen() {
  let record = { id: 'A', versionCode: 'IA1', checkoutStatus: 'checked_in', payload: { projectName: '冻结项目', templateId: 'forged-latest', ruleSetId: 'forged-latest', params: { userCount: 0, difficultyFactor: 0, orgCount: 1, orgSimilarityFactor: 1 }, items: [{ templateItemId: 'one', included: true }], creationBasis: { templateVersion: 'FORGED' }, result: { totalDays: 500 } } }
  const calls = { latest: 0, generic: 0, calculate: [], saves: [] }
  server.use(
    http.get(`${BASE}/versions/:id`, ({ params }) => HttpResponse.json({ code: 0, data: { record: { ...record, id: params.id } } })),
    http.get(`${BASE}/business-assessments/:id/basis`, () => HttpResponse.json({ code: 0, data: basis })),
    http.get(`${BASE}/templates/:id`, () => { calls.latest++; return HttpResponse.json({ data: { ...basis.template, templateVersion: 'T2' } }) }),
    http.get(`${BASE}/rule-sets/:path`, () => { calls.latest++; return HttpResponse.json({ data: { ...basis.ruleSet, ruleVersion: 'R2' } }) }),
    http.post(`${BASE}/estimates/calculate`, () => { calls.generic++; return HttpResponse.json({ data: { totalDays: 99 } }) }),
    http.post(`${BASE}/business-assessments/:id/calculate`, async ({ request }) => {
      calls.calculate.push(await request.json())
      return HttpResponse.json({ code: 0, data: { totalDays: 5, baseDays: 5, ruleVersion: 'R1', pipelineVersion: 'P1', itemResults: [{ templateItemId: 'one', included: true, standardDays: 5, effectiveStandardDays: 5 }] } })
    }),
    ...['checkout', 'checkin'].map(action => http.post(`${BASE}/versions/:id/${action}`, () => {
      record = { ...record, checkoutStatus: action === 'checkout' ? 'checked_out' : 'checked_in' }
      return HttpResponse.json({ code: 0, data: { record } })
    })),
    http.patch(`${BASE}/versions/:id/save-draft`, async ({ request }) => {
      const body = await request.json(); calls.saves.push(body)
      record = { ...record, payload: body.payload }
      return HttpResponse.json({ code: 0, data: { record } })
    }),
  )
  return calls
}
const options = { fallbackData: { kpi: { totalDays: 777 } } }
const loaded = result => waitFor(() => expect(result.current.loading).toBe(false))
function renderDetail() {
  return render(<MemoryRouter initialEntries={['/assessments/A']}><Routes><Route path="/assessments/:id" element={<AssessmentDetail />} /></Routes></MemoryRouter>)
}
function setupFullScope({ missing = [], overrides = {} } = {}) {
  const calls = setupFrozen()
  const items = Array.from({ length: 585 }, (_, index) => ({ templateItemId: `item-${index}`, groupId: 'g',
    itemName: `范围项${index}`, standardDays: index === 60 ? 2 : index === 62 ? 3 : 1, defaultIncluded: true,
  }))
  const saved = items.filter((_, index) => !missing.includes(index)).map(item => ({ templateItemId: item.templateItemId,
    included: ['item-60', 'item-62'].includes(item.templateItemId),
    ...(Object.hasOwn(overrides, item.templateItemId) ? { customStandardDays: overrides[item.templateItemId] } : {}),
  }))
  server.use(
    http.get(`${BASE}/versions/:id`, () => HttpResponse.json({ data: { record: { id: 'A', versionCode: 'IA1', checkoutStatus: 'checked_in', payload: {
      projectName: '真实范围项目', params: { userCount: 0, difficultyFactor: 0, orgCount: 1, orgSimilarityFactor: 1 }, items: saved,
    } } } })),
    http.get(`${BASE}/business-assessments/:id/basis`, () => HttpResponse.json({ data: { ...basis, template: { ...basis.template, items } } })),
    http.post(`${BASE}/business-assessments/:id/calculate`, async ({ request }) => {
      calls.calculate.push(await request.json())
      return HttpResponse.json({ data: { totalDays: 5, baseDays: 5, groupSubtotals: [{ groupName: '未纳入的长名称云产品', subtotalDays: 0 }],
        itemResults: items.map(item => ({ templateItemId: item.templateItemId, included: ['item-60', 'item-62'].includes(item.templateItemId),
          standardDays: item.standardDays, effectiveStandardDays: item.standardDays })),
      } })
    }),
  )
  return calls
}

describe('AssessmentDetail original server basis', () => {
  test('keeps the original 5 through checkout, save, checkin and refresh without reading the latest catalog', async () => {
    const calls = setupFrozen()
    const { result } = renderHook(() => useAssessmentDetail('A', options))
    await loaded(result)
    expect(result.current.kpi.totalDays).toBe(5)
    expect(result.current.calculationBasis.basis.templateVersion).toBe('T1')
    for (const [action, readonly] of [['checkout', false], ['saveDraft', false], ['checkin', true]]) {
      let outcome
      await act(async () => { outcome = await result.current.actions[action](result.current.raw.payload) })
      expect(outcome.success).toBe(true)
      await loaded(result)
      expect(result.current.vcs.isReadonly).toBe(readonly)
      expect(result.current.kpi.totalDays).toBe(5)
    }
    act(() => result.current.refetch())
    await loaded(result)
    expect(result.current.kpi.totalDays).toBe(5)
    expect(calls.latest).toBe(0); expect(calls.generic).toBe(0)
    expect(calls.calculate).toHaveLength(5)
    expect(calls.calculate[0]).toMatchObject({ templateId: 'original', ruleSetId: 'rules-original', userCount: 0, items: [{ templateItemId: 'one', included: true }] })
    expect(calls.calculate[0]).not.toHaveProperty('params')
    expect(calls.saves).toHaveLength(1)
  })

  test.each([
    ['unavailable', null, 503], ['conflict', null, 409],
    ['malformed', { kind: 'frozen', template: basis.template }, 200],
    ['unknown', {}, 200],
  ])('%s basis never loads latest or presents fallback total as success', async (_, data, status) => {
    const calls = setupFrozen()
    server.use(http.get(`${BASE}/business-assessments/:id/basis`, () => HttpResponse.json({ data, message: '原始依据不可用' }, { status })))
    const { result } = renderHook(() => useAssessmentDetail('A', options))
    await loaded(result)
    expect(result.current.estimateError).toBeTruthy()
    expect(result.current.kpi.totalDays).toBeNull()
    expect(calls.latest + calls.generic + calls.calculate.length).toBe(0)
  })

  test('failed recalculation clears a previously successful total', async () => {
    const calls = setupFrozen()
    const { result } = renderHook(() => useAssessmentDetail('A', options))
    await loaded(result)
    expect(result.current.kpi.totalDays).toBe(5)
    server.use(http.post(`${BASE}/business-assessments/:id/calculate`, () => HttpResponse.json({ message: '计算服务不可用' }, { status: 503 })))
    act(() => result.current.refetch())
    await loaded(result)
    expect(result.current.estimateError.message).toContain('计算服务不可用')
    expect(result.current.kpi.totalDays).toBeNull()
    expect(calls.generic).toBe(0)
  })

  test('only explicit server legacy classification retains the old calculation path', async () => {
    const calls = setupFrozen()
    server.use(http.get(`${BASE}/business-assessments/:id/basis`, () => HttpResponse.json({ data: { kind: 'legacy' } })))
    const { result } = renderHook(() => useAssessmentDetail('A', options))
    await loaded(result)
    expect(result.current.kpi.totalDays).toBe(99)
    expect(calls.latest).toBe(3); expect(calls.generic).toBe(1)
    expect(result.current.calculationBasis.kind).toBe('legacy')
  })

  test('a successful checkout response cannot invent a different server status', async () => {
    setupFrozen()
    server.use(http.post(`${BASE}/versions/:id/checkout`, () => HttpResponse.json({ data: { record: { id: 'A', checkoutStatus: 'checked_in' } } })))
    const { result } = renderHook(() => useAssessmentDetail('A', options))
    await loaded(result)
    await act(async () => { expect((await result.current.actions.checkout()).success).toBe(true) })
    await loaded(result)
    expect(result.current.vcs.isReadonly).toBe(true)
  })

  test('a frozen record with missing confirmed scope cannot calculate from display defaults', async () => {
    const calls = setupFrozen()
    server.use(http.get(`${BASE}/versions/:id`, () => HttpResponse.json({ data: { record: { id: 'A', payload: { params: {} } } } })))
    const { result } = renderHook(() => useAssessmentDetail('A', options))
    await loaded(result)
    expect(result.current.estimateError.message).toContain('参数或范围不完整')
    expect(result.current.kpi.totalDays).toBeNull()
    expect(calls.calculate).toHaveLength(0)
  })

  test('a checkout rejection retains the server readonly state', async () => {
    setupFrozen()
    server.use(http.post(`${BASE}/versions/:id/checkout`, () => HttpResponse.json({ message: '已由其他用户检出' }, { status: 409 })))
    const { result } = renderHook(() => useAssessmentDetail('A', options))
    await loaded(result)
    let outcome
    await act(async () => { outcome = await result.current.actions.checkout() })
    expect(outcome).toMatchObject({ success: false, error: '已由其他用户检出' })
    expect(result.current.vcs.isReadonly).toBe(true)
  })

  test('ignores old basis completion after A to B to A and reload changes', async () => {
    setupFrozen()
    let first = true
    let release
    const pending = new Promise(resolve => { release = resolve })
    server.use(http.get(`${BASE}/business-assessments/:id/basis`, async () => {
      if (first) { first = false; await pending; return HttpResponse.json({ data: { ...basis, basis: { ...basis.basis, templateVersion: 'STALE' } } }) }
      return HttpResponse.json({ data: basis })
    }))
    const { result, rerender } = renderHook(({ id }) => useAssessmentDetail(id, options), { initialProps: { id: 'A' } })
    await waitFor(() => expect(first).toBe(false))
    rerender({ id: 'B' }); rerender({ id: 'A' })
    await loaded(result)
    act(() => result.current.refetch()); await loaded(result)
    await act(async () => { release(); await delay(20) })
    expect(result.current.calculationBasis.basis.templateVersion).toBe('T1')
  })

  test('never applies in-flight original data after authentication changes', async () => {
    setupFrozen()
    let release
    const pending = new Promise(resolve => { release = resolve })
    let started = false
    server.use(http.post(`${BASE}/business-assessments/:id/calculate`, async () => { started = true; await pending; return HttpResponse.json({ data: { totalDays: 88 } }) }))
    const { result, rerender } = renderHook(({ enabled }) => useAssessmentDetail('A', { ...options, enabled }), { initialProps: { enabled: true } })
    await waitFor(() => expect(started).toBe(true))
    localStorage.setItem('wes_token', 'different-user')
    rerender({ enabled: false })
    await act(async () => { release(); await delay(20) })
    expect(result.current.calculationBasis).toBeNull()
    expect(result.current.kpi.totalDays).not.toBe(88)
  })

  test('failed refresh preserves confirmed exclusion and custom 7 despite template default true and standard 5', async () => {
    setupFrozen()
    server.use(
      http.get(`${BASE}/versions/:id`, () => HttpResponse.json({ data: { record: {
        id: 'A', checkoutStatus: 'checked_in', payload: {
          projectName: '确认范围项目', params: { userCount: 0, difficultyFactor: 0, orgCount: 1, orgSimilarityFactor: 1 },
          items: [{ templateItemId: 'one', included: false, customStandardDays: 7 }],
        },
      } } })),
      http.get(`${BASE}/business-assessments/:id/basis`, () => HttpResponse.json({ data: { ...basis,
        template: { ...basis.template, items: [...basis.template.items, { templateItemId: 'unconfirmed', itemName: '未确认范围', defaultIncluded: true, standardDays: 9 }] },
      } })),
    )
    server.use(http.post(`${BASE}/business-assessments/:id/calculate`, () => HttpResponse.json({ data: { totalDays: 0, baseDays: 0, itemResults: [{ templateItemId: 'one', included: false, standardDays: 5, effectiveStandardDays: 7 }] } })))
    render(<MemoryRouter initialEntries={['/assessments/A']}><Routes><Route path="/assessments/:id" element={<AssessmentDetail />} /></Routes></MemoryRouter>)
    expect(await screen.findByText('总评估人天 · 实时')).toBeInTheDocument()
    server.use(http.post(`${BASE}/business-assessments/:id/calculate`, () => HttpResponse.json({ message: '计算服务不可用' }, { status: 503 })))
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('计算服务不可用')
    expect(screen.queryByText('总评估人天 · 实时')).not.toBeInTheDocument()
    expect(screen.queryByText('总人天')).not.toBeInTheDocument()
    const table = screen.getByRole('table', { name: '已确认评估范围' })
    const confirmed = within(table).getByRole('row', { name: /原始范围/ })
    expect(within(confirmed).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['原始范围', '未纳入', '5', '7', '暂不可用'])
    const unconfirmed = within(table).getByRole('row', { name: /未确认范围/ })
    expect(unconfirmed).toHaveTextContent('未确认')
    expect(unconfirmed).not.toHaveTextContent('已纳入')
    expect(screen.getAllByRole('button', { name: '刷新' })).toHaveLength(1)
  })

  test('offers real checkout, checkin and refresh with original versions and reports action failure', async () => {
    setupFrozen()
    render(<MemoryRouter initialEntries={['/assessments/A']}><Routes><Route path="/assessments/:id" element={<AssessmentDetail />} /></Routes></MemoryRouter>)
    expect(await screen.findByText('原始计算依据')).toBeInTheDocument()
    expect(screen.getByText(/模板版本：T1/)).toBeInTheDocument()
    expect(screen.getByText(/规则版本：R1/)).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '原始计算依据' })).getByText('已检入 · 只读')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /签入/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '自定义人天' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '检出' }))
    await waitFor(() => expect(within(screen.getByRole('region', { name: '原始计算依据' })).getByText('已检出')).toBeInTheDocument())
    server.use(http.post(`${BASE}/versions/:id/checkin`, () => HttpResponse.json({ message: '检入失败，请重试' }, { status: 409 })))
    fireEvent.click(screen.getByRole('button', { name: '检入' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('检入失败，请重试')
    expect(screen.getByRole('button', { name: '刷新' })).toBeInTheDocument()
  })

  test('585项冻结目录默认仅显示2项真实纳入范围，紧凑统计不复用旧KPI和假入口', async () => {
    const calls = setupFullScope(); renderDetail()
    const stats = await screen.findByRole('region', { name: '评估计算统计' })
    expect(stats).toHaveTextContent('总评估人天 · 实时5'); expect(stats).toHaveTextContent('基础人天5')
    expect(stats).toHaveTextContent('已纳入实施项2 / 585')
    expect(within(screen.getByRole('table', { name: '已确认评估范围' })).getAllByRole('row')).toHaveLength(3)
    expect(screen.queryByText('云产品工作量')).not.toBeInTheDocument()
    expect(screen.queryByText('未纳入的长名称云产品')).not.toBeInTheDocument()
    expect(screen.queryByText('DSL 依赖校验')).not.toBeInTheDocument()
    expect(screen.queryByText('已选 1 SKU · 1 模块')).not.toBeInTheDocument()
    for (const label of ['仅显示已勾选', '展开全部', '多组织推广估算', '五段叙事', '附件 SOW']) expect(screen.queryByText(label)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '检出' })).toBeInTheDocument(); expect(calls.latest + calls.generic).toBe(0)
  })

  test('完整目录按钮真实切换585项与2项范围，纯查看不保存或重新计算', async () => {
    const calls = setupFullScope(); renderDetail(); await screen.findByRole('region', { name: '评估计算统计' })
    const table = screen.getByRole('table', { name: '已确认评估范围' }), before = structuredClone(calls.calculate)
    const expand = screen.getByRole('button', { name: '查看完整目录' })
    expect(expand).toHaveAttribute('aria-pressed', 'false'); fireEvent.click(expand)
    expect(within(table).getAllByRole('row')).toHaveLength(586)
    const excluded = within(table).getByRole('row', { name: /范围项0 未纳入/ })
    expect(within(excluded).getAllByRole('cell').at(-1)).toHaveTextContent('未计入')
    expect(screen.getByRole('button', { name: '返回评估范围' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '返回评估范围' }))
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(calls.calculate).toEqual(before); expect(calls.saves).toHaveLength(0)
  })

  test('默认范围同时保留缺失保存状态和已排除的人工覆盖0及7，不把模板默认纳入当确认', async () => {
    setupFullScope({ missing: [5], overrides: { 'item-3': 0, 'item-4': 7 } }); renderDetail()
    await screen.findByRole('region', { name: '评估计算统计' })
    const table = screen.getByRole('table', { name: '已确认评估范围' })
    expect(within(table).getAllByRole('row')).toHaveLength(6)
    for (const [id, override] of [[3, '0'], [4, '7']]) {
      const row = within(table).getByRole('row', { name: new RegExp(`范围项${id} 未纳入`) })
      expect(within(row).getAllByRole('cell').map(cell => cell.textContent)).toEqual([`范围项${id}`, '未纳入', '1', override, '未计入'])
    }
    const unknown = within(table).getByRole('row', { name: /范围项5 未确认/ })
    expect(within(unknown).getAllByRole('cell').at(-1)).toHaveTextContent('待确认')
    expect(screen.getByRole('region', { name: '评估计算统计' })).toHaveTextContent('已纳入实施项2 / 585')
  })

  test('真实范围刷新503后隐藏成功统计，默认范围仍保留0及7覆盖和未确认证据', async () => {
    setupFullScope({ missing: [5], overrides: { 'item-3': 0, 'item-4': 7 } }); renderDetail()
    await screen.findByRole('region', { name: '评估计算统计' })
    server.use(http.post(`${BASE}/business-assessments/:id/calculate`, () => HttpResponse.json({ message: '计算服务不可用' }, { status: 503 })))
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('计算服务不可用')
    expect(screen.queryByRole('region', { name: '评估计算统计' })).not.toBeInTheDocument()
    const table = screen.getByRole('table', { name: '已确认评估范围' })
    expect(within(table).getAllByRole('row')).toHaveLength(6)
    for (const [id, status, custom] of [[3, '未纳入', '0'], [4, '未纳入', '7'], [5, '未确认', '未覆盖']]) {
      expect(within(within(table).getByRole('row', { name: new RegExp(`范围项${id} ${status}`) })).getAllByRole('cell').map(cell => cell.textContent))
        .toEqual([`范围项${id}`, status, '1', custom, '暂不可用'])
    }
    expect(screen.getAllByRole('button', { name: '刷新' })).toHaveLength(1)
  })

  test('legacy详情继续使用原标签页、KPI和侧栏', async () => {
    setupFrozen(); server.use(http.get(`${BASE}/business-assessments/:id/basis`, () => HttpResponse.json({ data: { kind: 'legacy' } })))
    renderDetail(); await screen.findByText('总评估人天 · 实时')
    expect(screen.getByText('云产品工作量')).toBeInTheDocument(); expect(screen.getByText('校验摘要')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '多组织推广估算' })).toBeInTheDocument()
    expect(screen.getByText('仅显示已勾选')).toBeInTheDocument(); expect(screen.getByText('展开全部')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看完整目录' })).not.toBeInTheDocument()
  })
})
