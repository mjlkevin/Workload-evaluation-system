// ============================================================
// O4 Handler：harness_report_generation / harness_answer_submission
// 报告生成与 v2 提交的建议动作响应（dispatch 层不直接生成报告）
// ============================================================

import type { WorkbenchContext } from "../workbench-context.service";
import type { WorkbenchIntent } from "../workbench-intent.service";
import type { WorkbenchDispatchData, WorkbenchDispatchInput } from "../workbench-dispatch.service";
import type { WorkbenchIntentHandler } from "./handler.types";

/**
 * 报告生成 / v2 提交建议动作回复
 */
function buildReportGenerationResponse(intent: { intent: WorkbenchIntent; confidence: number; routingRule: string }, context: WorkbenchContext, input: WorkbenchDispatchInput): WorkbenchDispatchData {
  const isV2 = intent.intent === "harness_answer_submission";
  const answer = isV2
    ? "检测到你希望基于已有 v1 报告补充信息并生成 v2。请通过结构化卡片提交补充信息，或在卡片中填写后点击「提交补充并生成 v2」。"
    : "检测到你希望生成需求解析报告。请上传需求文件后点击下方按钮启动报告生成流程。";
  return {
    intent: intent.intent,
    answer,
    businessRole: input.businessRole,
    roleLabel: input.roleLabel,
    model: "rule-static",
    suggestedActions: isV2
      ? [{ id: "submit_structured_answers", label: "提交补充并生成 v2", actionType: "submit_structured_answers", requiresConfirm: false }]
      : [{ id: "generate_requirement_report", label: "生成需求解析报告", actionType: "generate_requirement_report", requiresConfirm: false }],
    trace: {
      intentConfidence: intent.confidence,
      routingRule: intent.routingRule,
      contextRefs: context.contextRefs,
    },
  };
}

export const harnessReportHandler: WorkbenchIntentHandler = {
  intents: ["harness_report_generation", "harness_answer_submission"],
  handle: ({ intent, context, input }) => buildReportGenerationResponse(intent, context, input),
};
