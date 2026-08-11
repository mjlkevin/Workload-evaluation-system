// 工单 2026-08-11-qoder-memory-panel-chip-live-link · RED→GREEN
// DEF-2026-08-11-001 修复②：记忆管理面板读取 location query ——
// MS2-PATCH 提示条「去确认」跳转 /system/memory?status=draft 后应自动筛选 draft；
// 请求携带 projectId（当前项目上下文经 query 传入时）。
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, test } from 'vitest'
import App from '../App.jsx'
import { mockUsers } from './mocks/data.js'
import { server } from './mocks/server.js'

const BASE = '/api/v1'

function renderAppAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  )
}

function mockMemoryApi(payload = {}) {
  let lastQuery = null
  server.use(
    http.get(`${BASE}/memory`, ({ request }) => {
      lastQuery = Object.fromEntries(new URL(request.url).searchParams.entries())
      return HttpResponse.json({
        code: 'OK',
        message: 'success',
        data: {
          atoms: [],
          scenes: [],
          totalAtoms: 0,
          totalScenes: 0,
          page: 1,
          pageSize: 50,
          ...payload,
        },
      })
    }),
  )
  return () => lastQuery
}

describe('记忆管理面板 query 初始化（DEF-2026-08-11-001）', () => {
  beforeEach(() => {
    server.use(http.get(`${BASE}/auth/me`, () => HttpResponse.json({ success: true, data: { user: mockUsers[0] } })))
  })

  test('?status=draft 落地后面板自动按 draft 筛选并带 status=draft 请求', async () => {
    const getQuery = mockMemoryApi()
    renderAppAt('/system/memory?status=draft')

    expect(await screen.findByRole('heading', { name: '记忆管理' })).toBeInTheDocument()
    await waitFor(() => expect(getQuery()).not.toBeNull())
    expect(getQuery()?.status).toBe('draft')
    // 筛选下拉应落在「待确认」
    expect(screen.getByDisplayValue('待确认')).toBeInTheDocument()
  })

  test('?projectId= 存在时请求携带 projectId（当前项目上下文）', async () => {
    const getQuery = mockMemoryApi()
    renderAppAt('/system/memory?projectId=proj-123')

    expect(await screen.findByRole('heading', { name: '记忆管理' })).toBeInTheDocument()
    await waitFor(() => expect(getQuery()).not.toBeNull())
    expect(getQuery()?.projectId).toBe('proj-123')
  })

  test('无 query 时按 owner 全量默认口径请求（不传 projectId / status）', async () => {
    const getQuery = mockMemoryApi()
    renderAppAt('/system/memory')

    expect(await screen.findByRole('heading', { name: '记忆管理' })).toBeInTheDocument()
    await waitFor(() => expect(getQuery()).not.toBeNull())
    expect(getQuery()?.projectId).toBeUndefined()
    expect(getQuery()?.status).toBeUndefined()
  })
})
