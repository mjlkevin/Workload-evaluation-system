// ============================================================
// AssessmentHandoff Service — 评估接力业务层
// ============================================================
// P1-3 核心服务：记录 IMPL → PM → PMO 的显式接力事件。

import { randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import { assessmentHandoffs } from "../../db/schema";
import type { AssessmentHandoffRow, AssessmentHandoffInsert } from "../../db/schema";

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

export class AssessmentHandoffService {
  constructor(private dbInstance: Database = db) {}

  async create(input: CreateHandoffInput): Promise<AssessmentHandoffRow> {
    const [row] = await this.dbInstance
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
      .returning();
    return row;
  }

  async findById(id: string): Promise<AssessmentHandoffRow | null> {
    const [row] = await this.dbInstance
      .select()
      .from(assessmentHandoffs)
      .where(eq(assessmentHandoffs.handoffId, id));
    return row ?? null;
  }

  async listByVersion(versionId: string): Promise<AssessmentHandoffRow[]> {
    return this.dbInstance
      .select()
      .from(assessmentHandoffs)
      .where(eq(assessmentHandoffs.assessmentVersionId, versionId))
      .orderBy(desc(assessmentHandoffs.createdAt));
  }

  async listByToRole(toRole: V2Role, status?: string): Promise<AssessmentHandoffRow[]> {
    const conds = [eq(assessmentHandoffs.toRole, toRole)];
    if (status) {
      // @ts-expect-error dynamic enum filter
      conds.push(eq(assessmentHandoffs.status, status));
    }
    return this.dbInstance
      .select()
      .from(assessmentHandoffs)
      .where(and(...conds))
      .orderBy(desc(assessmentHandoffs.createdAt));
  }

  async update(id: string, input: UpdateHandoffInput): Promise<AssessmentHandoffRow | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const set: Partial<AssessmentHandoffInsert> = { updatedAt: new Date() };
    if (input.acceptedByUserId !== undefined) set.acceptedByUserId = input.acceptedByUserId;
    if (input.status !== undefined) set.status = input.status;
    if (input.notes !== undefined) set.notes = input.notes;

    const [row] = await this.dbInstance
      .update(assessmentHandoffs)
      .set(set)
      .where(eq(assessmentHandoffs.handoffId, id))
      .returning();
    return row;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.dbInstance
      .delete(assessmentHandoffs)
      .where(eq(assessmentHandoffs.handoffId, id))
      .returning();
    return result.length > 0;
  }
}

export const assessmentHandoffService = new AssessmentHandoffService();
