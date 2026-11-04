import { useEffect, useRef, useState } from 'react'
import { workflowsApi } from '../api/workflows.js'
const matches = (p, r) => Boolean(p && p.mode === 'static' && p.executionPerformed === false && p.versionId === r?.versionId && p.hash === r.hash && p.dependencyHash === r.dependencyHash)
export default function useWorkflowRelease({ record, version, dirty, onRecord, setBusy }) {
  const [readiness, setReadiness] = useState(null)
  const [dependencies, setDependencies] = useState(null)
  const [error, setError] = useState('')
  const [dependencyError, setDependencyError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [invalidated, setInvalidated] = useState(false)
  const scope = `${record.workflowId}:${record.revision}:${version.workflowVersionId}:${version.hash}:${dirty}:${refresh}`
  const scopeRef = useRef(scope); scopeRef.current = scope
  const generation = useRef(0)
  useEffect(() => {
    const request = ++generation.current
    let alive = true
    const valid = () => alive && generation.current === request && scopeRef.current === scope
    setLoading(true); setReadiness(null); setDependencies(null); setError(''); setDependencyError('')
    workflowsApi.release(record.workflowId).then(({ data }) => { if (valid()) { setReadiness(data); setInvalidated(false) } }).catch(e => { if (valid()) setError(e.message) }).finally(() => { if (valid()) setLoading(false) })
    workflowsApi.dependencies(record.workflowId, version.workflowVersionId).then(({ data }) => { if (valid() && data.versionId === version.workflowVersionId) setDependencies(data) }).catch(e => { if (valid()) setDependencyError(e.message) })
    return () => { alive = false; generation.current++ }
  }, [scope, record.workflowId, version.workflowVersionId])
  const exact = Boolean(!invalidated && !loading && readiness && readiness.mode === 'static' && readiness.executionPerformed === false && readiness.revision === record.revision && readiness.versionId === record.currentVersionId && readiness.hash === record.versions.find(v => v.workflowVersionId === record.currentVersionId)?.hash)
  const fresh = exact && !dirty && version.workflowVersionId === record.currentVersionId
  const proofScopeMatches = Boolean(readiness && readiness.mode === 'static' && readiness.executionPerformed === false && readiness.revision === record.revision && readiness.versionId === version.workflowVersionId && readiness.hash === version.hash)
  const savedValidationCurrent = proofScopeMatches && matches(readiness.validation, readiness)
  const savedReviewCurrent = savedValidationCurrent && matches(readiness.review, readiness) && readiness.review.validationId === readiness.validation.id
  const validated = fresh && savedValidationCurrent
  const reviewed = fresh && savedReviewCurrent
  const mutate = async (action, input = {}) => {
    const requestScope = scopeRef.current
    const request = ++generation.current
    setBusy(true); setError(''); setInvalidated(true)
    try {
      const { data } = await workflowsApi.action(record.workflowId, action, record.revision, input)
      if (scopeRef.current !== requestScope || generation.current !== request) return false
      onRecord(data.record); setRefresh(n => n + 1); return true
    } catch (e) {
      if (scopeRef.current === requestScope && generation.current === request) {
        // Mutation superseded any pending reads; their finally handlers cannot clear loading.
        // Keep proof invalidated, but let this displayed record refresh after a failed write.
        setLoading(false)
        setError([e.message, ...(e.details || []).map(d => `${d.field}: ${d.reason}`)].join(' · '))
      }
      return false
    }
    finally { setBusy(false) }
  }
  return { readiness, dependencies, error, dependencyError, loading, fresh, validated, reviewed, savedValidationCurrent, savedReviewCurrent, mutate, reload: () => setRefresh(n => n + 1) }
}
