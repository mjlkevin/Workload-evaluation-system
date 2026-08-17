// ============================================================
// O4 Handler：knowledge_query — 只读知识库工具查询 + 检索失败模型兜底
// 不触发 Kimi 主评估或任何写动作。
// ============================================================

import type { KnowledgeBaseProfile } from "../../../types";
import { queryZhipuKnowledgeBase, type ZhipuKnowledgeToolConfig, type ZhipuKnowledgeToolTrace } from "../knowledge-tool.service";
import {
  resolveActiveKnowledgeBaseCatalog,
  resolveActiveKnowledgeBaseConfig,
  type ResolvedActiveKnowledgeBaseCatalog,
} from "../../../modules/system/system.repository";
import { routeKnowledgeBase, type KnowledgeBaseRouteDecision } from "../knowledge-base-router.service";
import type { WorkbenchContext } from "../workbench-context.service";
import type { WorkbenchDispatchData, WorkbenchDispatchInput } from "../workbench-dispatch.service";
import type { WorkbenchIntentHandler } from "./handler.types";
import { asCleanString, parseJsonObject } from "./json-utils";

function buildKnowledgeToolAnswer(trace: ZhipuKnowledgeToolTrace): string {
  const lines = [
    "## 知识库参考",
    "",
    ...(trace.knowledgeBaseName ? [`来源知识库：${trace.knowledgeBaseName}`, ""] : []),
    trace.answer,
    "",
    [
      `工具：${trace.toolId}`,
      `检索片段：${trace.chunksCount} 条`,
      `最高相关度：${trace.topScore.toFixed(2)}`,
      `置信度：${trace.confidence}`,
      trace.fallbackReason ? `备注：${trace.fallbackReason}` : "",
    ].filter(Boolean).join("；"),
    "",
    "该结果仅作为产品知识参考，不会自动改写正式估算、项目评估草稿或传统业务记录。",
  ];
  return lines.join("\n");
}

function createInjectedDefaultProfile(knowledgeId: string): KnowledgeBaseProfile {
  return {
    id: "injected-default",
    name: "默认知识库",
    description: "测试或兼容调用注入的默认知识库",
    knowledgeId: knowledgeId || "injected",
    routingKeywords: [],
    allowedBusinessRoles: [],
    enabled: true,
    isDefault: true,
    priority: 100,
  };
}

function summarizeKnowledgeAttempt(profile: KnowledgeBaseProfile, trace: ZhipuKnowledgeToolTrace) {
  return {
    profileId: profile.id,
    ...(trace.fallbackReason ? { fallbackReason: trace.fallbackReason } : {}),
    chunksCount: trace.chunksCount,
    topScore: trace.topScore,
    ...(trace.contextRef ? { contextRef: trace.contextRef } : {}),
  };
}

function attachKnowledgeRoute(
  trace: ZhipuKnowledgeToolTrace,
  profile: KnowledgeBaseProfile | undefined,
  route: KnowledgeBaseRouteDecision,
  attempts: ReturnType<typeof summarizeKnowledgeAttempt>[],
): ZhipuKnowledgeToolTrace {
  return {
    ...trace,
    ...(profile ? {
      knowledgeBaseProfileId: profile.id,
      knowledgeBaseName: profile.name,
    } : {}),
    route: {
      mode: route.mode,
      confidence: route.confidence,
      reason: route.reason,
      ...(route.primaryProfile ? { primaryProfileId: route.primaryProfile.id } : {}),
      ...(attempts.length > 1 && route.fallbackProfile ? { fallbackProfileId: route.fallbackProfile.id } : {}),
      attempts,
    },
  };
}

