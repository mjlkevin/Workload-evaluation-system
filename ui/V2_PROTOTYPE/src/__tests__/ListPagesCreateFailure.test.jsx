import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { apiClient } from '../api/client.js'
import AssessmentList from '../pages/AssessmentList.jsx'
import DevAssessmentList from '../pages/DevAssessmentList.jsx'
import HistoryList from '../pages/HistoryList.jsx'
import RequirementList from '../pages/RequirementList.jsx'
import ResourceCostList from '../pages/ResourceCostList.jsx'

/**
 * 「新建」失败时的两件事，此前都是错的：
 *   ① 四个列表页没取用 hook 早就导出的 createError，失败时界面无任何提示；
 *   ② 更要命的是 create() 在 catch 里回的是本地 id，调用方一律
 *      `if (id) navigate(...)`，于是失败还把用户带到一个服务器上并不存在的
 *      详情页 —— 即便写了提示也永远看不到。
 * 判例：useReviewList / ReviewList 早已区分成败（失败留在原地并报错）。
 *
 * 本文件同时守住这两条：失败必须出现 role=alert，且必须留在列表页。
 */
const DETAIL_MARKER = '详情页占位（不应到达）'

const CASES = [
  {
    name: '实施评估',
    Comp: AssessmentList,
    path: '/assessments',
    detailPath: '/assessments/:id',
    message: '创建实施评估失败，已先保留在本地列表，请稍后重试',
  },
  {
    name: '需求',
    Comp: RequirementList,
    path: '/requirements',
    detailPath: '/requirements/:id',
    message: '创建需求清单失败，已先保留在本地列表，请稍后重试',
  },
  {
    name: '资源成本',
    Comp: ResourceCostList,
    path: '/resource-costs',
    detailPath: '/resource-costs/:id',
    message: '创建资源成本失败，已先保留在本地列表，请稍后重试',
  },
  {
    name: '历史项目',
    Comp: HistoryList,
    path: '/history',
    detailPath: '/history/:id',
    message: '创建历史项目失败，已先保留在本地列表，请稍后重试',
  },
  {
    name: '开发评估',
    Comp: DevAssessmentList,
    path: '/dev-assessments',
    detailPath: '/dev-assessments/:id',
    // 这页此前就写了提示，但因为失败也跳转，提示等于死代码
    message: '创建开发评估失败，已先保留在本地列表，请稍后重试',
  },
]

function renderList({ Comp, path, detailPath }) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={<Comp />} />
        <Route path={detailPath} element={<div>{DETAIL_MARKER}</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe.each(CASES)('$name列表 · 新建失败的反馈与去向', (item) => {
  beforeEach(() => {
    localStorage.setItem('wes_token', 'mock-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  test(`创建失败时给出 role=alert 的失败提示（${item.name}）`, async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ code: 0, data: { items: [] } })
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('create failed'))

    renderList(item)
    fireEvent.click(await screen.findByRole('button', { name: /新建/ }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(item.message)
  })

  test(`创建失败时留在列表页，不跳到并不存在的详情页（${item.name}）`, async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ code: 0, data: { items: [] } })
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('create failed'))

    renderList(item)
    fireEvent.click(await screen.findByRole('button', { name: /新建/ }))

    // 先等失败反馈落地，再断言去向，避免在跳转发生前就判过
    await screen.findByRole('alert')
    await waitFor(() => {
      expect(screen.queryByText(DETAIL_MARKER)).not.toBeInTheDocument()
    })
  })
})
