import { randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import { opportunityBriefs } from "../../db/schema";
import type { OpportunityBriefRow, OpportunityBriefInsert } from "../../db/schema";

export interface CreateBriefInput {
  customerName: string;
  customerProfile?: Record<string, unknown>;
  vagueRequirements?: string;
  extractedSignals?: Array<{ signal: string; weight: number }>;
  ownerUserId?: string;
}

export interface UpdateBriefInput {
  customerName?: string;
  customerProfile?: Record<string, unknown>;
  vagueRequirements?: string;
  extractedSignals?: Array<{ signal: string; weight: number }>;
  status?: "open" | "converted" | "abandoned";
  linkedRequirementPackId?: string;
}

export function createBrief(
  input: CreateBriefInput,
  dbInstance: Database = db,
): Promise<OpportunityBriefRow> {
  return dbInstance
    .insert(opportunityBriefs)
    .values({
      opportunityBriefId: randomUUID(),
      customerName: input.customerName,
      customerProfile: input.customerProfile ?? {},
      vagueRequirements: input.vagueRequirements,
      extractedSignals: input.extractedSignals ?? [],
      priceRange: null,
      phaseProposal: [],
      status: "open",
      ownerUserId: input.ownerUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as OpportunityBriefInsert)
    .returning()
    .then((rows) => rows[0]);
}

export function findBriefById(
  id: string,
  dbInstance: Database = db,
): Promise<OpportunityBriefRow | null> {
  return dbInstance
    .select()
    .from(opportunityBriefs)
    .where(eq(opportunityBriefs.opportunityBriefId, id))
    .then((rows) => rows[0] ?? null);
}

export function listBriefsByOwner(
  ownerUserId: string,
  status: string | undefined,
  dbInstance: Database = db,
): Promise<OpportunityBriefRow[]> {
  const conds = [eq(opportunityBriefs.ownerUserId, ownerUserId)];
  if (status) {
    conds.push(eq(opportunityBriefs.status, status as any));
  }
  return dbInstance
    .select()
    .from(opportunityBriefs)
    .where(and(...conds))
    .orderBy(desc(opportunityBriefs.updatedAt));
}

export function updateBrief(
  id: string,
  input: UpdateBriefInput,
  dbInstance: Database = db,
): Promise<OpportunityBriefRow | null> {
  return findBriefById(id, dbInstance).then((existing) => {
    if (!existing) return null;

    const set: Partial<OpportunityBriefInsert> = { updatedAt: new Date() };
    if (input.customerName !== undefined) set.customerName = input.customerName;
    if (input.customerProfile !== undefined) set.customerProfile = input.customerProfile;
    if (input.vagueRequirements !== undefined) set.vagueRequirements = input.vagueRequirements;
    if (input.extractedSignals !== undefined) set.extractedSignals = input.extractedSignals;
    if (input.status !== undefined) set.status = input.status;
    if (input.linkedRequirementPackId !== undefined) set.linkedRequirementPackId = input.linkedRequirementPackId;

    return dbInstance
      .update(opportunityBriefs)
      .set(set)
      .where(eq(opportunityBriefs.opportunityBriefId, id))
      .returning()
      .then((rows) => rows[0] ?? null);
  });
}

export function deleteBrief(
  id: string,
  dbInstance: Database = db,
): Promise<boolean> {
  return dbInstance
    .delete(opportunityBriefs)
    .where(eq(opportunityBriefs.opportunityBriefId, id))
    .returning()
    .then((rows) => rows.length > 0);
}

export function updateBriefPricing(
  id: string,
  priceRange: unknown,
  phaseProposal: unknown,
  dbInstance: Database = db,
): Promise<OpportunityBriefRow | null> {
  return dbInstance
    .update(opportunityBriefs)
    .set({
      priceRange: priceRange as any,
      phaseProposal: phaseProposal as any,
      updatedAt: new Date(),
    })
    .where(eq(opportunityBriefs.opportunityBriefId, id))
    .returning()
    .then((rows) => rows[0] ?? null);
}
