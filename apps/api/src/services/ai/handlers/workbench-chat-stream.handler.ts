// ============================================================
// O4 搬迁：AI 工作台流式对话入口（SSE）
// 内容逐字节搬迁自 chat.service.ts，零逻辑变更。
// ============================================================

import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

import { config } from "../../../config/env";
import { asString } from "../../../utils/helpers";
import { normalizeKimiModelName } from "../../../utils/model-name";
import { resolveBusinessRole } from "../../../middleware/auth";
import { resolveActiveRequirementKimiApiKey, loadRequirementSystemConfigStore } from "../../../modules/system/system.repository";
import { appendAiSessionEvent, getAiSession } from "../../../modules/ai-sessions/ai-sessions.usecase";
import { dispatchHomeWorkbenchTurn, type StreamingAdapter, type StreamingChunk } from "../workbench-dispatch.service";
import { recordWorkbenchTurnFailureTrace, recordWorkbenchTurnTrace } from "../../../modules/trace/trace.usecase";
import {
  HOME_ROLE_PRESETS,
  allParsedHomeAttachments,
  buildHomeMessageContentForModel,
  currentUserFromRequest,
  ensureHomeAiSession,
  getKimiProvider,
  isExplicitReportRequest,
  latestParsedHomeAttachment,
  latestSessionAttachmentWithSummary,
  latestUserMessage,
  normalizeHomeMessages,
  resolveWorkbenchStreamFinalContent,
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
  const user = currentUserFromRequest(req, res);
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
    const session = ensureHomeAiSession(user, {
      sessionId: body.sessionId,
      workflowKey,
      title: userMessage.content.slice(0, 40),
    });
    traceSessionId = session.sessionId;

    // 记录用户消息到 session
    const sessionWithUserTurn = appendAiSessionEvent(user, session.sessionId, {
      message: userMessage,
      attachments: userMessage.attachments,
    }) || session;

    // ISS-2026-08-08-001: 请求级附件优先，缺失时回退到已落库会话附件（与非流式对齐）
    const parsedAttachment = latestParsedHomeAttachment(messages) ?? latestSessionAttachmentWithSummary(sessionWithUserTurn);
    const allAttachments = allParsedHomeAttachments(messages);
    traceContextRefs = parsedAttachment ? [`attachment:${parsedAttachment.name}`] : [];
    const businessRole = resolveBusinessRole(user);
    const roleLabel = HOME_ROLE_PRESETS[businessRole].label;
    const modelName = normalizeKimiModelName(config.kimi.model);

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
    const streamingAdapter: StreamingAdapter = {
      onToken: (chunk) => {
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

      const safeMessages = messages.slice(-12).map((message) => ({
        role: message.role,
        content: buildHomeMessageContentForModel(message),
      }));
      // 覆盖最后一条用户消息
      if (safeMessages.length > 0) {
        safeMessages[safeMessages.length - 1] = { role: "user", content: params.userContent };
      }

      const provider = getKimiProvider();
      if (!provider.streamChatCompletion) {
        throw new Error("stream_not_supported");
      }

      const stream = provider.streamChatCompletion({
        model: config.kimi.model,
        temperature: 0.3,
        promptCacheKey: "home-workbench-stream-v1",
        timeoutMs: loadRequirementSystemConfigStore().active.kimiEvaluation.timeoutMs || 120000,
        credentialsOverride: { apiKey, apiBaseUrl: config.kimi.apiBaseUrl },
        messages: [{ role: "system", content: params.systemPrompt }, ...safeMessages],
      });

      for await (const chunk of stream) {
        if (aborted) throw new Error("client_aborted");
        yield {
          contentDelta: chunk.contentDelta || "",
          reasoningContentDelta: chunk.reasoningContentDelta || "",
          model: chunk.model,
          finishReason: chunk.finishReason,
        };
      }
      if (aborted) throw new Error("client_aborted");
    };

    // 非流式 modelChat（用于静态路由后可能的模型调用）
    const modelChat = async ({ systemPrompt, userContent }: { systemPrompt: string; userContent: string }) => {
      const { apiKey } = resolveActiveRequirementKimiApiKey();
      if (!apiKey) throw new Error("api_key_missing");
      const safeMessages = messages.slice(-12).map((message) => ({
        role: message.role,
        content: buildHomeMessageContentForModel(message),
      }));
      if (safeMessages.length > 0) {
        safeMessages[safeMessages.length - 1] = { role: "user", content: userContent };
      }
      const completion = await getKimiProvider().chatCompletion({
        model: config.kimi.model,
        temperature: 0.3,
        promptCacheKey: "home-workbench-dispatch-v1",
        timeoutMs: loadRequirementSystemConfigStore().active.kimiEvaluation.timeoutMs || 120000,
        credentialsOverride: { apiKey, apiBaseUrl: config.kimi.apiBaseUrl },
        messages: [{ role: "system", content: systemPrompt }, ...safeMessages],
      });
      return {
        answer: completion.content,
        rawContent: completion.rawContent,
        provider: completion.provider,
        model: completion.model,
        attempts: completion.attempts,
        finishReason: completion.finishReason,
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
    const assistantMetadata = {
      ...(dispatchData.formBlock ? { formBlock: dispatchData.formBlock } : {}),
      ...(dispatchData.trace.knowledgeTool ? { knowledgeTool: dispatchData.trace.knowledgeTool } : {}),
      ...(dispatchData.trace.modelRun ? { modelRun: dispatchData.trace.modelRun } : {}),
      ...(dispatchData.suggestedActions?.length ? { suggestedActions: dispatchData.suggestedActions, intent: dispatchData.intent } : {}),
    };
    const updatedSession = appendAiSessionEvent(user, session.sessionId, {
      message: {
        role: "assistant",
        content: fullContent,
        ...(Object.keys(assistantMetadata).length > 0 ? { metadata: assistantMetadata } : {}),
      },
    }) || getAiSession(user, session.sessionId) || session;

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
