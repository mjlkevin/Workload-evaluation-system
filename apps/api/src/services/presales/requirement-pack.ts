// ============================================================
// RequirementPack Service — 售前需求包业务层
// ============================================================
// P1-1 核心服务：将 ExtractionResult → RequirementPack，
// 支持审阅、DSL 规则检查、问询生成、置信度叠加。

import { randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import { requirementPacks } from "../../db/schema";
import type { Evidence, ExtractionResult } from "../../ai/evidence/types";
import { evidenceRepository } from "../../ai/repository/evidence.repository";
import type { RuleViolation } from "../../dsl/types";
import { evaluate } from "../../dsl/engine";
import { sowCompletenessV1 } from "../../dsl/rules/sow-completeness-v1";
import { industryMandatoryV1 } from "../../dsl/rules/industry-mandatory-v1";
import { moduleDependencyV1 } from "../../dsl/rules/module-dependency-v1";
import { confidenceThresholdV1 } from "../../dsl/rules/confidence-threshold-v1";
import { wbsCompletenessV1 } from "../../dsl/rules/wbs-completeness-v1";

// ------------------------------------------------------------------
// 类型
// ------------------------------------------------------------------

export interface CreateRequirementPackInput {
  sourceExtractionId?: string;
  ownerUserId?: string;
  /** 若传了 extractionId，自动从 evidence repo 反查并填充 */
  extractionId?: string;
}

export interface UpdateRequirementPackInput {
  structuredRequirements?: unknown[];
  industry?: string;
  scale?: string;
  modules?: unknown[];
  constraints?: unknown[];
  status?: "draft" | "confirmed" | "deprecated";
}

export interface FieldConfidence {
  fieldPath: string;
  value: string;
  confidence: number;
  method: string;
  sourceKind: string;
}

export interface InquiryItem {
  inquiryId: string;
  question: string;
  severity: "error" | "warning" | "info";
  relatedFieldPath?: string;
  suggestion?: string;
}

export interface ReviewResult {
  requirementPackId: string;
  violations: RuleViolation[];
  inquiries: InquiryItem[];
  confidenceSummary: {
    overall: number;
    byDimension: Record<string, number>;
  };
}

// ------------------------------------------------------------------
// DSL 规则集（售前审查 Agent 默认启用）
// ------------------------------------------------------------------

const DEFAULT_REVIEW_RULES = [
  sowCompletenessV1,
  industryMandatoryV1,
  moduleDependencyV1,
  confidenceThresholdV1,
  wbsCompletenessV1,
];

// ------------------------------------------------------------------
// Service
// ------------------------------------------------------------------

export class RequirementPackService {
  constructor(private dbInstance: Database = db) {}

  /**
   * 从 extraction result 创建需求包。
   * 若提供了 extractionId，自动拉取证据并结构化。
   */
  async createFromExtraction(input: CreateRequirementPackInput): Promise<typeof requirementPacks.$inferSelect> {
    const packId = randomUUID();

    let structuredRequirements: unknown[] = [];
    let modules: unknown[] = [];
    let industry: string | null = null;
    let scale: string | null = null;
    let constraints: unknown[] = [];

    if (input.extractionId) {
      const extraction = await evidenceRepository.findByExtractionId(input.extractionId);
      if (extraction) {
        const { extracted } = this._extractFromEvidences(extraction.evidences);
        structuredRequirements = extracted.structuredRequirements ?? [];
        modules = extracted.modules ?? [];
        industry = extracted.industry ?? null;
        scale = extracted.scale ?? null;
        constraints = extracted.constraints ?? [];
      }
    }

    const [row] = await this.dbInstance
      .insert(requirementPacks)
      .values({
        requirementPackId: packId,
        sourceExtractionId: input.sourceExtractionId ?? input.extractionId,
        structuredRequirements: structuredRequirements as any,
        industry,
        scale,
        modules: modules as any,
        constraints: constraints as any,
        status: "draft",
        ownerUserId: input.ownerUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return row;
  }

  /** 按 ID 查询 */
  async findById(id: string): Promise<typeof requirementPacks.$inferSelect | null> {
    const [row] = await this.dbInstance.select().from(requirementPacks).where(eq(requirementPacks.requirementPackId, id));
    return row ?? null;
  }

  /** 按 owner 列表查询，支持状态过滤 */
  async listByOwner(ownerUserId: string, status?: string): Promise<typeof requirementPacks.$inferSelect[]> {
    const conds = [eq(requirementPacks.ownerUserId, ownerUserId)];
    if (status) {
      // @ts-expect-error dynamic enum filter
      conds.push(eq(requirementPacks.status, status));
    }
    return this.dbInstance
      .select()
      .from(requirementPacks)
      .where(and(...conds))
      .orderBy(desc(requirementPacks.updatedAt));
  }

  /** 更新需求包 */
  async update(id: string, input: UpdateRequirementPackInput): Promise<typeof requirementPacks.$inferSelect | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const set: Partial<typeof requirementPacks.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (input.structuredRequirements !== undefined) set.structuredRequirements = input.structuredRequirements as any;
    if (input.industry !== undefined) set.industry = input.industry;
    if (input.scale !== undefined) set.scale = input.scale;
    if (input.modules !== undefined) set.modules = input.modules as any;
    if (input.constraints !== undefined) set.constraints = input.constraints as any;
    if (input.status !== undefined) set.status = input.status;

    const [row] = await this.dbInstance.update(requirementPacks).set(set).where(eq(requirementPacks.requirementPackId, id)).returning();
    return row;
  }

  /** 删除（硬删除，P0 约定） */
  async delete(id: string): Promise<boolean> {
    const result = await this.dbInstance.delete(requirementPacks).where(eq(requirementPacks.requirementPackId, id)).returning();
    return result.length > 0;
  }

  // ------------------------------------------------------------------
  // 审阅：DSL 规则 + 问询生成 + 置信度汇总
  // ------------------------------------------------------------------

  async review(packId: string): Promise<ReviewResult> {
    const pack = await this.findById(packId);
    if (!pack) {
      throw new Error(`RequirementPack not found: ${packId}`);
    }

    // 1. 拉取证据（若有 sourceExtractionId）
    let evidences: Evidence[] = [];
    if (pack.sourceExtractionId) {
      const extraction = await evidenceRepository.findByExtractionId(pack.sourceExtractionId);
      if (extraction) {
        evidences = extraction.evidences;
      }
    }

    // 2. 运行 DSL 规则
    const violations = evaluate(DEFAULT_REVIEW_RULES, {
      extractionId: pack.sourceExtractionId ?? packId,
      evidences,
    });

    // 3. 从 violations 生成 inquiries
    const inquiries = this._violationsToInquiries(violations);

    // 4. 置信度汇总
    const confidenceSummary = this._computeConfidenceSummary(evidences, pack);

    return {
      requirementPackId: packId,
      violations,
      inquiries,
      confidenceSummary,
    };
  }

  /** 获取字段级置信度列表（US-8） */
  async getFieldConfidences(packId: string): Promise<FieldConfidence[]> {
    const pack = await this.findById(packId);
    if (!pack) return [];

    let evidences: Evidence[] = [];
    if (pack.sourceExtractionId) {
      const extraction = await evidenceRepository.findByExtractionId(pack.sourceExtractionId);
      if (extraction) {
        evidences = extraction.evidences;
      }
    }

    return evidences.map((ev) => ({
      fieldPath: ev.fieldPath,
      value: ev.value,
      confidence: ev.confidence,
      method: ev.method,
      sourceKind: ev.source.kind,
    }));
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private _extractFromEvidences(evidences: Evidence[]): {
    extracted: {
      structuredRequirements?: unknown[];
      modules?: unknown[];
      industry?: string;
      scale?: string;
      constraints?: unknown[];
    };
  } {
    const result: ReturnType<typeof this._extractFromEvidences>["extracted"] = {
      structuredRequirements: [],
      modules: [],
      industry: undefined,
      scale: undefined,
      constraints: [],
    };

    for (const ev of evidences) {
      if (ev.fieldPath === "basicInfo.customerIndustry") {
        result.industry = ev.value;
      } else if (ev.fieldPath === "basicInfo.scale" || ev.fieldPath === "basicInfo.orgScale") {
        result.scale = ev.value;
      } else if (ev.fieldPath.startsWith("requirementImportData.productModuleRows")) {
        // 从模块行中提取模块名
        const match = ev.fieldPath.match(/productModuleRows\[(\d+)\]\.moduleName/);
        if (match && ev.value) {
          const idx = parseInt(match[1], 10);
          if (!result.modules![idx]) {
            result.modules![idx] = { moduleName: ev.value, subModules: [] };
          } else {
            (result.modules![idx] as any).moduleName = ev.value;
          }
        }
      } else if (ev.fieldPath.startsWith("requirementImportData.businessRequirementRows")) {
        const match = ev.fieldPath.match(/businessRequirementRows\[(\d+)\]\.requirementName/);
        if (match && ev.value) {
          const idx = parseInt(match[1], 10);
          if (!result.structuredRequirements![idx]) {
            result.structuredRequirements![idx] = { name: ev.value, details: [] };
          } else {
            (result.structuredRequirements![idx] as any).name = ev.value;
          }
        }
      } else if (ev.fieldPath.includes("constraint") || ev.fieldPath.includes("limitation")) {
        if (ev.value) {
          (result.constraints as any[]).push({ description: ev.value, source: ev.source.kind });
        }
      }
    }

    // 去空
    result.modules = (result.modules as any[]).filter(Boolean);
    result.structuredRequirements = (result.structuredRequirements as any[]).filter(Boolean);

    return { extracted: result };
  }

  private _violationsToInquiries(violations: RuleViolation[]): InquiryItem[] {
    return violations.map((v) => ({
      inquiryId: randomUUID(),
      question: v.message,
      severity: v.severity,
      relatedFieldPath: v.fieldPath,
      suggestion: v.suggestion,
    }));
  }

  private _computeConfidenceSummary(
    evidences: Evidence[],
    _pack: typeof requirementPacks.$inferSelect,
  ): ReviewResult["confidenceSummary"] {
    if (evidences.length === 0) {
      return {
        overall: 0,
        byDimension: {
          evidenceCoverage: 0,
          inquiryCompleteness: 0,
          rulePassRate: 0,
          sourceReliability: 0,
        },
      };
    }

    const avgConfidence = evidences.reduce((sum, e) => sum + e.confidence, 0) / evidences.length;
    const aiCount = evidences.filter((e) => e.method === "ai").length;
    const ruleCount = evidences.filter((e) => e.method === "rule").length;
    const manualCount = evidences.filter((e) => e.method === "manual").length;
    const total = evidences.length;

    // sourceReliability: manual=1.0, rule=0.9, ai=0.7
    const sourceReliability =
      total === 0
        ? 0
        : (manualCount * 1.0 + ruleCount * 0.9 + aiCount * 0.7) / total;

    return {
      overall: Math.round(avgConfidence * 100) / 100,
      byDimension: {
        evidenceCoverage: Math.round((evidences.length > 0 ? 1 : 0) * 100) / 100,
        inquiryCompleteness: 0, // 由前端/后续流程填充
        rulePassRate: 0, // 由调用方根据 violations 计算
        sourceReliability: Math.round(sourceReliability * 100) / 100,
      },
    };
  }
}

/** 进程级单例 */
export const requirementPackService = new RequirementPackService();
