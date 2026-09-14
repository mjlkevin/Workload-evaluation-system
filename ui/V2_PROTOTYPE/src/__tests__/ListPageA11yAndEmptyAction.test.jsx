import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { apiClient } from '../api/client.js'
import AssessmentList from '../pages/AssessmentList.jsx'
import DevAssessmentList from '../pages/DevAssessmentList.jsx'
import RequirementList from '../pages/RequirementList.jsx'
import ResourceCostList from '../pages/ResourceCostList.jsx'

/**
 * 两件事：
 *   ① 列表表格没有可被读屏播报的名字（缺 <caption>）—— 屏幕阅读器用户
 *      听到的是一个没有名字的表格，不知道自己在哪张表上。
 *   ② 空态只说「暂无数据」，不给下一步 —— 用户看到空页面无从下手。
 * 两条都落在共用组件 ListPage 上，因此只需在一个地方修，六个列表页同时受益；
 * 空态的下一步动作沿用 ListPage 早已存在的 emptyAction 通道
 * （判例：IndustryMasterData 早就这么传）。
 */
const CASES = [
  { name: '实施评估', Comp: AssessmentList, path: '/assessments', caption: /实施评估.*数据表/, emptyBtn: '+ 新建实施评估' },
  { name: '需求', Comp: RequirementList, path: '/requirements', caption: /需求.*数据表/, emptyBtn: '+ 新建需求清单' },
  { name: '资源成本', Comp: ResourceCostList, path: '/resource-costs', caption: /资源及人天成本.*数据表/, emptyBtn: '+ 新建资源成本' },
  { name: '开发评估', Comp: DevAssessmentList, path: '/dev-assessments', caption: /开发评估.*数据表/, emptyBtn: '+ 新建开发评估' },
]

function renderPage({ Comp, path }) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={<Comp />} />
        <Route path={`${path}/:id`} element={<div>详情页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe.each(CASES)('$name列表 · 表格可读名与空态下一步', (item) => {
  beforeEach(() => {
    localStorage.setItem('wes_token', 'mock-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  test(`表格有可被读屏播报的名字（${item.name}）`, async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      code: 0,
      data: { items: [{ id: 'r1', versionCode: 'X-1', status: '已检入', updatedAt: '2026-09-14' }] },
    })

    renderPage(item)

    // 有 accessible name 的表格才能被按名定位；缺 <caption> 时这一步直接失败
    expect(await screen.findByRole('table', { name: item.caption })).toBeInTheDocument()
  })

  test(`空态给出下一步动作而不是只说「暂无数据」（${item.name}）`, async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ code: 0, data: { items: [] } })

    renderPage(item)

    const btn = await screen.findByRole('button', { name: item.emptyBtn })
    expect(btn).toBeEnabled()
    expect(screen.queryByText('暂无数据')).not.toBeInTheDocument()
  })

  test(`空态里的动作真的会发起创建（${item.name}）`, async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ code: 0, data: { items: [] } })
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ code: 0, data: { id: 'new-1' } })

    renderPage(item)
    fireEvent.click(await screen.findByRole('button', { name: item.emptyBtn }))

    expect(post).toHaveBeenCalled()
  })
})
