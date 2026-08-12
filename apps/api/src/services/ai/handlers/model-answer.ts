// ============================================================
// O4 搬迁：附件摘要 / 附件问答 / 普通业务问答的模型应答引擎
// attachment-qa 与 domain-qa 两个 handler 共用；内容逐字节搬迁，零逻辑变更。
// ============================================================

import type { WorkbenchContext } from "../workbench-context.service";
import type { WorkbenchIntent } from "../workbench-intent.service";
import type {
  StreamingChunk,
  WorkbenchDispatchData,
  WorkbenchDispatchInput,
  WorkbenchLightweightModelRunTrace,
  WorkbenchSuggestedAction,
} from "../workbench-dispatch.service";
import { extractFormBlockFromModelOutput } from "./form-block";

/**
 * 附件摘要 / 附件问答 — 调用模型回复
 */
export async function answerWithModelAndContext(
  input: WorkbenchDispatchInput,
  intent: { intent: WorkbenchIntent; confidence: number; routingRule: string },
  context: WorkbenchContext,
): Promise<WorkbenchDispatchData> {
  const systemPrompt = [
    "你是 WES 工作量评估系统首页 AI 工作台。",
    input.rolePrompt || "",
    `当前工作流：${input.workflowKey || "free_chat"}`,
    "请用中文简洁回答，优先结合用户上下文，避免冗余。",
    // ISS-2026-08-10-005（回答 Markdown 格式散乱）：模型实测输出单行紧凑
    // pseudo-markdown（## 无空格、列表无换行），提示词补排版规范（劝导层）。
    "【输出排版规范】",
    "- 使用标准 Markdown：标题写作「## 标题」（# 后必须有空格，且独占一行）；",
    "- 列表项各自独占一行，以「- 」或「1. 」开头；",
    "- 小节之间用空行分隔；不要使用「##1.」「-**」等无空格、无换行的紧凑写法。",
    "【反幻觉约束】",
    "- 不要编造不存在的文档名称、版本号、案例或数据。",
    "- 引用文档时必须标注来源，无法确认来源时明确说明这是基于通用知识的推断。",
    "- 当用户询问知识库/文档/方案时，如果知识库未配置或检索未命中，必须明确告知用户，不要虚构检索结果。",
    "- 涉及具体数值（如实施周期、重构率、并发量等）时，如非来自用户附件或明确来源，必须标注为估算或参考值。",
    input.attachment?.parsedSummary
      ? `【附件解析上下文】\n附件名：${input.attachment.name}\n${input.attachment.parsedSummary}`
      : "",
    input.latestHarnessArtifact?.artifactType === "requirement_report_v1"
      ? "【已有 v1 报告】用户已有需求解析报告 v1，当前追问请基于报告内容解释或回答，不要自动生成 v2。"
      : "",
    "当你需要用户补充结构化信息时，可以在正常中文回复后追加一个 ```json 代码块，且代码块只包含 {\"formBlock\":{...}}。",
    "formBlock 字段仅允许：blockId、title、description、submitLabel、submitMessageTemplate、fields；fields 最多 8 个，字段 type 仅允许 text、textarea、single_select、boolean、number；single_select options 最多 8 个。",
    "formBlock 只用于生成普通用户补充消息，不代表执行写动作、确认动作或正式业务落库。",
  ].filter(Boolean).join("\n");

  const userContent = input.message || "请分析上传的附件内容。";
  const startedAt = Date.now();

  // RP-029 返工：有 streamingAdapter + modelChatStream 时走流式路径
  let modelResult: { answer: string; rawContent: string; provider?: string; model?: string; attempts?: number; finishReason?: string };
  if (input.streamingAdapter && input.modelChatStream) {
    let fullContent = "";
    let lastChunk: StreamingChunk | undefined;
    try {
      const stream = input.modelChatStream({ systemPrompt, userContent });
      for await (const chunk of stream) {
        input.streamingAdapter.onToken(chunk);
        fullContent += chunk.contentDelta || "";
        lastChunk = chunk;
      }
      input.streamingAdapter.onComplete?.(fullContent);
    } catch (err) {
      const error = err instanceof Error ? err : new Error("stream_failed");
      input.streamingAdapter.onError?.(error);
      throw error;
    }
    const latencyMs = Math.max(0, Date.now() - startedAt);
    const parsedOutput = extractFormBlockFromModelOutput(fullContent, fullContent);
    modelResult = {
      answer: parsedOutput.answer,
      rawContent: fullContent,
      provider: lastChunk?.model ? "kimi" : undefined,
      model: lastChunk?.model,
      finishReason: lastChunk?.finishReason,
    };
    // 流式场景也需要记录 modelRun trace
    const modelRunTrace: WorkbenchLightweightModelRunTrace = {
      runKind: (intent.intent === "attachment_summary" || intent.intent === "attachment_qa") ? intent.intent : "attachment_summary",
      auditMode: "lightweight" as const,
      createsHarnessRun: false as const,
      provider: modelResult.provider || "kimi",
      model: modelResult.model || input.model,
      contextRefs: context.contextRefs,
      latencyMs,
      rawContentLength: fullContent.length,
      ...(modelResult.finishReason ? { finishReason: modelResult.finishReason } : {}),
    };
    const suggestedActions: WorkbenchSuggestedAction[] = [];
    if (input.attachment && !input.latestHarnessArtifact) {
      suggestedActions.push({
        id: "generate_requirement_report",
        label: "生成需求解析报告",
        actionType: "generate_requirement_report",
        requiresConfirm: false,
      });
    }
    return {
      intent: intent.intent,
      answer: parsedOutput.answer,
      businessRole: input.businessRole,
      roleLabel: input.roleLabel,
      model: input.model,
      rawContent: fullContent,
      formBlock: parsedOutput.formBlock,
      suggestedActions,
      trace: {
        intentConfidence: intent.confidence,
        routingRule: intent.routingRule,
        contextRefs: context.contextRefs,
        modelRun: modelRunTrace,
      },
    };
  }

  // 非流式路径：保持原有 modelChat 逻辑
  modelResult = await input.modelChat({ systemPrompt, userContent });
  const latencyMs = Math.max(0, Date.now() - startedAt);
  const { answer, rawContent } = modelResult;
  const parsedOutput = extractFormBlockFromModelOutput(answer, rawContent);

  const suggestedActions: WorkbenchSuggestedAction[] = [];
  if (input.attachment && !input.latestHarnessArtifact) {
    suggestedActions.push({
      id: "generate_requirement_report",
      label: "生成需求解析报告",
      actionType: "generate_requirement_report",
      requiresConfirm: false,
    });
  }

  const modelRun = input.attachment && (intent.intent === "attachment_summary" || intent.intent === "attachment_qa")
    ? {
      runKind: intent.intent,
      auditMode: "lightweight" as const,
      createsHarnessRun: false as const,
      provider: modelResult.provider || "kimi",
      model: modelResult.model || input.model,
      contextRefs: context.contextRefs,
      latencyMs,
      rawContentLength: String(rawContent || "").length,
      ...(typeof modelResult.attempts === "number" ? { attempts: modelResult.attempts } : {}),
      ...(modelResult.finishReason ? { finishReason: modelResult.finishReason } : {}),
    }
    : undefined;

  return {
    intent: intent.intent,
    answer: parsedOutput.answer,
    businessRole: input.businessRole,
    roleLabel: input.roleLabel,
    model: input.model,
    rawContent,
    formBlock: parsedOutput.formBlock,
    suggestedActions,
    trace: {
      intentConfidence: intent.confidence,
      routingRule: intent.routingRule,
      contextRefs: context.contextRefs,
      ...(modelRun ? { modelRun } : {}),
    },
  };
}
