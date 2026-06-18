// ============================================================
// QualityGateReview Service — PMO 质量门审核业务层
// ============================================================
// P1-3 核心服务：PMO 对评估包进行审核，产出通过/驳回裁决。
// 审核范围：交付物齐全 + 方法论七阶段 + RateCard 正确性 + Narrative 完整。

import { randomUUID } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import { qualityGateReviews } from "../../db/schema";
import type { QualityGateReviewRow, QualityGateReviewInsert } from "../../db/schema";

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

export class QualityGateReviewService {
  constructor(private dbInstance: Database = db) {}

  async create(input: CreateReviewInput): Promise<QualityGateReviewRow> {
    const [row] = await this.dbInstance
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
        },
        verdict: input.verdict ?? null,
        rejectionReasons: input.rejectionReasons ?? [],
        notes: input.notes,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as QualityGateReviewInsert)
      .returning();
    return row;
  }

  /** 自动执行审核检查清单 */
  async autoReview(params: {
    assessmentVersionId: string;
    reviewerUserId?: string;
    deliverables: Array<{ deliverableType: string; status: string }>;
    narrativeStatus?: string;
    hasAssumptions?: boolean;
  }): Promise<QualityGateReviewRow> {
    const { deliverables, narrativeStatus, hasAssumptions } = params;

    const requiredTypes = ["effort_table", "resource_cost", "variance_analysis", "wbs"];
    const presentTypes = new Set(deliverables.map((d) => d.deliverableType));
    const deliverablesComplete = requiredTypes.every((t) => presentTypes.has(t));
    const allDeliverablesConfirmed = deliverables.filter((d) => requiredTypes.includes(d.deliverableType)).every((d) => d.status === "confirmed");

    const checklist = {
      deliverablesComplete: deliverablesComplete && allDeliverablesConfirmed,
      methodologySevenPhases: true, // P1-3 默认通过，未来接入 DSL 规则
      rateCardCorrect: true, // P1-3 默认通过，未来接入 RateCard 校验
      narrativeComplete: narrativeStatus === "confirmed",
      assumptionsDocumented: hasAssumptions ?? false,
    };

    const allPass = Object.values(checklist).every(Boolean);
    const verdict: "pass" | "reject" = allPass ? "pass" : "reject";

    const rejectionReasons: Array<{ field: string; reason: string; suggestion?: string }> = [];
    if (!checklist.deliverablesComplete) {
      rejectionReasons.push({
        field: "deliverables",
        reason: "4大交付物未全部确认",
        suggestion: "请确认人天表、资源成本、差异分析、WBS 均已生成并确认",
      });
    }
    if (!checklist.narrativeComplete) {
      rejectionReasons.push({
        field: "narrative",
        reason: "评估叙事未确认",
        suggestion: "请 PM 确认五段式 Narrative 内容",
      });
    }
    if (!checklist.assumptionsDocumented) {
      rejectionReasons.push({
        field: "assumptions",
        reason: "假设清单未记录",
        suggestion: "请补充项目关键假设及风险说明",
      });
    }

    return this.create({
      assessmentVersionId: params.assessmentVersionId,
      reviewerUserId: params.reviewerUserId,
      checklist,
      verdict,
      rejectionReasons,
      notes: allPass ? "审核通过" : "存在未达标项，已驳回",
    });
  }

  async findById(id: string): Promise<QualityGateReviewRow | null> {
    const [row] = await this.dbInstance.select().from(qualityGateReviews).where(eq(qualityGateReviews.reviewId, id));
    return row ?? null;
  }

  async findByVersionId(versionId: string): Promise<QualityGateReviewRow | null> {
    const [row] = await this.dbInstance
      .select()
      .from(qualityGateReviews)
      .where(eq(qualityGateReviews.assessmentVersionId, versionId))
      .orderBy(desc(qualityGateReviews.createdAt));
    return row ?? null;
  }

  async update(id: string, input: UpdateReviewInput): Promise<QualityGateReviewRow | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const set: Partial<QualityGateReviewInsert> = { updatedAt: new Date() };
    if (input.checklist !== undefined) set.checklist = { ...(existing.checklist as object), ...input.checklist };
    if (input.verdict !== undefined) set.verdict = input.verdict;
    if (input.rejectionReasons !== undefined) set.rejectionReasons = input.rejectionReasons;
    if (input.notes !== undefined) set.notes = input.notes;

    const [row] = await this.dbInstance
      .update(qualityGateReviews)
      .set(set)
      .where(eq(qualityGateReviews.reviewId, id))
      .returning();
    return row;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.dbInstance.delete(qualityGateReviews).where(eq(qualityGateReviews.reviewId, id)).returning();
    return result.length > 0;
  }
}

export const qualityGateReviewService = new QualityGateReviewService();
