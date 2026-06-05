import { randomUUID } from "node:crypto";
import type { RequirementPackRow, SowDocumentRow } from "../../db/schema";
import type { Evidence } from "../../ai/evidence/types";
import { evidenceRepository } from "../../ai/repository/evidence.repository";
import type { RuleViolation } from "../../dsl/types";
import { evaluate } from "../../dsl/engine";
import { sowCompletenessV1 } from "../../dsl/rules/sow-completeness-v1";
import { industryMandatoryV1 } from "../../dsl/rules/industry-mandatory-v1";
import { moduleDependencyV1 } from "../../dsl/rules/module-dependency-v1";
import { confidenceThresholdV1 } from "../../dsl/rules/confidence-threshold-v1";
import { wbsCompletenessV1 } from "../../dsl/rules/wbs-completeness-v1";
import {
  createRequirementPack,
  findRequirementPackById,
  listRequirementPacksByOwner,
  updateRequirementPack,
  deleteRequirementPack,
  createInitialEstimate,
  findInitialEstimateById,
  findInitialEstimateByPackId,
  listInitialEstimatesByOwner,
  updateInitialEstimate,
  deleteInitialEstimate,
  createSowDocument,
  findSowDocumentById,
  findSowDocumentsByPackId,
  listSowDocumentsByOwner,
  updateSowDocument,
  deleteSowDocument,
  bumpSowVersion,
  type CreateRequirementPackInput,
  type UpdateRequirementPackInput,
  type EstimateLineItem,
  type PhaseProposal,
  type UpdateEstimateInput,
  type SowLineItem,
  type UpdateSowInput,
} from "./presales.repository";

export type {
  CreateRequirementPackInput,
  UpdateRequirementPackInput,
  EstimateLineItem,
  PhaseProposal,
  UpdateEstimateInput,
  SowLineItem,
  UpdateSowInput,
};

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

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

const DEFAULT_REVIEW_RULES = [
  sowCompletenessV1,
  industryMandatoryV1,
  moduleDependencyV1,
  confidenceThresholdV1,
  wbsCompletenessV1,
];

// ------------------------------------------------------------------
// Evidence extraction helpers
// ------------------------------------------------------------------

