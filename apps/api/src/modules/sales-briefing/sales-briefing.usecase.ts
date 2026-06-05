import type { OpportunityBriefRow } from "../../db/schema";
import {
  createBrief,
  findBriefById,
  listBriefsByOwner,
  updateBrief,
  deleteBrief,
  updateBriefPricing,
  type CreateBriefInput,
  type UpdateBriefInput,
} from "./sales-briefing.repository";

export type { CreateBriefInput, UpdateBriefInput };

export interface PriceRange {
  min: number;
  max: number;
  confidence: number;
  basis: string;
}

export interface PhaseItem {
  phase: string;
  scope: string;
  estimatedDays: number;
  estimatedCost: number;
  milestone: string;
}

export interface GenerateQuoteInput {
  industry?: string;
  scale?: string;
  moduleCount?: number;
  customRatio?: number;
  urgency?: "normal" | "urgent";
}

export interface RecalculateInput {
  removedModules?: string[];
  addedModules?: string[];
  addedOrgs?: number;
}

// ------------------------------------------------------------------
// CRUD passthrough
// ------------------------------------------------------------------

export { createBrief, findBriefById, listBriefsByOwner, updateBrief, deleteBrief };

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function estimateModuleCount(vagueRequirements?: string | null): number {
  if (!vagueRequirements) return 3;
  const keywords = ["模块", "系统", "功能", "报表", "接口", "集成", "定制", "开发"];
  let count = 0;
  for (const kw of keywords) {
    count += vagueRequirements.split(kw).length - 1;
  }
  return Math.max(2, Math.min(15, Math.round(count * 0.7 + 2)));
}

function industryFactor(industry: string): number {
  const map: Record<string, number> = {
    制造业: 1.3,
    零售: 1.1,
    金融: 1.5,
    医药: 1.4,
    食品: 1.1,
    物流: 1.2,
    建筑: 1.3,
  };
  for (const [key, val] of Object.entries(map)) {
    if (industry.includes(key)) return val;
  }
  return 1.0;
}

function scaleFactor(scale: string): number {
  if (scale.includes("集团") || scale.includes("500") || scale.includes("1000")) return 1.4;
  if (scale.includes("大型") || scale.includes("300")) return 1.2;
  if (scale.includes("中型") || scale.includes("100")) return 1.0;
  if (scale.includes("小型") || scale.includes("50")) return 0.8;
  return 1.0;
}

function computeConfidence(moduleCount: number, industry: string, scale: string): number {
  let c = 0.7;
  if (moduleCount <= 3) c += 0.15;
  else if (moduleCount <= 6) c += 0.05;
  else c -= 0.1;
  if (industry !== "通用") c += 0.05;
  if (scale !== "未知") c += 0.05;
  return Math.min(0.95, Math.max(0.4, Math.round(c * 100) / 100));
}

function buildPhaseProposal(moduleCount: number, totalDays: number, totalCost: number, _industry: string): PhaseItem[] {
  const dayRate = Math.round(totalCost / totalDays);

  if (moduleCount <= 3) {
    const p1Days = Math.round(totalDays * 0.6);
    const p2Days = totalDays - p1Days;
    return [
      { phase: "第一期（核心上线）", scope: "核心模块实施 + 基础数据迁移", estimatedDays: p1Days, estimatedCost: p1Days * dayRate, milestone: "核心功能上线验收" },
      { phase: "第二期（优化扩展）", scope: "扩展模块 + 报表优化", estimatedDays: p2Days, estimatedCost: p2Days * dayRate, milestone: "全量功能验收" },
    ];
  }

  const p1Days = Math.round(totalDays * 0.4);
  const p2Days = Math.round(totalDays * 0.35);
  const p3Days = totalDays - p1Days - p2Days;
  return [
    { phase: "第一期（蓝图 + 核心构建）", scope: "需求蓝图确认 + 核心模块构建", estimatedDays: p1Days, estimatedCost: p1Days * dayRate, milestone: "蓝图确认 + 核心模块 UAT" },
    { phase: "第二期（扩展 + 集成）", scope: "扩展模块实施 + 系统集成", estimatedDays: p2Days, estimatedCost: p2Days * dayRate, milestone: "扩展模块 UAT + 集成测试通过" },
    { phase: "第三期（上线 + 验收）", scope: "全面上线 + 用户培训 + 验收", estimatedDays: p3Days, estimatedCost: p3Days * dayRate, milestone: "正式上线 + 客户验收" },
  ];
}

