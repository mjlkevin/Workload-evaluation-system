// ============================================================
// O4 搬迁：AI 工作台流式对话入口（SSE）
// 内容逐字节搬迁自 chat.service.ts，零逻辑变更。
// ============================================================

import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

import { asString } from "../../../utils/helpers";
import { normalizeKimiModelName } from "../../../utils/model-name";
import { resolveBusinessRole } from "../../../middleware/auth";
import { resolveActiveApiKeyForScope, resolveActiveRequirementKimiApiKey } from "../../../modules/system/system.repository";
import { appendAiSessionEvent, getAiSession } from "../../../modules/ai-sessions/ai-sessions.usecase";
import { deriveSessionMessages } from "../../../modules/ai-sessions/session-history";
import { dispatchHomeWorkbenchTurn, type StreamingAdapter, type StreamingChunk } from "../workbench-dispatch.service";
import { hasOngoingWorkbenchToolInteraction } from "../workbench-intent.service";
import {
  resolveWorkbenchInjectableTools,
  runWorkbenchToolLoop,
  runWorkbenchToolLoopStream,
} from "../workbench-tool-loop";
import type { ChatCompletionResponse } from "../../../ai/provider";
import { recordWorkbenchTurnFailureTrace, recordWorkbenchTurnTrace } from "../../../modules/trace/trace.usecase";
import {
  HOME_ROLE_PRESETS,
  allParsedHomeAttachments,
  buildWorkbenchChatModelInput,
  currentUserFromRequest,
  ensureHomeAiSession,
  getKimiProvider,
  isExplicitReportRequest,
  latestParsedHomeAttachment,
  latestSessionAttachmentWithSummary,
  latestUserMessage,
  normalizeHomeMessages,
  resolveWorkbenchStreamFinalContent,
  type WorkbenchModelMemoryRef,
  resolveWorkbenchChatScenario,
} from "./workbench-shared";
import { runExplicitHomeReportFlow } from "./report-flow";

/**
 * RP-029 返工：AI 工作台流式对话接口（SSE）
 * 复用 dispatchHomeWorkbenchTurn 的完整意图路由、工具调用、审计链路。
 * 流式能力仅作为响应传输形态增强，不改变业务决策路径。
 *
 * SSE 事件格式：
 * - event: delta    data: { content, reasoningContent, model, finishReason? }
 * - event: static   data: { intent, answer, suggestedActions, trace }
 * - event: done     data: { content, model, intent, session?, trace? }
 * - event: error    data: { code, message }
 */
