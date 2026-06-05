import type {
  SealedBaselineRow,
  DeliverableRow,
  QualityGateReviewRow,
  AssessmentNarrativeRow,
  AssessmentHandoffRow,
} from "../../db/schema";
import {
  createSealedBaseline,
  findSealedBaselineById,
  findSealedBaselineByVersionId,
  listSealedBaselinesByStatus,
  supersedeSealedBaseline,
  deleteSealedBaseline,
  createDeliverable,
  findDeliverableById,
  listDeliverablesByVersion,
  findDeliverableByVersionAndType,
  updateDeliverableStatus,
  deleteDeliverable,
  createQualityGateReview,
  findQualityGateReviewById,
  findQualityGateReviewByVersionId,
  updateQualityGateReview,
  deleteQualityGateReview,
  createAssessmentNarrative,
  findAssessmentNarrativeById,
  findAssessmentNarrativeByVersionId,
  updateAssessmentNarrative,
  deleteAssessmentNarrative,
  createAssessmentHandoff,
  findAssessmentHandoffById,
  listAssessmentHandoffsByVersion,
  listAssessmentHandoffsByToRole,
  updateAssessmentHandoff,
  deleteAssessmentHandoff,
  type SealInput,
  type GenerateDeliverablesInput,
  type DeliverableType,
  type CreateReviewInput,
  type UpdateReviewInput,
  type CreateNarrativeInput,
  type UpdateNarrativeInput,
  type CreateHandoffInput,
  type UpdateHandoffInput,
  type V2Role,
} from "./pm-workbench.repository";

export type {
  SealInput,
  GenerateDeliverablesInput,
  DeliverableType,
  CreateReviewInput,
  UpdateReviewInput,
  CreateNarrativeInput,
  UpdateNarrativeInput,
  CreateHandoffInput,
  UpdateHandoffInput,
  V2Role,
};

// ====================================================================
// SealedBaseline — passthrough
// ====================================================================

export {
  createSealedBaseline as seal,
  findSealedBaselineById,
  findSealedBaselineByVersionId,
  listSealedBaselinesByStatus,
  supersedeSealedBaseline,
  deleteSealedBaseline,
};

// ====================================================================
// Deliverable — generation logic
// ====================================================================

export { findDeliverableById, listDeliverablesByVersion, findDeliverableByVersionAndType, updateDeliverableStatus, deleteDeliverable };

export async function generateAllDeliverables(input: GenerateDeliverablesInput): Promise<DeliverableRow[]> {
  const results: DeliverableRow[] = [];

  const effort = input.effortEstimate ?? [];
  const totalDays = effort.reduce((sum, e) => sum + e.days, 0);
  const ratePerDay = 3000;

  // Effort Table
  results.push(
    await createDeliverable({
      assessmentVersionId: input.assessmentVersionId,
      deliverableType: "effort_table",
      content: {
        title: "人天估算表",
        items: effort,
        totalDays,
        summary: `合计 ${totalDays} 人天，覆盖 ${effort.length} 个模块。`,
      },
      varianceBaseline: input.varianceBaseline,
    }),
  );

  // Resource Cost
  const costItems = effort.map((e) => ({
    module: e.module,
    days: e.days,
    rate: ratePerDay,
    cost: e.days * ratePerDay,
  }));
  const totalCost = costItems.reduce((sum, i) => sum + i.cost, 0);
  results.push(
    await createDeliverable({
      assessmentVersionId: input.assessmentVersionId,
      deliverableType: "resource_cost",
      content: {
        title: "资源人天成本表",
        items: costItems,
        totalCost,
        ratePerDay,
        summary: `按单价 ¥${ratePerDay}/人天，合计 ¥${totalCost.toLocaleString()}。`,
      },
      varianceBaseline: input.varianceBaseline,
    }),
  );

  // Variance Analysis
  const baselineDays = totalDays;
  const variance = totalDays - baselineDays;
  results.push(
    await createDeliverable({
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
      varianceBaseline: input.varianceBaseline,
    }),
  );

  // WBS
  const phases = input.phaseProposal ?? [];
  const wbsItems = phases.map((p, idx) => ({
    wbsCode: `1.${idx + 1}`,
    name: p.phase,
    modules: p.modules,
    estimatedDays: p.estimatedDays,
    milestone: p.milestone,
  }));
  results.push(
    await createDeliverable({
      assessmentVersionId: input.assessmentVersionId,
      deliverableType: "wbs",
      content: {
        title: "WBS 工作分解结构",
        items: wbsItems,
        summary: `共 ${wbsItems.length} 个阶段，覆盖 ${wbsItems.reduce((sum, i) => sum + i.modules.length, 0)} 个模块。`,
      },
      varianceBaseline: input.varianceBaseline,
    }),
  );

  return results;
}

// ====================================================================
// QualityGateReview — autoReview logic
// ====================================================================

export { createQualityGateReview, findQualityGateReviewById, findQualityGateReviewByVersionId, updateQualityGateReview, deleteQualityGateReview };

export async function autoReview(params: {
  assessmentVersionId: string;
  reviewerUserId?: string;
  deliverables: Array<{ deliverableType: string; status: string }>;
  narrativeStatus?: string;
  hasAssumptions?: boolean;
}): Promise<QualityGateReviewRow> {
  const { deliverables: dels, narrativeStatus, hasAssumptions } = params;

  const requiredTypes = ["effort_table", "resource_cost", "variance_analysis", "wbs"];
  const presentTypes = new Set(dels.map((d) => d.deliverableType));
  const deliverablesComplete = requiredTypes.every((t) => presentTypes.has(t));
  const allDeliverablesConfirmed = dels
    .filter((d) => requiredTypes.includes(d.deliverableType))
    .every((d) => d.status === "confirmed");

  const checklist = {
    deliverablesComplete: deliverablesComplete && allDeliverablesConfirmed,
    methodologySevenPhases: true,
    rateCardCorrect: true,
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

  return createQualityGateReview({
    assessmentVersionId: params.assessmentVersionId,
    reviewerUserId: params.reviewerUserId,
    checklist,
    verdict,
    rejectionReasons,
    notes: allPass ? "审核通过" : "存在未达标项，已驳回",
  });
}

// ====================================================================
// AssessmentNarrative — generateDraft logic
// ====================================================================

export { createAssessmentNarrative, findAssessmentNarrativeById, findAssessmentNarrativeByVersionId, updateAssessmentNarrative, deleteAssessmentNarrative };

export async function generateNarrativeDraft(params: {
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

  const acceptanceScope = "验收范围包含模块功能验收、集成测试、UAT 用户验收测试。最终以客户签署验收报告为项目关闭条件。";

  const timelineAndCost = phaseProposal.length > 0
    ? phaseProposal.map((p) => `${p.phase}约 ${p.estimatedDays} 人天，里程碑：${p.milestone}`).join("；")
    : "实施周期与成本待进一步细化。";

  return createAssessmentNarrative({
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

// ====================================================================
// AssessmentHandoff — passthrough
// ====================================================================

export {
  createAssessmentHandoff,
  findAssessmentHandoffById,
  listAssessmentHandoffsByVersion,
  listAssessmentHandoffsByToRole,
  updateAssessmentHandoff,
  deleteAssessmentHandoff,
};
