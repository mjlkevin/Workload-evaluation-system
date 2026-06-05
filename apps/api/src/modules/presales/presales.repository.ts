import { randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import { requirementPacks, initialEstimates, sowDocuments } from "../../db/schema";
import type { RequirementPackRow, SowDocumentRow } from "../../db/schema";

// ====================================================================
// RequirementPack
// ====================================================================

export interface CreateRequirementPackInput {
  sourceExtractionId?: string;
  ownerUserId?: string;
  extractionId?: string;
}

export interface UpdateRequirementPackInput {
  structuredRequirements?: unknown[];
  industry?: string;
  scale?: string;
  modules?: unknown[];
  constraints?: unknown[];
  status?: "draft" | "confirmed" | "deprecated";
}

export function createRequirementPack(
  input: {
    requirementPackId: string;
    sourceExtractionId?: string;
    structuredRequirements: unknown[];
    industry: string | null;
    scale: string | null;
    modules: unknown[];
    constraints: unknown[];
    ownerUserId?: string;
  },
  dbInstance: Database = db,
): Promise<RequirementPackRow> {
  return dbInstance
    .insert(requirementPacks)
    .values({
      requirementPackId: input.requirementPackId,
      sourceExtractionId: input.sourceExtractionId,
      structuredRequirements: input.structuredRequirements as any,
      industry: input.industry,
      scale: input.scale,
      modules: input.modules as any,
      constraints: input.constraints as any,
      status: "draft",
      ownerUserId: input.ownerUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()
    .then((rows) => rows[0]);
}

export function findRequirementPackById(
  id: string,
  dbInstance: Database = db,
): Promise<RequirementPackRow | null> {
  return dbInstance
    .select()
    .from(requirementPacks)
    .where(eq(requirementPacks.requirementPackId, id))
    .then((rows) => rows[0] ?? null);
}

export function listRequirementPacksByOwner(
  ownerUserId: string,
  status: string | undefined,
  dbInstance: Database = db,
): Promise<RequirementPackRow[]> {
  const conds = [eq(requirementPacks.ownerUserId, ownerUserId)];
  if (status) {
    conds.push(eq(requirementPacks.status, status as any));
  }
  return dbInstance
    .select()
    .from(requirementPacks)
    .where(and(...conds))
    .orderBy(desc(requirementPacks.updatedAt));
}

export function updateRequirementPack(
  id: string,
  input: UpdateRequirementPackInput,
  dbInstance: Database = db,
): Promise<RequirementPackRow | null> {
  return findRequirementPackById(id, dbInstance).then((existing) => {
    if (!existing) return null;

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.structuredRequirements !== undefined) set.structuredRequirements = input.structuredRequirements as any;
    if (input.industry !== undefined) set.industry = input.industry;
    if (input.scale !== undefined) set.scale = input.scale;
    if (input.modules !== undefined) set.modules = input.modules as any;
    if (input.constraints !== undefined) set.constraints = input.constraints as any;
    if (input.status !== undefined) set.status = input.status;

    return dbInstance
      .update(requirementPacks)
      .set(set as any)
      .where(eq(requirementPacks.requirementPackId, id))
      .returning()
      .then((rows) => rows[0] ?? null);
  });
}

export function deleteRequirementPack(
  id: string,
  dbInstance: Database = db,
): Promise<boolean> {
  return dbInstance
    .delete(requirementPacks)
    .where(eq(requirementPacks.requirementPackId, id))
    .returning()
    .then((rows) => rows.length > 0);
}

// ====================================================================
// InitialEstimate
// ====================================================================

export interface EstimateLineItem {
  module: string;
  days: number;
  basis: string;
}

export interface PhaseProposal {
  phase: string;
  modules: string[];
  estimatedDays: number;
  milestone: string;
}

export interface GenerateEstimateInput {
  requirementPack: RequirementPackRow;
  ownerUserId?: string;
}

export interface UpdateEstimateInput {
  effortEstimate?: EstimateLineItem[];
  riskTags?: string[];
  assumptions?: Array<{ assumption: string; rationale: string; riskIfInvalid: string }>;
  confidenceScores?: Record<string, number>;
  phaseProposal?: PhaseProposal[];
  status?: "draft" | "reviewed" | "handed_off" | "deprecated";
  reviewedByUserId?: string;
}

export function createInitialEstimate(
  input: {
    initialEstimateId: string;
    requirementPackId: string;
    effortEstimate: EstimateLineItem[];
    riskTags: string[];
    assumptions: Array<{ assumption: string; rationale: string; riskIfInvalid: string }>;
    confidenceScores: Record<string, number>;
    phaseProposal: PhaseProposal[];
    ownerUserId?: string;
  },
  dbInstance: Database = db,
) {
  return dbInstance
    .insert(initialEstimates)
    .values({
      initialEstimateId: input.initialEstimateId,
      requirementPackId: input.requirementPackId,
      effortEstimate: input.effortEstimate as any,
      riskTags: input.riskTags as any,
      assumptions: input.assumptions as any,
      confidenceScores: input.confidenceScores as any,
      phaseProposal: input.phaseProposal as any,
      status: "draft",
      ownerUserId: input.ownerUserId,
      reviewedByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()
    .then((rows) => rows[0]);
}

export function findInitialEstimateById(
  id: string,
  dbInstance: Database = db,
) {
  return dbInstance
    .select()
    .from(initialEstimates)
    .where(eq(initialEstimates.initialEstimateId, id))
    .then((rows) => rows[0] ?? null);
}

export function findInitialEstimateByPackId(
  packId: string,
  dbInstance: Database = db,
) {
  return dbInstance
    .select()
    .from(initialEstimates)
    .where(eq(initialEstimates.requirementPackId, packId))
    .then((rows) => rows[0] ?? null);
}

export function listInitialEstimatesByOwner(
  ownerUserId: string,
  status: string | undefined,
  dbInstance: Database = db,
) {
  const conds = [eq(initialEstimates.ownerUserId, ownerUserId)];
  if (status) {
    conds.push(eq(initialEstimates.status, status as any));
  }
  return dbInstance
    .select()
    .from(initialEstimates)
    .where(and(...conds))
    .orderBy(desc(initialEstimates.updatedAt));
}

export function updateInitialEstimate(
  id: string,
  input: UpdateEstimateInput,
  dbInstance: Database = db,
) {
  return findInitialEstimateById(id, dbInstance).then((existing) => {
    if (!existing) return null;

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.effortEstimate !== undefined) set.effortEstimate = input.effortEstimate as any;
    if (input.riskTags !== undefined) set.riskTags = input.riskTags as any;
    if (input.assumptions !== undefined) set.assumptions = input.assumptions as any;
    if (input.confidenceScores !== undefined) set.confidenceScores = input.confidenceScores as any;
    if (input.phaseProposal !== undefined) set.phaseProposal = input.phaseProposal as any;
    if (input.status !== undefined) set.status = input.status;
    if (input.reviewedByUserId !== undefined) set.reviewedByUserId = input.reviewedByUserId;

    return dbInstance
      .update(initialEstimates)
      .set(set as any)
      .where(eq(initialEstimates.initialEstimateId, id))
      .returning()
      .then((rows) => rows[0] ?? null);
  });
}

export function deleteInitialEstimate(
  id: string,
  dbInstance: Database = db,
): Promise<boolean> {
  return dbInstance
    .delete(initialEstimates)
    .where(eq(initialEstimates.initialEstimateId, id))
    .returning()
    .then((rows) => rows.length > 0);
}

// ====================================================================
// SOW
// ====================================================================

export interface SowLineItem {
  cloudProduct: string;
  module: string;
  category?: string;
  description?: string;
  customizationScope?: string;
}

export interface UpdateSowInput {
  cloudProduct?: string;
  module?: string;
  category?: string;
  description?: string;
  customizationScope?: string;
  version?: string;
  status?: "draft" | "confirmed" | "changed";
  linkedAssessmentVersionId?: string;
}

export function createSowDocument(
  input: {
    sowDocumentId: string;
    requirementPackId: string;
    cloudProduct: string;
    module: string;
    category: string;
    description: string;
    customizationScope?: string;
    ownerUserId?: string;
  },
  dbInstance: Database = db,
): Promise<SowDocumentRow> {
  return dbInstance
    .insert(sowDocuments)
    .values({
      sowDocumentId: input.sowDocumentId,
      requirementPackId: input.requirementPackId,
      cloudProduct: input.cloudProduct,
      module: input.module,
      category: input.category,
      description: input.description,
      customizationScope: input.customizationScope,
      version: "1.0",
      status: "draft",
      ownerUserId: input.ownerUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()
    .then((rows) => rows[0]);
}

export function findSowDocumentById(
  id: string,
  dbInstance: Database = db,
): Promise<SowDocumentRow | null> {
  return dbInstance
    .select()
    .from(sowDocuments)
    .where(eq(sowDocuments.sowDocumentId, id))
    .then((rows) => rows[0] ?? null);
}

export function findSowDocumentsByPackId(
  packId: string,
  dbInstance: Database = db,
): Promise<SowDocumentRow[]> {
  return dbInstance
    .select()
    .from(sowDocuments)
    .where(eq(sowDocuments.requirementPackId, packId))
    .orderBy(desc(sowDocuments.createdAt));
}

export function listSowDocumentsByOwner(
  ownerUserId: string,
  status: string | undefined,
  dbInstance: Database = db,
): Promise<SowDocumentRow[]> {
  const conds = [eq(sowDocuments.ownerUserId, ownerUserId)];
  if (status) {
    conds.push(eq(sowDocuments.status, status as any));
  }
  return dbInstance
    .select()
    .from(sowDocuments)
    .where(and(...conds))
    .orderBy(desc(sowDocuments.updatedAt));
}

export function updateSowDocument(
  id: string,
  input: UpdateSowInput,
  dbInstance: Database = db,
): Promise<SowDocumentRow | null> {
  return findSowDocumentById(id, dbInstance).then((existing) => {
    if (!existing) return null;

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.cloudProduct !== undefined) set.cloudProduct = input.cloudProduct;
    if (input.module !== undefined) set.module = input.module;
    if (input.category !== undefined) set.category = input.category;
    if (input.description !== undefined) set.description = input.description;
    if (input.customizationScope !== undefined) set.customizationScope = input.customizationScope;
    if (input.version !== undefined) set.version = input.version;
    if (input.status !== undefined) set.status = input.status;
    if (input.linkedAssessmentVersionId !== undefined) set.linkedAssessmentVersionId = input.linkedAssessmentVersionId;

    return dbInstance
      .update(sowDocuments)
      .set(set as any)
      .where(eq(sowDocuments.sowDocumentId, id))
      .returning()
      .then((rows) => rows[0] ?? null);
  });
}

export function deleteSowDocument(
  id: string,
  dbInstance: Database = db,
): Promise<boolean> {
  return dbInstance
    .delete(sowDocuments)
    .where(eq(sowDocuments.sowDocumentId, id))
    .returning()
    .then((rows) => rows.length > 0);
}

export function bumpSowVersion(
  packId: string,
  newVersion: string,
  dbInstance: Database = db,
): Promise<number> {
  return dbInstance
    .update(sowDocuments)
    .set({ version: newVersion, status: "changed", updatedAt: new Date() })
    .where(eq(sowDocuments.requirementPackId, packId))
    .returning()
    .then((result) => result.length);
}
