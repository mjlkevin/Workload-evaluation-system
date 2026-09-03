import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { apiClient } from '../api/client.js'
import TraditionalHomeDashboard from '../pages/TraditionalHomeDashboard.jsx'

// /projects 页此前把「正在加载」「取数失败」「一个项目都没有」「搜索没命中」四种情况
// 混成同一句「未找到匹配的项目」——首屏还在请求就先告诉用户没数据。
// 这里把四种情况拆开各自表述。
const LOADING_TEXT = '正在加载项目列表…'
const NO_PROJECT_TEXT = '还没有项目，新建后会显示在这里'
const NO_MATCH_TEXT = '未找到匹配的项目'
const SEARCH_PLACEHOLDER = '⌕ 搜索项目 / 客户 / 负责人'

// 四个指标卡各由一个端点供数，按调用顺序返回：项目 / 需求条目 / 评估人天 / 成员
function mockSources({ projects = [] } = {}) {
  return vi.spyOn(apiClient, 'get').mockImplementation((path) => {
    if (String(path).includes('/project-evaluations')) {
      return Promise.resolve({ code: 0, data: { items: projects } })
    }
    if (String(path).includes('/auth/users')) {
      return Promise.resolve({ code: 0, data: { users: [] } })
    }
    return Promise.resolve({ code: 0, data: { items: [] } })
  })
}

function renderProjects() {
  return render(
    <MemoryRouter initialEntries={['/projects']}>
      <Routes>
        <Route path="/projects" element={<TraditionalHomeDashboard />} />
      </Routes>
    </MemoryRouter>,
  )
}

const PROJECT_ROW = {
  projectId: 'p-1',
  projectName: '利民集团数字化二期',
  customerName: '利民集团',
  industry: '制造-离散',
  status: 'draft',
  totalDays: 12,
  updatedAt: '2026-09-01T10:00:00.000Z',
  ownerUsername: 'mjlkevin',
}

describe('/projects 项目列表的加载态与空态', () => {
  beforeEach(() => {
    localStorage.setItem('wes_token', 'mock-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  // ① 加载中不得说「没有数据」——这是本批的首要修复目标
  test('加载中给出进度提示，不提前判定为「未找到匹配的项目」', async () => {
    let resolveGet
    const pending = new Promise((res) => { resolveGet = res })
    vi.spyOn(apiClient, 'get').mockImplementation(() => pending)

    renderProjects()

    expect(screen.getByText(LOADING_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(NO_MATCH_TEXT)).not.toBeInTheDocument()
    expect(screen.queryByText(NO_PROJECT_TEXT)).not.toBeInTheDocument()

    await act(async () => {
      resolveGet({ code: 0, data: { items: [] } })
    })

    expect(screen.queryByText(LOADING_TEXT)).not.toBeInTheDocument()
  })

  // ② 一个项目都没有 ≠ 搜索没命中，两句文案必须不同
  test('一个项目都没有时说「还没有项目」，不说「未找到匹配」', async () => {
    mockSources({ projects: [] })

    renderProjects()

    expect(await screen.findByText(NO_PROJECT_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(NO_MATCH_TEXT)).not.toBeInTheDocument()
  })

  test('有项目但搜索没命中时说「未找到匹配」，不说「还没有项目」', async () => {
    mockSources({ projects: [PROJECT_ROW] })

    renderProjects()

    expect(await screen.findByText('利民集团数字化二期')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), {
      target: { value: '不存在的关键字zzz' },
    })

    expect(screen.getByText(NO_MATCH_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(NO_PROJECT_TEXT)).not.toBeInTheDocument()
  })

  // ③ 取数失败走既有的 role="alert" 报错条，不退化成空态措辞
  test('取数失败时给出可重试的报错条，不显示空态文案', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('bad request'))

    renderProjects()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeEnabled()
    expect(screen.queryByText(NO_MATCH_TEXT)).not.toBeInTheDocument()
    expect(screen.queryByText(NO_PROJECT_TEXT)).not.toBeInTheDocument()
  })
})