async function buildKnowledgeQueryResponse(
  intent: { confidence: number; routingRule: string },
  context: WorkbenchContext,
  input: WorkbenchDispatchInput,
): Promise<WorkbenchDispatchData> {
  const legacyConfig = resolveActiveKnowledgeBaseConfig();
  const resolvedCatalog = input.knowledgeBaseCatalog || resolveActiveKnowledgeBaseCatalog();
  const catalog: ResolvedActiveKnowledgeBaseCatalog = input.knowledgeQuery && resolvedCatalog.profiles.length === 0
    ? { ...resolvedCatalog, profiles: [createInjectedDefaultProfile(legacyConfig.knowledgeId)] }
    : resolvedCatalog;
  const route = await routeKnowledgeBase({
    query: input.message,
    businessRole: input.businessRole,
    profiles: catalog.profiles,
    modelSelect: async ({ query, candidates }) => {
      const modelResult = await input.modelChat({
        systemPrompt: [
          "你是 WES 知识库路由器。",
          "只能从调用方提供、且已按用户角色过滤的候选知识库中选择一个。",
          "只返回 JSON：{\"knowledgeBaseId\":\"候选ID\",\"confidence\":0到1,\"reason\":\"简短理由\"}。",
          "不得返回候选目录以外的 ID，不回答用户业务问题。",
        ].join("\n"),
        userContent: JSON.stringify({ query, candidates }),
      });
      const payload = parseJsonObject(modelResult.answer) || parseJsonObject(modelResult.rawContent);
      if (!payload) return null;
      return {
        knowledgeBaseId: asCleanString(payload.knowledgeBaseId, 64),
        confidence: Number(payload.confidence),
        reason: asCleanString(payload.reason, 200),
      };
    },
  });
  const knowledgeQuery = input.knowledgeQuery || ((query: string, conf?: ZhipuKnowledgeToolConfig) => queryZhipuKnowledgeBase(query, conf || {}));
  const queryProfile = (profile: KnowledgeBaseProfile) => knowledgeQuery(input.message, {
    apiKey: catalog.apiKey,
    knowledgeId: profile.knowledgeId,
    model: catalog.model,
    apiBaseUrl: catalog.apiBaseUrl,
    retrievalParams: catalog.retrievalParams,
    promptProfile: catalog.promptProfile,
    configVersion: catalog.configVersion,
    requestId: input.requestId,
  });

  let selectedProfile = route.primaryProfile;
  const attempts: ReturnType<typeof summarizeKnowledgeAttempt>[] = [];
  let rawKnowledgeTool: ZhipuKnowledgeToolTrace;
  if (route.primaryProfile) {
    rawKnowledgeTool = await queryProfile(route.primaryProfile);
    attempts.push(summarizeKnowledgeAttempt(route.primaryProfile, rawKnowledgeTool));
    if (rawKnowledgeTool.fallbackReason === "retrieval_empty" && route.fallbackProfile) {
      const fallbackTrace = await queryProfile(route.fallbackProfile);
      attempts.push(summarizeKnowledgeAttempt(route.fallbackProfile, fallbackTrace));
      rawKnowledgeTool = fallbackTrace;
      selectedProfile = route.fallbackProfile;
    }
  } else {
    rawKnowledgeTool = await queryZhipuKnowledgeBase(input.message, {
      apiKey: "",
      knowledgeId: "",
      model: catalog.model,
      apiBaseUrl: catalog.apiBaseUrl,
      retrievalParams: catalog.retrievalParams,
      promptProfile: catalog.promptProfile,
      configVersion: catalog.configVersion,
      requestId: input.requestId,
    });
  }
  const knowledgeTool = attachKnowledgeRoute(rawKnowledgeTool, selectedProfile, route, attempts);
  const routeContextRefs = attempts.map((attempt) => attempt.contextRef).filter((value): value is string => Boolean(value));
  const contextRefs = Array.from(new Set([
    ...context.contextRefs,
    ...routeContextRefs,
    knowledgeTool.contextRef,
  ].filter(Boolean)));

  // 知识库检索失败或为空时，fallback 到模型通用知识回答
  if (knowledgeTool.fallbackReason) {
    const systemPrompt = [
      "你是 WES 工作量评估系统首页 AI 工作台。",
      input.rolePrompt || "",
      `当前工作流：${input.workflowKey || "free_chat"}`,
      "请用中文简洁回答，优先结合用户上下文，避免冗余。",
      "【重要】用户的问题本应从知识库检索文档回答，但知识库未找到相关文档。",
      "请基于你的通用知识尽可能回答用户的问题，但必须在回答开头明确标注：",
      "「⚠️ 知识库未检索到相关文档，以下为模型通用知识，仅供参考，不代表官方方案。」",
      // ISS-2026-08-10-005（回答 Markdown 格式散乱）：与 model-answer 同款排版规范，
      // 覆盖知识库检索失败时的模型兜底回答通道。
      "【输出排版规范】",
      "- 使用标准 Markdown：标题写作「## 标题」（# 后必须有空格，且独占一行）；",
      "- 列表项各自独占一行，以「- 」或「1. 」开头；",
      "- 小节之间用空行分隔；不要使用「##1.」「-**」等无空格、无换行的紧凑写法。",
      "【反幻觉约束】",
      "- 不要编造不存在的文档名称、版本号、案例或数据。",
      "- 涉及具体数值时，必须标注为估算或参考值。",
      "- 如果确实不了解该领域，诚实告知用户。",
    ].filter(Boolean).join("\n");

    const startedAt = Date.now();
    let modelResult: { answer: string; rawContent: string; provider?: string; model?: string; attempts?: number; finishReason?: string };

    // RP-029 返工：知识库 fallback 也支持流式
    if (input.streamingAdapter && input.modelChatStream) {
      let fullContent = "";
      try {
        const stream = input.modelChatStream({ systemPrompt, userContent: input.message });
        for await (const chunk of stream) {
          input.streamingAdapter.onToken(chunk);
          fullContent += chunk.contentDelta || "";
        }
        input.streamingAdapter.onComplete?.(fullContent);
      } catch (err) {
        const error = err instanceof Error ? err : new Error("stream_failed");
        input.streamingAdapter.onError?.(error);
        throw error;
      }
      modelResult = { answer: fullContent, rawContent: fullContent, provider: "kimi" };
    } else {
      modelResult = await input.modelChat({ systemPrompt, userContent: input.message });
    }
    const latencyMs = Math.max(0, Date.now() - startedAt);

    const combinedAnswer = [
      buildKnowledgeToolAnswer(knowledgeTool),
      "",
      "---",
      "",
      modelResult.answer,
    ].join("\n");

    return {
      intent: "knowledge_query",
      answer: combinedAnswer,
      businessRole: input.businessRole,
      roleLabel: input.roleLabel,
      model: modelResult.model || input.model,
      rawContent: modelResult.rawContent,
      suggestedActions: [],
      trace: {
        intentConfidence: intent.confidence,
        routingRule: intent.routingRule,
        contextRefs,
        knowledgeTool,
        modelRun: {
          runKind: "knowledge_fallback" as const,
          auditMode: "lightweight" as const,
          createsHarnessRun: false as const,
          provider: modelResult.provider || "kimi",
          model: modelResult.model || input.model,
          contextRefs,
          latencyMs,
          rawContentLength: String(modelResult.rawContent || "").length,
          ...(typeof modelResult.attempts === "number" ? { attempts: modelResult.attempts } : {}),
          ...(modelResult.finishReason ? { finishReason: modelResult.finishReason } : {}),
        },
      },
    };
  }

  return {
    intent: "knowledge_query",
    answer: buildKnowledgeToolAnswer(knowledgeTool),
    businessRole: input.businessRole,
    roleLabel: input.roleLabel,
    model: knowledgeTool.model,
    suggestedActions: [],
    trace: {
      intentConfidence: intent.confidence,
      routingRule: intent.routingRule,
      contextRefs,
      knowledgeTool,
    },
  };
}

export const knowledgeQueryHandler: WorkbenchIntentHandler = {
  intents: ["knowledge_query"],
  handle: ({ intent, context, input }) => buildKnowledgeQueryResponse(intent, context, input),
};
