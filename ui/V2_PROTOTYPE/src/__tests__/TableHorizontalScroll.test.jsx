import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { apiClient } from '../api/client.js'
import ApiKeys from '../pages/ApiKeys.jsx'
import DevAssessmentDetail from '../pages/DevAssessmentDetail.jsx'
import ReviewDetail from '../pages/ReviewDetail.jsx'
import TraditionalHomeDashboard from '../pages/TraditionalHomeDashboard.jsx'

const layoutCss = readFileSync(join(process.cwd(), 'layout.css'), 'utf-8')

// 壳层 html{overflow-x:hidden} + .section{overflow:hidden} 会把超宽表格直接切掉：
// 窄屏下右侧列不是「要滚动」，是「永远看不见」。ListPage / UserManagement / 系统管理
// 那几张表已经套了 .sys-table-wrap，剩下的表各自漏在外面——同一个问题只修一半，
// 下次从这些页面复制片段就会把漏滚动的写法带回主线。
//
// 不进这份名单的两处：
// - AssessmentDetail 的两张表在 activeTab 后面，要摸到得造整套 payload——同一条规则
//   在上面的页面已经钉住了，不为它单独扩测试夹具。
// - KnowledgeBaseProfilesPanel 用 .kb-profiles__table-wrap，桌面态 table-layout:fixed
//   不溢出，≤ 760px 另有堆叠重排（index.css:1316），不是缺口。
const CASES = [
  { name: '首页项目表', Comp: TraditionalHomeDashboard, path: '/projects' },
  { name: 'API 密钥表', Comp: ApiKeys, path: '/api-keys' },
  { name: '评审详情页交付物表', Comp: ReviewDetail, path: '/reviews/REV-001' },
  { name: '开发评估明细表', Comp: DevAssessmentDetail, path: '/dev-assessments/DA-001' },
]

function renderAt(Comp, path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={<Comp />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe.each(CASES)('$name的横向滚动容器', ({ name, Comp, path }) => {
  beforeEach(() => {
    localStorage.setItem('wes_token', 'mock-token')
    vi.spyOn(apiClient, 'get').mockResolvedValue({ code: 0, data: { items: [], total: 0 } })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  test(`${name}里每张表都套在横向滚动容器内`, async () => {
    renderAt(Comp, path)

    // 等第一次取数结束、表格挂上 DOM
    await screen.findAllByRole('table')

    const tables = Array.from(document.querySelectorAll('table'))
    expect(tables.length).toBeGreaterThan(0)

    const bare = tables.filter((t) => !t.closest('.sys-table-wrap') && !scrollableAncestor(t))
    expect(bare.map((t) => t.getAttribute('aria-label') || t.className)).toEqual([])
  })
})

// 祖先内联样式里写了滚动声明的（如明细弹窗、历史版本区），视为已处理。
function scrollableAncestor(node) {
  let el = node.parentElement
  while (el && el !== document.body) {
    const { overflow, overflowX } = el.style
    if (/auto|scroll/.test(`${overflow} ${overflowX}`)) return true
    el = el.parentElement
  }
  return false
}

// 容器类一旦被改名或规则被删，页面上那圈包裹就退化成普通 div——断言 CSS 侧的契约还在。
test('.sys-table-wrap 仍然是横向滚动容器', () => {
  expect(layoutCss).toMatch(/\.sys-table-wrap\s*\{[^}]*overflow-x:\s*auto/)
})
