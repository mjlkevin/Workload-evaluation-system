// ============================================================
// HistoryProject Service — 历史项目库（P2-4）
// ============================================================
// 项目结案后数据回流到知识库，新商机时查询行业+规模相似的历史项目。
// 覆盖 v2 §10 US-19：老客户二期继承起点，只问增量部分。

import { randomUUID } from "node:crypto";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import { historyProjects, sealedBaselines } from "../../db/schema";
import type { HistoryProjectRow, HistoryProjectInsert } from "../../db/schema";

// ------------------------------------------------------------------
// 类型
// ------------------------------------------------------------------

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

export interface SimilarProjectResult {
  project: HistoryProjectRow;
  similarityScore: number;
  estimatedActualDiff: {
    daysDiff?: number;
    costDiff?: number;
  };
}

// ------------------------------------------------------------------
// 相似度计算 helpers
// ------------------------------------------------------------------

function computeIndustryScore(recordIndustry: string, queryIndustry: string): number {
  const r = recordIndustry.trim();
  const q = queryIndustry.trim();
  if (!r || !q) return 0;
  if (r === q) return 50;
  // 大类匹配：互相包含
  if (r.includes(q) || q.includes(r)) return 30;
  return 0;
}

function computeScaleScore(recordScale: string, queryScale: string): number {
  const r = recordScale.trim();
  const q = queryScale.trim();
  if (!r || !q) return 0;

  const keywords = ["集团", "500", "1000", "大型", "300", "中型", "100", "小型", "50"];
  let score = 0;
  for (const kw of keywords) {
    const hasInR = r.includes(kw);
    const hasInQ = q.includes(kw);
    if (hasInR && hasInQ) {
      // 对于纯数字关键字，避免子串误匹配（如 "50" 匹配 "500"）
      if (/^\d+$/.test(kw)) {
        const rMatch = new RegExp(`(^|\\D)${kw}(\\D|$)`).test(r);
        const qMatch = new RegExp(`(^|\\D)${kw}(\\D|$)`).test(q);
        if (rMatch && qMatch) score += 20;
      } else {
        score += 20;
      }
    }
  }
  return score;
}

function computeModuleOverlap(recordModules: unknown, queryModules: string[]): number {
  const recMods = Array.isArray(recordModules) ? (recordModules as string[]) : [];
  if (!recMods.length || !queryModules.length) return 0;
  const recSet = new Set(recMods.map((m) => String(m).trim()));
  let overlap = 0;
  for (const m of queryModules) {
    if (recSet.has(m.trim())) overlap++;
  }
  return overlap * 5;
}

function computeSimilarity(
  project: HistoryProjectRow,
  industry: string,
  scale: string,
  modules: string[],
): number {
  return (
    computeIndustryScore(project.industry, industry) +
    computeScaleScore(project.scale, scale) +
    computeModuleOverlap(project.modules, modules)
  );
}

function computeEstimatedActualDiff(project: HistoryProjectRow): SimilarProjectResult["estimatedActualDiff"] {
  const diff: SimilarProjectResult["estimatedActualDiff"] = {};
  if (typeof project.actualDays === "number" && typeof project.estimatedDays === "number") {
    diff.daysDiff = project.actualDays - project.estimatedDays;
  }
  if (typeof project.actualCost === "number" && typeof project.estimatedCost === "number") {
    diff.costDiff = project.actualCost - project.estimatedCost;
  }
  return diff;
}

// ------------------------------------------------------------------
// Service
// ------------------------------------------------------------------

export class HistoryProjectService {
  constructor(private dbInstance: Database = db) {}

  // ------------------------------------------------------------------
  // 从封版基线回流创建历史项目
  // ------------------------------------------------------------------

  async closeProject(input: CreateHistoryProjectInput): Promise<HistoryProjectRow> {
    const [row] = await this.dbInstance
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
      .returning();
    return row;
  }

  // ------------------------------------------------------------------
  // CRUD
  // ------------------------------------------------------------------

  async findById(id: string): Promise<HistoryProjectRow | null> {
    const [row] = await this.dbInstance
      .select()
      .from(historyProjects)
      .where(eq(historyProjects.historyProjectId, id));
    return row ?? null;
  }

  async update(id: string, input: UpdateHistoryProjectInput): Promise<HistoryProjectRow | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

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

    const [row] = await this.dbInstance
      .update(historyProjects)
      .set(set)
      .where(eq(historyProjects.historyProjectId, id))
      .returning();
    return row;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.dbInstance
      .delete(historyProjects)
      .where(eq(historyProjects.historyProjectId, id))
      .returning();
    return result.length > 0;
  }

  // ------------------------------------------------------------------
  // 列表 + 过滤
  // ------------------------------------------------------------------

  async listAll(opts: ListHistoryProjectsOpts = {}): Promise<HistoryProjectRow[]> {
    const limit = Math.max(1, Math.min(100, opts.limit ?? 20));
    const offset = Math.max(0, opts.offset ?? 0);

    let query = this.dbInstance.select().from(historyProjects).$dynamic();

    const conditions = [];
    if (opts.industry) {
      conditions.push(eq(historyProjects.industry, opts.industry));
    }
    if (opts.scale) {
      conditions.push(eq(historyProjects.scale, opts.scale));
    }
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    return query.orderBy(desc(historyProjects.createdAt)).limit(limit).offset(offset);
  }

  // ------------------------------------------------------------------
  // 相似度检索（核心）
  // ------------------------------------------------------------------

  async findSimilar(
    industry: string,
    scale: string,
    modules: string[],
    topN = 5,
  ): Promise<SimilarProjectResult[]> {
    const allProjects = await this.dbInstance.select().from(historyProjects);

    const scored = allProjects.map((project) => {
      const similarityScore = computeSimilarity(project, industry, scale, modules);
      return {
        project,
        similarityScore,
        estimatedActualDiff: computeEstimatedActualDiff(project),
      };
    });

    scored.sort((a, b) => b.similarityScore - a.similarityScore);
    return scored.filter((s) => s.similarityScore > 0).slice(0, topN);
  }
}

export const historyProjectService = new HistoryProjectService();
