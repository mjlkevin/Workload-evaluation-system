// ============================================================
// O4 搬迁：AI 工作台对话入口（非流式）
// Phase 1G 显式报告闸门 + dispatch 路由 + trace 记录。
// 内容逐字节搬迁自 chat.service.ts，零逻辑变更。
// ============================================================

import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

import { asString } from "../../../utils/helpers";
import { normalizeKimiModelName } from "../../../utils/model-name";
import { ok, fail } from "../../../utils/response";
import { resolveBusinessRole } from "../../../middleware/auth";
import { appendAiSessionEvent, getAiSession } from "../../../modules/ai-sessions/ai-sessions.usecase";
import { dispatchHomeWorkbenchTurn } from "../workbench-dispatch.service";
import { hasOngoingWorkbenchToolInteraction } from "../workbench-intent.service";
import { recordWorkbenchTurnFailureTrace, recordWorkbenchTurnTrace } from "../../../modules/trace/trace.usecase";
import {
  HOME_ROLE_PRESETS,
  allParsedHomeAttachments,
  buildWorkbenchChatDispatchInput,
  currentUserFromRequest,
  ensureHomeAiSession,
  isExplicitReportRequest,
  latestParsedHomeAttachment,
  latestSessionAttachmentWithSummary,
  latestUserMessage,
  normalizeHomeMessages,
  resolveWorkbenchChatScenario,
} from "./workbench-shared";
import { runExplicitHomeReportFlow } from "./report-flow";

