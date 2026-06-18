// ============================================================
// SealedBaseline Service — 封版基线业务层
// ============================================================
// P1-3 核心服务：成交后锁定评估基线，后续变更强制走新版本或变更单。
// 封版后向下游合同系统推送（单向事件）。

import { randomUUID } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import { sealedBaselines } from "../../db/schema";
import type { SealedBaselineRow, SealedBaselineInsert } from "../../db/schema";

export interface SealInput {
  assessmentVersionId: string;
  sealedByUserId?: string;
  artifactsSnapshot?: Record<string, unknown>;
  contractFlowId?: string;
  sealReason?: string;
}

export class SealedBaselineService {
  constructor(private dbInstance: Database = db) {}

  async seal(input: SealInput): Promise<SealedBaselineRow> {
    const [row] = await this.dbInstance
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
      .returning();
    return row;
  }

  async findById(id: string): Promise<SealedBaselineRow | null> {
    const [row] = await this.dbInstance.select().from(sealedBaselines).where(eq(sealedBaselines.sealedBaselineId, id));
    return row ?? null;
  }

  async findByVersionId(versionId: string): Promise<SealedBaselineRow | null> {
    const [row] = await this.dbInstance
      .select()
      .from(sealedBaselines)
      .where(eq(sealedBaselines.assessmentVersionId, versionId))
      .orderBy(desc(sealedBaselines.createdAt));
    return row ?? null;
  }

  async listByStatus(status: "sealed" | "superseded"): Promise<SealedBaselineRow[]> {
    return this.dbInstance
      .select()
      .from(sealedBaselines)
      .where(eq(sealedBaselines.status, status))
      .orderBy(desc(sealedBaselines.createdAt));
  }

  async supersede(id: string): Promise<SealedBaselineRow | null> {
    const [row] = await this.dbInstance
      .update(sealedBaselines)
      .set({ status: "superseded", updatedAt: new Date() })
      .where(eq(sealedBaselines.sealedBaselineId, id))
      .returning();
    return row ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.dbInstance.delete(sealedBaselines).where(eq(sealedBaselines.sealedBaselineId, id)).returning();
    return result.length > 0;
  }
}

export const sealedBaselineService = new SealedBaselineService();
