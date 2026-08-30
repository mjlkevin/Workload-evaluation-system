import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { apiClient } from '../api/client.js'
import AssessmentList from '../pages/AssessmentList.jsx'
import HistoryList from '../pages/HistoryList.jsx'
import RequirementList from '../pages/RequirementList.jsx'
import ResourceCostList from '../pages/ResourceCostList.jsx'
import WbsList from '../pages/WbsList.jsx'

// 这批列表页此前只从 hook 里取 rows，把 loading / error 丢在解构那一步，
// 结果接口挂了渲染成「暂无数据」——用户以为真没数据，实际是请求没成功。
// 评审列表（ReviewList）与开发评估列表早就接好了，这里把那套口径推到其余五个页面。
const CASES = [
  {
    name: '实施评估',
    Comp: AssessmentList,
    path: '/assessments',
    loadingText: '正在加载实施评估列表…',
    errorText: '加载实施评估列表失败，请检查网络后重试',
    hasKpi: true,
  },
  {
    name: '需求',
    Comp: RequirementList,
    path: '/requirements',
    loadingText: '正在加载需求列表…',
    errorText: '加载需求列表失败，请检查网络后重试',
    hasKpi: true,
  },
  {
    name: '资源成本',
    Comp: ResourceCostList,
    path: '/resource-costs',
    loadingText: '正在加载资源成本列表…',
    errorText: '加载资源成本列表失败，请检查网络后重试',
    hasKpi: true,
  },
  {
    name: 'WBS 任务',
    Comp: WbsList,
    path: '/wbs',
    loadingText: '正在加载 WBS 任务列表…',
    errorText: '加载 WBS 任务列表失败，请检查网络后重试',
    hasKpi: true,
  },
  // 历史项目列表没有汇总卡，只测加载/失败态
  {
    name: '历史项目',
    Comp: HistoryList,
    path: '/history',
    loadingText: '正在加载历史项目列表…',
    errorText: '加载历史项目列表失败，请检查网络后重试',
    hasKpi: false,
  },
]

function renderList(Comp, path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={<Comp />} />
      </Routes>
    </MemoryRouter>,
  )
}

// 汇总卡整块由 ListPage 的 .home-kpi 包裹，查容器比查卡标题稳：
// WBS 那一格的标题和侧边导航项同名，会互相误伤。
const hasKpiCards = () => document.querySelector('.home-kpi') !== null

describe.each(CASES)('$name列表的加载态与失败态', ({ name, Comp, path, loadingText, errorText }) => {
  beforeEach(() => {
    localStorage.setItem('wes_token', 'mock-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  test(`接口失败时给出可重试的提示，而不是空态（${name}）`, async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('bad request'))

    renderList(Comp, path)

    expect(await screen.findByRole('alert')).toHaveTextContent(errorText)
    expect(screen.getByRole('button', { name: '重试' })).toBeEnabled()
    expect(screen.queryByText('暂无数据')).not.toBeInTheDocument()
  })

  test('加载中给出进度提示，不提前判定为空', async () => {
    let resolveGet
    vi.spyOn(apiClient, 'get').mockImplementation(
      () => new Promise((res) => { resolveGet = res }),
    )

    renderList(Comp, path)

    expect(screen.getByText(loadingText)).toBeInTheDocument()
    expect(screen.queryByText('暂无数据')).not.toBeInTheDocument()
    await act(async () => {
      resolveGet({ code: 0, data: { items: [] } })
    })
    expect(screen.queryByText(loadingText)).not.toBeInTheDocument()
  })
})

// 取数没成功时汇总卡上的 0 没有依据，那颗无条件绿的点更是把失败说成健康。
describe.each(CASES.filter((item) => item.hasKpi))('$name列表的汇总卡时机', ({ Comp, path }) => {
  beforeEach(() => {
    localStorage.setItem('wes_token', 'mock-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  test('加载中不出汇总指标卡，取到数后才出', async () => {
    let resolveGet
    vi.spyOn(apiClient, 'get').mockImplementation(
      () => new Promise((res) => { resolveGet = res }),
    )

    renderList(Comp, path)
    expect(hasKpiCards()).toBe(false)

    await act(async () => {
      resolveGet({ code: 0, data: { items: [] } })
    })
    await waitFor(() => expect(hasKpiCards()).toBe(true))
  })

  test('加载失败时不出汇总指标卡', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('bad request'))

    renderList(Comp, path)
    await screen.findByRole('alert')
    expect(hasKpiCards()).toBe(false)
  })
})
