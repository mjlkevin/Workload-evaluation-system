import PendingActionCard from '../../../../components/AiWorkbench/PendingActionCard.jsx'
import BusinessValue from '../BusinessResult.jsx'
import { pickArray } from '../../utils/harnessPayload.js'
import AttachmentCard from './AttachmentCard.jsx'
import ReportViewer from '../WorkspacePanel/ReportViewer.jsx'
import { extractReportCardData } from '../WorkspacePanel/reportData.js'

const artifactId = artifact => artifact.harnessArtifactId || artifact.artifactId
const reportIsVisible = artifact => {
  if (!artifact || typeof artifact !== 'object') return false
  const data = extractReportCardData(artifact)
  return data.isLegacyReport || data.isHarnessReport
}

/** Older sessions can contain results/actions without an associated chat message. */
export default function SessionBusinessRecords({ session, messages = [], onConfirmAction, confirmingActionId, bubbleProps = {} }) {
  const represented = new Set(messages.flatMap(message => pickArray(message.artifacts)
    .filter(reportIsVisible).map(artifactId).filter(Boolean)))
  const artifacts = pickArray(session?.artifacts).filter(artifact => artifact && typeof artifact === 'object').filter(artifact => !artifactId(artifact) || !represented.has(artifactId(artifact)))
  const visibleFiles = new Set(messages.map(message => message.file?.name).filter(Boolean))
  const attachments = pickArray(session?.attachments).filter(file => file.name && !visibleFiles.has(file.name))
  const pending = pickArray(session?.pendingActions).filter(action => action.status === 'pending')
  const linked = session?.linkedRecords || {}
  const associations = [
    ['项目', linked.projectName || linked.projectId],
    ['评估', linked.assessmentVersionCode || linked.assessmentVersionId],
    ['需求', linked.requirementVersionCode || linked.requirementVersionId],
  ].filter(([, value]) => value)
  if (!attachments.length && !artifacts.length && !pending.length && !associations.length) return null
  return <section aria-label="会话业务记录" className="grid min-w-0 gap-3">
    {attachments.map((file, index) => <AttachmentCard key={file.attachmentId || index} file={file} state="sent" compact />)}
    {artifacts.map((artifact, index) => reportIsVisible(artifact)
      ? <ReportViewer key={artifactId(artifact) || index} artifact={artifact} onAction={bubbleProps.onHarnessAction} onSubmitSupplement={bubbleProps.onStructuredSupplement} confirmingActionId={confirmingActionId} />
      : <article key={artifactId(artifact) || index} className="grid min-w-0 gap-2 rounded-md border border-line bg-surface p-4">
        <h3 className="m-0 break-words text-sm font-semibold">{artifact.title || '执行结果'}</h3>
        <BusinessValue value={artifact.content} />
      </article>)}
    {pending.map(action => <PendingActionCard key={action.actionId || action.title} action={action} onConfirm={onConfirmAction} confirming={confirmingActionId === (action.actionId || action.title)} />)}
    {!!associations.length && <article aria-label="关联结果" className="grid min-w-0 gap-2 rounded-md border border-line bg-surface p-4 text-sm">
      {associations.map(([label, value]) => <p key={label} className="m-0 break-words">{label}：{value}</p>)}
    </article>}
  </section>
}