export async function homeWorkbenchChat(req: Request, res: Response) {
  const requestId = res.locals?.requestId || randomUUID();
  const user = await currentUserFromRequest(req, res);
  if (!user) return;

  const body = (req.body || {}) as { messages?: unknown; workflowKey?: unknown; sessionId?: unknown; clientAction?: unknown };
  const messages = normalizeHomeMessages(body.messages);
  if (messages.length === 0) return fail(res, 40001, "参数错误", [{ field: "messages", reason: "required" }]);
  const userMessage = latestUserMessage(messages);
  if (!userMessage) return fail(res, 40001, "参数错误", [{ field: "messages", reason: "user_message_required" }]);
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
    const sessionWithUserTurn = (await appendAiSessionEvent(user, session.sessionId, {
      message: userMessage,
      attachments: userMessage.attachments,
    })) || session;
    // ISS-2026-08-08-001: 请求级附件优先，缺失时回退到已落库会话附件（覆盖刷新/切换会话场景）
    const parsedAttachment = latestParsedHomeAttachment(messages) ?? latestSessionAttachmentWithSummary(sessionWithUserTurn);
    const allAttachments = allParsedHomeAttachments(messages);
    traceContextRefs = parsedAttachment ? [`attachment:${parsedAttachment.name}`] : [];

    // Phase 1G: 有附件 + 明确报告生成请求 → 报告生成路径
    // ISS-2026-08-08-001: 闸门追加 clientAction 条件，与建议动作按钮口径对齐；闸门语义（isExplicitReportRequest）零变更
    if (parsedAttachment && (isExplicitReportRequest(userMessage.content) || asString(body.clientAction) === "generate_requirement_report")) {
      const flowResult = await runExplicitHomeReportFlow({
        user,
        workflowKey,
        session,
        sessionWithUserTurn,
        parsedAttachment,
        allAttachments,
      });
      if (!flowResult.ok) return fail(res, 40001, "参数错误", [{ field: "apiKey", reason: "required_or_env_missing" }]);
      return res.json(ok(flowResult.body, requestId));
    }

    // Phase 1G: 通过意图分发器路由（普通问答、附件问答、能力发现、数据查询、写动作等）。
    // 静态意图（能力发现、项目查询、写动作确认）不应依赖模型额度；只有实际模型问答时才解析 API Key。
    const businessRole = resolveBusinessRole(user);
    const roleLabel = HOME_ROLE_PRESETS[businessRole].label;
    // DEF-2026-09-03-001：模型名取自场景配置（assessment 绑定），不再是 env 默认值。
    const modelName = normalizeKimiModelName((await resolveWorkbenchChatScenario()).model);

    const dispatchInput = await buildWorkbenchChatDispatchInput(user, userMessage.content, {
      messages,
      // DEF-2026-08-11-001 关联：同步通道启用记忆注入——工作台会话蒸馏产物落 default 项目
      // （harness-boot 蒸馏钩子口径），注入计数经 memoryRef additive 字段透出给 chip。
      projectId: "default",
    });

    const dispatchData = await dispatchHomeWorkbenchTurn({
      requestId,
      user: dispatchInput.user,
      workflowKey,
      message: dispatchInput.message,
      attachment: parsedAttachment ? { name: parsedAttachment.name, size: parsedAttachment.size, type: parsedAttachment.type, parsedSummary: parsedAttachment.parsedSummary } : null,
      latestHarnessArtifact: null,
      clientAction: asString(body.clientAction),
      // 批次 1c · 缺陷二：进行中判据取自**已落库的会话记录**（sessionWithUserTurn 已含本轮
      // 用户消息，判据只看它之前那条 assistant），不读前端传来的任何标记。
      hasOngoingToolInteraction: hasOngoingWorkbenchToolInteraction(sessionWithUserTurn.messages),
      businessRole: dispatchInput.businessRole,
      roleLabel: dispatchInput.roleLabel,
      model: dispatchInput.model,
      rolePrompt: dispatchInput.rolePrompt,
      modelChat: dispatchInput.modelChat,
    });
    traceContextRefs = dispatchData.trace.contextRefs;
    traceRoutingRule = dispatchData.trace.routingRule;

    // RP-030: 记录 trace（写入失败不影响主响应）
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
      // trace 写入失败不影响主响应
    }

    const assistantMetadata = {
      ...(dispatchData.formBlock ? { formBlock: dispatchData.formBlock } : {}),
      ...(dispatchData.trace.knowledgeTool ? { knowledgeTool: dispatchData.trace.knowledgeTool } : {}),
      ...(dispatchData.trace.modelRun ? { modelRun: dispatchData.trace.modelRun } : {}),
      // MS3 chip 活数据链路（additive）：trace 携带工具调用 / 引用记忆数据时写入消息 metadata
      ...(dispatchData.trace.toolCalls?.length ? { toolCalls: dispatchData.trace.toolCalls } : {}),
      ...(dispatchData.trace.memoryRef ? { memoryRef: dispatchData.trace.memoryRef } : {}),
      ...(dispatchData.suggestedActions?.length ? { suggestedActions: dispatchData.suggestedActions, intent: dispatchData.intent } : {}),
    };
    const updatedSession = (await appendAiSessionEvent(user, session.sessionId, {
      message: {
        role: "assistant",
        content: dispatchData.answer,
        ...(Object.keys(assistantMetadata).length > 0 ? { metadata: assistantMetadata } : {}),
      },
    })) || (await getAiSession(user, session.sessionId)) || sessionWithUserTurn;
    return res.json(ok({
      intent: dispatchData.intent,
      answer: dispatchData.answer,
      businessRole: dispatchData.businessRole,
      roleLabel: dispatchData.roleLabel,
      model: dispatchData.model || modelName,
      rawContent: dispatchData.rawContent,
      formBlock: dispatchData.formBlock,
      session: updatedSession,
      suggestedActions: dispatchData.suggestedActions,
      trace: dispatchData.trace,
    }, requestId));
  } catch (err) {
    const reason = err instanceof Error ? err.message : "home_workbench_chat_failed";
    try {
      recordWorkbenchTurnFailureTrace({
        requestId,
        ownerUserId: user.id,
        ownerUsername: user.username,
        aiSessionId: traceSessionId,
        userInputSummary: userMessage.content.slice(0, 200),
        routingRule: traceRoutingRule,
        contextRefs: traceContextRefs,
        error: { code: reason, message: reason, retryable: reason !== "client_aborted" },
      });
    } catch {
      // trace 写入失败不影响主响应
    }
    // RP-025: 区分错误类型，避免将所有异常都报告为"参数错误"
    const isParamError = reason === "required_or_env_missing" || reason === "user_message_required";
    const message = isParamError ? "参数错误" : "AI 服务异常";
    return fail(res, 40001, message, [{ field: "messages/api", reason }]);
  }
}
