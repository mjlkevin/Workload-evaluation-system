// ============================================================
// O4 Handler：attachment_qa / attachment_summary — 基于附件解析上下文的模型问答
// 守护口径：文件上传仅提问时只走本路径，不触发报告生成工作流（不建 Harness Run）。
// ============================================================

import type { WorkbenchIntentHandler } from "./handler.types";
import { answerWithModelAndContext } from "./model-answer";

export const attachmentQaHandler: WorkbenchIntentHandler = {
  intents: ["attachment_qa", "attachment_summary"],
  async handle({ intent, context, input, modelClassification }) {
    const result = await answerWithModelAndContext(input, intent, context);
    if (modelClassification) result.trace.modelClassification = modelClassification;
    return result;
  },
};
