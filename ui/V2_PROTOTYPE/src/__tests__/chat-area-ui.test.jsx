import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import Composer from '../pages/AiHomeWorkbench/components/ChatArea/Composer.jsx'
import MessageList from '../pages/AiHomeWorkbench/components/ChatArea/MessageList.jsx'
import { listExecutionCatalog } from '../api/businessExecutions.js'

vi.mock('../api/businessExecutions.js', () => ({ listExecutionCatalog: vi.fn() }))
const task = { kind: 'skill', id: 's1', name: '需求拆解', description: '拆分业务诉求' }
beforeEach(() => listExecutionCatalog.mockResolvedValue([task]))

test('可见的能力入口打开原目录；选择保留草稿并回到编辑框，不发送消息', async () => {
  const send = vi.fn(), choose = vi.fn()
  function Host() {
    const [composer, setComposer] = useState('请保留我的草稿')
    return <Composer composer={composer} setComposer={setComposer} onSelectTask={choose} onSend={send} fileInputRef={{ current: null }} />
  }
  render(<Host />)
  fireEvent.click(screen.getByRole('button', { name: '选择 Skill 或流程' }))
  fireEvent.click(await screen.findByRole('option', { name: /需求拆解/ }))
  const box = screen.getByRole('textbox', { name: 'AI 工作台输入' })
  expect(box.value.trim()).toBe('请保留我的草稿')
  expect(box).toHaveFocus()
  expect(choose).toHaveBeenCalledWith(task)
  expect(send).not.toHaveBeenCalled()
})

test('历史阅读不被新消息打断；回到最新消息恢复跟随', () => {
  const messages = [{ id: 'a', role: 'assistant', text: '原有回答' }]
  const props = { sessionId: 's1', messages, bubbleProps: {} }
  const { rerender } = render(<MessageList {...props} />)
  const pane = screen.getByTestId('ai-home-message-pane')
  Object.defineProperties(pane, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 } })
  pane.scrollTop = 100
  fireEvent.scroll(pane)
  expect(screen.getByRole('button', { name: '回到最新消息' })).toBeVisible()
  rerender(<MessageList {...props} messages={[...messages, { id: 'b', role: 'assistant', text: '新回答' }]} />)
  expect(pane.scrollTop).toBe(100)
  fireEvent.click(screen.getByRole('button', { name: '回到最新消息' }))
  expect(pane.scrollTop).toBe(1000)
  expect(screen.queryByRole('button', { name: '回到最新消息' })).not.toBeInTheDocument()
  rerender(<MessageList {...props} messages={[...messages, { id: 'c', role: 'assistant', text: '继续回复' }]} />)
  expect(pane.scrollTop).toBe(1000)
})

test('重复打开能力入口复用草稿末尾的斜杠，不追加重复命令', () => {
  function Host() {
    const [composer, setComposer] = useState('保留草稿')
    return <Composer composer={composer} setComposer={setComposer} onSelectTask={vi.fn()} onSend={vi.fn()} fileInputRef={{ current: null }} />
  }
  render(<Host />)
  const trigger = screen.getByRole('button', { name: '选择 Skill 或流程' })
  fireEvent.click(trigger)
  fireEvent.click(trigger)
  expect(screen.getByRole('textbox', { name: 'AI 工作台输入' })).toHaveValue('保留草稿 /')
})

test('切换会话后清除上一会话的历史回看提示', () => {
  const messages = [{ id: 'a', role: 'user', text: '历史问题' }]
  const { rerender } = render(<MessageList messages={messages} sessionId="s1" bubbleProps={{}} />)
  const pane = screen.getByTestId('ai-home-message-pane')
  Object.defineProperties(pane, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 } })
  pane.scrollTop = 0
  fireEvent.scroll(pane)
  expect(screen.getByRole('button', { name: '回到最新消息' })).toBeVisible()
  rerender(<MessageList messages={messages} sessionId="s2" bubbleProps={{}} />)
  expect(screen.queryByRole('button', { name: '回到最新消息' })).not.toBeInTheDocument()
  expect(pane.scrollTop).toBe(1000)
})
