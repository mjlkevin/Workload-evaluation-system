import { apiClient } from './client.js'
import { unwrap, unwrapList } from './utils.js'

const options = { suppressUnauthorizedRedirect: true }
const runPath = (runId) => `/ai-runs/${encodeURIComponent(runId)}`
export async function listExecutionCatalog() {
  return unwrapList(await apiClient.get('/ai-executions/catalog', undefined, options))
}
export async function recommendBusinessExecutions(goal) {
  return unwrap(await apiClient.post('/ai-executions/recommendations', { goal }, options))
}
export async function uploadExecutionSource(sessionId, file) {
  const body = new FormData()
  body.append('file', file)
  return unwrap(await apiClient.upload(`/ai-sessions/${encodeURIComponent(sessionId)}/execution-sources`, body, options))
}
export async function listExecutionTemplates() {
  const list = unwrap(await apiClient.get('/templates', undefined, options), 'list')
  return Array.isArray(list) ? list : []
}
export async function listBusinessRuns(sessionId) {
  return unwrapList(await apiClient.get('/ai-executions/runs', { sessionId }, options))
}
export async function startBusinessExecution(sessionId, { submissionKey, content, execution }) {
  const selection = { kind: execution.kind,
    [execution.kind === 'skill' ? 'skillId' : 'workflowId']: execution.kind === 'skill' ? execution.skillId : execution.workflowId,
    input: execution.input }
  if (execution.sources?.length) selection.sources = execution.sources.map(({ kind, id, location }) => ({ kind, id, ...(location ? { location } : {}) }))
  const assets = (execution.assets || [])
    .filter(asset => asset.kind === 'assessment-catalog' && typeof asset.templateId === 'string')
    .map(({ kind, templateId }) => ({ kind, templateId }))
  if (assets.length) selection.assets = assets
  return unwrap(await apiClient.post(`/ai-sessions/${encodeURIComponent(sessionId)}/runs`, { submissionKey, content, execution: selection }, options))
}
export async function submitBusinessInput(runId, pending, input) {
  const { actionId, kind, stepId, contentHash } = pending
  return unwrap(await apiClient.post(`${runPath(runId)}/inputs`, { actionId, kind, stepId, contentHash, input }, options))
}
export async function decideBusinessAction(runId, pending, decision) {
  if (!['confirm', 'reject'].includes(decision)) throw new Error('请选择确认或拒绝')
  const body = pending.confirmationHash
    ? { confirmationHash: pending.confirmationHash }
    : { stepId: pending.stepId, contentHash: pending.contentHash }
  return unwrap(await apiClient.post(`${runPath(runId)}/actions/${encodeURIComponent(pending.actionId)}/${decision}`, body, options))
}
export async function retryBusinessExecution(runId, { submissionKey, reason }) {
  return unwrap(await apiClient.post(`${runPath(runId)}/retry`, { submissionKey, reason }, options))
}
