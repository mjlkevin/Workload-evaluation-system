import { randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import {
  changeSubmissions,
  opportunityBriefs,
  requirementPacks,
  assessmentVersions,
} from "../../db/schema";
import type { ChangeSubmissionRow, ChangeSubmissionInsert } from "../../db/schema";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface DiffItemAdded {
  field: string;
  value: unknown;
}

export interface DiffItemRemoved {
  field: string;
  oldValue: unknown;
}

export interface DiffItemModified {
  field: string;
  before: unknown;
  after: unknown;
}

export interface DiffResult {
  added: DiffItemAdded[];
  removed: DiffItemRemoved[];
  modified: DiffItemModified[];
}

export interface SubmitChangeInput {
  parentEntityType: "opportunity_brief" | "requirement_pack" | "assessment_version";
  parentEntityId: string;
  changeDescription: string;
  submittedByUserId?: string;
}

export interface RejectInput {
  reviewedByUserId?: string;
}

// ------------------------------------------------------------------
// Parent entity snapshot
// ------------------------------------------------------------------

export function fetchParentSnapshot(
  type: SubmitChangeInput["parentEntityType"],
  id: string,
  dbInstance: Database = db,
): Promise<Record<string, unknown> | null> {
  switch (type) {
    case "opportunity_brief":
      return dbInstance
        .select()
        .from(opportunityBriefs)
        .where(eq(opportunityBriefs.opportunityBriefId, id))
        .then((rows) => (rows[0] ? (rows[0] as unknown as Record<string, unknown>) : null));
    case "requirement_pack":
      return dbInstance
        .select()
        .from(requirementPacks)
        .where(eq(requirementPacks.requirementPackId, id))
        .then((rows) => (rows[0] ? (rows[0] as unknown as Record<string, unknown>) : null));
    case "assessment_version":
      return dbInstance
        .select()
        .from(assessmentVersions)
        .where(eq(assessmentVersions.assessmentVersionId, id))
        .then((rows) => (rows[0] ? (rows[0] as unknown as Record<string, unknown>) : null));
    default:
      return Promise.resolve(null);
  }
}

// ------------------------------------------------------------------
// ChangeSubmission CRUD
// ------------------------------------------------------------------

export function createChangeSubmission(
  input: {
    parentEntityType: string;
    parentEntityId: string;
    changeDescription: string;
    diffResult?: DiffResult;
    newEstimate?: Record<string, unknown>;
    submittedByUserId?: string;
  },
  dbInstance: Database = db,
): Promise<ChangeSubmissionRow> {
  return dbInstance
    .insert(changeSubmissions)
    .values({
      changeSubmissionId: randomUUID(),
      parentEntityType: input.parentEntityType,
      parentEntityId: input.parentEntityId,
      changeDescription: input.changeDescription,
      diffResult: input.diffResult as any,
      newEstimate: input.newEstimate as any,
      submittedByUserId: input.submittedByUserId,
      status: "submitted",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ChangeSubmissionInsert)
    .returning()
    .then((rows) => rows[0]);
}

export function findChangeSubmissionById(
  id: string,
  dbInstance: Database = db,
): Promise<ChangeSubmissionRow | null> {
  return dbInstance
    .select()
    .from(changeSubmissions)
    .where(eq(changeSubmissions.changeSubmissionId, id))
    .then((rows) => rows[0] ?? null);
}

export function listChangeSubmissionsByParent(
  parentEntityType: string,
  parentEntityId: string,
  dbInstance: Database = db,
): Promise<ChangeSubmissionRow[]> {
  return dbInstance
    .select()
    .from(changeSubmissions)
    .where(
      and(
        eq(changeSubmissions.parentEntityType, parentEntityType as any),
        eq(changeSubmissions.parentEntityId, parentEntityId),
      ),
    )
    .orderBy(desc(changeSubmissions.createdAt));
}

export function listChangeSubmissionsBySubmitter(
  submittedByUserId: string,
  dbInstance: Database = db,
): Promise<ChangeSubmissionRow[]> {
  return dbInstance
    .select()
    .from(changeSubmissions)
    .where(eq(changeSubmissions.submittedByUserId, submittedByUserId))
    .orderBy(desc(changeSubmissions.createdAt));
}

export function markChangeSubmissionMerged(
  changeSubmissionId: string,
  targetVersionId: string,
  mergedByUserId: string | undefined,
  dbInstance: Database = db,
): Promise<ChangeSubmissionRow | null> {
  return dbInstance
    .update(changeSubmissions)
    .set({
      status: "merged",
      mergedToVersionId: targetVersionId,
      reviewedByUserId: mergedByUserId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(changeSubmissions.changeSubmissionId, changeSubmissionId))
    .returning()
    .then((rows) => rows[0] ?? null);
}

export function markChangeSubmissionRejected(
  changeSubmissionId: string,
  reviewedByUserId: string | undefined,
  dbInstance: Database = db,
): Promise<ChangeSubmissionRow | null> {
  return dbInstance
    .update(changeSubmissions)
    .set({
      status: "rejected",
      reviewedByUserId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(changeSubmissions.changeSubmissionId, changeSubmissionId))
    .returning()
    .then((rows) => rows[0] ?? null);
}

// ------------------------------------------------------------------
// Assessment version payload merge
// ------------------------------------------------------------------

export function findAssessmentVersionPayload(
  versionId: string,
  dbInstance: Database = db,
): Promise<Record<string, unknown>> {
  return dbInstance
    .select()
    .from(assessmentVersions)
    .where(eq(assessmentVersions.assessmentVersionId, versionId))
    .then((rows) => {
      if (!rows.length) throw new Error("assessment_version_not_found");
      return (rows[0].payload as Record<string, unknown> | null) ?? {};
    });
}

export function appendChangeToVersionPayload(
  versionId: string,
  existingPayload: Record<string, unknown>,
  changeEntry: Record<string, unknown>,
  dbInstance: Database = db,
): Promise<void> {
  const changeSubmissionsList = (existingPayload.changeSubmissions ?? []) as Array<Record<string, unknown>>;
  changeSubmissionsList.push(changeEntry);

  return dbInstance
    .update(assessmentVersions)
    .set({
      payload: { ...existingPayload, changeSubmissions: changeSubmissionsList } as any,
      updatedAt: new Date(),
    })
    .where(eq(assessmentVersions.assessmentVersionId, versionId))
    .then(() => undefined);
}
