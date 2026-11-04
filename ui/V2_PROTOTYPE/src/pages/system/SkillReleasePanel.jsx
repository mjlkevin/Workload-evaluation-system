import { useEffect, useRef, useState } from 'react'
import useSkillRelease from '../../hooks/useSkillRelease.js'
import SystemObjectDialog from '../../components/system/SystemObjectDialog.jsx'
import { systemButton, systemInput, systemPrimaryButton } from '../../components/system/SystemObjectList.jsx'
import SkillTrialEvidence, { SkillSimulatedSteps } from './SkillTrialEvidence.jsx'
import SkillInfluences from './SkillInfluences.jsx'

const blockerLabels = {
  SKILL_MODEL_TRIAL_REQUIRED: '需要当前定义与依赖下通过的真实模型试运行',
  SKILL_REVIEW_REQUIRED: '需要复核通过',
  SKILL_CHECKIN_REQUIRED: '请先检入当前版本', SKILL_DISABLED: 'Skill 已停用', SKILL_ARCHIVED: 'Skill 已归档',
}
export default function SkillReleasePanel({ record, version, dirty, busy, setBusy, onRecord, viewerId, onDirtyChange }) {
  const release = useSkillRelease({ record, version, dirty, setBusy, onRecord })
  const [evaluationId, setEvaluationId] = useState('')
  const [reason, setReason] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [rollbackId, setRollbackId] = useState('')
  const [rollbackReason, setRollbackReason] = useState('')
  const [confirm, setConfirm] = useState(null)
  useEffect(() => { onDirtyChange?.(Boolean(reason || rollbackReason)) }, [reason, rollbackReason, onDirtyChange])
  const historical = version.skillVersionId !== record.currentVersionId
  const locked = version.checkoutStatus === 'checked_out' && version.checkedOutBy !== viewerId
  const blocked = busy || dirty || historical || locked || record.archived || !record.enabled
  const { readiness } = release
  const published = version.status === 'published'
  const blockers = (readiness?.blockers || []).filter(code => code !== 'SKILL_ALREADY_PUBLISHED')
  const chosen = release.candidates.find(item => item.id === evaluationId) || release.candidates[0]
  const proofKey = chosen ? `${chosen.id}:${chosen.hash}:${chosen.contextHash}` : ''
  const previousProof = useRef('')
  useEffect(() => { if (proofKey && previousProof.current !== proofKey) { setAcknowledged(false); previousProof.current = proofKey } }, [proofKey])
  const simulated = chosen?.result.simulatedSteps || []
  const reviewAvailable = !blocked && release.fresh && readiness?.reviewAvailable && chosen && reason.trim() && (!simulated.length || acknowledged)
  const publishAvailable = !published && !blocked && release.fresh && readiness?.publishAvailable && release.reviewed && version.checkoutStatus === 'checked_in'
  const targets = readiness?.revision === record.revision ? readiness.rollbackVersions || [] : []
  const rollbackTarget = targets.find(item => item.versionId === rollbackId)
  const activeVersion = record.versions.find(item => item.skillVersionId === record.activeVersionId)
  const displayedTrials = release.lastTrial && !release.trials.some(item => item.id === release.lastTrial.id) ? [release.lastTrial, ...release.trials] : release.trials
  const mutate = async (action, input) => {
    const success = await release.mutate(action, input)
    if (success) {
      setConfirm(null)
      if (action === 'review') { setReason(''); setAcknowledged(false) }
      if (action === 'rollback') { setRollbackId(''); setRollbackReason('') }
    }
  }
  return <section aria-label="Skill 试运行与发布" className="min-w-0 space-y-4 rounded-md border border-solid border-line p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="m-0 text-base font-semibold text-ink">试运行与发布</h3><button type="button" className={systemButton} onClick={release.reload} disabled={busy || dirty || release.loading}>刷新发布状态</button></div>
    <p className="m-0 text-sm text-ink-2 wrap-anywhere">当前工作版本：{record.versions.find(item => item.skillVersionId === record.currentVersionId)?.versionCode} · 当前生效版本：{activeVersion?.versionCode || '无'}</p>
    {historical ? <p className="m-0 text-sm text-ink-2">历史版本只读。试运行接口仅提供当前版本记录，历史证据暂不可在此读取。</p> : <>
      {busy && <p role="status" className="m-0 text-sm text-ink-2">正在处理，请稍候…</p>}
      {!busy && release.loading && <p role="status" className="m-0 text-sm text-ink-2">正在核对发布状态…</p>}
      {!busy && !release.loading && readiness && !release.exact && <p className="m-0 text-sm text-warn-ink">发布状态与当前记录不一致，请刷新发布状态；若仍有冲突，请关闭后重新读取 Skill。</p>}
      {dirty && <p className="m-0 text-sm text-warn-ink">请先保存草稿，再试运行、复核或发布。</p>}
      <div className="flex flex-wrap gap-2"><button type="button" className={systemPrimaryButton} onClick={() => mutate('trial', { mode: 'model' })} disabled={blocked || release.loading}>模型试运行</button><button type="button" className={systemButton} onClick={() => mutate('trial', { mode: 'simulation' })} disabled={blocked || release.loading}>样例模拟</button></div>
      <p className="m-0 text-xs text-ink-2">模拟使用样例期望值，不能作为发布证明；模型试运行中的写入、外发工具仅模拟执行。</p>
      {published && <p className="m-0 text-sm text-ink-2">当前版本已发布，维护请升版。</p>}
      {blockers.length > 0 && <details className={published ? "text-sm text-ink-2" : "text-sm text-warn-ink"} open><summary className="cursor-pointer">{published ? '当前状态限制' : '样例测试与审核门禁尚未完成，暂不可发布。'}</summary><ul className="my-2 pl-5">{blockers.map(code => <li key={code} className="wrap-anywhere">{blockerLabels[code] || code}</li>)}</ul></details>}
      <div className="space-y-3">{displayedTrials.map(item => <SkillTrialEvidence key={item.id} trial={item} examples={item.hash === version.hash ? version.definition.examples : []} />)}</div>
      <div className="min-w-0 space-y-3 border-0 border-t border-solid border-line pt-3">
        <label className="flex min-w-0 flex-col gap-2 text-sm text-ink-2">复核试运行<select className={systemInput} value={chosen?.id || ''} disabled={blocked || !release.candidates.length} onChange={e => { setEvaluationId(e.target.value); setAcknowledged(false) }}><option value="">选择通过的当前模型试运行</option>{release.candidates.map(item => <option key={item.id} value={item.id}>{item.id} · {item.createdAt}</option>)}</select></label>
        <label className="flex min-w-0 flex-col gap-2 text-sm text-ink-2">复核理由<textarea className={`${systemInput.replace('h-9', 'h-auto')} min-h-20 py-2`} value={reason} onChange={e => setReason(e.target.value)} disabled={busy || historical} maxLength={2000} /></label>
        <SkillSimulatedSteps steps={simulated} />
        {simulated.length > 0 && <label className="flex items-start gap-2 text-sm text-warn-ink"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} disabled={busy} />我已确认这些工具仅模拟执行，并接受此隔离范围</label>}
        {readiness?.review && <p className="m-0 text-xs text-ink-2 wrap-anywhere">复核记录：{readiness.review.reason || readiness.review.id} · 证据 {readiness.review.evaluationId}</p>}
        <div className="flex flex-wrap gap-2"><button type="button" className={systemButton} disabled={!reviewAvailable} onClick={() => mutate('review', { evaluationId: chosen.id, reason: reason.trim(), ...(simulated.length ? { acknowledgeSimulation: acknowledged } : {}) })}>复核通过</button><button type="button" className={systemPrimaryButton} disabled={!publishAvailable} onClick={() => setConfirm('publish')}>发布</button></div>
      </div>
      {targets.length > 0 && <div className="min-w-0 space-y-3 border-0 border-t border-solid border-line pt-3">
        <label className="flex min-w-0 flex-col gap-2 text-sm text-ink-2">回滚目标<select className={systemInput} value={rollbackId} disabled={blocked} onChange={e => setRollbackId(e.target.value)}><option value="">选择曾发布版本</option>{targets.map(item => <option key={item.versionId} value={item.versionId}>{item.versionCode}</option>)}</select></label>
        <label className="flex min-w-0 flex-col gap-2 text-sm text-ink-2">回滚理由<textarea className={`${systemInput.replace('h-9', 'h-auto')} min-h-20 py-2`} value={rollbackReason} onChange={e => setRollbackReason(e.target.value)} disabled={blocked} maxLength={2000} /></label>
        <button type="button" className={systemButton} disabled={blocked || !release.fresh || !rollbackTarget || !rollbackReason.trim()} onClick={() => setConfirm('rollback')}>回滚生效版本</button>
      </div>}
    </>}
    {release.error && !confirm && <p role="alert" className="m-0 text-sm text-err-ink wrap-anywhere">{release.error}</p>}
    <SkillInfluences version={version} items={release.influences} loading={release.influenceLoading} error={release.influenceError} onRetry={release.reload} activeVersion={activeVersion} />
    {readiness?.events?.length > 0 && <details className="text-sm text-ink-2"><summary className="cursor-pointer">发布与回滚记录（{readiness.events.length}）</summary><ol className="space-y-2 pl-5">{readiness.events.map(event => <li key={event.id} className="wrap-anywhere">{event.kind === 'publish' ? '发布' : '回滚'} · {event.versionId} · 原生效 {event.previousVersionId || '无'} · {event.reason} · {event.createdAt}</li>)}</ol></details>}
    {/* Keep the shared inner focus trap and dismissal local to this nested confirmation. */}
    <div onKeyDown={event => { if (event.key === 'Escape' || event.key === 'Tab') event.stopPropagation() }} onCancel={event => event.stopPropagation()}>
    <SystemObjectDialog open={Boolean(confirm)} title={confirm === 'publish' ? '发布 Skill' : '回滚生效版本'} onClose={() => setConfirm(null)} busy={busy} footer={requestClose => <><button type="button" className={systemButton} onClick={requestClose} disabled={busy}>取消</button><button type="button" className={systemPrimaryButton} disabled={busy || (confirm === 'publish' ? !publishAvailable : !release.fresh || !rollbackReason.trim())} onClick={() => mutate(confirm, confirm === 'rollback' ? { targetVersionId: rollbackId, reason: rollbackReason.trim() } : {})}>确认{confirm === 'publish' ? '发布 Skill' : '回滚生效版本'}</button></>}>
      <div className="space-y-3 text-sm text-ink-2"><p>候选版本：{confirm === 'publish' ? version.versionCode : rollbackTarget?.versionCode || record.versions.find(item => item.skillVersionId === rollbackId)?.versionCode} · {confirm === 'publish' ? version.skillVersionId : rollbackId}</p><p>当前生效版本：{activeVersion?.versionCode || '无'} · {activeVersion?.skillVersionId || '无'}</p><p>此操作更新默认生效指针，Workflow 保留原有固定版本绑定。</p>{release.error && <p role="alert" className="text-err-ink wrap-anywhere">{release.error}</p>}</div>
    </SystemObjectDialog>
    </div>
  </section>
}
