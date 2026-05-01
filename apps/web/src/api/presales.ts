import { apiGet, apiPost, apiPatch, apiDelete } from './client'

// ------------------------------------------------------------------
// Types (aligned with backend)
// ------------------------------------------------------------------

export interface RequirementPack {
  requirementPackId: string
  sourceExtractionId: string | null
  structuredRequirements: unknown[]
  industry: string | null
  scale: string | null
  modules: Array<{ moduleName?: string; subModules?: string[]; [k: string]: unknown }>
  constraints: unknown[]
  status: 'draft' | 'confirmed' | 'deprecated'
  ownerUserId: string | null
  createdAt: string
  updatedAt: string
}

export interface ReviewResult {
  requirementPackId: string
  violations: Array<{
    ruleId: string
    message: string
    severity: 'error' | 'warning' | 'info'
    fieldPath?: string
  }>
  inquiries: Array<{
    inquiryId: string
    question: string
    severity: 'error' | 'warning' | 'info'
    relatedFieldPath?: string
    suggestion?: string
  }>
  confidenceSummary: {
    overall: number
    byDimension: Record<string, number>
  }
}

export interface FieldConfidence {
  fieldPath: string
  value: string
  confidence: number
  method: string
  sourceKind: string
}

export interface EstimateLineItem {
  module: string
  days: number
  basis: string
}

export interface PhaseProposal {
  phase: string
  modules: string[]
  estimatedDays: number
  milestone: string
}

export interface InitialEstimate {
  initialEstimateId: string
  requirementPackId: string | null
  effortEstimate: EstimateLineItem[]
  riskTags: string[]
  assumptions: Array<{
    assumption: string
    rationale: string
    riskIfInvalid: string
  }>
  confidenceScores: Record<string, number> | null
  phaseProposal: PhaseProposal[]
  status: 'draft' | 'reviewed' | 'handed_off' | 'deprecated'
  ownerUserId: string | null
  createdAt: string
  updatedAt: string
}

export interface SowDocument {
  sowDocumentId: string
  requirementPackId: string | null
  cloudProduct: string
  module: string
  category: string | null
  description: string | null
  customizationScope: string | null
  version: string
  status: 'draft' | 'confirmed' | 'changed'
  linkedAssessmentVersionId: string | null
  ownerUserId: string | null
  createdAt: string
  updatedAt: string
}

// ------------------------------------------------------------------
// Requirement Pack APIs
// ------------------------------------------------------------------

export function listPacks(status?: string): Promise<RequirementPack[]> {
  return apiGet('/presales/requirement-packs', status ? { status } : undefined)
}

export function getPack(id: string): Promise<RequirementPack> {
  return apiGet(`/presales/requirement-packs/${id}`)
}

export function createPack(body: { sourceExtractionId?: string; extractionId?: string }): Promise<RequirementPack> {
  return apiPost('/presales/requirement-packs', body)
}

export function updatePack(id: string, body: Partial<Pick<RequirementPack, 'industry' | 'scale' | 'modules' | 'constraints' | 'status'>>): Promise<RequirementPack> {
  return apiPatch(`/presales/requirement-packs/${id}`, body)
}

export function deletePack(id: string): Promise<void> {
  return apiDelete(`/presales/requirement-packs/${id}`)
}

export function reviewPack(id: string): Promise<ReviewResult> {
  return apiPost(`/presales/requirement-packs/${id}/review`)
}

export function getPackConfidences(id: string): Promise<FieldConfidence[]> {
  return apiGet(`/presales/requirement-packs/${id}/confidences`)
}

// ------------------------------------------------------------------
// Initial Estimate APIs
// ------------------------------------------------------------------

export function generateInitialEstimate(id: string): Promise<InitialEstimate> {
  return apiPost(`/presales/requirement-packs/${id}/initial-estimate`)
}

export function getInitialEstimate(id: string): Promise<InitialEstimate> {
  return apiGet(`/presales/initial-estimates/${id}`)
}

// ------------------------------------------------------------------
// SOW APIs
// ------------------------------------------------------------------

export function generateSow(id: string, cloudProduct?: string): Promise<SowDocument[]> {
  return apiPost(`/presales/requirement-packs/${id}/sow`, { cloudProduct })
}

export function listSowByPack(id: string): Promise<SowDocument[]> {
  return apiGet(`/presales/requirement-packs/${id}/sow`)
}
