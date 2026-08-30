import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { ROUTE_REDIRECTS, SYSTEM_MANAGEMENT_SECTIONS } from '../../config/systemManagementSections.js'
import { useUnsavedNavigation } from '../../hooks/useUnsavedChanges.jsx'

const STORAGE_KEY = 'wes-v2-workspace-tabs-v1'

const STATIC_TITLES = {
  '/': 'AI 工作台',
  '/projects': '项目',
  '/requirements': '需求',
  '/assessments': '实施评估',
  '/dev-assessments': '开发评估',
  '/resource-costs': '资源成本',
  '/wbs': 'WBS',
  '/reviews': '评审',
  '/history': '历史项目',
  '/system': '系统管理',
  '/users': '用户管理',
  '/api-keys': 'API 密钥',
  ...Object.fromEntries(SYSTEM_MANAGEMENT_SECTIONS.map((section) => [section.route, section.label])),
}

const DETAIL_TITLES = [
  { pattern: /^\/requirements\/[^/]+\/ai-evaluation$/, title: 'AI 评估台' },
  { pattern: /^\/requirements\/[^/]+$/, title: '需求详情' },
  { pattern: /^\/assessments\/[^/]+$/, title: '实施评估详情' },
  { pattern: /^\/dev-assessments\/[^/]+$/, title: '开发评估详情' },
  { pattern: /^\/resource-costs\/[^/]+$/, title: '资源成本详情' },
  { pattern: /^\/reviews\/[^/]+$/, title: '评审详情' },
  { pattern: /^\/history\/[^/]+$/, title: '历史项目详情' },
]

function routeKeyFromLocation(location) {
  const search = location.search || ''
  return `${location.pathname || '/'}${search}`
}

function normalizeTabPath(path) {
  const raw = String(path || '').trim()
  if (!raw) return '/'
  const [basePath, query = ''] = raw.split('?')
  if (!query) return basePath || '/'
  const params = new URLSearchParams(query)
  params.delete('tabKey')
  const entries = [...params.entries()].sort(([aKey, aVal], [bKey, bVal]) => {
    const keyOrder = aKey.localeCompare(bKey)
    return keyOrder !== 0 ? keyOrder : aVal.localeCompare(bVal)
  })
  if (!entries.length) return basePath || '/'
  return `${basePath || '/'}?${new URLSearchParams(entries).toString()}`
}

function resolveTabTitle(path) {
  const purePath = String(path || '/').split('?')[0] || '/'
  if (STATIC_TITLES[purePath]) return STATIC_TITLES[purePath]
  const matched = DETAIL_TITLES.find((item) => item.pattern.test(purePath))
  if (matched) return matched.title
  const last = purePath.split('/').filter(Boolean).at(-1)
  return last ? decodeURIComponent(last) : '页面'
}

function normalizeTabs(input) {
  const seen = new Set()
  const tabs = []
  for (const tab of input) {
    // 先把跳转路由解到它真正指向的子页再进去重：/system 会被 <Navigate replace>
    // 立刻换成 /system/code-rules，但布局路由在重定向期间不卸载，两个路径都会被记
    // 一笔。不解的话条上会常年挂着一个点不动的「系统管理」僵尸页签。
    const path = resolveRedirectPath(tab?.path)
    if (!path || path === '/login' || !path.startsWith('/')) continue
    const dedupeKey = normalizeTabPath(path)
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    tabs.push({ path, title: resolveTabTitle(path) })
  }
  return tabs.length ? tabs : [{ path: '/', title: 'AI 工作台' }]
}

function resolveRedirectPath(path) {
  const raw = String(path || '').trim()
  const [basePath, query = ''] = raw.split('?')
  const target = ROUTE_REDIRECTS[basePath]
  if (!target) return raw
  return query ? `${target}?${query}` : target
}