function extractFromEvidences(evidences: Evidence[]): {
  structuredRequirements?: unknown[];
  modules?: unknown[];
  industry?: string;
  scale?: string;
  constraints?: unknown[];
} {
  const result: ReturnType<typeof extractFromEvidences> = {
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

  result.modules = (result.modules as any[]).filter(Boolean);
  result.structuredRequirements = (result.structuredRequirements as any[]).filter(Boolean);
  return result;
}

// ------------------------------------------------------------------
// RequirementPack — createFromExtraction
// ------------------------------------------------------------------

export async function createFromExtraction(input: CreateRequirementPackInput): Promise<RequirementPackRow> {
  const packId = randomUUID();

  let structuredRequirements: unknown[] = [];
  let modules: unknown[] = [];
  let industry: string | null = null;
  let scale: string | null = null;
  let constraints: unknown[] = [];

  if (input.extractionId) {
    const extraction = await evidenceRepository.findByExtractionId(input.extractionId);
    if (extraction) {
      const extracted = extractFromEvidences(extraction.evidences);
      structuredRequirements = extracted.structuredRequirements ?? [];
      modules = extracted.modules ?? [];
      industry = extracted.industry ?? null;
      scale = extracted.scale ?? null;
      constraints = extracted.constraints ?? [];
    }
  }

  return createRequirementPack({
    requirementPackId: packId,
    sourceExtractionId: input.sourceExtractionId ?? input.extractionId,
    structuredRequirements,
    industry,
    scale,
    modules,
    constraints,
    ownerUserId: input.ownerUserId,
  });
}

export { findRequirementPackById, listRequirementPacksByOwner, updateRequirementPack, deleteRequirementPack };

// ------------------------------------------------------------------
// RequirementPack — review + confidences
// ------------------------------------------------------------------

function violationsToInquiries(violations: RuleViolation[]): InquiryItem[] {
  const grouped = new Map<string, { severity: string; fieldPath: string; messages: string[]; suggestions: string[] }>();

  for (const v of violations) {
    const key = `${v.severity}::${v.fieldPath}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.messages.push(v.message);
      if (v.suggestion) existing.suggestions.push(v.suggestion);
    } else {
      grouped.set(key, { severity: v.severity, fieldPath: v.fieldPath, messages: [v.message], suggestions: v.suggestion ? [v.suggestion] : [] });
    }
  }

  return Array.from(grouped.values()).map((group) => ({
    inquiryId: randomUUID(),
    question: group.messages.join("\n"),
    severity: group.severity as InquiryItem["severity"],
    relatedFieldPath: group.fieldPath,
    suggestion: group.suggestions.length > 0 ? group.suggestions.join("\n") : undefined,
  }));
}

function computeConfidenceSummary(evidences: Evidence[], pack: RequirementPackRow): ReviewResult["confidenceSummary"] {
  if (evidences.length === 0) {
    return { overall: 0, byDimension: { evidenceCoverage: 0, inquiryCompleteness: 0, rulePassRate: 0, sourceReliability: 0 } };
  }

  const CORE_FIELD_WEIGHTS: Record<string, number> = {
    "basicInfo.industry": 0.3,
    "basicInfo.scale": 0.3,
    "sow.moduleScope": 0.4,
  };

  const fieldConfidences = new Map<string, number[]>();
  for (const ev of evidences) {
    if (!fieldConfidences.has(ev.fieldPath)) fieldConfidences.set(ev.fieldPath, []);
    fieldConfidences.get(ev.fieldPath)!.push(ev.confidence);
  }

  let weightedSum = 0;
  let totalWeight = 0;
  for (const [fieldPath, weight] of Object.entries(CORE_FIELD_WEIGHTS)) {
    const confidences = fieldConfidences.get(fieldPath);
    if (confidences && confidences.length > 0) {
      weightedSum += (confidences.reduce((sum, c) => sum + c, 0) / confidences.length) * weight;
      totalWeight += weight;
    }
  }

  const remainingWeight = 1 - totalWeight;
  if (remainingWeight > 0) {
    const nonCoreEvidences = evidences.filter((e) => !CORE_FIELD_WEIGHTS[e.fieldPath]);
    if (nonCoreEvidences.length > 0) {
      weightedSum += (nonCoreEvidences.reduce((sum, e) => sum + e.confidence, 0) / nonCoreEvidences.length) * remainingWeight;
    }
  }

  const total = evidences.length;
  const aiCount = evidences.filter((e) => e.method === "ai").length;
  const ruleCount = evidences.filter((e) => e.method === "rule").length;
  const manualCount = evidences.filter((e) => e.method === "manual").length;
  const sourceReliability = total === 0 ? 0 : (manualCount * 1.0 + ruleCount * 0.9 + aiCount * 0.7) / total;

  return {
    overall: Math.round((totalWeight > 0 || remainingWeight > 0 ? weightedSum : 0) * 100) / 100,
    byDimension: {
      evidenceCoverage: Math.round((evidences.length > 0 ? 1 : 0) * 100) / 100,
      inquiryCompleteness: 0,
      rulePassRate: 0,
      sourceReliability: Math.round(sourceReliability * 100) / 100,
    },
  };
}

export async function reviewPack(packId: string): Promise<ReviewResult> {
  const pack = await findRequirementPackById(packId);
  if (!pack) throw new Error(`RequirementPack not found: ${packId}`);

  let evidences: Evidence[] = [];
  if (pack.sourceExtractionId) {
    const extraction = await evidenceRepository.findByExtractionId(pack.sourceExtractionId);
    if (extraction) evidences = extraction.evidences;
  }

  const violations = evaluate(DEFAULT_REVIEW_RULES, { extractionId: pack.sourceExtractionId ?? packId, evidences });
  const inquiries = violationsToInquiries(violations);
  const confidenceSummary = computeConfidenceSummary(evidences, pack);

  return { requirementPackId: packId, violations, inquiries, confidenceSummary };
}

export async function getFieldConfidences(packId: string): Promise<FieldConfidence[]> {
  const pack = await findRequirementPackById(packId);
  if (!pack) return [];

  let evidences: Evidence[] = [];
  if (pack.sourceExtractionId) {
    const extraction = await evidenceRepository.findByExtractionId(pack.sourceExtractionId);
    if (extraction) evidences = extraction.evidences;
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
// InitialEstimate — generateFromPack
// ------------------------------------------------------------------

export { findInitialEstimateById, findInitialEstimateByPackId, listInitialEstimatesByOwner, updateInitialEstimate, deleteInitialEstimate };

function industryFactor(industry: string | null): number {
  if (!industry) return 1.0;
  const lower = industry.toLowerCase();
  if (lower.includes("制造") || lower.includes("mes")) return 1.3;
  if (lower.includes("零售") || lower.includes("连锁")) return 1.1;
  if (lower.includes("金融") || lower.includes("银行")) return 1.5;
  if (lower.includes("医药") || lower.includes("医疗")) return 1.4;
  return 1.0;
}

function inferRiskTags(pack: RequirementPackRow): string[] {
  const tags: string[] = [];
  const modules = (pack.modules ?? []) as Array<{ moduleName?: string }>;
  const moduleNames = modules.map((m) => (m.moduleName ?? "").toLowerCase());

  if (moduleNames.some((n) => n.includes("接口") || n.includes("集成"))) tags.push("接口复杂");
  if (moduleNames.some((n) => n.includes("定制") || n.includes("开发"))) tags.push("定制开发比例高");
  if (((pack.constraints as unknown[]) ?? []).length > 3) tags.push("约束条件多");
  if ((pack.scale ?? "").includes("集团") || (pack.scale ?? "").includes("多组织")) tags.push("多组织");
  if (!pack.industry) tags.push("行业信息缺失");

  return tags;
}

function generateAssumptions(pack: RequirementPackRow): Array<{ assumption: string; rationale: string; riskIfInvalid: string }> {
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

function scoreOrgScale(scale: string | null): number {
  if (!scale) return 0.3;
  const lower = scale.toLowerCase();
  if (lower.includes("集团") || lower.includes("500") || lower.includes("1000")) return 0.7;
  if (lower.includes("中型") || lower.includes("100") || lower.includes("200")) return 0.8;
  if (lower.includes("小型") || lower.includes("50")) return 0.9;
  return 0.6;
}

function scoreModuleComplexity(modules: Array<{ subModules?: string[] }>): number {
  if (modules.length === 0) return 0.3;
  const totalSubModules = modules.reduce((sum, m) => sum + (m.subModules ?? []).length, 0);
  const avgSub = totalSubModules / modules.length;
  if (avgSub > 5) return 0.5;
  if (avgSub > 2) return 0.7;
  return 0.9;
}

function buildPhaseProposal(
  modules: Array<{ moduleName?: string }>,
  effortEstimate: EstimateLineItem[],
): PhaseProposal[] {
  const totalDays = effortEstimate.reduce((sum, e) => sum + e.days, 0);
  const midPoint = totalDays / 2;

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
    { phase: "第一期（核心模块）", modules: phase1Modules, estimatedDays: Math.round(phase1Days), milestone: "核心模块上线 + 基础数据迁移完成" },
    { phase: "第二期（扩展模块）", modules: phase2Modules, estimatedDays: Math.round(totalDays - phase1Days), milestone: "全模块上线 + UAT 通过" },
  ];
}

export async function generateFromPack(input: { requirementPack: RequirementPackRow; ownerUserId?: string }) {
  const { requirementPack: pack } = input;
  const estimateId = randomUUID();

  const modules = (pack.modules ?? []) as Array<{ moduleName?: string; subModules?: string[] }>;
  const effortEstimate: EstimateLineItem[] = modules.map((m) => {
    const moduleName = m.moduleName ?? "未命名模块";
    const subCount = (m.subModules ?? []).length;
    const baseDays = 10;
    const subDays = subCount * 3;
    const iFactor = industryFactor(pack.industry);
    const days = Math.round((baseDays + subDays) * iFactor);
    return { module: moduleName, days, basis: `基础 ${baseDays}d + ${subCount} 子模块 × 3d × 行业系数 ${iFactor}` };
  });

  const riskTags = inferRiskTags(pack);
  const assumptions = generateAssumptions(pack);
  const confidenceScores = {
    orgScale: scoreOrgScale(pack.scale),
    moduleComplexity: scoreModuleComplexity(modules),
    customRatio: 0.5,
    deliveryCycle: 0.6,
  };
  const phaseProposal = buildPhaseProposal(modules, effortEstimate);

  return createInitialEstimate({
    initialEstimateId: estimateId,
    requirementPackId: pack.requirementPackId,
    effortEstimate,
    riskTags,
    assumptions,
    confidenceScores,
    phaseProposal,
    ownerUserId: input.ownerUserId,
  });
}

// ------------------------------------------------------------------
// SOW — generateFromPack
// ------------------------------------------------------------------

export { findSowDocumentById, findSowDocumentsByPackId, listSowDocumentsByOwner, updateSowDocument, deleteSowDocument, bumpSowVersion };

export async function generateSowFromPack(input: {
  requirementPack: RequirementPackRow;
  cloudProduct?: string;
  ownerUserId?: string;
}): Promise<SowDocumentRow[]> {
  const { requirementPack: pack, cloudProduct = "金蝶AI星空" } = input;

  let modules = (pack.modules ?? []) as Array<{
    moduleName?: string;
    subModules?: string[];
    customization?: boolean;
  }>;

  if (modules.length === 0) {
    const row = await createSowDocument({
      sowDocumentId: randomUUID(),
      requirementPackId: pack.requirementPackId,
      cloudProduct,
      module: "待确认模块范围",
      category: "标准功能",
      description: "基于当前需求包，模块范围尚未明确，需售前顾问补充。",
      ownerUserId: input.ownerUserId,
    });
    return [row];
  }

  // Deduplicate by moduleName
  const moduleMap = new Map<string, { moduleName: string; subModules: string[]; customization?: boolean }>();
  for (const mod of modules) {
    const moduleName = mod.moduleName ?? "未命名模块";
    const existing = moduleMap.get(moduleName);
    if (existing) {
      existing.subModules = [...new Set([...existing.subModules, ...(mod.subModules ?? [])])];
      if (mod.customization) existing.customization = true;
    } else {
      moduleMap.set(moduleName, { moduleName, subModules: mod.subModules ?? [], customization: mod.customization });
    }
  }
  modules = Array.from(moduleMap.values());

  const rows: SowDocumentRow[] = [];
  for (const mod of modules) {
    const moduleName = mod.moduleName ?? "未命名模块";
    const hasCustomization = mod.customization === true || (mod.subModules ?? []).some((s: string) =>
      s.toLowerCase().includes("定制") || s.toLowerCase().includes("开发"),
    );
    const category = hasCustomization ? "定制开发" : "标准功能";
    const description = `模块「${moduleName}」的实施范围包含${(mod.subModules ?? []).length}个子项。`;
    const customizationScope = hasCustomization
      ? `包含定制开发：${(mod.subModules ?? []).filter((s: string) => s.toLowerCase().includes("定制") || s.toLowerCase().includes("开发")).join("、")}`
      : undefined;

    const row = await createSowDocument({
      sowDocumentId: randomUUID(),
      requirementPackId: pack.requirementPackId,
      cloudProduct,
      module: moduleName,
      category,
      description,
      customizationScope,
      ownerUserId: input.ownerUserId,
    });
    rows.push(row);
  }

  return rows;
}
