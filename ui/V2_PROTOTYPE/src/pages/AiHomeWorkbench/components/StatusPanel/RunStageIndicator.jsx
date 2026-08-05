import ActionConfirmer from './ActionConfirmer.jsx'

function previewContent(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function firstAttachmentName(session) {
  const attachments = Array.isArray(session?.attachments) ? session.attachments : []
  const attachment = attachments.find((item) => item?.name || item?.fileName)
  if (attachment) return attachment.name || attachment.fileName

  const messages = Array.isArray(session?.messages) ? session.messages : []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.file?.name) return message.file.name
    if (message?.attachment?.name) return message.attachment.name
  }
  return ''
}

function linkedRecordText(linked = {}) {
  const project = linked.projectName || linked.projectId
  const assessment = linked.assessmentVersionCode || linked.assessmentVersionId
  const requirement = linked.requirementVersionCode || linked.requirementVersionId
  return [
    project ? { icon: '📁', label: `项目：${project}` } : null,
    assessment ? { icon: '📊', label: `评估：${assessment}` } : null,
    requirement ? { icon: '📋', label: `需求：${requirement}` } : null,
  ].filter(Boolean)
}

function artifactTypeLabel(artifact) {
  const type = artifact?.artifactType || artifact?.type || ''
  if (type.includes('report_v2')) return '报告 v2'
  if (type.includes('report_v1')) return '报告 v1'
  if (type.includes('understanding')) return '文件理解'
  if (type.includes('file')) return '文件摘要'
  return '产物'
}

const timelineItemStyle = {
  display: 'grid',
  gridTemplateColumns: '28px minmax(0,1fr)',
  gap: 10,
  alignItems: 'start',
}

const markerBase = {
  width: 28,
  height: 28,
  borderRadius: 999,
  display: 'grid',
  placeItems: 'center',
  fontSize: 11,
  fontWeight: 850,
  transition: 'background 0.2s ease-out, color 0.2s ease-out, box-shadow 0.2s ease-out',
}

function markerStyleFor(state) {
  if (state === 'active') {
    return { ...markerBase, background: 'var(--brand)', color: '#fff', boxShadow: '0 0 0 3px var(--brand-soft)' }
  }
  if (state === 'done') {
    return { ...markerBase, background: 'var(--brand-soft)', color: 'var(--brand)' }
  }
  return { ...markerBase, background: 'var(--bg-soft, #f3f4f6)', color: 'var(--ink-3)' }
}

function TimelineItem({ index, title, meta, state = 'idle', children }) {
  return (
    <div role="listitem" style={timelineItemStyle}>
      <span style={markerStyleFor(state)} aria-hidden>{index}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <b style={{ fontSize: 12.5 }}>{title}</b>
          {state === 'active' && <span className="wes-timeline-pulse" aria-label="处理中" />}
          {meta && <span style={{ marginLeft: 'auto', fontSize: 11, color: state === 'active' ? 'var(--brand)' : 'var(--ink-3)', fontWeight: state === 'active' ? 700 : 400 }}>{meta}</span>}
        </div>
        <div style={{ marginTop: 6, display: 'grid', gap: 8, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.6 }}>
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * 会话进度时间线（改造自 components/AiWorkbench/ArtifactPanel）：
 * 输入来源 → AI 执行 → 结构化产物 → 交付与关联。
 */
export default function RunStageIndicator({ session, sending = false, onConfirmAction, confirmingActionId = '' }) {
  const artifacts = Array.isArray(session?.artifacts) ? session.artifacts : []
  const pendingActions = (Array.isArray(session?.pendingActions) ? session.pendingActions : []).filter((action) => action.status === 'pending')
  const linked = session?.linkedRecords || {}
  const messages = Array.isArray(session?.messages) ? session.messages : []
  const sourceName = firstAttachmentName(session)
  const linkedRows = linkedRecordText(linked)

  const sourceState = sourceName ? 'done' : 'idle'
  const execState = sending ? 'active' : messages.length ? 'done' : 'idle'
  const artifactState = artifacts.length ? 'done' : sending ? 'active' : 'idle'
  const deliveryState = linkedRows.length ? 'done' : pendingActions.length ? 'active' : 'idle'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <section style={{ border: '1px solid var(--line)', borderRadius: 10, background: '#fff', overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <b style={{ fontSize: 13 }}>会话进度</b>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>
            {artifacts.length} 个产物{pendingActions.length ? ` · ${pendingActions.length} 待确认` : ''}
          </span>
        </div>
        <div role="list" aria-label="AI 会话执行链路" style={{ padding: 14, display: 'grid', gap: 18 }}>
          <TimelineItem index="1" title="输入来源" meta={sourceName ? '已接收' : '待输入'} state={sourceState}>
            {sourceName ? (
              <span style={{ fontWeight: 700, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                {sourceName}
              </span>
            ) : (
              <span style={{ color: 'var(--ink-3)' }}>上传文件或输入业务问题，AI 将以此为分析起点。</span>
            )}
          </TimelineItem>

          <TimelineItem index="2" title="AI 执行" meta={sending ? '处理中…' : messages.length ? `${messages.length} 轮对话` : '未开始'} state={execState}>
            {sending ? (
              <span style={{ color: 'var(--brand)', fontWeight: 600 }}>AI 正在分析上下文并组织回复，请稍候…</span>
            ) : messages.length ? (
              <span>AI 已完成 {messages.length} 轮对话处理，可继续追问或触发下游动作。</span>
            ) : (
              <span style={{ color: 'var(--ink-3)' }}>发送第一条消息后，AI 的处理过程将在此实时展示。</span>
            )}
          </TimelineItem>

          <TimelineItem index="3" title="结构化产物" meta={artifacts.length ? `${artifacts.length} 个` : sending ? '生成中' : '暂无'} state={artifactState}>
            {artifacts.length ? artifacts.map((artifact) => (
              <div key={artifact.artifactId || artifact.title} className="wes-artifact-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="wes-artifact-type">{artifactTypeLabel(artifact)}</span>
                  <b style={{ fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{artifact.title || '未命名产物'}</b>
                </div>
                <p style={{ margin: '5px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{previewContent(artifact.content).slice(0, 120)}</p>
              </div>
            )) : (
              <span style={{ color: 'var(--ink-3)' }}>{sending ? 'AI 正在生成结构化产物…' : 'AI 尚未生成产物，继续对话或选择工作流模板可触发产出。'}</span>
            )}
          </TimelineItem>

          <TimelineItem index="4" title="交付与关联" meta={linkedRows.length ? '已关联' : pendingActions.length ? '待确认' : '待关联'} state={deliveryState}>
            <ActionConfirmer pendingActions={pendingActions} onConfirmAction={onConfirmAction} confirmingActionId={confirmingActionId} />
            {linkedRows.length ? (
              <div style={{ display: 'grid', gap: 6 }}>
                {linkedRows.map((row) => (
                  <span key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: 'var(--ink)', fontSize: 12 }}>
                    <span aria-hidden style={{ fontSize: 13 }}>{row.icon}</span>
                    {row.label}
                  </span>
                ))}
              </div>
            ) : !pendingActions.length ? (
              <span style={{ color: 'var(--ink-3)' }}>当 AI 建议创建项目或推送评估时，将在此等待你确认后写入业务系统。</span>
            ) : null}
          </TimelineItem>
        </div>
      </section>
    </div>
  )
}
