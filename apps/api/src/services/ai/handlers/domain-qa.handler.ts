// ============================================================
// O4 Handler：domain_qa — 普通业务问答模型自然回复（兜底路径）
// 同文件保留 unsupported_or_out_of_scope 静态拦截：
// 该意图只可能经由 O10 Batch A 兜底分类采纳产生，与兜底链同属一环。
// ============================================================

import type { WorkbenchContext } from "../workbench-context.service";
import type { ModelClassificationResult } from "../workbench-intent.service";
import type { WorkbenchDispatchData, WorkbenchDispatchInput } from "../workbench-dispatch.service";
import type { WorkbenchIntentHandler } from "./handler.types";
import { answerWithModelAndContext } from "./model-answer";

/**
 * 不支持/超出范围的请求 — 静态回复
 */
function buildUnsupportedResponse(
  intent: { confidence: number; routingRule: string },
  context: WorkbenchContext,
  input: WorkbenchDispatchInput,
  modelClassification?: ModelClassificationResult,
): WorkbenchDispatchData {
  const answer = "抱歉，这个请求超出了我的能力范围。我是 WES AI 工作台，主要帮助你完成需求解析、工作量评估和项目管理工作。你可以尝试上传需求文件，或者问我与项目评估相关的问题。";
  return {
    intent: "unsupported_or_out_of_scope",
    answer,
    businessRole: input.businessRole,
    roleLabel: input.roleLabel,
    model: "rule-static",
    suggestedActions: [
      { id: "upload_file", label: "上传需求文件", actionType: "send_message", requiresConfirm: false },
      { id: "ask_capability", label: "了解我能做什么", actionType: "send_message", requiresConfirm: false },
    ],
    trace: {
      intentConfidence: intent.confidence,
      routingRule: intent.routingRule,
      contextRefs: context.contextRefs,
      ...(modelClassification ? { modelClassification } : {}),
    },
  };
}

export const domainQaHandler: WorkbenchIntentHandler = {
  intents: ["domain_qa"],
  async handle({ intent, context, input, modelClassification }) {
    const result = await answerWithModelAndContext(input, intent, context);
    if (modelClassification) result.trace.modelClassification = modelClassification;
    return result;
  },
};

export const unsupportedHandler: WorkbenchIntentHandler = {
  intents: ["unsupported_or_out_of_scope"],
  handle: ({ intent, context, input, modelClassification }) =>
    buildUnsupportedResponse(intent, context, input, modelClassification),
};
