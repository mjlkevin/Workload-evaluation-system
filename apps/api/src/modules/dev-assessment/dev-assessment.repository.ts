import { randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import { devAssessments, assessmentVersions } from "../../db/schema";
import type { DevAssessmentRow, DevAssessmentInsert, DevAssessmentItem, DevAssessmentDeployOpsItem } from "../../db/schema";

export interface DevAssessmentItemInput {
  itemId?: string;
  domain: string;
  module: string;
  brief?: string;
  description: string;
  devType: "feature" | "report" | "integration";
  basis?: string;
  codingDays: number;
  planningDays?: number;
  testingDays?: number;
  totalDays?: number;
}

export interface CreateDevAssessmentInput {
  assessmentVersionId?: string;
  contractMode?: "embedded" | "separate";
  items?: DevAssessmentItemInput[];
  deployOpsItems?: DevAssessmentDeployOpsItem[];
  assignedByUserId?: string;
  assessedByUserId?: string;
  contextSnapshot?: Record<string, unknown>;
  notes?: string;
}

export interface UpdateDevAssessmentInput {
  contractMode?: "embedded" | "separate";
  status?: "draft" | "in_progress" | "review_pending" | "confirmed" | "merged";
  items?: DevAssessmentItemInput[];
  deployOpsItems?: DevAssessmentDeployOpsItem[];
  assessedByUserId?: string;
  contextSnapshot?: Record<string, unknown>;
  notes?: string;
}

export interface MergeToVersionInput {
  mergedByUserId?: string;
}

export function createDevAssessment(
  input: CreateDevAssessmentInput,
  dbInstance: Database = db,
): Promise<DevAssessmentRow> {
  const items = normalizeItems(input.items);
  const deployOpsItems = normalizeDeployOpsItems(input.deployOpsItems);
  const totalDays = computeTotalDays(items, deployOpsItems);

  return dbInstance
    .insert(devAssessments)
    .values({
      devAssessmentId: randomUUID(),
      assessmentVersionId: input.assessmentVersionId,
      contractMode: input.contractMode ?? "embedded",
      status: "draft",
      items: items as any,
      deployOpsItems: deployOpsItems as any,
      totalDays,
      assignedByUserId: input.assignedByUserId,
      assessedByUserId: input.assessedByUserId,
      contextSnapshot: input.contextSnapshot ?? {},
      notes: input.notes,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as DevAssessmentInsert)
    .returning()
    .then((rows) => rows[0]);
}

export function findDevAssessmentById(
  id: string,
  dbInstance: Database = db,
): Promise<DevAssessmentRow | null> {
  return dbInstance
    .select()
    .from(devAssessments)
    .where(eq(devAssessments.devAssessmentId, id))
    .then((rows) => rows[0] ?? null);
}

export function listDevAssessmentsByVersionId(
  versionId: string,
  dbInstance: Database = db,
): Promise<DevAssessmentRow[]> {
  return dbInstance
    .select()
    .from(devAssessments)
    .where(eq(devAssessments.assessmentVersionId, versionId))
    .orderBy(desc(devAssessments.createdAt));
}

export function listDevAssessmentsByUser(
  userId: string,
  status: string | undefined,
  field: "assessedByUserId" | "assignedByUserId",
  dbInstance: Database = db,
): Promise<DevAssessmentRow[]> {
  const conds = [eq(devAssessments[field], userId)];
  if (status) {
    conds.push(eq(devAssessments.status, status as any));
  }
  return dbInstance
    .select()
    .from(devAssessments)
    .where(and(...conds))
    .orderBy(desc(devAssessments.createdAt));
}

export function updateDevAssessment(
  id: string,
  input: UpdateDevAssessmentInput,
  dbInstance: Database = db,
): Promise<DevAssessmentRow | null> {
  return findDevAssessmentById(id, dbInstance).then((existing) => {
    if (!existing) return null;

    const set: Partial<DevAssessmentInsert> = { updatedAt: new Date() };

    if (input.contractMode !== undefined) set.contractMode = input.contractMode;
    if (input.status !== undefined) set.status = input.status;
    if (input.assessedByUserId !== undefined) set.assessedByUserId = input.assessedByUserId;
    if (input.contextSnapshot !== undefined) set.contextSnapshot = input.contextSnapshot as any;
    if (input.notes !== undefined) set.notes = input.notes;

    let items = existing.items as unknown as DevAssessmentItem[];
    let deployOpsItems = (existing.deployOpsItems as unknown as DevAssessmentDeployOpsItem[]) ?? [];

    if (input.items !== undefined) {
      items = normalizeItems(input.items);
      set.items = items as any;
    }
    if (input.deployOpsItems !== undefined) {
      deployOpsItems = normalizeDeployOpsItems(input.deployOpsItems);
      set.deployOpsItems = deployOpsItems as any;
    }

    set.totalDays = computeTotalDays(items, deployOpsItems);

    return dbInstance
      .update(devAssessments)
      .set(set)
      .where(eq(devAssessments.devAssessmentId, id))
      .returning()
      .then((rows) => rows[0] ?? null);
  });
}

export function deleteDevAssessment(
  id: string,
  dbInstance: Database = db,
): Promise<boolean> {
  return dbInstance
    .delete(devAssessments)
    .where(eq(devAssessments.devAssessmentId, id))
    .returning()
    .then((rows) => rows.length > 0);
}

export function markDevAssessmentMerged(
  id: string,
  dbInstance: Database = db,
): Promise<void> {
  return dbInstance
    .update(devAssessments)
    .set({ status: "merged", updatedAt: new Date() })
    .where(eq(devAssessments.devAssessmentId, id))
    .then(() => undefined);
}

export function findAssessmentVersionPayload(
  versionId: string,
  dbInstance: Database = db,
): Promise<Record<string, unknown> | null> {
  return dbInstance
    .select()
    .from(assessmentVersions)
    .where(eq(assessmentVersions.assessmentVersionId, versionId))
    .then((rows) => {
      if (!rows.length) throw new Error("assessment_version_not_found");
      return (rows[0].payload as Record<string, unknown> | null) ?? {};
    });
}

export function updateAssessmentVersionPayload(
  versionId: string,
  payload: Record<string, unknown>,
  dbInstance: Database = db,
): Promise<void> {
  return dbInstance
    .update(assessmentVersions)
    .set({ payload: payload as any, updatedAt: new Date() })
    .where(eq(assessmentVersions.assessmentVersionId, versionId))
    .then(() => undefined);
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

export function calculateItemDerivedFields(item: DevAssessmentItemInput): DevAssessmentItem {
  const codingDays = Math.max(0, Number(item.codingDays) || 0);
  const planningDays = Math.round(codingDays * 0.2 * 10) / 10;
  const testingDays = Math.round(codingDays * 0.4 * 10) / 10;
  const totalDays = Math.round((codingDays + planningDays + testingDays) * 10) / 10;
  return { ...item, codingDays, planningDays, testingDays, totalDays };
}

export function normalizeItems(items: DevAssessmentItemInput[] | undefined): DevAssessmentItem[] {
  if (!Array.isArray(items)) return [];
  return items.map(calculateItemDerivedFields);
}

export function normalizeDeployOpsItems(items: DevAssessmentDeployOpsItem[] | undefined): DevAssessmentDeployOpsItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((it) => ({ ...it, days: Math.max(0, Number(it.days) || 0) }));
}

export function computeTotalDays(items: DevAssessmentItem[], deployOpsItems: DevAssessmentDeployOpsItem[]): number {
  const devTotal = items.reduce((sum, it) => sum + (Number(it.totalDays) || 0), 0);
  const opsTotal = deployOpsItems.reduce((sum, it) => sum + (Number(it.days) || 0), 0);
  return Math.round((devTotal + opsTotal) * 10) / 10;
}
