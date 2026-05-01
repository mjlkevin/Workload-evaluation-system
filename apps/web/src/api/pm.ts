import { apiGet, apiPost, apiPatch } from './client'

// ------------------------------------------------------------------
// Assessment Handoff
// ------------------------------------------------------------------

export interface Handoff {
  handoffId: string
  assessmentVersionId: string | null
  fromRole: string
  toRole: string
  initiatedByUserId: string | null
  acceptedByUserId: string | null
  fromVersionId: string | null
  toVersionId: string | null
  contextSnapshot: unknown
  status: 'pending' | 'accepted' | 'rejected'
  notes: string | null
  createdAt: string
  updatedAt: string
}

export function createHandoff(body: {
  assessmentVersionId?: string
  fromRole: string
  toRole: string
  fromVersionId?: string
  toVersionId?: string
  contextSnapshot?: unknown
  notes?: string
}): Promise<Handoff> {
  return apiPost('/pm/handoffs', body)
}

export function listHandoffs(toRole: string, status?: string): Promise<Handoff[]> {
  return apiGet('/pm/handoffs', { toRole, status })
}

export function getHandoff(id: string): Promise<Handoff> {
  return apiGet(`/pm/handoffs/${id}`)
}

export function updateHandoff(
  id: string,
  body: { acceptedByUserId?: string; status?: 'pending' | 'accepted' | 'rejected'; notes?: string }
): Promise<Handoff> {
  return apiPatch(`/pm/handoffs/${id}`, body)
}

// ------------------------------------------------------------------
// Assessment Narrative
// ------------------------------------------------------------------

export interface Narrative {
  narrativeId: string
  assessmentVersionId: string | null
  templateId: string | null
  orgAndModules: string | null
  dataGovernance: string | null
  specialScenarios: string | null
  acceptanceScope: string | null
  timelineAndCost: string | null
  metadata: unknown
  generatedFrom: string
  status: 'draft' | 'confirmed'
  lastEditedByUserId: string | null
  createdAt: string
  updatedAt: string
}

export function createNarrative(body: Partial<Narrative>): Promise<Narrative> {
  return apiPost('/pm/narratives', body)
}

export function generateNarrative(body: {
  assessmentVersionId: string
  packData: unknown
  estimateData?: unknown
}): Promise<Narrative> {
  return apiPost('/pm/narratives/generate', body)
}

export function getNarrative(id: string): Promise<Narrative> {
  return apiGet(`/pm/narratives/${id}`)
}

export function getNarrativeByVersion(versionId: string): Promise<Narrative> {
  return apiGet(`/pm/versions/${versionId}/narrative`)
}

export function updateNarrative(
  id: string,
  body: Partial<Pick<Narrative, 'orgAndModules' | 'dataGovernance' | 'specialScenarios' | 'acceptanceScope' | 'timelineAndCost' | 'status'>>
): Promise<Narrative> {
  return apiPatch(`/pm/narratives/${id}`, body)
}

// ------------------------------------------------------------------
// Deliverables
// ------------------------------------------------------------------

export interface Deliverable {
  deliverableId: string
  assessmentVersionId: string | null
  deliverableType: 'effort_table' | 'resource_cost' | 'variance_analysis' | 'wbs'
  content: unknown
  generatedFrom: string
  status: 'draft' | 'confirmed'
  varianceBaseline: string | null
  createdAt: string
  updatedAt: string
}

export function generateDeliverables(body: {
  assessmentVersionId: string
  effortEstimate?: unknown
  riskTags?: string[]
  assumptions?: unknown
  phaseProposal?: unknown
  varianceBaseline?: string
}): Promise<Deliverable[]> {
  return apiPost('/pm/deliverables/generate', body)
}

export function getDeliverable(id: string): Promise<Deliverable> {
  return apiGet(`/pm/deliverables/${id}`)
}

export function listDeliverablesByVersion(versionId: string): Promise<Deliverable[]> {
  return apiGet(`/pm/versions/${versionId}/deliverables`)
}

export function updateDeliverableStatus(id: string, status: 'draft' | 'confirmed'): Promise<Deliverable> {
  return apiPatch(`/pm/deliverables/${id}/status`, { status })
}

// ------------------------------------------------------------------
// Quality Gate Review
// ------------------------------------------------------------------

export interface QualityGateReview {
  reviewId: string
  assessmentVersionId: string | null
  reviewerUserId: string | null
  checklist: {
    deliverablesComplete: boolean
    methodologySevenPhases: boolean
    rateCardCorrect: boolean
    narrativeComplete: boolean
    assumptionsDocumented: boolean
  }
  verdict: 'pass' | 'reject'
  rejectionReasons: Array<{ field: string; reason: string; suggestion?: string }>
  notes: string | null
  createdAt: string
  updatedAt: string
}

export function createReview(body: Partial<QualityGateReview>): Promise<QualityGateReview> {
  return apiPost('/pm/reviews', body)
}

export function autoReview(body: {
  assessmentVersionId: string
  deliverables: unknown[]
  narrativeStatus?: string
  hasAssumptions?: boolean
}): Promise<QualityGateReview> {
  return apiPost('/pm/reviews/auto', body)
}

export function getReview(id: string): Promise<QualityGateReview> {
  return apiGet(`/pm/reviews/${id}`)
}

export function getReviewByVersion(versionId: string): Promise<QualityGateReview> {
  return apiGet(`/pm/versions/${versionId}/review`)
}

export function updateReview(id: string, body: Partial<QualityGateReview>): Promise<QualityGateReview> {
  return apiPatch(`/pm/reviews/${id}`, body)
}

// ------------------------------------------------------------------
// Sealed Baseline
// ------------------------------------------------------------------

export interface SealedBaseline {
  sealedBaselineId: string
  assessmentVersionId: string
  sealedByUserId: string | null
  artifactsSnapshot: unknown
  contractFlowId: string | null
  sealReason: string | null
  status: 'sealed' | 'superseded'
  createdAt: string
  updatedAt: string
}

export function createSeal(body: {
  assessmentVersionId: string
  artifactsSnapshot?: unknown
  contractFlowId?: string
  sealReason?: string
}): Promise<SealedBaseline> {
  return apiPost('/pm/seal', body)
}

export function getSeal(id: string): Promise<SealedBaseline> {
  return apiGet(`/pm/seal/${id}`)
}

export function getSealByVersion(versionId: string): Promise<SealedBaseline> {
  return apiGet(`/pm/versions/${versionId}/seal`)
}
