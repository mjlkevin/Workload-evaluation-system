// ============================================================
// O4 Handler：wes_data_query — owner-scoped 项目/评估数据查询
// ============================================================

import type { WorkbenchContext } from "../workbench-context.service";
import type { WorkbenchDispatchData, WorkbenchDispatchInput } from "../workbench-dispatch.service";
import type { WorkbenchIntentHandler } from "./handler.types";

/**
 * WES 数据查询回复
 */
const PROJECT_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  active: "进行中",
  reviewing: "评审中",
  published: "已发布",
  archived: "已归档",
};

function labelProjectStatus(status: string): string {
  return PROJECT_STATUS_LABELS[status] || status || "未知";
}

function summarizeProjectStatuses(projects: WorkbenchContext["visibleProjects"]): string[] {
  const statusCounts = new Map<string, number>();
  for (const project of projects) {
    const label = labelProjectStatus(project.status);
    statusCounts.set(label, (statusCounts.get(label) || 0) + 1);
  }
  return Array.from(statusCounts.entries()).map(([label, count]) => `${label}：${count}`);
}

function buildProjectListResponse(intent: { confidence: number; routingRule: string }, context: WorkbenchContext, input: WorkbenchDispatchInput): WorkbenchDispatchData {
  const projects = context.visibleProjects;
  let answer: string;
  if (projects.length === 0) {
    answer = "你当前还没有创建过项目评估。可以在上传需求文件后，通过 AI 生成需求解析报告，再进入正式评估来创建项目。";
  } else {
    const statusSummary = summarizeProjectStatuses(projects);
    const pendingDrafts = projects.filter((project) => project.aiDraftReviewStatus === "pending");
    const lines = projects.map((project, index) =>
      `${index + 1}. ${project.projectName || "未命名项目"} — 客户：${project.customerName || "待补充"} — 状态：${labelProjectStatus(project.status)} — 阶段：${project.currentStage || "待补充"}`
    );
    const pendingLines = pendingDrafts.length
      ? [
        "",
        `待确认 AI 草稿：${pendingDrafts.length} 个`,
        ...pendingDrafts.map((project, index) => `${index + 1}. ${project.projectName || "未命名项目"} — 需要人工确认后才会回写 Harness 审计链。`),
      ]
      : ["", "待确认 AI 草稿：0 个"];
    answer = [
      `你创建过的项目（最近 ${projects.length} 个）：`,
      "",
      `状态汇总：${statusSummary.join("，")}`,
      "",
      ...lines,
      ...pendingLines,
      "",
      "这些结果仅来自你有权限的项目评估记录，不包含其他用户数据。",
    ].join("\n");
  }

  return {
    intent: "wes_data_query",
    answer,
    businessRole: input.businessRole,
    roleLabel: input.roleLabel,
    model: "rule-static",
    suggestedActions: [
      { id: "open_project_list", label: "打开项目列表", actionType: "open_project_list", requiresConfirm: false },
      { id: "upload_file", label: "上传需求文件", actionType: "send_message", requiresConfirm: false },
    ],
    trace: {
      intentConfidence: intent.confidence,
      routingRule: intent.routingRule,
      contextRefs: context.contextRefs,
    },
  };
}

export const wesDataQueryHandler: WorkbenchIntentHandler = {
  intents: ["wes_data_query"],
  handle: ({ intent, context, input }) => buildProjectListResponse(intent, context, input),
};