// ------------------------------------------------------------------
// 报价生成（US-1: 30秒区间报价）
// ------------------------------------------------------------------

export async function generateQuote(
  briefId: string,
  params: GenerateQuoteInput = {},
): Promise<OpportunityBriefRow | null> {
  const brief = await findBriefById(briefId);
  if (!brief) return null;

  const industry = params.industry ?? (brief.customerProfile as any)?.industry ?? "通用";
  const scale = params.scale ?? (brief.customerProfile as any)?.scale ?? "中型";
  const moduleCount = params.moduleCount ?? estimateModuleCount(brief.vagueRequirements);
  const customRatio = params.customRatio ?? 0.2;
  const urgency = params.urgency ?? "normal";

  const iFactor = industryFactor(industry);
  const sFactor = scaleFactor(scale);
  const baseDaysPerModule = 15;
  const baseCostPerDay = 3000;

  const totalDays = Math.round(moduleCount * baseDaysPerModule * iFactor * sFactor * (1 + customRatio));
  const totalCost = totalDays * baseCostPerDay;
  const urgencyFactor = urgency === "urgent" ? 1.2 : 1.0;

  const min = Math.round(totalCost * 0.8 * urgencyFactor);
  const max = Math.round(totalCost * 1.3 * urgencyFactor);

  const priceRange: PriceRange = {
    min,
    max,
    confidence: computeConfidence(moduleCount, industry, scale),
    basis: `模块数 ${moduleCount} × 基础 ${baseDaysPerModule}d × 行业系数 ${iFactor} × 规模系数 ${sFactor} × 定制加成 ${Math.round(customRatio * 100)}%${urgency === "urgent" ? " × 紧急加成 20%" : ""}`,
  };

  const phaseProposal = buildPhaseProposal(moduleCount, totalDays, totalCost, industry);

  return updateBriefPricing(briefId, priceRange, phaseProposal);
}

// ------------------------------------------------------------------
// 变更重算（US-3: 口述变更重算）
// ------------------------------------------------------------------

export async function recalculate(
  briefId: string,
  changes: RecalculateInput,
): Promise<OpportunityBriefRow | null> {
  const brief = await findBriefById(briefId);
  if (!brief) return null;

  const currentPrice = brief.priceRange as PriceRange | null;
  const currentPhases = (brief.phaseProposal ?? []) as PhaseItem[];
  if (!currentPrice) return null;

  const removedCount = (changes.removedModules ?? []).length;
  const addedCount = (changes.addedModules ?? []).length;
  const orgFactor = (changes.addedOrgs ?? 0) > 0 ? 1 + changes.addedOrgs! * 0.15 : 1;

  const netModuleChange = addedCount - removedCount;
  const baseDaysPerModule = 15;
  const baseCostPerDay = 3000;
  const adjustment = netModuleChange * baseDaysPerModule * baseCostPerDay * orgFactor;

  const newMin = Math.round(Math.max(0, currentPrice.min + adjustment * 0.8));
  const newMax = Math.round(Math.max(newMin, currentPrice.max + adjustment * 1.3));

  const priceRange: PriceRange = {
    min: newMin,
    max: newMax,
    confidence: Math.max(0.3, currentPrice.confidence - 0.1),
    basis: `${currentPrice.basis}；变更调整：移除 ${removedCount} 模块，新增 ${addedCount} 模块${changes.addedOrgs ? "，新增 " + changes.addedOrgs + " 家组织" : ""}`,
  };

  let phaseProposal = currentPhases;
  if (Math.abs(netModuleChange) >= 2) {
    const estimatedModuleCount = Math.max(1, estimateModuleCount(brief.vagueRequirements) + netModuleChange);
    const totalDays = Math.round(estimatedModuleCount * baseDaysPerModule);
    const totalCost = Math.round((newMin + newMax) / 2);
    phaseProposal = buildPhaseProposal(estimatedModuleCount, totalDays, totalCost, "通用");
  }

  return updateBriefPricing(briefId, priceRange, phaseProposal);
}
