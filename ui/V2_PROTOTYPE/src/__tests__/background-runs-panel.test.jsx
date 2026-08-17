import { describe, expect, test, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BackgroundRunsPanel from '../pages/AiHomeWorkbench/components/ChatArea/BackgroundRunsPanel.jsx'

describe('BackgroundRunsPanel', () => {
  test('进行中和已完成都为 0 时不渲染', () => {
    const { container } = render(
      <BackgroundRunsPanel runs={[]} runCounts={{ active: 0, completed: 0 }} onStopRun={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  test('渲染顶部计数摘要', () => {
    render(
      <BackgroundRunsPanel runs={[]} runCounts={{ active: 0, completed: 3 }} onStopRun={() => {}} />,
    )
    expect(screen.getByText('后台任务 进行中 0 · 已完成 3')).toBeInTheDocument()
  })

  test('活跃任务逐行渲染，每行带停止按钮', () => {
    const onStopRun = vi.fn()
    const runs = [
      { runId: 'r1', title: '任务A', status: 'running', sessionId: 's1' },
      { runId: 'r2', title: '任务B', status: 'queued', sessionId: 's2' },
    ]
    render(
      <BackgroundRunsPanel runs={runs} runCounts={{ active: 2, completed: 0 }} onStopRun={onStopRun} />,
    )
    expect(screen.getByText('任务A')).toBeInTheDocument()
    expect(screen.getByText('任务B')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('停止后台任务：任务A'))
    expect(onStopRun).toHaveBeenCalledWith(runs[0])
  })

  test('已完成/失败状态的 run 不出现在行列表里（只计入顶部计数）', () => {
    const runs = [
      { runId: 'r1', title: '任务A', status: 'completed', sessionId: 's1' },
      { runId: 'r2', title: '任务B', status: 'running', sessionId: 's2' },
    ]
    render(
      <BackgroundRunsPanel runs={runs} runCounts={{ active: 1, completed: 1 }} onStopRun={() => {}} />,
    )
    expect(screen.queryByText('任务A')).not.toBeInTheDocument()
    expect(screen.getByText('任务B')).toBeInTheDocument()
  })

  test('超过 2 条活跃任务时默认折叠，点击展开全部', () => {
    const runs = [
      { runId: 'r1', title: '任务A', status: 'running', sessionId: 's1' },
      { runId: 'r2', title: '任务B', status: 'running', sessionId: 's2' },
      { runId: 'r3', title: '任务C', status: 'running', sessionId: 's3' },
    ]
    render(
      <BackgroundRunsPanel runs={runs} runCounts={{ active: 3, completed: 0 }} onStopRun={() => {}} />,
    )
    expect(screen.getByText('任务A')).toBeInTheDocument()
    expect(screen.getByText('任务B')).toBeInTheDocument()
    expect(screen.queryByText('任务C')).not.toBeInTheDocument()
    expect(screen.getByText('还有 1 项')).toBeInTheDocument()

    fireEvent.click(screen.getByText('还有 1 项'))
    expect(screen.getByText('任务C')).toBeInTheDocument()
  })
})
