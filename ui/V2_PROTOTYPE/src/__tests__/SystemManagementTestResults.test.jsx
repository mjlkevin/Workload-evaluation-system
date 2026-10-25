import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import { ToastProvider } from '../hooks/useToast.jsx'
import SystemManagement from '../pages/SystemManagement.jsx'
import { server } from './mocks/server.js'
const BASE = '/api/v1'
const rows = Array.from({ length: 12 }, (_, index) => ({ manualTestResultId: `result-${index}`, harnessRunId: 'run-1', harnessToolEventId: 'event-1', metadata: { evidence: 'metadata-evidence' }, testCaseKey: `TC-${index}`, executorName: '测试人员', environment: '验收环境', account: 'test-account', resultStatus: index === 0 ? 'failed' : 'passed', screenshotUrl: index === 0 ? 'https://example.com/evidence.png' : '', notes: '完整备注和定位证据', createdAt: '2026-10-21T00:00:00Z' }))
async function setup(items = rows) {
  server.use(http.get(`${BASE}/harness/test-results`, () => HttpResponse.json({ data: { items } })))
  render(<ToastProvider><MemoryRouter><SystemManagement sectionId="testResults" /></MemoryRouter></ToastProvider>)
  await waitFor(() => expect(screen.getByRole('button', { name: '+ 新建' })).toBeEnabled())
}
describe('人工测试结果统一列表', () => {
  test('ten row list searches and filters with full read-only details and screenshot', async () => {
    await setup()
    const table = await screen.findByRole('table', { name: '人工测试结果列表' })
    expect(within(table).getAllByRole('row')).toHaveLength(11)
    fireEvent.click(screen.getByRole('button', { name: '查看 TC-0' }))
    const dialog = screen.getByRole('dialog', { name: '人工测试结果详情' })
    expect(within(dialog).getByText('完整备注和定位证据')).toBeInTheDocument()
    expect(within(dialog).getByText('test-account')).toBeInTheDocument()
    expect(within(dialog).getByText('run-1')).toBeInTheDocument()
    expect(within(dialog).getByText('event-1')).toBeInTheDocument()
    expect(within(dialog).getByText(/metadata-evidence/)).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: '查看截图' })).toHaveAttribute('href', 'https://example.com/evidence.png')
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭', exact: true }))
    fireEvent.change(screen.getByRole('combobox', { name: '筛选人工测试结果' }), { target: { value: 'failed' } })
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索人工测试结果' }), { target: { value: 'no-match' } })
    expect(screen.getByText('没有匹配的人工测试结果')).toBeInTheDocument()
  })
  test('create candidates can be discarded without a write', async () => {
    let writes = 0
    server.use(http.post(`${BASE}/harness/runs/:runId/test-results`, () => { writes += 1; return HttpResponse.json({ data: {} }) }))
    await setup([])
    fireEvent.click(await screen.findByRole('button', { name: '+ 新建' }))
    const dialog = screen.getByRole('dialog', { name: '新建人工测试结果' })
    fireEvent.change(within(dialog).getByLabelText('执行人 *'), { target: { value: '候选执行人' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '取消', exact: true }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('尚未应用')
    fireEvent.click(within(dialog).getByRole('button', { name: '放弃修改' }))
    expect(writes).toBe(0)
  })
  test('create failure stays open with candidate fields and a retry action', async () => {
    server.use(http.post(`${BASE}/harness/runs/:runId/test-results`, () => new HttpResponse(null, { status: 500 })))
    await setup([])
    fireEvent.click(await screen.findByRole('button', { name: '+ 新建' }))
    const dialog = screen.getByRole('dialog', { name: '新建人工测试结果' })
    fireEvent.change(within(dialog).getByLabelText('执行人 *'), { target: { value: '执行人' } })
    fireEvent.change(within(dialog).getByLabelText('环境 *'), { target: { value: '环境A' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '确定', exact: true }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('失败')
    expect(within(dialog).getByLabelText('执行人 *')).toHaveValue('执行人')
  })
  test('delete requires target confirmation and blocks repeat writes while pending', async () => {
    let writes = 0
    server.use(http.delete(`${BASE}/harness/runs/run-1/test-results/result-0`, async () => { writes += 1; await delay(80); return new HttpResponse(null, { status: 500 }) }))
    await setup()
    fireEvent.click(await screen.findByRole('button', { name: '删除 TC-0' }))
    const dialog = screen.getByRole('dialog', { name: '删除人工测试结果' })
    expect(within(dialog).getByText(/TC-0/)).toBeInTheDocument()
    expect(writes).toBe(0)
    fireEvent.click(within(dialog).getByRole('button', { name: '确认删除' }))
    expect(within(dialog).getByRole('button', { name: '删除中…' })).toBeDisabled()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(dialog).toBeInTheDocument()
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('失败')
    expect(writes).toBe(1)
  })
  test('load failure offers retry instead of a false empty list', async () => {
    let fail = true
    server.use(http.get(`${BASE}/harness/test-results`, () => fail ? new HttpResponse(null, { status: 500 }) : HttpResponse.json({ data: { items: rows } })))
    render(<ToastProvider><MemoryRouter><SystemManagement sectionId="testResults" /></MemoryRouter></ToastProvider>)
    expect(await screen.findByRole('alert')).toHaveTextContent('测试结果加载失败')
    expect(screen.queryByText('暂无人工测试结果')).not.toBeInTheDocument()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('TC-0')).toBeInTheDocument()
  })
  test('load more tracks the server offset independently of deduplicated visible records', async () => {
    const offsets = []
    const first = Array.from({ length: 20 }, (_, index) => ({ ...rows[0], manualTestResultId: `p-${index}`, testCaseKey: `PAGE-${index}` }))
    server.use(http.get(`${BASE}/harness/test-results`, ({ request }) => {
      const offset = Number(new URL(request.url).searchParams.get('offset') || 0); offsets.push(offset)
      return HttpResponse.json({ data: { items: offset === 0 ? first : offset === 20 ? first.map((row, index) => index === 19 ? { ...row, manualTestResultId: 'p-20', testCaseKey: 'PAGE-20' } : row) : [] } })
    }))
    render(<ToastProvider><MemoryRouter><SystemManagement sectionId="testResults" /></MemoryRouter></ToastProvider>)
    fireEvent.click(await screen.findByRole('button', { name: '加载更多记录' }))
    await screen.findByText(/已加载 21 条人工测试结果/)
    fireEvent.click(screen.getByRole('button', { name: '加载更多记录' }))
    await waitFor(() => expect(offsets).toEqual([0, 20, 40]))
    await waitFor(() => expect(screen.queryByRole('button', { name: '加载更多记录' })).not.toBeInTheDocument())
  })

  test('create submits the original fields once, blocks closing while busy, and closes on success', async () => {
    const payloads = []
    server.use(http.post(`${BASE}/harness/runs/:runId/test-results`, async ({ request }) => { payloads.push(await request.json()); await delay(50); return HttpResponse.json({ data: { result: {} } }) }))
    await setup([])
    fireEvent.click(screen.getByRole('button', { name: '+ 新建' }))
    const dialog = screen.getByRole('dialog', { name: '新建人工测试结果' })
    fireEvent.change(within(dialog).getByLabelText('执行人 *'), { target: { value: '执行人A' } })
    fireEvent.change(within(dialog).getByLabelText('环境 *'), { target: { value: '验收环境' } })
    fireEvent.change(within(dialog).getByLabelText('用例编号'), { target: { value: 'TC-NEW' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '确定', exact: true }))
    expect(within(dialog).getByRole('button', { name: '保存中…' })).toBeDisabled()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(dialog).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(payloads).toEqual([{ executorName: '执行人A', environment: '验收环境', testCaseKey: 'TC-NEW', account: '', screenshotUrl: '', notes: '', resultStatus: 'passed' }])
  })

})
