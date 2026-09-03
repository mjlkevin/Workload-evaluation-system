import { useState } from 'react'
import { TOOL_CALL_STATUS } from '../../utils/messageFormatter.js'

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
  // null = 用户未显式操作过：此时由「流式期间是否有运行中项」自动决定展开，
  // 保证 started→running 阶段免点击即可见（批次 0.5 ③）。用户一旦点过开关，
  // 其选择优先于自动展开。
  const [toolsExpanded, setToolsExpanded] = useState(null)

  const thoughtList = Array.isArray(thoughts) ? thoughts : []
  const hasThoughts = thoughtList.length > 0
  const hasKnowledge = Boolean(knowledgeTool)
  const toolCallList = Array.isArray(toolCalls) ? toolCalls.filter((t) => t && t.name) : []
  const hasToolCalls = toolCallList.length > 0
  const hasLiveRunning = streaming && toolCallList.some((call) => call.status === TOOL_CALL_STATUS.RUNNING)
  const showToolList = toolsExpanded ?? hasLiveRunning
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
            onClick={() => setToolsExpanded(!showToolList)}
            aria-expanded={showToolList}
            className="inline-flex min-h-[22px] cursor-pointer items-center gap-1 rounded-md border border-brand/30 bg-brand-soft px-1.5 py-0.5 text-[11px] font-bold text-brand"
          >
            <span aria-hidden="true">{showToolList ? '▾' : '▸'}</span>
            工具调用 {toolCallList.length} 项
          </button>
          {showToolList && toolCallList.map((call, idx) => (
            <span key={`${call.name}-${idx}`} className="inline-flex items-center gap-1">
              <code className="border-0 bg-transparent p-0">{call.name}</code>
              {call.source === 'list_tools' && <em className="not-italic text-ink-3">· 经发现</em>}
              <ToolCallStatusTag call={call} streaming={streaming} />
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

/**
 * 工具调用状态标签（批次 0.5 ③）：started→运行中、completed→已完成、failed→失败
 * 三态各自可见。存量数据无 status 时不渲染任何标签，保持既有行为。
 */
function ToolCallStatusTag({ call, streaming }) {
  const elapsed = formatToolCallElapsed(call.elapsedMs)
  if (call.status === TOOL_CALL_STATUS.RUNNING) {
    // 流已结束却仍残留 running，只说明本轮未收到终态帧，不臆造「运行中」。
    if (!streaming) return null
    return <em className="not-italic text-brand">· 运行中{elapsed ? ` ${elapsed}` : ''}</em>
  }
  if (call.status === TOOL_CALL_STATUS.COMPLETED) {
    return <em className="not-italic text-ink-3">· 已完成{elapsed ? ` ${elapsed}` : ''}</em>
  }
  if (call.status === TOOL_CALL_STATUS.FAILED) {
    return (
      <em className="not-italic text-warn">
        · 失败{elapsed ? ` ${elapsed}` : ''}{call.errorPreview ? ` · ${call.errorPreview}` : ''}
      </em>
    )
  }
  return null
}

/** 耗时可读化：< 1s 用毫秒，其余保留一位小数秒 */
function formatToolCallElapsed(value) {
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms <= 0) return ''
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}
