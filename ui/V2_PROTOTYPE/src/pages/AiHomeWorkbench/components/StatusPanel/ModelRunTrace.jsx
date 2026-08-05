/**
 * 模型运行痕迹：知识库检索置信度与回退说明。
 */
export default function ModelRunTrace({ knowledgeTool }) {
  if (!knowledgeTool) return null
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
