// ============================================================
// AssessmentNarrative Service — 评估叙事（五段式）业务层
// ============================================================
// P1-3 核心服务：从评估版本自动生成五段式 Narrative，支持 PM 编辑。

import { randomUUID } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import { assessmentNarratives } from "../../db/schema";
import type { AssessmentNarrativeRow, AssessmentNarrativeInsert } from "../../db/schema";

export interface CreateNarrativeInput {
  assessmentVersionId?: string;
  templateId?: string;
  orgAndModules?: string;
  dataGovernance?: string;
  specialScenarios?: string;
  acceptanceScope?: string;
  timelineAndCost?: string;
  metadata?: Record<string, unknown>;
  generatedFrom?: "ai" | "template" | "manual";
  lastEditedByUserId?: string;
}

export interface UpdateNarrativeInput {
  orgAndModules?: string;
  dataGovernance?: string;
  specialScenarios?: string;
  acceptanceScope?: string;
  timelineAndCost?: string;
  metadata?: Record<string, unknown>;
  status?: "draft" | "confirmed";
  lastEditedByUserId?: string;
}

export class AssessmentNarrativeService {
  constructor(private dbInstance: Database = db) {}

  async create(input: CreateNarrativeInput): Promise<AssessmentNarrativeRow> {
    const [row] = await this.dbInstance
      .insert(assessmentNarratives)
      .values({
        narrativeId: randomUUID(),
        assessmentVersionId: input.assessmentVersionId,
        templateId: input.templateId,
        orgAndModules: input.orgAndModules,
        dataGovernance: input.dataGovernance,
        specialScenarios: input.specialScenarios,
        acceptanceScope: input.acceptanceScope,
        timelineAndCost: input.timelineAndCost,
        metadata: input.metadata ?? {},
        generatedFrom: input.generatedFrom ?? "template",
        status: "draft",
        lastEditedByUserId: input.lastEditedByUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AssessmentNarrativeInsert)
      .returning();
    return row;
  }

  /** 从评估数据自动生成初稿 */
  async generateDraft(params: {
    assessmentVersionId: string;
    packData: {
      industry?: string | null;
      scale?: string | null;
      modules?: unknown[];
      constraints?: unknown[];
    };
    estimateData?: {
      effortEstimate?: unknown[];
      riskTags?: unknown[];
      assumptions?: unknown[];
      phaseProposal?: unknown[];
    };
    generatedByUserId?: string;
  }): Promise<AssessmentNarrativeRow> {
    const { packData, estimateData } = params;
    const modules = (packData.modules ?? []) as Array<{ moduleName?: string; subModules?: string[] }>;
    const moduleNames = modules.map((m) => m.moduleName ?? "未命名模块").join("、");
    const riskTags = (estimateData?.riskTags ?? []) as string[];
    const assumptions = (estimateData?.assumptions ?? []) as Array<{ assumption: string }>;
    const phaseProposal = (estimateData?.phaseProposal ?? []) as Array<{ phase: string; estimatedDays: number; milestone: string }>;

    const orgAndModules = `本项目服务${packData.industry ?? "某行业"}客户，${packData.scale ?? "规模待确认"}。实施范围涵盖${moduleNames}等核心模块。`;

    const dataGovernance = `数据治理方面，需完成基础数据整理、科目映射、历史数据迁移。${assumptions.length > 0 ? "关键假设：" + assumptions.map((a) => a.assumption).join("；") : ""}`;

    const specialScenarios = riskTags.length > 0
      ? `本项目需重点关注以下特殊场景：${riskTags.join("、")}。建议在实施前期制定专项应对方案。`
      : "经初步评估，未发现重大特殊场景风险。";

    const acceptanceScope = `验收范围包含模块功能验收、集成测试、UAT 用户验收测试。最终以客户签署验收报告为项目关闭条件。`;

    const timelineAndCost = phaseProposal.length > 0
      ? phaseProposal.map((p) => `${p.phase}约 ${p.estimatedDays} 人天，里程碑：${p.milestone}`).join("；")
      : "实施周期与成本待进一步细化。";

    return this.create({
      assessmentVersionId: params.assessmentVersionId,
      orgAndModules,
      dataGovernance,
      specialScenarios,
      acceptanceScope,
      timelineAndCost,
      generatedFrom: "template",
      lastEditedByUserId: params.generatedByUserId,
    });
  }

  async findById(id: string): Promise<AssessmentNarrativeRow | null> {
    const [row] = await this.dbInstance
      .select()
      .from(assessmentNarratives)
      .where(eq(assessmentNarratives.narrativeId, id));
    return row ?? null;
  }

  async findByVersionId(versionId: string): Promise<AssessmentNarrativeRow | null> {
    const [row] = await this.dbInstance
      .select()
      .from(assessmentNarratives)
      .where(eq(assessmentNarratives.assessmentVersionId, versionId));
    return row ?? null;
  }

  async update(id: string, input: UpdateNarrativeInput): Promise<AssessmentNarrativeRow | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const set: Partial<AssessmentNarrativeInsert> = { updatedAt: new Date() };
    if (input.orgAndModules !== undefined) set.orgAndModules = input.orgAndModules;
    if (input.dataGovernance !== undefined) set.dataGovernance = input.dataGovernance;
    if (input.specialScenarios !== undefined) set.specialScenarios = input.specialScenarios;
    if (input.acceptanceScope !== undefined) set.acceptanceScope = input.acceptanceScope;
    if (input.timelineAndCost !== undefined) set.timelineAndCost = input.timelineAndCost;
    if (input.metadata !== undefined) set.metadata = input.metadata;
    if (input.status !== undefined) set.status = input.status;
    if (input.lastEditedByUserId !== undefined) set.lastEditedByUserId = input.lastEditedByUserId;

    const [row] = await this.dbInstance
      .update(assessmentNarratives)
      .set(set)
      .where(eq(assessmentNarratives.narrativeId, id))
      .returning();
    return row;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.dbInstance
      .delete(assessmentNarratives)
      .where(eq(assessmentNarratives.narrativeId, id))
      .returning();
    return result.length > 0;
  }
}

export const assessmentNarrativeService = new AssessmentNarrativeService();
