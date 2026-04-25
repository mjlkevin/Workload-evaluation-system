// ============================================================
// DevAssessment Service — 开发评估业务层（P2-2）
// ============================================================
// 开发顾问独立工作面：CRUD + 自动计算 + 合并到总评估。

import { randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import { devAssessments, assessmentVersions } from "../../db/schema";
import type { DevAssessmentRow, DevAssessmentInsert, DevAssessmentItem, DevAssessmentDeployOpsItem } from "../../db/schema";
import { generateDevAssessmentDraft } from "./dev-assessment-ai";
import type { GenerateDevAssessmentDraftResult } from "./dev-assessment-ai";

// ------------------------------------------------------------------
// Input types
// ------------------------------------------------------------------

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

// ------------------------------------------------------------------
// 自动计算 helpers
// ------------------------------------------------------------------

function calculateItemDerivedFields(item: DevAssessmentItemInput): DevAssessmentItem {
  const codingDays = Math.max(0, Number(item.codingDays) || 0);
  const planningDays = Math.round(codingDays * 0.2 * 10) / 10;
  const testingDays = Math.round(codingDays * 0.4 * 10) / 10;
  const totalDays = Math.round((codingDays + planningDays + testingDays) * 10) / 10;
  return {
    ...item,
    codingDays,
    planningDays,
    testingDays,
    totalDays,
  };
}

function normalizeItems(items: DevAssessmentItemInput[] | undefined): DevAssessmentItem[] {
  if (!Array.isArray(items)) return [];
  return items.map(calculateItemDerivedFields);
}

function normalizeDeployOpsItems(items: DevAssessmentDeployOpsItem[] | undefined): DevAssessmentDeployOpsItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((it) => ({
    ...it,
    days: Math.max(0, Number(it.days) || 0),
  }));
}

function computeTotalDays(items: DevAssessmentItem[], deployOpsItems: DevAssessmentDeployOpsItem[]): number {
  const devTotal = items.reduce((sum, it) => sum + (Number(it.totalDays) || 0), 0);
  const opsTotal = deployOpsItems.reduce((sum, it) => sum + (Number(it.days) || 0), 0);
  return Math.round((devTotal + opsTotal) * 10) / 10;
}

// ------------------------------------------------------------------
// Service
// ------------------------------------------------------------------

export class DevAssessmentService {
  constructor(private dbInstance: Database = db) {}

  async create(input: CreateDevAssessmentInput): Promise<DevAssessmentRow> {
    const items = normalizeItems(input.items);
    const deployOpsItems = normalizeDeployOpsItems(input.deployOpsItems);
    const totalDays = computeTotalDays(items, deployOpsItems);

    const [row] = await this.dbInstance
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
      .returning();
    return row;
  }

  async findById(id: string): Promise<DevAssessmentRow | null> {
    const [row] = await this.dbInstance
      .select()
      .from(devAssessments)
      .where(eq(devAssessments.devAssessmentId, id));
    return row ?? null;
  }

  async listByVersionId(versionId: string): Promise<DevAssessmentRow[]> {
    return this.dbInstance
      .select()
      .from(devAssessments)
      .where(eq(devAssessments.assessmentVersionId, versionId))
      .orderBy(desc(devAssessments.createdAt));
  }

  async listByAssessedBy(userId: string, status?: string): Promise<DevAssessmentRow[]> {
    const conds = [eq(devAssessments.assessedByUserId, userId)];
    if (status) {
      // @ts-expect-error dynamic enum filter
      conds.push(eq(devAssessments.status, status));
    }
    return this.dbInstance
      .select()
      .from(devAssessments)
      .where(and(...conds))
      .orderBy(desc(devAssessments.createdAt));
  }

  async listByAssignedBy(userId: string, status?: string): Promise<DevAssessmentRow[]> {
    const conds = [eq(devAssessments.assignedByUserId, userId)];
    if (status) {
      // @ts-expect-error dynamic enum filter
      conds.push(eq(devAssessments.status, status));
    }
    return this.dbInstance
      .select()
      .from(devAssessments)
      .where(and(...conds))
      .orderBy(desc(devAssessments.createdAt));
  }

  async update(id: string, input: UpdateDevAssessmentInput): Promise<DevAssessmentRow | null> {
    const existing = await this.findById(id);
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

    const [row] = await this.dbInstance
      .update(devAssessments)
      .set(set)
      .where(eq(devAssessments.devAssessmentId, id))
      .returning();
    return row;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.dbInstance
      .delete(devAssessments)
      .where(eq(devAssessments.devAssessmentId, id))
      .returning();
    return result.length > 0;
  }

  /**
   * AI 生成开发评估草稿。
   * 调用 Kimi 为每个条目估算 codingDays，失败时规则兜底。
   */
  async generateDraft(id: string): Promise<{ devAssessment: DevAssessmentRow; aiResult: GenerateDevAssessmentDraftResult } | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const currentItems = (existing.items as unknown as DevAssessmentItem[]) ?? [];
    const aiResult = await generateDevAssessmentDraft({
      items: currentItems,
      contextSnapshot: existing.contextSnapshot as Record<string, unknown> | undefined,
    });

    const updated = await this.update(id, {
      items: aiResult.items,
      status: "in_progress",
    });

    return { devAssessment: updated!, aiResult };
  }

  /**
   * 将开发评估合并到总评估版本。
   * 更新 dev_assessment.status = merged，
   * 并将 dev 数据写入 assessment_versions.payload.devAssessment。
   */
  async mergeToVersion(id: string, input: MergeToVersionInput): Promise<{ devAssessment: DevAssessmentRow; mergedPayload: Record<string, unknown> } | null> {
    const devAssessment = await this.findById(id);
    if (!devAssessment) return null;
    if (!devAssessment.assessmentVersionId) {
      throw new Error("dev_assessment_not_linked_to_version");
    }

    // 1. 更新 dev_assessment 状态
    await this.dbInstance
      .update(devAssessments)
      .set({ status: "merged", updatedAt: new Date() })
      .where(eq(devAssessments.devAssessmentId, id));

    // 2. 读取当前 assessment_version payload
    const [version] = await this.dbInstance
      .select()
      .from(assessmentVersions)
      .where(eq(assessmentVersions.assessmentVersionId, devAssessment.assessmentVersionId));

    if (!version) {
      throw new Error("assessment_version_not_found");
    }

    // 3. 构造合并后的 payload
    const existingPayload = (version.payload as Record<string, unknown> | null) ?? {};
    const mergedPayload: Record<string, unknown> = {
      ...existingPayload,
      devAssessment: {
        devAssessmentId: devAssessment.devAssessmentId,
        contractMode: devAssessment.contractMode,
        items: devAssessment.items,
        deployOpsItems: devAssessment.deployOpsItems,
        totalDays: devAssessment.totalDays,
        assessedByUserId: devAssessment.assessedByUserId,
        mergedAt: new Date().toISOString(),
        mergedByUserId: input.mergedByUserId,
      },
    };

    // 4. 写回 assessment_versions
    await this.dbInstance
      .update(assessmentVersions)
      .set({ payload: mergedPayload as any, updatedAt: new Date() })
      .where(eq(assessmentVersions.assessmentVersionId, devAssessment.assessmentVersionId));

    const updated = await this.findById(id);
    return { devAssessment: updated!, mergedPayload };
  }
}

export const devAssessmentService = new DevAssessmentService();
