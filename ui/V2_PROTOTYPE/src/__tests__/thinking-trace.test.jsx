import { describe, expect, test, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ThinkingTrace from '../pages/AiHomeWorkbench/components/ChatArea/ThinkingTrace.jsx'

const knowledgeToolFixture = {
  toolId: 'knowledge_base.query_product_knowledge',
  available: true,
  retrievalTriggered: true,
  confidence: 'high',
  model: 'glm-4.6',
  fallbackReason: '',
  contextRef: 'ctx-1',
}

describe('ThinkingTrace', () => {
  test('四类数据都没有时不渲染任何内容', () => {
    const { container } = render(<ThinkingTrace messageId="m0" />)
    expect(container).toBeEmptyDOMElement()
  })

  test('只有 thoughts 时渲染折叠态摘要，点击展开显示推理文本', () => {
    const onToggleThought = vi.fn()
    render(
      <ThinkingTrace
        messageId="m1"
        thoughts={[{ text: '正在分析需求边界', collapsed: true }]}
        streaming={false}
        onToggleThought={onToggleThought}
      />,
    )
    expect(screen.getByText('已思考')).toBeInTheDocument()
    expect(screen.queryByText('正在分析需求边界')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('已思考'))
    expect(onToggleThought).toHaveBeenCalledWith('m1', 0)
  })

  test('streaming 为 true 且未折叠时显示"思考中…"', () => {
    render(
      <ThinkingTrace
        messageId="m2"
        thoughts={[{ text: '推理中的文本', collapsed: false }]}
        streaming={true}
      />,
    )
    expect(screen.getByText('思考中…')).toBeInTheDocument()
    expect(screen.getByText('推理中的文本')).toBeInTheDocument()
  })

  test('既有知识库 chip 行为保持不变', () => {
    render(<ThinkingTrace messageId="m3" knowledgeTool={knowledgeToolFixture} />)
    expect(screen.getByLabelText('知识库参考')).toBeInTheDocument()
    expect(screen.getByText('知识库参考')).toBeInTheDocument()
    expect(screen.queryByLabelText('工具调用')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('引用记忆')).not.toBeInTheDocument()
  })

  test('工具调用 chip：默认折叠，展开可见工具名', () => {
    render(
      <ThinkingTrace
        messageId="m4"
        knowledgeTool={knowledgeToolFixture}
        toolCalls={[
          { name: 'knowledge_query', source: 'list_tools' },
          { name: 'project_list', source: 'list_tools' },
        ]}
      />,
    )
    const chip = screen.getByLabelText('工具调用')
    expect(chip).toBeInTheDocument()
    expect(screen.queryByText('knowledge_query')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /工具调用/ }))
    expect(screen.getByText('knowledge_query')).toBeInTheDocument()
    expect(screen.getByText('project_list')).toBeInTheDocument()
  })

  test('仅有工具调用数据时也应渲染 chip', () => {
    render(<ThinkingTrace messageId="m5" toolCalls={[{ name: 'estimate_history', source: 'list_tools' }]} />)
    expect(screen.getByLabelText('工具调用')).toBeInTheDocument()
    expect(screen.queryByLabelText('知识库参考')).not.toBeInTheDocument()
  })

  test('引用记忆标记：数量大于 0 才渲染', () => {
    const { rerender } = render(
      <ThinkingTrace messageId="m6" memoryRef={{ scenesCount: 2, atomsCount: 3 }} />,
    )
    const marker = screen.getByLabelText('引用记忆')
    expect(marker).toHaveTextContent('2 场景')
    expect(marker).toHaveTextContent('3 事实')

    rerender(<ThinkingTrace messageId="m7" memoryRef={{ scenesCount: 0, atomsCount: 0 }} />)
    expect(screen.queryByLabelText('引用记忆')).not.toBeInTheDocument()
  })

  test('四类数据同时存在时按 推理→工具调用→知识检索→记忆引用 顺序渲染', () => {
    const { container } = render(
      <ThinkingTrace
        messageId="m8"
        thoughts={[{ text: '推理文本', collapsed: true }]}
        toolCalls={[{ name: 'estimate_history', source: 'list_tools' }]}
        knowledgeTool={knowledgeToolFixture}
        memoryRef={{ scenesCount: 1, atomsCount: 1 }}
      />,
    )
    const labels = Array.from(container.querySelectorAll('[aria-label]')).map((el) => el.getAttribute('aria-label'))
    expect(labels).toEqual(['知识库参考', '工具调用', '引用记忆'])
  })
})
