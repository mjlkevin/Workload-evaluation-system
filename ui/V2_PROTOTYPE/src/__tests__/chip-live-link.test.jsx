// 工单 2026-08-11-qoder-memory-panel-chip-live-link · RED→GREEN
// MS3 chip 活数据链路（前端段）：
// ① MessageBubble 把 message.toolCalls / message.memoryRef 透传给 ModelRunTrace ——
//    真实 dispatch run 下 chip 可见；
// ② mapSessionMessages 从会话 metadata 归一 toolCalls / memoryRef ——
//    刷新 / 切换会话后 chip 仍可渲染。
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import MessageBubble from '../pages/AiHomeWorkbench/components/ChatArea/MessageBubble.jsx'
import { mapSessionMessages } from '../pages/AiHomeWorkbench/utils/messageFormatter.js'

function renderBubble(message) {
  return render(
    <MemoryRouter>
      <MessageBubble message={message} index={0} sending={false} confirmingActionId="" />
    </MemoryRouter>,
  )
}

describe('MessageBubble chip 透传（MS3 活数据链路）', () => {
  test('message 带 toolCalls 时渲染工具调用 chip 且可展开', () => {
    renderBubble({
      id: 'm1',
      role: 'assistant',
      text: '已为你查询。',
      toolCalls: [
        { name: 'estimate_history', source: 'list_tools' },
        { name: 'project_list', source: 'list_tools' },
      ],
    })

    const chip = screen.getByLabelText('工具调用')
    expect(chip).toBeInTheDocument()
    expect(screen.queryByText('estimate_history')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /工具调用/ }))
    expect(screen.getByText('estimate_history')).toBeInTheDocument()
    expect(screen.getByText('project_list')).toBeInTheDocument()
  })

  test('message 带 memoryRef 时渲染引用记忆标记', () => {
    renderBubble({
      id: 'm2',
      role: 'assistant',
      text: '基于已知事实继续。',
      memoryRef: { scenesCount: 2, atomsCount: 3 },
    })

    const marker = screen.getByLabelText('引用记忆')
    expect(marker).toBeInTheDocument()
    expect(marker).toHaveTextContent('2 场景')
    expect(marker).toHaveTextContent('3 事实')
  })

  test('message 无任何 trace 数据时不渲染 chip（静默降级）', () => {
    renderBubble({ id: 'm3', role: 'assistant', text: '普通回复。' })

    expect(screen.queryByLabelText('工具调用')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('引用记忆')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('知识库参考')).not.toBeInTheDocument()
  })
})

describe('mapSessionMessages chip metadata 归一', () => {
  test('assistant metadata.toolCalls / metadata.memoryRef 映射到消息字段', () => {
    const session = {
      sessionId: 's-1',
      messages: [
        { messageId: 'u1', role: 'user', content: '继续推进' },
        {
          messageId: 'a1',
          role: 'assistant',
          content: '好的。',
          metadata: {
            toolCalls: [{ name: 'estimate_history', source: 'list_tools' }],
            memoryRef: { scenesCount: 1, atomsCount: 2 },
          },
        },
      ],
    }

    const messages = mapSessionMessages(session)
    const assistant = messages.find((m) => m.role === 'assistant')

    expect(assistant?.toolCalls).toEqual([{ name: 'estimate_history', source: 'list_tools' }])
    expect(assistant?.memoryRef).toEqual({ scenesCount: 1, atomsCount: 2 })
  })

  test('metadata 无 chip 字段时消息字段为 undefined（不影响既有渲染）', () => {
    const session = {
      sessionId: 's-2',
      messages: [{ messageId: 'a2', role: 'assistant', content: '好的。', metadata: {} }],
    }

    const messages = mapSessionMessages(session)
    expect(messages[0]?.toolCalls).toBeUndefined()
    expect(messages[0]?.memoryRef).toBeUndefined()
  })
})
