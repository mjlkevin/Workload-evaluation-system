import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import SessionRail from '../components/AiWorkbench/SessionRail.jsx'
import WorkflowTemplates from '../pages/AiHomeWorkbench/components/ChatArea/WorkflowTemplates.jsx'
import { ToastProvider } from '../hooks/useToast.jsx'

const sessions = [
  { sessionId: 'a', title: '库存需求分析', createdAt: '2026-11-04T08:00:00Z' },
  { sessionId: 'b', title: 'MVP 评估', createdAt: '2026-11-03T08:00:00Z' },
]

function renderRail(props = {}) {
  return render(<ToastProvider><SessionRail sessions={sessions} activeSessionId="a" {...props} /></ToastProvider>)
}

describe('工作台左栏', () => {
  test('搜索过滤会话，空结果可清除，过滤不切换当前会话', () => {
    const onSelect = vi.fn()
    renderRail({ onSelect })
    const search = screen.getByRole('searchbox', { name: '搜索会话' })
    fireEvent.change(search, { target: { value: ' mVp ' } })
    expect(screen.queryByText('库存需求分析')).not.toBeInTheDocument()
    expect(screen.getByText('MVP 评估')).toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.change(search, { target: { value: '不存在' } })
    expect(screen.getByText('没有匹配的会话')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))
    expect(search).toHaveValue('')
    expect(screen.getByText('库存需求分析')).toBeInTheDocument()
  })

  test('选择、停止、更多操作各自独立；可见更多入口复用原管理回调', () => {
    const onSelect = vi.fn()
    const onStop = vi.fn()
    const onDelete = vi.fn()
    renderRail({ onSelect, onStop, onDelete, sessionRuns: { a: { runId: 'r1', title: '分析任务' } } })
    const select = screen.getByRole('button', { name: /库存需求分析.*今天|库存需求分析.*11月|库存需求分析.*2026/ })
    expect(select.tagName).toBe('BUTTON')
    expect(within(select).queryByRole('button')).not.toBeInTheDocument()
    expect(select).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(select)
    expect(onSelect).toHaveBeenCalledWith(sessions[0])
    onSelect.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '停止后台任务：分析任务' }))
    expect(onStop).toHaveBeenCalledWith(sessions[0])
    fireEvent.click(screen.getByRole('button', { name: '更多操作：库存需求分析' }))
    fireEvent.click(screen.getByRole('button', { name: '删除会话' }))
    expect(onDelete).toHaveBeenCalledWith(sessions[0])
    expect(onSelect).not.toHaveBeenCalled()
  })

  test('模板可收起再展开，选择仍交给原回调且保留当前任务语义', () => {
    const workflow = { key: 'parse', title: '解析需求文件', desc: '识别业务需求及问题一览' }
    const onStartWorkflow = vi.fn()
    render(<WorkflowTemplates workflows={[workflow]} activeWorkflowKey="parse" onStartWorkflow={onStartWorkflow} />)
    const toggle = screen.getByRole('button', { name: /工作流模板/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: '解析需求文件（当前任务）' })).not.toBeInTheDocument()
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: '解析需求文件（当前任务）' }))
    expect(onStartWorkflow).toHaveBeenCalledWith(workflow)
  })

  test('Escape返回更多按钮；点击搜索关闭菜单时保持搜索焦点', async () => {
    renderRail()
    const trigger = screen.getByRole('button', { name: '更多操作：库存需求分析' })
    fireEvent.click(trigger)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(trigger).toHaveFocus()
    fireEvent.click(trigger)
    // The outside-click listener is deliberately installed after the opening click.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const search = screen.getByRole('searchbox', { name: '搜索会话' })
    search.focus()
    fireEvent.click(search)
    expect(screen.queryByRole('button', { name: '复制 Session ID' })).not.toBeInTheDocument()
    expect(search).toHaveFocus()
  })
})
