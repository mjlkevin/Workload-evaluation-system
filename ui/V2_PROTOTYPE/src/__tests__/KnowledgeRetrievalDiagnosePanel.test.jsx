import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test, vi } from 'vitest'
import KnowledgeRetrievalDiagnosePanel from '../components/system/KnowledgeRetrievalDiagnosePanel.jsx'
import { apiClient } from '../api/client.js'
import { server } from './mocks/server.js'
const BASE = '/api/v1'
const result = (title = '完整知识条目') => ({ query: '售前估算', tokens: ['售前', '估算'], durationMs: 8, guard: { truncatedBy: 'maxItems', droppedCount: 2, totalChars: 99 }, items: [{ entry: { id: 'entry-1', title, category: 'presales', content: '完整长正文\n第二段不能靠悬停查看', status: 'active', tags: ['人天', '报价'] }, score: 0.12345, source: 'bm25' }] })
function setup() { server.use(http.get(`${BASE}/knowledge/diagnose`, () => HttpResponse.json({ data: { stage: 'ms1-bm25-rrf', corpus: { total: 25, active: 24, archived: 1 }, guard: { maxItems: 8, charBudget: 6000, timeoutMs: 3000 }, sample: result() } }))); render(<KnowledgeRetrievalDiagnosePanel />) }
describe('检索诊断统一结果列表', () => {
  test('sample preserves diagnostic metrics and opens complete entry in a read-only dialog', async () => {
    setup()
    const table = await screen.findByRole('table', { name: '检索结果列表' })
    expect(screen.getByText(/语料 25 条/)).toBeInTheDocument()
    expect(screen.getByText(/条目数超限截断/)).toBeInTheDocument()
    expect(within(table).getByText('0.123')).toBeInTheDocument()
    fireEvent.click(within(table).getByRole('button', { name: '查看 完整知识条目' }))
    const dialog = screen.getByRole('dialog', { name: '检索条目详情' })
    expect(within(dialog).getByText(/完整长正文/)).toHaveTextContent('第二段不能靠悬停查看')
    expect(within(dialog).getByText('人天 · 报价')).toBeInTheDocument()
    expect(within(dialog).getByText('entry-1')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
  })
  test('read error is announced with retry instead of false zero corpus', async () => {
    let fail = true
    server.use(http.get(`${BASE}/knowledge/diagnose`, () => fail ? new HttpResponse(null, { status: 500 }) : HttpResponse.json({ data: { corpus: { total: 9, active: 9, archived: 0 } } })))
    render(<KnowledgeRetrievalDiagnosePanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent('诊断加载失败')
    expect(screen.queryByText(/语料 0 条/)).not.toBeInTheDocument()
    fail = false; fireEvent.click(screen.getByRole('button', { name: '重试诊断' }))
    expect(await screen.findByText(/语料 9 条/)).toBeInTheDocument()
  })
  test('pending search blocks repeated Enter and a changed input discards the old response', async () => {
    setup(); await screen.findByRole('table', { name: '检索结果列表' })
    let finish
    const requested = []
    const original = apiClient.get.bind(apiClient)
    vi.spyOn(apiClient, 'get').mockImplementation((path, params) => {
      if (path === '/knowledge/search') { requested.push(params.q); return new Promise((resolve) => { finish = resolve }) }
      return original(path, params)
    })
    const input = screen.getByRole('textbox', { name: '检索关键词' })
    fireEvent.change(input, { target: { value: '旧查询' } })
    fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.keyDown(input, { key: 'Enter' })
    expect(requested).toEqual(['旧查询'])
    fireEvent.change(input, { target: { value: '新查询' } })
    await act(async () => { finish({ data: result('旧响应不应出现') }) })
    expect(screen.queryByText('旧响应不应出现')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '检索', exact: true })).toBeEnabled()
  })
  test('search failure is explicit and retry uses the current query', async () => {
    setup(); await screen.findByRole('table', { name: '检索结果列表' })
    let fail = true
    server.use(http.get(`${BASE}/knowledge/search`, () => fail ? new HttpResponse(null, { status: 500 }) : HttpResponse.json({ data: result('重试条目') })))
    fireEvent.change(screen.getByRole('textbox', { name: '检索关键词' }), { target: { value: '预算' } })
    fireEvent.click(screen.getByRole('button', { name: '检索', exact: true }))
    expect(await screen.findByRole('alert')).toHaveTextContent('检索失败')
    fail = false; fireEvent.click(screen.getByRole('button', { name: '重试检索' }))
    expect(await screen.findByText('重试条目')).toBeInTheDocument()
  })
})
