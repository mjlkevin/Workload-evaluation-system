// ============================================================
// Deliverable Service — 4大交付物业务层
// ============================================================
// P1-3 核心服务：从 AssessmentVersion 派生人天表 / 资源成本 / 差异分析 / WBS。

import { randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import { deliverables } from "../../db/schema";
import type { DeliverableRow, DeliverableInsert } from "../../db/schema";

export type DeliverableType = "effort_table" | "resource_cost" | "variance_analysis" | "wbs";

export interface GenerateDeliverablesInput {
  assessmentVersionId: string;
  effortEstimate?: Array<{ module: string; days: number; basis: string }>;
  riskTags?: string[];
  assumptions?: Array<{ assumption: string; rationale: string; riskIfInvalid: string }>;
  phaseProposal?: Array<{ phase: string; modules: string[]; estimatedDays: number; milestone: string }>;
  varianceBaseline?: "initial_estimate" | "bid_baseline" | "historical_avg" | "customer_budget";
}

export class DeliverableService {
  constructor(private dbInstance: Database = db) {}

  async generateAll(input: GenerateDeliverablesInput): Promise<DeliverableRow[]> {
    const results: DeliverableRow[] = [];
    results.push(await this._generateEffortTable(input));
    results.push(await this._generateResourceCost(input));
    results.push(await this._generateVarianceAnalysis(input));
    results.push(await this._generateWbs(input));
    return results;
  }

  async findById(id: string): Promise<DeliverableRow | null> {
    const [row] = await this.dbInstance.select().from(deliverables).where(eq(deliverables.deliverableId, id));
    return row ?? null;
  }

  async listByVersion(versionId: string): Promise<DeliverableRow[]> {
    return this.dbInstance
      .select()
      .from(deliverables)
      .where(eq(deliverables.assessmentVersionId, versionId))
      .orderBy(desc(deliverables.createdAt));
  }

  async listByVersionAndType(versionId: string, type: DeliverableType): Promise<DeliverableRow | null> {
    const [row] = await this.dbInstance
      .select()
      .from(deliverables)
      .where(and(eq(deliverables.assessmentVersionId, versionId), eq(deliverables.deliverableType, type)));
    return row ?? null;
  }

  async updateStatus(id: string, status: "draft" | "confirmed"): Promise<DeliverableRow | null> {
    const [row] = await this.dbInstance
      .update(deliverables)
      .set({ status, updatedAt: new Date() })
      .where(eq(deliverables.deliverableId, id))
      .returning();
    return row ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.dbInstance.delete(deliverables).where(eq(deliverables.deliverableId, id)).returning();
    return result.length > 0;
  }

  // ------------------------------------------------------------------
  // Private generators
  // ------------------------------------------------------------------

  private async _generateEffortTable(input: GenerateDeliverablesInput): Promise<DeliverableRow> {
    const effort = input.effortEstimate ?? [];
    const totalDays = effort.reduce((sum, e) => sum + e.days, 0);
    const [row] = await this.dbInstance
      .insert(deliverables)
      .values({
        deliverableId: randomUUID(),
        assessmentVersionId: input.assessmentVersionId,
        deliverableType: "effort_table",
        content: {
          title: "人天估算表",
          items: effort,
          totalDays,
          summary: `合计 ${totalDays} 人天，覆盖 ${effort.length} 个模块。`,
        },
        generatedFrom: "auto",
        status: "draft",
        varianceBaseline: input.varianceBaseline,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as DeliverableInsert)
      .returning();
    return row;
  }

  private async _generateResourceCost(input: GenerateDeliverablesInput): Promise<DeliverableRow> {
    const effort = input.effortEstimate ?? [];
    const ratePerDay = 3000; // 默认人天单价，可由 RateCard 替换
    const items = effort.map((e) => ({
      module: e.module,
      days: e.days,
      rate: ratePerDay,
      cost: e.days * ratePerDay,
    }));
    const totalCost = items.reduce((sum, i) => sum + i.cost, 0);

    const [row] = await this.dbInstance
      .insert(deliverables)
      .values({
        deliverableId: randomUUID(),
        assessmentVersionId: input.assessmentVersionId,
        deliverableType: "resource_cost",
        content: {
          title: "资源人天成本表",
          items,
          totalCost,
          ratePerDay,
          summary: `按单价 ¥${ratePerDay}/人天，合计 ¥${totalCost.toLocaleString()}。`,
        },
        generatedFrom: "auto",
        status: "draft",
        varianceBaseline: input.varianceBaseline,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as DeliverableInsert)
      .returning();
    return row;
  }

  private async _generateVarianceAnalysis(input: GenerateDeliverablesInput): Promise<DeliverableRow> {
    const effort = input.effortEstimate ?? [];
    const totalDays = effort.reduce((sum, e) => sum + e.days, 0);
    // 简单模拟：与初始估算是同一来源，差异为 0；未来接入历史样本 P80
    const baselineDays = totalDays;
    const variance = totalDays - baselineDays;

    const [row] = await this.dbInstance
      .insert(deliverables)
      .values({
        deliverableId: randomUUID(),
        assessmentVersionId: input.assessmentVersionId,
        deliverableType: "variance_analysis",
        content: {
          title: "差异分析表",
          baseline: input.varianceBaseline ?? "initial_estimate",
          baselineDays,
          currentDays: totalDays,
          variance,
          variancePercent: baselineDays > 0 ? Math.round((variance / baselineDays) * 10000) / 100 : 0,
          summary: variance === 0 ? "与基线一致，无显著差异。" : `差异 ${variance} 人天（${Math.round((variance / baselineDays) * 100)}%）。`,
        },
        generatedFrom: "auto",
        status: "draft",
        varianceBaseline: input.varianceBaseline,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as DeliverableInsert)
      .returning();
    return row;
  }

  private async _generateWbs(input: GenerateDeliverablesInput): Promise<DeliverableRow> {
    const phases = input.phaseProposal ?? [];
    const wbsItems = phases.map((p, idx) => ({
      wbsCode: `1.${idx + 1}`,
      name: p.phase,
      modules: p.modules,
      estimatedDays: p.estimatedDays,
      milestone: p.milestone,
    }));

    const [row] = await this.dbInstance
      .insert(deliverables)
      .values({
        deliverableId: randomUUID(),
        assessmentVersionId: input.assessmentVersionId,
        deliverableType: "wbs",
        content: {
          title: "WBS 工作分解结构",
          items: wbsItems,
          summary: `共 ${wbsItems.length} 个阶段，覆盖 ${wbsItems.reduce((sum, i) => sum + i.modules.length, 0)} 个模块。`,
        },
        generatedFrom: "auto",
        status: "draft",
        varianceBaseline: input.varianceBaseline,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as DeliverableInsert)
      .returning();
    return row;
  }
}

export const deliverableService = new DeliverableService();
