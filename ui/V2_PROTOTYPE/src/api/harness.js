import { apiClient } from './client'
import { unwrap } from './utils'

export async function createHarnessRun(payload) {
  return unwrap(await apiClient.post('/harness/runs', payload, { suppressUnauthorizedRedirect: true }))
}

export async function bindHarnessFile(runId, payload) {
  return unwrap(await apiClient.post(`/harness/runs/${runId}/files`, payload, { suppressUnauthorizedRedirect: true }))
}

export async function submitHarnessParseResult(runId, payload) {
  return unwrap(await apiClient.post(`/harness/runs/${runId}/parse-result`, payload, { suppressUnauthorizedRedirect: true }))
}

export async function generateHarnessReportV1(runId, payload = {}) {
  return unwrap(await apiClient.post(`/harness/runs/${runId}/report-v1`, payload, { suppressUnauthorizedRedirect: true }))
}

export async function submitHarnessAnswers(runId, payload) {
  return unwrap(await apiClient.post(`/harness/runs/${runId}/answers`, payload, { suppressUnauthorizedRedirect: true }))
}

export async function generateHarnessReportV2(runId, payload = {}) {
  return unwrap(await apiClient.post(`/harness/runs/${runId}/report-v2`, payload, { suppressUnauthorizedRedirect: true }))
}

export async function confirmHarnessAction(runId, actionId, payload) {
  return unwrap(await apiClient.post(`/harness/runs/${runId}/actions/${actionId}/confirm`, payload, { suppressUnauthorizedRedirect: true }))
}

export async function getHarnessRunDetail(runId) {
  return unwrap(await apiClient.get(`/harness/runs/${runId}`, null, { suppressUnauthorizedRedirect: true }))
}