function menuPosition(x, y) {
  const width = 152
  const height = 74
  const gap = 6
  const maxX = Math.max(gap, window.innerWidth - width - gap)
  const maxY = Math.max(gap, window.innerHeight - height - gap)
  return {
    x: Math.min(Math.max(gap, x + gap), maxX),
    y: Math.min(Math.max(gap, y + gap), maxY),
  }
}

// 溢出时贴在条两侧的滚动按钮：滚动条在 macOS / 手机上默认不占位，
// 不给出可点的箭头，用户不知道右边还有页签。sticky 在横向滚动容器里
// 能贴在 scrollport 边缘，所以它们可以当普通 flow 子项放进 track，
// 不必新增 DOM 层，也不动已冻结的 layout.css。
const SCROLL_CUE_BASE = 'sticky z-10 grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line bg-surface text-ink-3 cursor-pointer hover:bg-bg-soft'

// jsdom 不实现这些几何 API，组件侧得先探一下；真实浏览器全部可用。
function scrollByAmount(el, amount) {
  if (typeof el?.scrollBy === 'function') el.scrollBy({ left: amount, behavior: 'smooth' })
  else if (el) el.scrollLeft += amount
}

export default function WorkspaceTabs() {
  const location = useLocation()
  const navigate = useNavigate()
  const { isDirty, requestNavigation, confirmNavigation, cancelNavigation } = useUnsavedNavigation()
  const currentRouteKey = useMemo(() => routeKeyFromLocation(location), [location])
  const [tabs, setTabs] = useState(() => [{ path: '/', title: 'AI 工作台' }])
  const [ready, setReady] = useState(false)
  const [menu, setMenu] = useState(null)
  const stripRef = useRef(null)
  const [cue, setCue] = useState({ left: false, right: false })

  const measureCue = useCallback(() => {
    const el = stripRef.current
    if (!el) return
    const maxScroll = el.scrollWidth - el.clientWidth
    const left = el.scrollLeft > 1
    const right = el.scrollLeft < maxScroll - 1
    setCue((prev) => (prev.left === left && prev.right === right ? prev : { left, right }))
  }, [])

  useEffect(() => {
    const el = stripRef.current
    if (!el) return undefined
    measureCue()
    // 页签增减、窗口缩放、字体回位都会改变溢出量，三个信号都得重测
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measureCue) : null
    if (observer) observer.observe(el)
    el.addEventListener('scroll', measureCue, { passive: true })
    window.addEventListener('resize', measureCue)
    return () => {
      el.removeEventListener('scroll', measureCue)
      window.removeEventListener('resize', measureCue)
      if (observer) observer.disconnect()
    }
  }, [measureCue, tabs])

  // 当前页签可能在屏幕外：只给箭头不够，切页时自己滚过来
  useEffect(() => {
    const active = stripRef.current?.querySelector('.workspace-tab.on')
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [currentRouteKey, tabs])

  function nudgeCue(direction) {
    const el = stripRef.current
    if (!el) return
    scrollByAmount(el, direction * Math.max(1, Math.round(el.clientWidth * 0.9)))
  }

  useEffect(() => {
    let restored = []
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) restored = JSON.parse(raw)
    } catch {
      restored = []
    }
    setTabs(normalizeTabs([...restored, { path: currentRouteKey, title: resolveTabTitle(currentRouteKey) }]))
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    const currentDedupeKey = normalizeTabPath(currentRouteKey)
    setTabs((prev) => {
      if (prev.some((tab) => normalizeTabPath(tab.path) === currentDedupeKey)) return prev
      return normalizeTabs([...prev, { path: currentRouteKey, title: resolveTabTitle(currentRouteKey) }])
    })
  }, [currentRouteKey, ready])

  useEffect(() => {
    if (!ready) return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs))
  }, [tabs, ready])

  useEffect(() => {
    if (!menu) return undefined
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('keydown', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', close)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  function openTab(path) {
    if (path === currentRouteKey) return
    if (!requestNavigation(path)) {
      if (!window.confirm('当前页有未保存修改，切换页签后将丢弃这些修改。是否继续？')) {
        cancelNavigation()
        return
      }
      confirmNavigation()
    }
    navigate(path)
  }

  function closeTab(path) {
    const isActive = path === currentRouteKey
    if (isActive && isDirty) {
      if (!window.confirm('当前页有未保存修改，关闭页签后将丢弃这些修改。是否关闭？')) {
        cancelNavigation()
        return
      }
      confirmNavigation()
    }
    const index = tabs.findIndex((tab) => tab.path === path)
    const nextTabs = tabs.filter((tab) => tab.path !== path)
    if (!nextTabs.length) {
      const fallback = { path: '/', title: 'AI 工作台' }
      setTabs([fallback])
      if (path !== '/') navigate('/')
      return
    }
    setTabs(nextTabs)
    if (path === currentRouteKey) {
      const fallback = nextTabs[Math.max(0, index - 1)] || nextTabs[0]
      navigate(fallback.path)
    }
  }

  function closeOtherTabs(path) {
    const kept = tabs.find((tab) => tab.path === path) || { path, title: resolveTabTitle(path) }
    if (path !== currentRouteKey && !requestNavigation(path)) {
      if (!window.confirm('当前页有未保存修改，关闭其他页签并切换后将丢弃这些修改。是否继续？')) {
        cancelNavigation()
        return
      }
      confirmNavigation()
    }
    setTabs([kept])
    if (path !== currentRouteKey) navigate(path)
  }

  function closeAllTabs() {
    if (isDirty) {
      if (!window.confirm('当前页有未保存修改，关闭所有页签后将丢弃这些修改。是否继续？')) {
        cancelNavigation()
        return
      }
      confirmNavigation()
    }
    setTabs([{ path: '/', title: 'AI 工作台' }])
    if (currentRouteKey !== '/') navigate('/')
  }

  if (!ready) return null

  return (
    <div className="workspace-tabs" role="tablist" aria-label="已打开页面" tabIndex={0} ref={stripRef}>
      <div className="workspace-tabs-track">
        {cue.left && (
          <button
            type="button"
            className={`${SCROLL_CUE_BASE} left-0`}
            aria-label="页签向左滚动"
            onClick={() => nudgeCue(-1)}
          >
            ‹
          </button>
        )}
        {tabs.map((tab) => {
          const isActive = normalizeTabPath(tab.path) === normalizeTabPath(currentRouteKey)
          return (
            <div
              className={isActive ? 'workspace-tab on' : 'workspace-tab'}
              key={tab.path}
              role="tab"
              aria-selected={isActive}
              onContextMenu={(event) => {
                event.preventDefault()
                const pos = menuPosition(event.clientX, event.clientY)
                setMenu({ path: tab.path, ...pos })
              }}
            >
              <button type="button" className="workspace-tab-title" onClick={() => openTab(tab.path)} title={tab.title}>
                {tab.title}
              </button>
              <button
                type="button"
                className="workspace-tab-close"
                onClick={(event) => {
                  event.stopPropagation()
                  closeTab(tab.path)
                }}
                aria-label={`关闭${tab.title}`}
                title="关闭"
              >
                ×
              </button>
            </div>
          )
        })}
        {cue.right && (
          <button
            type="button"
            className={`${SCROLL_CUE_BASE} right-0`}
            aria-label="页签向右滚动"
            onClick={() => nudgeCue(1)}
          >
            ›
          </button>
        )}
      </div>
      {menu && createPortal(
        <div
          className="workspace-tab-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => { closeOtherTabs(menu.path); setMenu(null) }}>关闭其他页签</button>
          <button type="button" onClick={() => { closeAllTabs(); setMenu(null) }}>关闭全部页签</button>
        </div>,
        document.body
      )}
    </div>
  )
}
