import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import WorkspaceTabs from '../components/Layout/WorkspaceTabs.jsx'

const STORAGE_KEY = 'wes-v2-workspace-tabs-v1'

// 360 档手机上页签条会横着排不下：.workspace-tabs 确实 overflow-x:auto
// （layout.css:56），但 macOS/移动端 overlay 滚动条平时不显示，用户看不出右边还有页签，
// 当前激活那一格也可能整个在屏幕外。这里把几何量成「内容 900 / 视口 360」的溢出形状，
// jsdom 不做布局、几何恒为 0，不 stub 就永远测不到溢出分支。
function stubGeometry({ scrollWidth = 900, clientWidth = 360, scrollLeft = 0 }) {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => scrollWidth })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => clientWidth })
  Object.defineProperty(HTMLElement.prototype, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: () => {},
  })
}

function renderTabs() {
  return render(
    <MemoryRouter initialEntries={['/projects']}>
      <Routes>
        <Route path="*" element={<WorkspaceTabs />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('WorkspaceTabs 窄屏滚动提示', () => {
  beforeEach(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      { path: '/', title: 'AI 工作台' },
      { path: '/projects', title: '项目' },
      { path: '/assessments', title: '实施评估' },
    ]))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    delete HTMLElement.prototype.scrollWidth
    delete HTMLElement.prototype.clientWidth
    delete HTMLElement.prototype.scrollLeft
    delete HTMLElement.prototype.scrollBy
    delete HTMLElement.prototype.scrollIntoView
  })

  test('右边还有页签时给出可点的向右提示', () => {
    stubGeometry({ scrollWidth: 900, clientWidth: 360, scrollLeft: 0 })

    renderTabs()

    expect(screen.getByRole('button', { name: '页签向右滚动' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '页签向左滚动' })).not.toBeInTheDocument()
  })

  test('滚到最右边后提示翻向左边', () => {
    stubGeometry({ scrollWidth: 900, clientWidth: 360, scrollLeft: 540 })

    renderTabs()

    expect(screen.getByRole('button', { name: '页签向左滚动' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '页签向右滚动' })).not.toBeInTheDocument()
  })

  test('页签没溢出时不出多余按钮', () => {
    stubGeometry({ scrollWidth: 360, clientWidth: 360, scrollLeft: 0 })

    renderTabs()

    expect(screen.queryByRole('button', { name: /页签向[左右]滚动/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(3)
  })

  test('点箭头按视口宽度滚动，不按固定像素', () => {
    const amountAt = (clientWidth) => {
      stubGeometry({ scrollWidth: 900, clientWidth, scrollLeft: 0 })
      const scrollBy = vi.fn()
      HTMLElement.prototype.scrollBy = scrollBy

      const view = renderTabs()
      fireEvent.click(screen.getByRole('button', { name: '页签向右滚动' }))
      view.unmount()

      expect(scrollBy).toHaveBeenCalledTimes(1)
      return scrollBy.mock.calls[0][0].left
    }

    const narrow = amountAt(360)
    expect(narrow).toBeGreaterThan(0)
    expect(amountAt(720)).toBeGreaterThan(narrow)
  })

  // 光有箭头不够：点开一个在屏幕外的页签，条得自己把它滚过来。
  test('切换时把当前页签滚进可视区', () => {
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    renderTabs()

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
    expect(document.querySelectorAll('.workspace-tab.on')).toHaveLength(1)
  })

  // 滚动区能被键盘聚焦是 WCAG 对可滚动容器的基本要求：
  // 只用键盘的人也得把条上剩下的页签滚出来，而不是只能靠鼠标滚轮。
  test('页签条本身可被键盘聚焦并滚动', () => {
    renderTabs()

    const strip = document.querySelector('.workspace-tabs')

    expect(strip).toHaveAttribute('tabindex', '0')
    expect(strip).toHaveAccessibleName('已打开页面')
  })
})
