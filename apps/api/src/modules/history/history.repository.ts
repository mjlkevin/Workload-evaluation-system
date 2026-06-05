import { randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import { historyProjects } from "../../db/schema";
import type { HistoryProjectRow, HistoryProjectInsert } from "../../db/schema";

export interface CreateHistoryProjectInput {
  industry: string;
  scale: string;
  modules?: string[];
  estimatedDays: number;
  actualDays?: number;
  estimatedCost?: number;
  actualCost?: number;
  delayReason?: string;
  riskTags?: string[];
  sourceAssessmentVersionId?: string;
  sourceSealedBaselineId?: string;
  closedAt?: Date;
}

export interface UpdateHistoryProjectInput {
  industry?: string;
  scale?: string;
  modules?: string[];
  estimatedDays?: number;
  actualDays?: number;
  estimatedCost?: number;
  actualCost?: number;
  delayReason?: string;
  riskTags?: string[];
  closedAt?: Date;
}

export interface ListHistoryProjectsOpts {
  industry?: string;
  scale?: string;
  limit?: number;
  offset?: number;
}

export function createHistoryProject(
  input: CreateHistoryProjectInput,
  dbInstance: Database = db,
): Promise<HistoryProjectRow> {
  return dbInstance
    .insert(historyProjects)
    .values({
      historyProjectId: randomUUID(),
      industry: input.industry,
      scale: input.scale,
      modules: input.modules ?? [],
      estimatedDays: input.estimatedDays,
      actualDays: input.actualDays ?? null,
      estimatedCost: input.estimatedCost ?? null,
      actualCost: input.actualCost ?? null,
      delayReason: input.delayReason ?? null,
      riskTags: input.riskTags ?? [],
      sourceAssessmentVersionId: input.sourceAssessmentVersionId ?? null,
      sourceSealedBaselineId: input.sourceSealedBaselineId ?? null,
      closedAt: input.closedAt ?? new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as HistoryProjectInsert)
    .returning()
    .then((rows) => rows[0]);
}

export function findHistoryProjectById(
  id: string,
  dbInstance: Database = db,
): Promise<HistoryProjectRow | null> {
  return dbInstance
    .select()
    .from(historyProjects)
    .where(eq(historyProjects.historyProjectId, id))
    .then((rows) => rows[0] ?? null);
}

export function updateHistoryProject(
  id: string,
  input: UpdateHistoryProjectInput,
  dbInstance: Database = db,
): Promise<HistoryProjectRow | null> {
  const set: Partial<HistoryProjectInsert> = { updatedAt: new Date() };
  if (input.industry !== undefined) set.industry = input.industry;
  if (input.scale !== undefined) set.scale = input.scale;
  if (input.modules !== undefined) set.modules = input.modules;
  if (input.estimatedDays !== undefined) set.estimatedDays = input.estimatedDays;
  if (input.actualDays !== undefined) set.actualDays = input.actualDays;
  if (input.estimatedCost !== undefined) set.estimatedCost = input.estimatedCost;
  if (input.actualCost !== undefined) set.actualCost = input.actualCost;
  if (input.delayReason !== undefined) set.delayReason = input.delayReason;
  if (input.riskTags !== undefined) set.riskTags = input.riskTags;
  if (input.closedAt !== undefined) set.closedAt = input.closedAt;

  return dbInstance
    .update(historyProjects)
    .set(set)
    .where(eq(historyProjects.historyProjectId, id))
    .returning()
    .then((rows) => rows[0] ?? null);
}

export function deleteHistoryProject(
  id: string,
  dbInstance: Database = db,
): Promise<boolean> {
  return dbInstance
    .delete(historyProjects)
    .where(eq(historyProjects.historyProjectId, id))
    .returning()
    .then((rows) => rows.length > 0);
}

export function listHistoryProjects(
  opts: ListHistoryProjectsOpts = {},
  dbInstance: Database = db,
): Promise<HistoryProjectRow[]> {
  const limit = Math.max(1, Math.min(100, opts.limit ?? 20));
  const offset = Math.max(0, opts.offset ?? 0);

  let query = dbInstance.select().from(historyProjects).$dynamic();
  const conditions = [];
  if (opts.industry) conditions.push(eq(historyProjects.industry, opts.industry));
  if (opts.scale) conditions.push(eq(historyProjects.scale, opts.scale));
  if (conditions.length > 0) query = query.where(and(...conditions));

  return query.orderBy(desc(historyProjects.createdAt)).limit(limit).offset(offset);
}

export function listAllHistoryProjects(dbInstance: Database = db): Promise<HistoryProjectRow[]> {
  return dbInstance.select().from(historyProjects);
}
