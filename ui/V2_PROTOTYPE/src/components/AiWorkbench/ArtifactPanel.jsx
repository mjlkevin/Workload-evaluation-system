import PendingActionCard from './PendingActionCard.jsx'

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
    project ? `项目：${project}` : '',
    assessment ? `评估：${assessment}` : '',
    requirement ? `需求：${requirement}` : '',
  ].filter(Boolean)
}

const timelineItemStyle = {
  display: 'grid',
  gridTemplateColumns: '24px minmax(0,1fr)',
  gap: 10,
  alignItems: 'start',
}

const markerStyle = {
  width: 24,
  height: 24,
  borderRadius: 999,
  display: 'grid',
  placeItems: 'center',
  background: 'var(--brand-soft)',
  color: 'var(--brand)',
  fontSize: 11,
  fontWeight: 850,
}

function TimelineItem({ index, title, meta, children }) {
  return (
    <div role="listitem" style={timelineItemStyle}>
      <span style={markerStyle}>{index}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <b style={{ fontSize: 12.5 }}>{title}</b>
          {meta && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>{meta}</span>}
        </div>
        <div style={{ marginTop: 6, display: 'grid', gap: 8, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.6 }}>
          {children}
        </div>
      </div>
    </div>
  )
}

export default function ArtifactPanel({ session, onConfirmAction, confirmingActionId = '' }) {
  const artifacts = Array.isArray(session?.artifacts) ? session.artifacts : []
  const pendingActions = (Array.isArray(session?.pendingActions) ? session.pendingActions : []).filter((action) => action.status === 'pending')
  const linked = session?.linkedRecords || {}
  const messages = Array.isArray(session?.messages) ? session.messages : []
  const sourceName = firstAttachmentName(session)
  const linkedRows = linkedRecordText(linked)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <section style={{ border: '1px solid var(--line)', borderRadius: 8, background: '#fff', overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <b style={{ fontSize: 13 }}>产物工作区</b>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>
            {artifacts.length} 个产物 · {pendingActions.length} 个待确认
          </span>
        </div>
        <div role="list" aria-label="AI 运行时间线" style={{ padding: 12, display: 'grid', gap: 14 }}>
          <TimelineItem index="1" title="来源" meta={sourceName ? '已接收' : '待输入'}>
            {sourceName ? (
              <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{sourceName}</span>
            ) : (
              <span style={{ color: 'var(--ink-3)' }}>等待上传附件或输入业务问题。</span>
            )}
          </TimelineItem>

          <TimelineItem index="2" title="执行" meta={messages.length ? `${messages.length} 条消息` : '未开始'}>
            <span>{messages.length ? 'AI 已处理当前会话上下文，可继续追问或进入下游动作。' : '发送消息后会在此串联执行结果。'}</span>
          </TimelineItem>

          <TimelineItem index="3" title="产物" meta={artifacts.length ? `${artifacts.length} 个` : '暂无'}>
            {artifacts.length ? artifacts.map((artifact) => (
              <div key={artifact.artifactId || artifact.title} style={{ padding: 10, borderRadius: 8, background: 'var(--bg-soft)' }}>
                <b style={{ fontSize: 12 }}>{artifact.title || '未命名产物'}</b>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6 }}>{previewContent(artifact.content).slice(0, 96)}</p>
              </div>
            )) : <span style={{ color: 'var(--ink-3)' }}>暂无产物</span>}
          </TimelineItem>

          <TimelineItem index="4" title="交付" meta={linkedRows.length ? '已关联' : '待关联'}>
            {pendingActions.length ? pendingActions.map((action) => (
              <PendingActionCard key={action.actionId || action.title} action={action} onConfirm={onConfirmAction} confirming={confirmingActionId === (action.actionId || action.title)} />
            )) : <span style={{ color: 'var(--ink-3)' }}>暂无待确认动作</span>}
            {linkedRows.length ? linkedRows.map((row) => (
              <span key={row} style={{ fontWeight: 700, color: 'var(--ink)' }}>{row}</span>
            )) : <span style={{ color: 'var(--ink-3)' }}>关联记录：未关联</span>}
          </TimelineItem>
        </div>
      </section>
    </div>
  )
}
