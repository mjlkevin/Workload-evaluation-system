import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderHook, waitFor as waitForHook } from '@testing-library/react'

import App from '../App.jsx'
import { apiClient } from '../api/client.js'
import TraditionalHomeDashboard from '../pages/TraditionalHomeDashboard.jsx'
import { mockIndustryOptions, mockUsers } from './mocks/data.js'
import { server } from './mocks/server.js'
import { useIndustryOptions } from '../hooks/useIndustryMasterData.js'

// ============================================================
// 批次 10a · 基础管理（行业主数据）前端判据
// ============================================================
// 覆盖派单判据 1 与 3 的前端侧：
//   ① 导航出现【基础管理】且与系统管理同级；非管理员看不到（沿用现有
//      Shell.jsx 的「系统」分组过滤口径）+ 直接输 URL 也被守卫挡回
//   ③ 停用一个行业 → 新建单据的选项里没有它；
//      库里存过的非标准值（如 `离散制造`）在页面上仍正常显示、不崩不空白
// 另钉一条结构性事实：界面上不给任何删除入口（禁硬删的第一层）。

const BASE = '/api/v1'

function renderAppAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

function asAdmin() {
  server.use(http.get(`${BASE}/auth/me`, () => HttpResponse.json({ success: true, data: { user: mockUsers[0] } })))
}

function asBusinessUser() {
  server.use(http.get(`${BASE}/auth/me`, () => HttpResponse.json({ success: true, data: { user: mockUsers[2] } })))
}

describe('① 导航：基础管理与系统管理同级', () => {
  beforeEach(() => asAdmin())

  test('管理员侧栏出现【基础管理】父项与【行业】子链接', async () => {
    renderAppAt('/base-data/industries')
    await screen.findByRole('heading', { name: '行业' })

    const navigation = screen.getByRole('navigation', { name: '主导航' })
    // 父项是可展开按钮（与系统管理同形态），不是链接
    expect(within(navigation).getByRole('button', { name: /系统管理/ })).toBeInTheDocument()
    expect(within(navigation).getByRole('button', { name: /基础管理/ })).toBeInTheDocument()
    expect(within(navigation).getByRole('link', { name: /行业/ })).toHaveAttribute('href', '/base-data/industries')
  })

  test('/base-data 父路由跳到默认子页，不渲染空白页', async () => {
    renderAppAt('/base-data')
    expect(await screen.findByRole('heading', { name: '行业' })).toBeInTheDocument()
  })

  test('非管理员：侧栏没有基础管理，直接输 URL 也被挡回工作台', async () => {
    asBusinessUser()
    const { unmount } = renderAppAt('/base-data/industries')

    expect(await screen.findByRole('heading', { name: 'AI 工作台' })).toBeInTheDocument()
    const navigation = screen.getByRole('navigation', { name: '主导航' })
    expect(within(navigation).queryByRole('button', { name: /基础管理/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '行业' })).not.toBeInTheDocument()
    unmount()

    // 分组过滤之外还要有路由守卫：光靠不给按钮，手输 URL 就进来了
    renderAppAt('/base-data/industries')
    expect(await screen.findByRole('heading', { name: 'AI 工作台' })).toBeInTheDocument()
  })
})

describe('③ 行业管理页：两层可见、无删除入口', () => {
  beforeEach(() => asAdmin())

  test('一级与二级都在列表里，已停用的仍看得见（停用不是消失）', async () => {
    renderAppAt('/base-data/industries')
    await screen.findByRole('heading', { name: '行业' })

    // 列表要等取数回来才出行，标题先渲染，不能用同步 getByText
    // 「制造业」在表里出现两次：一级行本身 + 二级行的「所属大类」列
    expect((await screen.findAllByText('制造业')).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('└ 流程制造')).toBeInTheDocument()
    expect(screen.getAllByText('其他').length).toBeGreaterThan(0)
    // 「已停用」既是 KPI 卡标题也是状态徽标，取徽标那一处即可
    expect(screen.getAllByText('已停用').length).toBeGreaterThanOrEqual(2)
  })

  test('批量动作里没有「删除」——主数据只允许停用', async () => {
    renderAppAt('/base-data/industries')
    await screen.findByRole('heading', { name: '行业' })

    const toolbar = screen.getByText('已选 0').closest('div')
    expect(within(toolbar).getByText('✏ 修改')).toBeInTheDocument()
    expect(within(toolbar).getByText('⏸ 停用')).toBeInTheDocument()
    expect(within(toolbar).getByText('▶ 启用')).toBeInTheDocument()
    expect(within(toolbar).queryByText(/删除/)).not.toBeInTheDocument()
    expect(within(toolbar).queryByText(/🗑/)).not.toBeInTheDocument()
  })

  test('新增大类弹窗提交会打到后端 categories 端点', async () => {
    renderAppAt('/base-data/industries')
    await screen.findByRole('heading', { name: '行业' })

    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ code: 0, data: { category: { id: 'c-new' } } })
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ code: 0, data: { items: [], total: 0 } })

    fireEvent.click(screen.getByRole('button', { name: '+ 新增大类' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: '零售业' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))

    await waitFor(() => expect(post).toHaveBeenCalled())
    expect(post.mock.calls.some(([path]) => path === '/master-data/industries/categories')).toBe(true)
    // 提交后的 refetch 也必须走本域端点，不能打到别的清单上
    expect(get.mock.calls.some(([path]) => path === '/master-data/industries/tree')).toBe(true)
  })
})