export async function homeWorkbenchChatStream(req: Request, res: Response) {
  const requestId = res.locals?.requestId || randomUUID();
  const user = await currentUserFromRequest(req, res);
  if (!user) return;

  // 设置 SSE 头
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("X-Request-Id", requestId);
  res.flushHeaders();

  const sendSseEvent = (event: string, data: unknown) => {
    if (!aborted) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  // client disconnect/abort 处理
  let aborted = false;
  req.on("close", () => {
    aborted = true;
  });

  const body = (req.body || {}) as { messages?: unknown; workflowKey?: unknown; sessionId?: unknown; clientAction?: unknown };
  const messages = normalizeHomeMessages(body.messages);
  if (messages.length === 0) {
    sendSseEvent("error", { code: "messages_required", message: "消息列表不能为空" });
    res.end();
    return;
  }
  const userMessage = latestUserMessage(messages);
  if (!userMessage) {
    sendSseEvent("error", { code: "user_message_required", message: "缺少用户消息" });
    res.end();
    return;
  }
  let traceSessionId: string | undefined;
  let traceContextRefs: string[] = [];
  let traceRoutingRule = "failed_before_dispatch";

  try {
    const workflowKey = asString(body.workflowKey) || "free_chat";
    const session = await ensureHomeAiSession(user, {
      sessionId: body.sessionId,
      workflowKey,
      title: userMessage.content.slice(0, 40),
    });
    traceSessionId = session.sessionId;

    // 记录用户消息到 session
    const sessionWithUserTurn = (await appendAiSessionEvent(user, session.sessionId, {
      message: userMessage,
      attachments: userMessage.attachments,
    })) || session;

    // ISS-2026-08-08-001: 请求级附件优先，缺失时回退到已落库会话附件（与非流式对齐）
    const parsedAttachment = latestParsedHomeAttachment(messages) ?? latestSessionAttachmentWithSummary(sessionWithUserTurn);
    const allAttachments = allParsedHomeAttachments(messages);
    traceContextRefs = parsedAttachment ? [`attachment:${parsedAttachment.name}`] : [];
    const businessRole = resolveBusinessRole(user);
    const roleLabel = HOME_ROLE_PRESETS[businessRole].label;
    // DEF-2026-09-03-001：模型名取自场景配置（assessment 绑定），不再是 env 默认值。
    const modelName = normalizeKimiModelName((await resolveWorkbenchChatScenario()).model);

    // ISS-2026-08-08-001: 显式报告闸门与非流式对齐——命中时走共享报告流程，结果以 done 事件一次性下发
    if (parsedAttachment && (isExplicitReportRequest(userMessage.content) || asString(body.clientAction) === "generate_requirement_report")) {
      const flowResult = await runExplicitHomeReportFlow({
        user,
        workflowKey,
        session,
        sessionWithUserTurn,
        parsedAttachment,
        allAttachments,
      });
      if (!flowResult.ok) {
        sendSseEvent("error", { code: flowResult.reason, message: "AI 服务未配置 API 密钥" });
        res.end();
        return;
      }
      sendSseEvent("done", {
        content: flowResult.body.answer,
        model: flowResult.body.model,
        intent: flowResult.body.intent,
        session: flowResult.body.session,
        trace: flowResult.body.trace,
        suggestedActions: flowResult.body.suggestedActions,
      });
      res.end();
      return;
    }

    // 构建流式 adapter — 收集 chunks 并通过 SSE 发送
    const streamedChunks: StreamingChunk[] = [];
    // DEF-2026-08-27-001 B3：流式通道的 memoryRef 只存在于 metadata chunk（modelChat
    // 捕获包装不覆盖 modelChatStream），故在此暂存，供 assistant metadata 落库使用。
    let streamMemoryRef: WorkbenchModelMemoryRef | undefined;
    const streamingAdapter: StreamingAdapter = {
      onToken: (chunk) => {
        // metadata chunk 是模型调用元信息，不是内容增量：既不入 streamedChunks
        // （否则污染 resolveWorkbenchStreamFinalContent），也不下发 delta 帧。
        if (chunk.kind === "metadata") {
          if (chunk.memoryRef) streamMemoryRef = chunk.memoryRef;
          return;
        }
        streamedChunks.push(chunk);
        sendSseEvent("delta", {
          content: chunk.contentDelta || "",
          reasoningContent: chunk.reasoningContentDelta || "",
          model: chunk.model,
          finishReason: chunk.finishReason,
        });
      },
      onComplete: () => {
        // 流式完成，done 事件将在 dispatch 返回后发送
      },
      onError: (error) => {
        sendSseEvent("error", { code: error.message || "stream_failed", message: "流式输出异常" });
      },
    };

    // 构建流式模型调用函数
    const modelChatStream = async function* (params: { systemPrompt: string; userContent: string }): AsyncIterable<StreamingChunk> {
      const { apiKey } = resolveActiveRequirementKimiApiKey();
      if (!apiKey) throw new Error("api_key_missing");

      // DEF-2026-08-27-001 B3：与同步非流式路径共用同一份模型入参组装口径
      // （历史窗口 slice(-12) + 覆盖末条 + active 记忆注入）。此前本路径自行内联
      // 整形、只拼历史不注入记忆，属同源不对称。
      // projectId 取 "default"，与 workbench-chat.handler.ts 口径一致——工作台会话
      // 蒸馏产物落 default 项目（harness-boot 蒸馏钩子口径）。
      const modelInput = await buildWorkbenchChatModelInput(user, {
        systemPrompt: params.systemPrompt,
        userContent: params.userContent,
        messages,
        projectId: "default",
      });
      // metadata chunk 必须首发：消费端以末条 chunk 决定 model/finishReason。
      if (modelInput.memoryRef) {
        yield { contentDelta: "", kind: "metadata", memoryRef: modelInput.memoryRef };
      }

      const provider = getKimiProvider();
      if (!provider.streamChatCompletion) {
        throw new Error("stream_not_supported");
      }

      // DEF-2026-09-03-001：模型 / baseUrl / 超时统一取自场景配置（assessment 绑定）。
      const scenario = await resolveWorkbenchChatScenario();
      const timeoutMs = scenario.timeoutMs;
      // 批次 0 · ①②③：分流在注入点完成（不改 ToolRegistry），并把单轮流式调用
      // 批次 1a：本 SSE 兜底通道不接审批闸门 → ask 档（写工具）一律拒绝执行。
      // 交给工具循环——模型返回的 tool_calls 必须被真正执行后回填再问，否则
      // 「传了 tools 等于模型说了没人听」。
      const toolSet = resolveWorkbenchInjectableTools(user);
      for await (const chunk of runWorkbenchToolLoopStream({
        messages: modelInput.messages,
        registry: toolSet.registry,
        agentUser: toolSet.agentUser,
        allowToolNames: toolSet.allowToolNames,
        invokeStream: async function* ({ messages }) {
          const stream = provider.streamChatCompletion!({
            model: scenario.model,
            temperature: 0.3,
            promptCacheKey: "home-workbench-stream-v1",
            timeoutMs,
            credentialsOverride: { apiKey, apiBaseUrl: scenario.baseUrl },
            messages,
            ...(toolSet.tools.length > 0 ? { tools: toolSet.tools, toolChoice: "auto" as const } : {}),
          });
          for await (const providerChunk of stream) {
            if (aborted) throw new Error("client_aborted");
            yield {
              contentDelta: providerChunk.contentDelta || "",
              reasoningContentDelta: providerChunk.reasoningContentDelta || "",
              model: providerChunk.model,
              finishReason: providerChunk.finishReason,
              // 批次 0：不得丢弃 toolCalls——工具循环靠它识别本轮要执行的调用
              ...(providerChunk.toolCalls ? { toolCalls: providerChunk.toolCalls } : {}),
            };
          }
        },
      })) {
        yield chunk;
      }
      if (aborted) throw new Error("client_aborted");
    };

    // 非流式 modelChat（用于静态路由后可能的模型调用）
    const modelChat = async ({ systemPrompt, userContent }: { systemPrompt: string; userContent: string }) => {
      // DEF-2026-09-03-001：场景解析先于取密钥——凭据 scope 由场景绑定的供应商决定。
      const scenario = await resolveWorkbenchChatScenario();
      const { apiKey } = resolveActiveApiKeyForScope(scenario.credentialScope);
      if (!apiKey) throw new Error("api_key_missing");
      // DEF-2026-08-27-001 B3：同上，与流式/非流式共用唯一口径。
      const modelInput = await buildWorkbenchChatModelInput(user, {
        systemPrompt,
        userContent,
        messages,
        projectId: "default",
      });
      // 批次 0 · ①②③：与流式路径同口径——注入点分流 + 真正执行 tool_calls（写工具无闸门即拒绝）。
      const toolSet = resolveWorkbenchInjectableTools(user);
      let lastCompletion: ChatCompletionResponse | undefined;
      const loop = await runWorkbenchToolLoop({
        messages: modelInput.messages,
        registry: toolSet.registry,
        agentUser: toolSet.agentUser,
        allowToolNames: toolSet.allowToolNames,
        invoke: async ({ messages }) => {
          const completion = await getKimiProvider().chatCompletion({
            model: scenario.model,
            temperature: 0.3,
            promptCacheKey: "home-workbench-dispatch-v1",
            timeoutMs: scenario.timeoutMs,
            credentialsOverride: { apiKey, apiBaseUrl: scenario.baseUrl },
            messages,
            ...(toolSet.tools.length > 0 ? { tools: toolSet.tools, toolChoice: "auto" as const } : {}),
          });
          lastCompletion = completion;
          return { content: completion.content, toolCalls: completion.toolCalls };
        },
      });
      const completion = lastCompletion;
      return {
        answer: loop.content,
        rawContent: completion?.rawContent ?? loop.content,
        provider: completion?.provider,
        model: completion?.model,
        attempts: completion?.attempts,
        finishReason: completion?.finishReason,
        // additive：dispatch 的捕获包装会把 toolCalls / memoryRef 透传进 trace
        ...(loop.toolCalls.length > 0 ? { toolCalls: loop.toolCalls } : {}),
        ...(modelInput.memoryRef ? { memoryRef: modelInput.memoryRef } : {}),
      };
    };

    // 调用 dispatchHomeWorkbenchTurn — 复用全部路由逻辑
    const dispatchData = await dispatchHomeWorkbenchTurn({
      requestId,
      user,
      workflowKey,
      message: userMessage.content,
      attachment: parsedAttachment ? { name: parsedAttachment.name, size: parsedAttachment.size, type: parsedAttachment.type, parsedSummary: parsedAttachment.parsedSummary } : null,
      latestHarnessArtifact: null,
      clientAction: asString(body.clientAction),
      // 批次 1c · 缺陷二：与 workbench-chat.handler.ts 同口径——判据取自已落库的会话记录
      // （sessionWithUserTurn 已含本轮用户消息，判据只看它之前那条 assistant），不读前端标记。
      // 三条通道共用一份判据，否则换一条通道就换一种断法。
      hasOngoingToolInteraction: hasOngoingWorkbenchToolInteraction(deriveSessionMessages(sessionWithUserTurn)),
      businessRole,
      roleLabel,
      model: modelName,
      rolePrompt: HOME_ROLE_PRESETS[businessRole].prompt,
      modelChat,
      streamingAdapter,
      modelChatStream,
    });
    traceContextRefs = dispatchData.trace.contextRefs;
    traceRoutingRule = dispatchData.trace.routingRule;

    // 判断是否有流式输出（streamedChunks 非空说明走了流式路径）
    const { hasStreaming, content: fullContent } = resolveWorkbenchStreamFinalContent(dispatchData.answer, streamedChunks);

    if (!hasStreaming) {
      // 静态响应（能力发现、数据查询、写动作确认等）— 发送 static 事件
      sendSseEvent("static", {
        intent: dispatchData.intent,
        answer: dispatchData.answer,
        suggestedActions: dispatchData.suggestedActions,
        trace: dispatchData.trace,
      });
    }

    // 保存 assistant 消息到 session
    // DEF-2026-08-27-001 B3：流式路径的记忆来自 metadata chunk，非流式兜底路径的
    // 记忆由 dispatch 捕获进 trace；两条都落到 assistant metadata 顶层，与
    // workbench-chat.handler.ts:129 同口径（前端 messageFormatter 只读顶层）。
    const memoryRefForMessage = streamMemoryRef ?? dispatchData.trace.memoryRef;
    const assistantMetadata = {
      ...(dispatchData.formBlock ? { formBlock: dispatchData.formBlock } : {}),
      ...(dispatchData.trace.knowledgeTool ? { knowledgeTool: dispatchData.trace.knowledgeTool } : {}),
      ...(dispatchData.trace.modelRun ? { modelRun: dispatchData.trace.modelRun } : {}),
      ...(memoryRefForMessage ? { memoryRef: memoryRefForMessage } : {}),
      // MS3 chip 活数据链路（additive）：流式通道的工具调用同样写入消息 metadata，
      // 与 workbench-chat.handler.ts 同口径（前端 messageFormatter 只读顶层）。
      ...(dispatchData.trace.toolCalls?.length ? { toolCalls: dispatchData.trace.toolCalls } : {}),
      ...(dispatchData.suggestedActions?.length ? { suggestedActions: dispatchData.suggestedActions, intent: dispatchData.intent } : {}),
    };
    const updatedSession = (await appendAiSessionEvent(user, session.sessionId, {
      message: {
        role: "assistant",
        content: fullContent,
        ...(Object.keys(assistantMetadata).length > 0 ? { metadata: assistantMetadata } : {}),
      },
    })) || (await getAiSession(user, session.sessionId)) || session;

    // RP-030: 记录 trace
    try {
      recordWorkbenchTurnTrace({
        requestId,
        ownerUserId: user.id,
        ownerUsername: user.username,
        aiSessionId: session.sessionId,
        userInputSummary: userMessage.content.slice(0, 200),
        dispatchTrace: dispatchData.trace,
        model: dispatchData.model || modelName,
      });
    } catch {
      // trace 写入失败不影响流式响应
    }

    // 发送 done 事件
    sendSseEvent("done", {
      content: fullContent,
      model: dispatchData.model || modelName,
      intent: dispatchData.intent,
      session: updatedSession,
      trace: dispatchData.trace,
      suggestedActions: dispatchData.suggestedActions,
    });

    res.end();
  } catch (err) {
    const reason = err instanceof Error ? err.message : "stream_failed";
    try {
      recordWorkbenchTurnFailureTrace({
        requestId,
        ownerUserId: user.id,
        ownerUsername: user.username,
        aiSessionId: traceSessionId,
        userInputSummary: userMessage.content.slice(0, 200),
        routingRule: reason === "client_aborted" ? "client_aborted" : traceRoutingRule,
        contextRefs: traceContextRefs,
        error: { code: reason, message: reason, retryable: reason !== "client_aborted" },
      });
    } catch {
      // trace 写入失败不影响流式错误响应
    }
    sendSseEvent("error", { code: reason, message: "流式输出异常" });
    res.end();
  }
}
