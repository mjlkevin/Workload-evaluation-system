import { useEffect } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import WorkspaceTabs from '../components/Layout/WorkspaceTabs.jsx'
import { UnsavedChangesProvider, useSetUnsavedDirty } from '../hooks/useUnsavedChanges.jsx'

const STORAGE_KEY = 'wes-v2-workspace-tabs-v1'
const savedTabs = [{ path: '/' }, { path: '/projects' }, { path: '/assessments' }]

function CurrentPage({ dirty }) {
  const location = useLocation()
  const setDirty = useSetUnsavedDirty()
  useEffect(() => { setDirty(dirty) }, [dirty, setDirty])
  return <output aria-label="当前页面路径">{location.pathname}</output>
}
function renderTabs(dirty = false) {
  return render(<MemoryRouter initialEntries={['/projects']}><UnsavedChangesProvider>
    <WorkspaceTabs /><CurrentPage dirty={dirty} />
  </UnsavedChangesProvider></MemoryRouter>)
}
describe('WorkspaceTabs overflow navigation', () => {
  beforeEach(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedTabs))
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 900 })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 360 })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete HTMLElement.prototype.scrollWidth
    delete HTMLElement.prototype.clientWidth
    localStorage.clear()
  })
  test('overflow provides all existing pages, marks the current one, and keeps controls outside tablist', () => {
    renderTabs()
    const picker = screen.getByRole('combobox', { name: '全部页签' })
    expect(within(picker).getByRole('option', { name: '当前 · 项目' })).toHaveValue('/projects')
    expect(within(picker).getByRole('option', { name: '实施评估' })).toHaveValue('/assessments')
    expect(within(screen.getByRole('tablist')).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(screen.getByRole('tablist')).queryByRole('button', { name: /页签向/ })).not.toBeInTheDocument()
  })
  test('selecting an offscreen existing page navigates without creating duplicate tabs', () => {
    renderTabs()
    fireEvent.change(screen.getByRole('combobox', { name: '全部页签' }), { target: { value: '/assessments' } })
    expect(screen.getByLabelText('当前页面路径')).toHaveTextContent('/assessments')
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toHaveLength(3)
    expect(screen.getByRole('combobox', { name: '全部页签' })).toHaveValue('')
  })
  test('canceling the existing unsaved prompt keeps route and tab selection unchanged', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderTabs(true)
    fireEvent.change(screen.getByRole('combobox', { name: '全部页签' }), { target: { value: '/assessments' } })
    expect(confirm).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('当前页面路径')).toHaveTextContent('/projects')
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('项目')
    expect(screen.getByRole('combobox', { name: '全部页签' })).toHaveValue('')
  })
  test('accepting the existing unsaved prompt allows selection', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderTabs(true)
    fireEvent.change(screen.getByRole('combobox', { name: '全部页签' }), { target: { value: '/' } })
    expect(screen.getByLabelText('当前页面路径')).toHaveTextContent('/')
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('AI 工作台')
  })
  test('no overflow leaves a simple tab row without overflow controls', () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 360 })
    renderTabs()
    expect(screen.queryByRole('combobox', { name: '全部页签' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /页签向/ })).not.toBeInTheDocument()
  })
})
