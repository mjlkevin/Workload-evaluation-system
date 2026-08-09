// ============================================================
// O10 Batch B: capability_discovery — 能力发现回复
// 默认走模型辅助（基于事实表生成自然语言回复），
// 模型失败时降级为结构化事实表摘要（标注「以下为能力清单摘要」）。
// ============================================================

import type { WorkbenchContext } from "../workbench-context.service";
import type { WorkbenchDispatchData, WorkbenchDispatchInput } from "../workbench-dispatch.service";
import type { WorkbenchIntentHandler } from "./handler.types";
import { formatCapabilityFacts, formatCapabilityFactsBrief } from "../workbench-capability-facts";

const CAPABILITY_SYSTEM_PROMPT = `你是 WES AI 工作台的助手。用户正在询问你能做什么。

以下是你的真实能力清单（唯一事实源），你必须只基于这些事实作答，不得新增未实现的能力承诺：

{{FACTS}}

要求：
1. 用自然、亲切的语气回复，直接回应用户的原话。
2. 只列出上述事实中的能力，禁止编造不存在的能力。
3. 如果用户问的是特定能力，重点介绍该能力；如果是泛泛询问，概括介绍主要能力。
4. 简要说明附件仅作为上下文、不会自动触发报告生成。
5. 说明写操作（创建、修改）需要用户确认后才会执行。
6. 回复控制在 300 字以内。`;

function buildStaticFallbackResponse(
  intent: { confidence: number; routingRule: string },
  context: WorkbenchContext,
  input: WorkbenchDispatchInput,
): WorkbenchDispatchData {
  const brief = formatCapabilityFactsBrief();
  const answer = [
    `我是 WES AI 工作台，当前角色：${context.user.username}（${context.user.role}）。`,
    "",
    "（以下为能力清单摘要）",
    "",
    "我可以帮你完成以下工作：",
    brief,
    "",
    "上传附件时，附件仅作为上下文；除非你明确要求生成报告，我不会自动进入报告生成流程。",
  ].join("\n");

  return {
    intent: "capability_discovery",
    answer,
    businessRole: input.businessRole,
    roleLabel: input.roleLabel,
    model: "rule-static",
    suggestedActions: [
      { id: "upload_file", label: "上传需求文件", actionType: "send_message", requiresConfirm: false },
      { id: "query_projects", label: "查看我的项目", actionType: "open_project_list", requiresConfirm: false },
      { id: "lookup_customer", label: "检索客户主体", actionType: "company_lookup", requiresConfirm: false },
    ],
    trace: {
      intentConfidence: intent.confidence,
      routingRule: intent.routingRule,
      contextRefs: context.contextRefs,
    },
  };
}

async function buildModelAssistedResponse(
  intent: { confidence: number; routingRule: string },
  context: WorkbenchContext,
  input: WorkbenchDispatchInput,
): Promise<WorkbenchDispatchData> {
  const systemPrompt = CAPABILITY_SYSTEM_PROMPT.replace("{{FACTS}}", formatCapabilityFacts());
  const userContent = input.message || "你能做什么？";

  try {
    const modelResult = await input.modelChat({ systemPrompt, userContent });
    const answer = modelResult.answer || modelResult.rawContent || "";

    // 如果模型返回空或明显异常，降级
    if (!answer.trim() || answer.trim().length < 10) {
      return buildStaticFallbackResponse(intent, context, input);
    }

    return {
      intent: "capability_discovery",
      answer: answer.trim(),
      businessRole: input.businessRole,
      roleLabel: input.roleLabel,
      model: modelResult.model || input.model,
      suggestedActions: [
        { id: "upload_file", label: "上传需求文件", actionType: "send_message", requiresConfirm: false },
        { id: "query_projects", label: "查看我的项目", actionType: "open_project_list", requiresConfirm: false },
        { id: "lookup_customer", label: "检索客户主体", actionType: "company_lookup", requiresConfirm: false },
      ],
      trace: {
        intentConfidence: intent.confidence,
        routingRule: intent.routingRule,
        contextRefs: context.contextRefs,
      },
    };
  } catch {
    // 模型调用失败：降级为结构化事实表摘要
    return buildStaticFallbackResponse(intent, context, input);
  }
}

export const capabilityHandler: WorkbenchIntentHandler = {
  intents: ["capability_discovery"],
  async handle({ intent, context, input, modelClassification }) {
    const resp = await buildModelAssistedResponse(intent, context, input);
    if (modelClassification) resp.trace.modelClassification = modelClassification;
    return resp;
  },
};
