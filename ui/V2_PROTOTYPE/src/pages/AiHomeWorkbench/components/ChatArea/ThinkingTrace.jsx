import { useState } from 'react'

/**
 * 统一的模型「思考轨迹」披露区：合并推理文本、工具调用、知识检索、
 * 记忆引用四类数据到一次渲染，取代原来分散在气泡内两个位置的
 * thoughts 内联块 + <ModelRunTrace>。四类数据独立存在与否互不影响，
 * 只渲染实际有数据的分类，固定顺序：推理 → 知识检索 → 工具调用 → 记忆引用。
 * 各分类的展开/折叠行为保持互相独立，不套一个包裹全部的外层开关。
 */
export default function ThinkingTrace({
  messageId,
  thoughts,
  streaming,
  onToggleThought,
  knowledgeTool,
  toolCalls,
  memoryRef,
}) {
  const [toolsExpanded, setToolsExpanded] = useState(false)

  const thoughtList = Array.isArray(thoughts) ? thoughts : []
  const hasThoughts = thoughtList.length > 0
  const hasKnowledge = Boolean(knowledgeTool)
  const toolCallList = Array.isArray(toolCalls) ? toolCalls.filter((t) => t && t.name) : []
  const hasToolCalls = toolCallList.length > 0
  const scenesCount = Number(memoryRef?.scenesCount) || 0
  const atomsCount = Number(memoryRef?.atomsCount) || 0
  const hasMemoryRef = scenesCount > 0 || atomsCount > 0

  if (!hasThoughts && !hasKnowledge && !hasToolCalls && !hasMemoryRef) return null

  return (
    <div className="mb-2.5 flex flex-col gap-1.5">
      {hasThoughts && thoughtList.map((thought, idx) => (
        <div key={`thought-${idx}`}>
          <button
            type="button"
            onClick={() => onToggleThought?.(messageId, idx)}
            className="flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-xs text-ink-3"
          >
            <span>{thought.collapsed ? '▶' : '▼'}</span>
            <span>{thought.collapsed ? '已思考' : (streaming ? '思考中…' : '思考过程')}</span>
          </button>
          {!thought.collapsed && (
            <div className="mt-1 whitespace-pre-wrap rounded-md bg-accent-soft px-2.5 py-2 text-xs leading-relaxed text-ink-2">
              {thought.text}
            </div>
          )}
        </div>
      ))}
      {hasKnowledge && <KnowledgeTraceChip knowledgeTool={knowledgeTool} />}
      {hasToolCalls && (
        <div aria-label="工具调用" className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
          <button
            type="button"
            onClick={() => setToolsExpanded((v) => !v)}
            aria-expanded={toolsExpanded}
            className="inline-flex min-h-[22px] cursor-pointer items-center gap-1 rounded-md border border-brand/30 bg-brand-soft px-1.5 py-0.5 text-[11px] font-bold text-brand"
          >
            <span aria-hidden="true">{toolsExpanded ? '▾' : '▸'}</span>
            工具调用 {toolCallList.length} 项
          </button>
          {toolsExpanded && toolCallList.map((call, idx) => (
            <span key={`${call.name}-${idx}`}>
              <code className="border-0 bg-transparent p-0">{call.name}</code>
              {call.source === 'list_tools' && <em className="not-italic text-ink-3">· 经发现</em>}
            </span>
          ))}
        </div>
      )}
      {hasMemoryRef && (
        <div aria-label="引用记忆" className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
          <span>引用记忆</span>
          {scenesCount > 0 && <span>{scenesCount} 场景</span>}
          {atomsCount > 0 && <span>{atomsCount} 事实</span>}
        </div>
      )}
    </div>
  )
}

/** 既有知识库检索 chip（渲染逻辑与既有 ModelRunTrace 保持一致） */
function KnowledgeTraceChip({ knowledgeTool }) {
  const confidenceLabel = knowledgeTool.confidence === 'high' ? '高置信' : '低置信'
  const retrievalLabel = `retrievalTriggered=${knowledgeTool.retrievalTriggered ? 'true' : 'false'}`
  const isRealRetrieval = knowledgeTool.available && knowledgeTool.retrievalTriggered && knowledgeTool.confidence === 'high'
  const isUnavailable = !knowledgeTool.available
  const hasFallback = Boolean(knowledgeTool.fallbackReason)
  return (
    <div aria-label="知识库参考" className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
      <span>{isRealRetrieval ? '知识库参考' : '模型通用知识'}</span>
      {knowledgeTool.model && <code className="border-0 bg-transparent p-0">{knowledgeTool.model}</code>}
      <span>{retrievalLabel}</span>
      <span>{confidenceLabel}</span>
      {knowledgeTool.fallbackReason && <span>{knowledgeTool.fallbackReason}</span>}
      {isUnavailable && <span className="text-warn">知识库未配置</span>}
      {hasFallback && !isUnavailable && <span className="text-warn">检索未命中</span>}
    </div>
  )
}
