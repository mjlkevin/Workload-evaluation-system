import { useState } from 'react'
import useWorkflowRelease from '../../hooks/useWorkflowRelease.js'
import SystemObjectDialog from '../../components/system/SystemObjectDialog.jsx'
import { systemButton, systemPrimaryButton, systemInput } from '../../components/system/SystemObjectList.jsx'
import { WorkflowField } from './WorkflowDefinitionEditor.jsx'
const blockers = { WORKFLOW_STATIC_VALIDATION_REQUIRED: '需要当前定义及依赖的配置校验', WORKFLOW_REVIEW_REQUIRED: '需要复核通过', WORKFLOW_ALREADY_PUBLISHED: '当前版本已发布', WORKFLOW_CHECKIN_REQUIRED: '请先检入', WORKFLOW_DISABLED: '工作流已停用或归档', WORKFLOW_DEPENDENCY_UNAVAILABLE: '固定依赖不可用或映射未通过校验' }
export default function WorkflowReleasePanel({ record, version, dirty, busy, setBusy, onRecord }) {
  const release = useWorkflowRelease({ record, version, dirty, setBusy, onRecord })
  const [reason, setReason] = useState('')
  const [rollbackId, setRollbackId] = useState('')
  const [rollbackReason, setRollbackReason] = useState('')
  const [confirm, setConfirm] = useState(null)
  const historical = version.workflowVersionId !== record.currentVersionId
  const blocked = busy || dirty || historical || record.archived || !record.enabled || version.checkoutStatus !== 'checked_in'
  const published = version.status === 'published'
  const publishAvailable = !blocked && !published && release.fresh && release.reviewed && release.readiness.publishAvailable
  const remainingBlockers = (release.readiness?.blockers || []).filter(code => !published || code !== 'WORKFLOW_ALREADY_PUBLISHED')
  const targets = release.readiness?.revision === record.revision ? release.readiness.rollbackVersions || [] : []
  const rollbackTarget = targets.find(t => t.versionId === rollbackId)
  const active = record.versions.find(v => v.workflowVersionId === record.activeVersionId)
  const proofLabel = current => busy || release.loading ? '正在核对' : !current ? '已失效，请重新配置校验与复核' : release.fresh ? '当前有效' : '待重新核对'
  const mutate = async (action, input) => { if (await release.mutate(action, input)) { setConfirm(null); if (action === 'review') setReason(''); if (action === 'rollback') { setRollbackId(''); setRollbackReason('') } } }
  return <section aria-label="Workflow 配置校验与发布" className="min-w-0 space-y-3 rounded-md border border-solid border-line p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="m-0 text-base font-semibold text-ink">配置校验与发布</h3><button className={systemButton} disabled={busy || dirty || release.loading} onClick={release.reload}>刷新发布状态</button></div>
    <p className="m-0 text-sm text-ink-2 wrap-anywhere">当前工作版本：{record.versions.find(v => v.workflowVersionId === record.currentVersionId)?.versionCode} · 当前生效版本：{active?.versionCode || '无'}</p>
    <p className="m-0 text-xs text-ink-2">仅静态检查配置、映射、固定依赖和有限控制结构；未执行模型、工具或工作流。</p>
    {release.loading && <p role="status" className="text-sm text-ink-2">正在核对发布状态…</p>}
    {(release.readiness?.validation || release.readiness?.review) && <p className="text-xs text-ink-2 wrap-anywhere">{release.readiness.validation && <>配置校验证明：{release.readiness.validation.id} · {proofLabel(release.savedValidationCurrent)}</>}{release.readiness.review && <>；复核证明：{release.readiness.review.id} · {proofLabel(release.savedReviewCurrent)}</>}</p>}
    {release.validated && <p className="text-sm text-ok-ink">已校验（未执行）</p>}
    {published && <p className="text-sm text-ink-2">当前版本已发布，维护请升版。</p>}
    {remainingBlockers.length > 0 && <details className="text-sm text-warn-ink"><summary>{published ? '当前状态限制' : '发布门禁尚未完成'}</summary><ul>{remainingBlockers.map(b => <li key={b}>{blockers[b] || b}</li>)}</ul></details>}
    <div className="flex flex-wrap gap-2"><button className={systemButton} disabled={blocked || published} onClick={() => mutate('validate')}>配置校验</button><button className={systemPrimaryButton} disabled={!publishAvailable} onClick={() => setConfirm('publish')}>发布</button></div>
    <WorkflowField label="复核理由" value={reason} onChange={setReason} multiline maxLength={2000} disabled={blocked || published} />
    <button className={systemButton} disabled={blocked || published || !release.validated || !reason.trim()} onClick={() => mutate('review', { reason: reason.trim() })}>复核通过</button>
    {release.readiness?.review && <p className="text-xs text-ink-2 wrap-anywhere">复核：{release.readiness.review.reason || release.readiness.review.id}</p>}
    {(release.readiness?.validation || release.readiness?.review) && <details className="min-w-0 text-sm text-ink-2"><summary className="cursor-pointer">证明版本、内容与依赖指纹</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap wrap-anywhere">{JSON.stringify({ validation: release.readiness.validation, review: release.readiness.review }, null, 2)}</pre></details>}
    {targets.length > 0 && <div className="space-y-3 border-0 border-t border-solid border-line pt-3"><WorkflowField label="回滚目标"><select className={systemInput} value={rollbackId} disabled={blocked} onChange={e => setRollbackId(e.target.value)}><option value="">选择曾发布版本</option>{targets.map(t => <option key={t.versionId} value={t.versionId}>{t.versionCode}</option>)}</select></WorkflowField><WorkflowField label="回滚理由" value={rollbackReason} onChange={setRollbackReason} multiline maxLength={2000} disabled={blocked} /><button className={systemButton} disabled={blocked || !release.fresh || !rollbackTarget || !rollbackReason.trim()} onClick={() => setConfirm('rollback')}>回滚生效版本</button></div>}
    {release.error && !confirm && <p role="alert" className="text-sm text-err-ink wrap-anywhere">{release.error}</p>}
    <details className="min-w-0 text-sm text-ink-2"><summary className="cursor-pointer">{release.dependencies?.frozen ? '已发布固定依赖快照' : '当前依赖与配置问题'}</summary>{release.dependencyError && <p role="alert">{release.dependencyError}</p>}{release.dependencies ? <><p>所选版本：{release.dependencies.versionId} · {release.dependencies.frozen ? '发布时冻结' : '草稿实时检查'}</p>{release.dependencies.issues.map((issue, i) => <p key={i} className="text-warn-ink">{issue.code}：{issue.message}</p>)}<pre className="max-h-64 overflow-auto whitespace-pre-wrap wrap-anywhere">{JSON.stringify(release.dependencies.snapshot, null, 2)}</pre></> : <p>依赖快照尚未加载，可刷新重试。</p>}</details>
    <div onKeyDown={e => { if (e.key === 'Escape' || e.key === 'Tab') e.stopPropagation() }} onCancel={e => e.stopPropagation()}><SystemObjectDialog open={Boolean(confirm)} title={confirm === 'publish' ? '发布 Workflow' : '回滚 Workflow'} onClose={() => setConfirm(null)} busy={busy} footer={close => <><button className={systemButton} disabled={busy} onClick={close}>取消</button><button className={systemPrimaryButton} disabled={busy || (confirm === 'publish' ? !publishAvailable : blocked || !release.fresh || !rollbackTarget || !rollbackReason.trim())} onClick={() => mutate(confirm, confirm === 'rollback' ? { targetVersionId: rollbackId, reason: rollbackReason.trim() } : {})}>确认{confirm === 'publish' ? '发布' : '回滚'}</button></>}><div className="space-y-3 text-sm text-ink-2"><p>候选版本：{confirm === 'publish' ? version.versionCode : rollbackTarget?.versionCode || rollbackId}</p><p>当前生效版本：{active?.versionCode || '无'}</p><p>操作更新生效版本指针，保留固定 Skill 依赖；配置校验不代表已执行工作流。</p>{release.error && <p role="alert" className="text-err-ink">{release.error}</p>}</div></SystemObjectDialog></div>
  </section>
}
