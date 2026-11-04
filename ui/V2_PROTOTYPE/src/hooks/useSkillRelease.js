import { useEffect, useRef, useState } from 'react'
import { skillsApi } from '../api/skills.js'

export function eligibleSkillTrial(trial, readiness) {
  const result = trial?.result
  return Boolean(trial?.current && trial.hash === readiness?.hash && trial.contextHash === readiness?.contextHash && result?.mode === 'model' && result.modelExecuted && result.passed && result.releaseEligible)
}

// A generation belongs to one displayed, saved record. Switching, editing or closing
// invalidates requests even when the transport cannot cancel an in-flight provider call.
export default function useSkillRelease({ record, version, dirty, onRecord, setBusy }) {
  const [invalidated, setInvalidated] = useState(false)
  const [readiness, setReadiness] = useState(null)
  const [influences, setInfluences] = useState([])
  const [influenceLoading, setInfluenceLoading] = useState(true)
  const [influenceError, setInfluenceError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastTrial, setLastTrial] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const scope = `${record.skillId}:${record.revision}:${version.skillVersionId}:${version.hash}:${dirty}:${refresh}`
  const currentScope = useRef(scope)
  currentScope.current = scope
  const generation = useRef(0)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    const request = ++generation.current
    let alive = true
    const valid = () => alive && generation.current === request && currentScope.current === scope
    setLoading(true); setInfluenceLoading(true); setError(''); setReadiness(null); setInfluences([]); setInfluenceError('')
    skillsApi.release(record.skillId).then(({ data }) => {
      if (valid()) { setReadiness(data); setInvalidated(false) }
    }).catch(cause => { if (valid()) setError(`发布状态加载失败：${cause.message}`) })
      .finally(() => { if (valid()) setLoading(false) })
    skillsApi.influences(record.skillId, version.skillVersionId).then(({ data }) => {
      if (valid()) setInfluences(data.items)
    }).catch(cause => { if (valid()) setInfluenceError(`影响分析加载失败：${cause.message}`) }).finally(() => { if (valid()) setInfluenceLoading(false) })
    return () => { alive = false; generation.current++ }
  }, [scope, record.skillId, version.skillVersionId])
  const exact = Boolean(!invalidated && !loading && readiness && readiness.revision === record.revision && readiness.versionId === record.currentVersionId && readiness.hash === record.versions.find(v => v.skillVersionId === record.currentVersionId)?.hash)
  const historical = version.skillVersionId !== record.currentVersionId
  const fresh = exact && !dirty && !historical
  const trials = historical ? [] : readiness?.trials || []
  const candidates = trials.filter(trial => eligibleSkillTrial(trial, readiness))
  const review = readiness?.review
  const reviewed = review?.versionId === readiness?.versionId && candidates.some(trial => trial.id === review?.evaluationId && review.hash === readiness.hash && review.contextHash === readiness.contextHash)
  const mutate = async (action, payload = {}) => {
    const requestScope = currentScope.current
    const request = ++generation.current
    setBusy(true); setError(''); setInvalidated(true)
    if (influenceLoading) { setInfluenceLoading(false); setInfluenceError('影响分析请求已过期，请刷新后查看') }
    try {
      const { data } = await skillsApi[action](record.skillId, { revision: record.revision, ...payload })
      if (!mounted.current || currentScope.current !== requestScope || generation.current !== request) return false
      if (data.evaluation) setLastTrial({ versionId: version.skillVersionId, evaluation: data.evaluation })
      onRecord(data.record)
      setRefresh(n => n + 1)
      return true
    } catch (cause) {
      if (mounted.current && currentScope.current === requestScope && generation.current === request) setError(cause.message)
      return false
    } finally { setBusy(false) }
  }
  return { readiness, exact, fresh, trials, candidates, reviewed, loading, error, influences, influenceError, influenceLoading,
    lastTrial: lastTrial?.versionId === version.skillVersionId ? lastTrial.evaluation : null,
    reload: () => setRefresh(n => n + 1), mutate }
}
