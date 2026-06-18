// ============================================================
// InitialEstimate Service — 初估交接包业务层
// ============================================================
// P1-1 核心服务：从 RequirementPack → InitialEstimate，
// 含人天估算、风险标签、假设清单、4维置信度、分期方案。

import { randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import { initialEstimates } from "../../db/schema";
import type { RequirementPackRow } from "../../db/schema";

// ------------------------------------------------------------------
// 类型
// ------------------------------------------------------------------

export interface EstimateLineItem {
  module: string;
  days: number;
  basis: string;
}

export interface PhaseProposal {
  phase: string;
  modules: string[];
  estimatedDays: number;
  milestone: string;
}

export interface GenerateEstimateInput {
  requirementPack: RequirementPackRow;
  ownerUserId?: string;
}

export interface UpdateEstimateInput {
  effortEstimate?: EstimateLineItem[];
  riskTags?: string[];
  assumptions?: Array<{ assumption: string; rationale: string; riskIfInvalid: string }>;
  confidenceScores?: Record<string, number>;
  phaseProposal?: PhaseProposal[];
  status?: "draft" | "reviewed" | "handed_off" | "deprecated";
  reviewedByUserId?: string;
}

// ------------------------------------------------------------------
// Service
// ------------------------------------------------------------------

export class InitialEstimateService {
  constructor(private dbInstance: Database = db) {}

  /**
   * 从 RequirementPack 生成初估包。
   * P1-1 采用规则化估算（基于模块数、行业系数）；未来可接入 AI 估算。
   */
  async generateFromPack(input: GenerateEstimateInput): Promise<typeof initialEstimates.$inferSelect> {
    const { requirementPack: pack } = input;
    const estimateId = randomUUID();

    // 从 pack.modules 生成估算行
    const modules = (pack.modules ?? []) as Array<{ moduleName?: string; subModules?: string[] }>;
    const effortEstimate: EstimateLineItem[] = modules.map((m) => {
      const moduleName = m.moduleName ?? "未命名模块";
      const subCount = (m.subModules ?? []).length;
      const baseDays = 10; // 基础人天
      const subDays = subCount * 3; // 每个子模块 3 人天
      const industryFactor = this._industryFactor(pack.industry);
      const days = Math.round((baseDays + subDays) * industryFactor);
      return {
        module: moduleName,
        days,
        basis: `基础 ${baseDays}d + ${subCount} 子模块 × 3d × 行业系数 ${industryFactor}`,
      };
    });

    // 风险标签
    const riskTags = this._inferRiskTags(pack);

    // 假设清单
    const assumptions = this._generateAssumptions(pack);

    // 4 维置信度
    const confidenceScores = {
      orgScale: this._scoreOrgScale(pack.scale),
      moduleComplexity: this._scoreModuleComplexity(modules),
      customRatio: 0.5, // P1-1 默认中值，需人工校准
      deliveryCycle: 0.6, // P1-1 默认中值
    };

    // 分期方案（简单二分法）
    const phaseProposal = this._buildPhaseProposal(modules, effortEstimate);

    const [row] = await this.dbInstance
      .insert(initialEstimates)
      .values({
        initialEstimateId: estimateId,
        requirementPackId: pack.requirementPackId,
        effortEstimate: effortEstimate as any,
        riskTags: riskTags as any,
        assumptions: assumptions as any,
        confidenceScores: confidenceScores as any,
        phaseProposal: phaseProposal as any,
        status: "draft",
        ownerUserId: input.ownerUserId,
        reviewedByUserId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return row;
  }

  /** 按 ID 查询 */
  async findById(id: string): Promise<typeof initialEstimates.$inferSelect | null> {
    const [row] = await this.dbInstance.select().from(initialEstimates).where(eq(initialEstimates.initialEstimateId, id));
    return row ?? null;
  }

  /** 按 requirementPackId 查询 */
  async findByPackId(packId: string): Promise<typeof initialEstimates.$inferSelect | null> {
    const [row] = await this.dbInstance
      .select()
      .from(initialEstimates)
      .where(eq(initialEstimates.requirementPackId, packId));
    return row ?? null;
  }

  /** 按 owner 列表 */
  async listByOwner(ownerUserId: string, status?: string): Promise<typeof initialEstimates.$inferSelect[]> {
    const conds = [eq(initialEstimates.ownerUserId, ownerUserId)];
    if (status) {
      // @ts-expect-error dynamic enum filter
      conds.push(eq(initialEstimates.status, status));
    }
    return this.dbInstance
      .select()
      .from(initialEstimates)
      .where(and(...conds))
      .orderBy(desc(initialEstimates.updatedAt));
  }

  /** 更新 */
  async update(id: string, input: UpdateEstimateInput): Promise<typeof initialEstimates.$inferSelect | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const set: Partial<typeof initialEstimates.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (input.effortEstimate !== undefined) set.effortEstimate = input.effortEstimate as any;
    if (input.riskTags !== undefined) set.riskTags = input.riskTags as any;
    if (input.assumptions !== undefined) set.assumptions = input.assumptions as any;
    if (input.confidenceScores !== undefined) set.confidenceScores = input.confidenceScores as any;
    if (input.phaseProposal !== undefined) set.phaseProposal = input.phaseProposal as any;
    if (input.status !== undefined) set.status = input.status;
    if (input.reviewedByUserId !== undefined) set.reviewedByUserId = input.reviewedByUserId;

    const [row] = await this.dbInstance
      .update(initialEstimates)
      .set(set)
      .where(eq(initialEstimates.initialEstimateId, id))
      .returning();
    return row;
  }

  /** 删除 */
  async delete(id: string): Promise<boolean> {
    const result = await this.dbInstance.delete(initialEstimates).where(eq(initialEstimates.initialEstimateId, id)).returning();
    return result.length > 0;
  }

  // ------------------------------------------------------------------
  // Private helpers — 规则化估算逻辑
  // ------------------------------------------------------------------

  private _industryFactor(industry: string | null): number {
    if (!industry) return 1.0;
    const lower = industry.toLowerCase();
    if (lower.includes("制造") || lower.includes("mes")) return 1.3;
    if (lower.includes("零售") || lower.includes("连锁")) return 1.1;
    if (lower.includes("金融") || lower.includes("银行")) return 1.5;
    if (lower.includes("医药") || lower.includes("医疗")) return 1.4;
    return 1.0;
  }

  private _inferRiskTags(pack: RequirementPackRow): string[] {
    const tags: string[] = [];
    const modules = (pack.modules ?? []) as Array<{ moduleName?: string }>;
    const moduleNames = modules.map((m) => (m.moduleName ?? "").toLowerCase());

    if (moduleNames.some((n) => n.includes("接口") || n.includes("集成"))) {
      tags.push("接口复杂");
    }
    if (moduleNames.some((n) => n.includes("定制") || n.includes("开发"))) {
      tags.push("定制开发比例高");
    }
    if (((pack.constraints as unknown[]) ?? []).length > 3) {
      tags.push("约束条件多");
    }
    if ((pack.scale ?? "").includes("集团") || (pack.scale ?? "").includes("多组织")) {
      tags.push("多组织");
    }
    if (!pack.industry) {
      tags.push("行业信息缺失");
    }

    return tags;
  }

  private _generateAssumptions(pack: RequirementPackRow): Array<{ assumption: string; rationale: string; riskIfInvalid: string }> {
    const assumptions: Array<{ assumption: string; rationale: string; riskIfInvalid: string }> = [];

    assumptions.push({
      assumption: "客户提供的数据源格式标准且可解析",
      rationale: "估算基于现有模块清单，未包含数据清洗工作量",
      riskIfInvalid: "追加 10-20% 人天用于数据迁移与清洗",
    });

    if (((pack.modules as unknown[]) ?? []).length > 5) {
      assumptions.push({
        assumption: "模块间依赖关系在实施前已明确",
        rationale: "模块数 > 5，依赖不清会导致实施顺序混乱",
        riskIfInvalid: "项目延期风险 + 需追加集成测试人天",
      });
    }

    if (!(pack.scale ?? "").includes("集团")) {
      assumptions.push({
        assumption: "单组织部署，不涉及跨组织数据隔离与权限体系",
        rationale: "规模描述未提及多组织",
        riskIfInvalid: "需追加组织建模与权限设计人天（约 15-30d）",
      });
    }

    return assumptions;
  }

  private _scoreOrgScale(scale: string | null): number {
    if (!scale) return 0.3;
    const lower = scale.toLowerCase();
    if (lower.includes("集团") || lower.includes("500") || lower.includes("1000")) return 0.7;
    if (lower.includes("中型") || lower.includes("100") || lower.includes("200")) return 0.8;
    if (lower.includes("小型") || lower.includes("50")) return 0.9;
    return 0.6;
  }

  private _scoreModuleComplexity(modules: Array<{ subModules?: string[] }>): number {
    if (modules.length === 0) return 0.3;
    const totalSubModules = modules.reduce((sum, m) => sum + (m.subModules ?? []).length, 0);
    const avgSub = totalSubModules / modules.length;
    if (avgSub > 5) return 0.5;
    if (avgSub > 2) return 0.7;
    return 0.9;
  }

  private _buildPhaseProposal(
    modules: Array<{ moduleName?: string }>,
    effortEstimate: EstimateLineItem[],
  ): PhaseProposal[] {
    const totalDays = effortEstimate.reduce((sum, e) => sum + e.days, 0);
    const midPoint = totalDays / 2;

    // 简单按人天分两期
    let phase1Days = 0;
    const phase1Modules: string[] = [];
    const phase2Modules: string[] = [];

    for (const item of effortEstimate) {
      if (phase1Days < midPoint) {
        phase1Modules.push(item.module);
        phase1Days += item.days;
      } else {
        phase2Modules.push(item.module);
      }
    }

    return [
      {
        phase: "第一期（核心模块）",
        modules: phase1Modules,
        estimatedDays: Math.round(phase1Days),
        milestone: "核心模块上线 + 基础数据迁移完成",
      },
      {
        phase: "第二期（扩展模块）",
        modules: phase2Modules,
        estimatedDays: Math.round(totalDays - phase1Days),
        milestone: "全模块上线 + UAT 通过",
      },
    ];
  }
}

/** 进程级单例 */
export const initialEstimateService = new InitialEstimateService();
