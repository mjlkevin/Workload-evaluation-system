import { randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import {
  sealedBaselines,
  deliverables,
  qualityGateReviews,
  assessmentNarratives,
  assessmentHandoffs,
} from "../../db/schema";
import type {
  SealedBaselineRow,
  SealedBaselineInsert,
  DeliverableRow,
  DeliverableInsert,
  QualityGateReviewRow,
  QualityGateReviewInsert,
  AssessmentNarrativeRow,
  AssessmentNarrativeInsert,
  AssessmentHandoffRow,
  AssessmentHandoffInsert,
} from "../../db/schema";

// ====================================================================
// SealedBaseline
// ====================================================================

export interface SealInput {
  assessmentVersionId: string;
  sealedByUserId?: string;
  artifactsSnapshot?: Record<string, unknown>;
  contractFlowId?: string;
  sealReason?: string;
}

export function createSealedBaseline(
  input: SealInput,
  dbInstance: Database = db,
): Promise<SealedBaselineRow> {
  return dbInstance
    .insert(sealedBaselines)
    .values({
      sealedBaselineId: randomUUID(),
      assessmentVersionId: input.assessmentVersionId,
      sealedByUserId: input.sealedByUserId,
      artifactsSnapshot: input.artifactsSnapshot ?? {},
      contractFlowId: input.contractFlowId,
      sealReason: input.sealReason,
      status: "sealed",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as SealedBaselineInsert)
    .returning()
    .then((rows) => rows[0]);
}

export function findSealedBaselineById(
  id: string,
  dbInstance: Database = db,
): Promise<SealedBaselineRow | null> {
  return dbInstance
    .select()
    .from(sealedBaselines)
    .where(eq(sealedBaselines.sealedBaselineId, id))
    .then((rows) => rows[0] ?? null);
}

export function findSealedBaselineByVersionId(
  versionId: string,
  dbInstance: Database = db,
): Promise<SealedBaselineRow | null> {
  return dbInstance
    .select()
    .from(sealedBaselines)
    .where(eq(sealedBaselines.assessmentVersionId, versionId))
    .orderBy(desc(sealedBaselines.createdAt))
    .then((rows) => rows[0] ?? null);
}

export function listSealedBaselinesByStatus(
  status: "sealed" | "superseded",
  dbInstance: Database = db,
): Promise<SealedBaselineRow[]> {
  return dbInstance
    .select()
    .from(sealedBaselines)
    .where(eq(sealedBaselines.status, status))
    .orderBy(desc(sealedBaselines.createdAt));
}

export function supersedeSealedBaseline(
  id: string,
  dbInstance: Database = db,
): Promise<SealedBaselineRow | null> {
  return dbInstance
    .update(sealedBaselines)
    .set({ status: "superseded", updatedAt: new Date() })
    .where(eq(sealedBaselines.sealedBaselineId, id))
    .returning()
    .then((rows) => rows[0] ?? null);
}

export function deleteSealedBaseline(
  id: string,
  dbInstance: Database = db,
): Promise<boolean> {
  return dbInstance
    .delete(sealedBaselines)
    .where(eq(sealedBaselines.sealedBaselineId, id))
    .returning()
    .then((rows) => rows.length > 0);
}

// ====================================================================
// Deliverable
// ====================================================================

export type DeliverableType = "effort_table" | "resource_cost" | "variance_analysis" | "wbs";

export interface GenerateDeliverablesInput {
  assessmentVersionId: string;
  effortEstimate?: Array<{ module: string; days: number; basis: string }>;
  riskTags?: string[];
  assumptions?: Array<{ assumption: string; rationale: string; riskIfInvalid: string }>;
  phaseProposal?: Array<{ phase: string; modules: string[]; estimatedDays: number; milestone: string }>;
  varianceBaseline?: "initial_estimate" | "bid_baseline" | "historical_avg" | "customer_budget";
}

export function createDeliverable(
  values: {
    assessmentVersionId: string;
    deliverableType: DeliverableType;
    content: Record<string, unknown>;
    status?: "draft" | "confirmed";
    varianceBaseline?: string;
  },
  dbInstance: Database = db,
): Promise<DeliverableRow> {
  return dbInstance
    .insert(deliverables)
    .values({
      deliverableId: randomUUID(),
      assessmentVersionId: values.assessmentVersionId,
      deliverableType: values.deliverableType,
      content: values.content as any,
      generatedFrom: "auto",
      status: values.status ?? "draft",
      varianceBaseline: values.varianceBaseline,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as DeliverableInsert)
    .returning()
    .then((rows) => rows[0]);
}

export function findDeliverableById(
  id: string,
  dbInstance: Database = db,
): Promise<DeliverableRow | null> {
  return dbInstance
    .select()
    .from(deliverables)
    .where(eq(deliverables.deliverableId, id))
    .then((rows) => rows[0] ?? null);
}

export function listDeliverablesByVersion(
  versionId: string,
  dbInstance: Database = db,
): Promise<DeliverableRow[]> {
  return dbInstance
    .select()
    .from(deliverables)
    .where(eq(deliverables.assessmentVersionId, versionId))
    .orderBy(desc(deliverables.createdAt));
}

export function findDeliverableByVersionAndType(
  versionId: string,
  type: DeliverableType,
  dbInstance: Database = db,
): Promise<DeliverableRow | null> {
  return dbInstance
    .select()
    .from(deliverables)
    .where(
      and(
        eq(deliverables.assessmentVersionId, versionId),
        eq(deliverables.deliverableType, type),
      ),
    )
    .then((rows) => rows[0] ?? null);
}

export function updateDeliverableStatus(
  id: string,
  status: "draft" | "confirmed",
  dbInstance: Database = db,
): Promise<DeliverableRow | null> {
  return dbInstance
    .update(deliverables)
    .set({ status, updatedAt: new Date() })
    .where(eq(deliverables.deliverableId, id))
    .returning()
    .then((rows) => rows[0] ?? null);
}

export function deleteDeliverable(
  id: string,
  dbInstance: Database = db,
): Promise<boolean> {
  return dbInstance
    .delete(deliverables)
    .where(eq(deliverables.deliverableId, id))
    .returning()
    .then((rows) => rows.length > 0);
}

// ====================================================================
// QualityGateReview
// ====================================================================

export interface CreateReviewInput {
  assessmentVersionId?: string;
  reviewerUserId?: string;
  checklist?: {
    deliverablesComplete?: boolean;
    methodologySevenPhases?: boolean;
    rateCardCorrect?: boolean;
    narrativeComplete?: boolean;
    assumptionsDocumented?: boolean;
  };
  verdict?: "pass" | "reject";
  rejectionReasons?: Array<{ field: string; reason: string; suggestion?: string }>;
  notes?: string;
}

export interface UpdateReviewInput {
  checklist?: {
    deliverablesComplete?: boolean;
    methodologySevenPhases?: boolean;
    rateCardCorrect?: boolean;
    narrativeComplete?: boolean;
    assumptionsDocumented?: boolean;
  };
  verdict?: "pass" | "reject";
  rejectionReasons?: Array<{ field: string; reason: string; suggestion?: string }>;
  notes?: string;
}

export function createQualityGateReview(
  input: CreateReviewInput,
  dbInstance: Database = db,
): Promise<QualityGateReviewRow> {
  return dbInstance
    .insert(qualityGateReviews)
    .values({
      reviewId: randomUUID(),
      assessmentVersionId: input.assessmentVersionId,
      reviewerUserId: input.reviewerUserId,
      checklist: {
        deliverablesComplete: false,
        methodologySevenPhases: false,
        rateCardCorrect: false,
        narrativeComplete: false,
        assumptionsDocumented: false,
        ...input.checklist,
      } as any,
      verdict: input.verdict ?? null,
      rejectionReasons: input.rejectionReasons ?? [],
      notes: input.notes,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as QualityGateReviewInsert)
    .returning()
    .then((rows) => rows[0]);
}

export function findQualityGateReviewById(
  id: string,
  dbInstance: Database = db,
): Promise<QualityGateReviewRow | null> {
  return dbInstance
    .select()
    .from(qualityGateReviews)
    .where(eq(qualityGateReviews.reviewId, id))
    .then((rows) => rows[0] ?? null);
}

export function findQualityGateReviewByVersionId(
  versionId: string,
  dbInstance: Database = db,
): Promise<QualityGateReviewRow | null> {
  return dbInstance
    .select()
    .from(qualityGateReviews)
    .where(eq(qualityGateReviews.assessmentVersionId, versionId))
    .orderBy(desc(qualityGateReviews.createdAt))
    .then((rows) => rows[0] ?? null);
}

export function updateQualityGateReview(
  id: string,
  input: UpdateReviewInput,
  dbInstance: Database = db,
): Promise<QualityGateReviewRow | null> {
  return findQualityGateReviewById(id, dbInstance).then((existing) => {
    if (!existing) return null;

    const set: Partial<QualityGateReviewInsert> = { updatedAt: new Date() };
    if (input.checklist !== undefined) {
      set.checklist = { ...(existing.checklist as object), ...input.checklist } as any;
    }
    if (input.verdict !== undefined) set.verdict = input.verdict;
    if (input.rejectionReasons !== undefined) set.rejectionReasons = input.rejectionReasons;
    if (input.notes !== undefined) set.notes = input.notes;

    return dbInstance
      .update(qualityGateReviews)
      .set(set)
      .where(eq(qualityGateReviews.reviewId, id))
      .returning()
      .then((rows) => rows[0] ?? null);
  });
}

export function deleteQualityGateReview(
  id: string,
  dbInstance: Database = db,
): Promise<boolean> {
  return dbInstance
    .delete(qualityGateReviews)
    .where(eq(qualityGateReviews.reviewId, id))
    .returning()
    .then((rows) => rows.length > 0);
}

// ====================================================================
// AssessmentNarrative
// ====================================================================

export interface CreateNarrativeInput {
  assessmentVersionId?: string;
  templateId?: string;
  orgAndModules?: string;
  dataGovernance?: string;
  specialScenarios?: string;
  acceptanceScope?: string;
  timelineAndCost?: string;
  metadata?: Record<string, unknown>;
  generatedFrom?: "ai" | "template" | "manual";
  lastEditedByUserId?: string;
}

export interface UpdateNarrativeInput {
  orgAndModules?: string;
  dataGovernance?: string;
  specialScenarios?: string;
  acceptanceScope?: string;
  timelineAndCost?: string;
  metadata?: Record<string, unknown>;
  status?: "draft" | "confirmed";
  lastEditedByUserId?: string;
}

export function createAssessmentNarrative(
  input: CreateNarrativeInput,
  dbInstance: Database = db,
): Promise<AssessmentNarrativeRow> {
  return dbInstance
    .insert(assessmentNarratives)
    .values({
      narrativeId: randomUUID(),
      assessmentVersionId: input.assessmentVersionId,
      templateId: input.templateId,
      orgAndModules: input.orgAndModules,
      dataGovernance: input.dataGovernance,
      specialScenarios: input.specialScenarios,
      acceptanceScope: input.acceptanceScope,
      timelineAndCost: input.timelineAndCost,
      metadata: input.metadata ?? {},
      generatedFrom: input.generatedFrom ?? "template",
      status: "draft",
      lastEditedByUserId: input.lastEditedByUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as AssessmentNarrativeInsert)
    .returning()
    .then((rows) => rows[0]);
}

export function findAssessmentNarrativeById(
  id: string,
  dbInstance: Database = db,
): Promise<AssessmentNarrativeRow | null> {
  return dbInstance
    .select()
    .from(assessmentNarratives)
    .where(eq(assessmentNarratives.narrativeId, id))
    .then((rows) => rows[0] ?? null);
}

export function findAssessmentNarrativeByVersionId(
  versionId: string,
  dbInstance: Database = db,
): Promise<AssessmentNarrativeRow | null> {
  return dbInstance
    .select()
    .from(assessmentNarratives)
    .where(eq(assessmentNarratives.assessmentVersionId, versionId))
    .then((rows) => rows[0] ?? null);
}

export function updateAssessmentNarrative(
  id: string,
  input: UpdateNarrativeInput,
  dbInstance: Database = db,
): Promise<AssessmentNarrativeRow | null> {
  return findAssessmentNarrativeById(id, dbInstance).then((existing) => {
    if (!existing) return null;

    const set: Partial<AssessmentNarrativeInsert> = { updatedAt: new Date() };
    if (input.orgAndModules !== undefined) set.orgAndModules = input.orgAndModules;
    if (input.dataGovernance !== undefined) set.dataGovernance = input.dataGovernance;
    if (input.specialScenarios !== undefined) set.specialScenarios = input.specialScenarios;
    if (input.acceptanceScope !== undefined) set.acceptanceScope = input.acceptanceScope;
    if (input.timelineAndCost !== undefined) set.timelineAndCost = input.timelineAndCost;
    if (input.metadata !== undefined) set.metadata = input.metadata;
    if (input.status !== undefined) set.status = input.status;
    if (input.lastEditedByUserId !== undefined) set.lastEditedByUserId = input.lastEditedByUserId;

    return dbInstance
      .update(assessmentNarratives)
      .set(set)
      .where(eq(assessmentNarratives.narrativeId, id))
      .returning()
      .then((rows) => rows[0] ?? null);
  });
}

export function deleteAssessmentNarrative(
  id: string,
  dbInstance: Database = db,
): Promise<boolean> {
  return dbInstance
    .delete(assessmentNarratives)
    .where(eq(assessmentNarratives.narrativeId, id))
    .returning()
    .then((rows) => rows.length > 0);
}

// ====================================================================
// AssessmentHandoff
// ====================================================================

export type V2Role = "SALES" | "PRE_SALES" | "IMPL" | "PM" | "PMO" | "ADMIN";

export interface CreateHandoffInput {
  assessmentVersionId?: string;
  fromRole: V2Role;
  toRole: V2Role;
  initiatedByUserId?: string;
  fromVersionId?: string;
  toVersionId?: string;
  contextSnapshot?: Record<string, unknown>;
  notes?: string;
}

export interface UpdateHandoffInput {
  acceptedByUserId?: string;
  status?: "pending" | "accepted" | "rejected";
  notes?: string;
}

export function createAssessmentHandoff(
  input: CreateHandoffInput,
  dbInstance: Database = db,
): Promise<AssessmentHandoffRow> {
  return dbInstance
    .insert(assessmentHandoffs)
    .values({
      handoffId: randomUUID(),
      assessmentVersionId: input.assessmentVersionId,
      fromRole: input.fromRole,
      toRole: input.toRole,
      initiatedByUserId: input.initiatedByUserId,
      acceptedByUserId: null,
      fromVersionId: input.fromVersionId,
      toVersionId: input.toVersionId,
      contextSnapshot: input.contextSnapshot ?? {},
      status: "pending",
      notes: input.notes,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as AssessmentHandoffInsert)
    .returning()
    .then((rows) => rows[0]);
}

export function findAssessmentHandoffById(
  id: string,
  dbInstance: Database = db,
): Promise<AssessmentHandoffRow | null> {
  return dbInstance
    .select()
    .from(assessmentHandoffs)
    .where(eq(assessmentHandoffs.handoffId, id))
    .then((rows) => rows[0] ?? null);
}

export function listAssessmentHandoffsByVersion(
  versionId: string,
  dbInstance: Database = db,
): Promise<AssessmentHandoffRow[]> {
  return dbInstance
    .select()
    .from(assessmentHandoffs)
    .where(eq(assessmentHandoffs.assessmentVersionId, versionId))
    .orderBy(desc(assessmentHandoffs.createdAt));
}

export function listAssessmentHandoffsByToRole(
  toRole: V2Role,
  status: string | undefined,
  dbInstance: Database = db,
): Promise<AssessmentHandoffRow[]> {
  const conds = [eq(assessmentHandoffs.toRole, toRole)];
  if (status) {
    conds.push(eq(assessmentHandoffs.status, status as any));
  }
  return dbInstance
    .select()
    .from(assessmentHandoffs)
    .where(and(...conds))
    .orderBy(desc(assessmentHandoffs.createdAt));
}

export function updateAssessmentHandoff(
  id: string,
  input: UpdateHandoffInput,
  dbInstance: Database = db,
): Promise<AssessmentHandoffRow | null> {
  return findAssessmentHandoffById(id, dbInstance).then((existing) => {
    if (!existing) return null;

    const set: Partial<AssessmentHandoffInsert> = { updatedAt: new Date() };
    if (input.acceptedByUserId !== undefined) set.acceptedByUserId = input.acceptedByUserId;
    if (input.status !== undefined) set.status = input.status;
    if (input.notes !== undefined) set.notes = input.notes;

    return dbInstance
      .update(assessmentHandoffs)
      .set(set)
      .where(eq(assessmentHandoffs.handoffId, id))
      .returning()
      .then((rows) => rows[0] ?? null);
  });
}

export function deleteAssessmentHandoff(
  id: string,
  dbInstance: Database = db,
): Promise<boolean> {
  return dbInstance
    .delete(assessmentHandoffs)
    .where(eq(assessmentHandoffs.handoffId, id))
    .returning()
    .then((rows) => rows.length > 0);
}
