import { useState } from 'react'

/**
 * 模型运行痕迹：知识库检索置信度与回退说明（既有 chip）；
 * SP-2026-007 扩展为通用 trace 区——
 * ① MS3 工具发现：Agent 经 list_tools 选中工具执行后展示可折叠「工具调用」chip；
 * ② MS2-PATCH：AI 回复引用 active 记忆时展示「引用记忆」标记；
 * 三个 chip 复用同一 .ai-message-trace 设计语言。
 */
export default function ModelRunTrace({ knowledgeTool, toolCalls, memoryRef }) {
  const [toolsExpanded, setToolsExpanded] = useState(false)

  const hasKnowledge = Boolean(knowledgeTool)
  const toolCallList = Array.isArray(toolCalls) ? toolCalls.filter((t) => t && t.name) : []
  const hasToolCalls = toolCallList.length > 0
  const scenesCount = Number(memoryRef?.scenesCount) || 0
  const atomsCount = Number(memoryRef?.atomsCount) || 0
  const hasMemoryRef = scenesCount > 0 || atomsCount > 0

  if (!hasKnowledge && !hasToolCalls && !hasMemoryRef) return null

  return (
    <>
      {hasKnowledge && <KnowledgeTraceChip knowledgeTool={knowledgeTool} />}
      {hasToolCalls && (
        <div className="ai-message-trace" aria-label="工具调用">
          <button
            type="button"
            onClick={() => setToolsExpanded((v) => !v)}
            aria-expanded={toolsExpanded}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              minHeight: 22,
              padding: '2px 7px',
              border: '1px solid color-mix(in oklab, var(--brand) 30%, var(--line))',
              borderRadius: 6,
              background: 'var(--brand-soft)',
              color: 'var(--brand)',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <span aria-hidden="true">{toolsExpanded ? '▾' : '▸'}</span>
            工具调用 {toolCallList.length} 项
          </button>
          {toolsExpanded &&
            toolCallList.map((call, idx) => (
              <span key={`${call.name}-${idx}`}>
                <code style={{ border: 'none', background: 'none', padding: 0, minHeight: 0 }}>{call.name}</code>
                {call.source === 'list_tools' && <em style={{ fontStyle: 'normal', color: 'var(--ink-3)' }}>· 经发现</em>}
              </span>
            ))}
        </div>
      )}
      {hasMemoryRef && (
        <div className="ai-message-trace" aria-label="引用记忆">
          <span>引用记忆</span>
          {scenesCount > 0 && <span>{scenesCount} 场景</span>}
          {atomsCount > 0 && <span>{atomsCount} 事实</span>}
        </div>
      )}
    </>
  )
}

/** 既有知识库检索 chip（行为与样式保持原样） */
function KnowledgeTraceChip({ knowledgeTool }) {
  const confidenceLabel = knowledgeTool.confidence === 'high' ? '高置信' : '低置信'
  const retrievalLabel = `retrievalTriggered=${knowledgeTool.retrievalTriggered ? 'true' : 'false'}`
  // 判断是否为真实知识库检索结果
  const isRealRetrieval = knowledgeTool.available && knowledgeTool.retrievalTriggered && knowledgeTool.confidence === 'high'
  const isUnavailable = !knowledgeTool.available
  const hasFallback = Boolean(knowledgeTool.fallbackReason)
  return (
    <div className="ai-message-trace" aria-label="知识库参考">
      <span>{isRealRetrieval ? '知识库参考' : '模型通用知识'}</span>
      {knowledgeTool.model && <code>{knowledgeTool.model}</code>}
      <span>{retrievalLabel}</span>
      <span>{confidenceLabel}</span>
      {knowledgeTool.fallbackReason && <span>{knowledgeTool.fallbackReason}</span>}
      {isUnavailable && <span style={{ color: 'var(--warn, #f59e0b)' }}>知识库未配置</span>}
      {hasFallback && !isUnavailable && <span style={{ color: 'var(--warn, #f59e0b)' }}>检索未命中</span>}
    </div>
  )
}
