import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import MessageBubble from '../pages/AiHomeWorkbench/components/ChatArea/MessageBubble.jsx'

/**
 * ISS-2026-08-11-004 / RP-056：消息复制控件与时间戳重构
 * - 复制控件移到消息气泡外（气泡右下角外侧），不再渲染在气泡内部
 * - 复制控件与时间戳仅在鼠标悬浮消息区域时可见（CSS 负责 opacity，DOM 恒在）
 * - 时间戳打印在复制控件右侧
 * - 用户消息侧同样具备复制控件与时间戳
 */

describe('RP-056 MessageBubble 复制控件 + 时间戳', () => {
  test('AI 消息：复制控件渲染在气泡外（ai-bubble-wrap 之外）', () => {
    const { container } = render(
      <MessageBubble
        message={{ id: 'a1', role: 'assistant', text: '这是 AI 回复', createdAt: '2026-08-11T21:38:00' }}
        sending={false}
      />,
    )

    const copyButton = screen.getByRole('button', { name: '复制消息' })
    const bubble = container.querySelector('.ai-bubble-wrap')
    expect(bubble).toBeTruthy()
    // 复制控件不再位于气泡内部
    expect(bubble.contains(copyButton)).toBe(false)
    // 但仍属于本条消息行（悬浮触发区域）
    const row = container.querySelector('.ai-msg-row')
    expect(row).toBeTruthy()
    expect(row.contains(copyButton)).toBe(true)
  })

  test('AI 消息：时间戳渲染在复制控件右侧', () => {
    render(
      <MessageBubble
        message={{ id: 'a2', role: 'assistant', text: '带时间的回复', createdAt: '2026-08-10T09:05:00' }}
        sending={false}
      />,
    )

    const copyButton = screen.getByRole('button', { name: '复制消息' })
    const time = screen.getByText('08-10 09:05')
    // 时间戳在复制控件之后（右侧）
    expect(copyButton.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('用户消息：同样渲染复制控件与时间戳', () => {
    render(
      <MessageBubble
        message={{ id: 'u1', role: 'user', text: '用户提问', createdAt: '2026-08-10T10:20:00' }}
        sending={false}
      />,
    )

    expect(screen.getByRole('button', { name: '复制消息' })).toBeInTheDocument()
    expect(screen.getByText('08-10 10:20')).toBeInTheDocument()
  })

  test('loading / error 消息：不渲染复制控件', () => {
    const { rerender } = render(
      <MessageBubble
        message={{ id: 'l1', role: 'assistant', text: '正在理解你的问题', loading: true, createdAt: '2026-08-11T21:00:00' }}
        sending={true}
      />,
    )
    expect(screen.queryByRole('button', { name: '复制消息' })).not.toBeInTheDocument()

    rerender(
      <MessageBubble
        message={{ id: 'e1', role: 'assistant', text: '出错了', error: true, createdAt: '2026-08-11T21:01:00' }}
        sending={false}
      />,
    )
    expect(screen.queryByRole('button', { name: '复制消息' })).not.toBeInTheDocument()
  })

  test('AI 消息带 model 时：悬停信息区在复制控件与时间戳之间显示模型名', () => {
    render(
      <MessageBubble
        message={{ id: 'm1', role: 'assistant', text: '模型回答', model: 'kimi-k2-turbo-preview', createdAt: '2026-08-10T09:05:00' }}
        sending={false}
      />,
    )

    const copyButton = screen.getByRole('button', { name: '复制消息' })
    const modelName = screen.getByText('kimi-k2-turbo-preview')
    const time = screen.getByText('08-10 09:05')
    // 顺序：复制控件 → 模型名 → 时间戳
    expect(copyButton.compareDocumentPosition(modelName) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(modelName.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('AI 消息无 model 时：不显示模型名（历史消息/静态意图静默降级）', () => {
    render(
      <MessageBubble
        message={{ id: 'm2', role: 'assistant', text: '普通回答', createdAt: '2026-08-10T09:05:00' }}
        sending={false}
      />,
    )

    expect(screen.getByRole('button', { name: '复制消息' })).toBeInTheDocument()
    expect(screen.queryByText('kimi-k2-turbo-preview')).not.toBeInTheDocument()
  })

  test('用户消息：不显示模型名', () => {
    render(
      <MessageBubble
        message={{ id: 'u2', role: 'user', text: '用户提问', model: 'kimi-k2-turbo-preview', createdAt: '2026-08-10T10:20:00' }}
        sending={false}
      />,
    )

    expect(screen.getByRole('button', { name: '复制消息' })).toBeInTheDocument()
    expect(screen.queryByText('kimi-k2-turbo-preview')).not.toBeInTheDocument()
  })
})
