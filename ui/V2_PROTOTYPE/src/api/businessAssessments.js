import { apiClient } from './client.js'
import { unwrap } from './utils.js'

const referenceFields = ['operationId', 'executionId', 'runId', 'rootRunId', 'manifestHash', 'workflowId', 'workflowVersionId', 'workflowHash', 'templateId', 'templateVersion', 'ruleSetId', 'ruleVersion', 'pipelineVersion', 'snapshotDigest']
const nonempty = value => typeof value === 'string' && value.trim().length > 0

export async function getBusinessAssessmentBasis(recordId) {
  const data = unwrap(await apiClient.get(`/business-assessments/${encodeURIComponent(recordId)}/basis`))
  if (data?.kind === 'legacy') return data
  const { template, ruleSet, basis } = data || {}
  if (data?.kind !== 'frozen' || !referenceFields.every(key => nonempty(basis?.[key]))
    || !Array.isArray(template?.items) || !template.items.length || !Array.isArray(template?.groups)
    || !Array.isArray(ruleSet?.pipeline) || !Array.isArray(ruleSet?.baseRule?.userCountTiers)
    || !Array.isArray(ruleSet?.baseRule?.difficultyFactorList) || typeof ruleSet?.orgIncrementRule?.enabled !== 'boolean'
    || template.templateId !== basis.templateId || template.templateVersion !== basis.templateVersion
    || ruleSet.ruleSetId !== basis.ruleSetId || ruleSet.ruleVersion !== basis.ruleVersion
    || ruleSet.pipelineVersion !== basis.pipelineVersion) {
    throw new Error('原始计算依据不完整，请核对评估来源后重试')
  }
  return data
}

export async function calculateBusinessAssessment(recordId, request) {
  const result = unwrap(await apiClient.post(`/business-assessments/${encodeURIComponent(recordId)}/calculate`, request))
  if (!Number.isFinite(result?.totalDays) || result.totalDays < 0 || !Array.isArray(result?.itemResults)) {
    throw new Error('原始依据计算结果不完整，请重试')
  }
  return result
}