describe('③ 新建项目评估：客户行业只列启用项，非标准值不崩', () => {
  /** 项目页四个指标卡 + 行业下拉共 5 个取数点，全部按路径分派。 */
  function mockProjectPage({ options = mockIndustryOptions } = {}) {
    vi.spyOn(apiClient, 'get').mockImplementation((path) => {
      const target = String(path)
      if (target.includes('/master-data/industries/options')) {
        return Promise.resolve({ code: 0, message: 'ok', data: { items: options, total: options.length } })
      }
      if (target.includes('/project-evaluations')) return Promise.resolve({ code: 0, data: { items: [] } })
      if (target.includes('/auth/users')) return Promise.resolve({ code: 0, data: { users: [] } })
      return Promise.resolve({ code: 0, data: { items: [] } })
    })
  }

  async function openNewPlanDialog() {
    mockProjectPage()
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <TraditionalHomeDashboard />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getAllByText('+ 新建')[0])
    return screen.findByText('客户行业')
  }

  test('「客户行业」是下拉而不是文本框（行业只有一个来源）', async () => {
    await openNewPlanDialog()
    const select = screen.getByLabelText('客户行业')
    expect(select.tagName).toBe('SELECT')
  })

  test('已停用的行业不出现在新建选项里', async () => {
    await openNewPlanDialog()
    const select = screen.getByLabelText('客户行业')
    const values = Array.from(select.querySelectorAll('option')).map((o) => o.value).filter(Boolean)
    expect(values).toEqual(['制造业', '流程制造'])
    expect(values).not.toContain('其他')
  })

  test('行业清单取数失败时明说，而不是静默给一个空下拉', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation((path) => {
      if (String(path).includes('/master-data/industries/options')) {
        return Promise.reject(new Error('行业选项加载失败'))
      }
      if (String(path).includes('/project-evaluations')) return Promise.resolve({ code: 0, data: { items: [] } })
      if (String(path).includes('/auth/users')) return Promise.resolve({ code: 0, data: { users: [] } })
      return Promise.resolve({ code: 0, data: { items: [] } })
    })
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <TraditionalHomeDashboard />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getAllByText('+ 新建')[0])
    await screen.findByText('客户行业')
    expect(await screen.findByText(/行业清单加载失败/)).toBeInTheDocument()
  })
})

describe('③ 历史值不在主数据里时的显示兜底', () => {
  test('当前值是非标准值时：保留原值并标注，不空白不报错', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ code: 0, data: { items: mockIndustryOptions, total: 2 } })
    const { result } = renderHook(() => useIndustryOptions({ currentValue: '离散制造' }))

    await waitForHook(() => expect(result.current.loading).toBe(false))

    expect(result.current.isKnownValue).toBe(false)
    expect(result.current.displayOptions[0].value).toBe('离散制造')
    expect(result.current.displayOptions[0].label).toBe('离散制造（非标准值）')
    // 标准项必须跟在后面，不能因为多了保留项就把清单挤掉
    expect(result.current.displayOptions.map((o) => o.value)).toEqual(['离散制造', '制造业', '流程制造'])
  })

  test('当前值在启用清单里时：不多塞一条重复项', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ code: 0, data: { items: mockIndustryOptions, total: 2 } })
    const { result } = renderHook(() => useIndustryOptions({ currentValue: '制造业' }))

    await waitForHook(() => expect(result.current.loading).toBe(false))

    expect(result.current.isKnownValue).toBe(true)
    expect(result.current.displayOptions.map((o) => o.value)).toEqual(['制造业', '流程制造'])
  })

  test('取数中不得把原值标成非标准值（看不到清单 ≠ 值不标准）', () => {
    vi.spyOn(apiClient, 'get').mockImplementation(() => new Promise(() => {}))
    const { result } = renderHook(() => useIndustryOptions({ currentValue: '离散制造' }))

    expect(result.current.loading).toBe(true)
    expect(result.current.displayOptions[0].label).toBe('离散制造')
  })
})
