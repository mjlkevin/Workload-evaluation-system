// ============================================================
// O4 搬迁：AI 工作台对话入口（非流式）
// Phase 1G 显式报告闸门 + dispatch 路由 + trace 记录。
// 内容逐字节搬迁自 chat.service.ts，零逻辑变更。
// ============================================================

import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

import { config } from "../../../config/env";
import { asString } from "../../../utils/helpers";
import { normalizeKimiModelName } from "../../../utils/model-name";
import { ok, fail } from "../../../utils/response";
import { resolveBusinessRole } from "../../../middleware/auth";
import { resolveActiveRequirementKimiApiKey, loadRequirementSystemConfigStore } from "../../../modules/system/system.repository";
import { appendAiSessionEvent, getAiSession } from "../../../modules/ai-sessions/ai-sessions.usecase";
import { dispatchHomeWorkbenchTurn } from "../workbench-dispatch.service";
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
  latestUserMessage,
  normalizeHomeMessages,
} from "./workbench-shared";
import { analyzeMultipleAttachmentsByKimi, analyzeRequirementAttachmentByKimi } from "./report-analysis";

export async function homeWorkbenchChat(req: Request, res: Response) {
  const requestId = res.locals?.requestId || randomUUID();
  const user = currentUserFromRequest(req, res);
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
    const session = ensureHomeAiSession(user, {
      sessionId: body.sessionId,
      workflowKey,
      title: userMessage.content.slice(0, 40),
    });
    traceSessionId = session.sessionId;
    const sessionWithUserTurn = appendAiSessionEvent(user, session.sessionId, {
      message: userMessage,
      attachments: userMessage.attachments,
    }) || session;
    const parsedAttachment = latestParsedHomeAttachment(messages);
    const allAttachments = allParsedHomeAttachments(messages);
    traceContextRefs = parsedAttachment ? [`attachment:${parsedAttachment.name}`] : [];

    // Phase 1G: 有附件 + 明确报告生成请求 → 报告生成路径
    if (parsedAttachment && isExplicitReportRequest(userMessage.content)) {
      const { apiKey } = resolveActiveRequirementKimiApiKey();
      if (!apiKey) return fail(res, 40001, "参数错误", [{ field: "apiKey", reason: "required_or_env_missing" }]);
      const artifactId = randomUUID();

      // RP-006: 多附件走合并分析路径
      const useMulti = allAttachments.length > 1;
      const analysis = useMulti
        ? await analyzeMultipleAttachmentsByKimi({
            apiUrl: config.kimi.apiBaseUrl,
            apiKey,
            model: config.kimi.model,
            user,
            workflowKey,
            attachments: allAttachments,
          })
        : await analyzeRequirementAttachmentByKimi({
            apiUrl: config.kimi.apiBaseUrl,
            apiKey,
            model: config.kimi.model,
            user,
            workflowKey,
            attachment: parsedAttachment,
          });
      const { answer, report } = analysis;
      const sourceFiles: string[] = useMulti
        ? allAttachments.map((a) => a.name)
        : [parsedAttachment.name];
      const updatedSession = appendAiSessionEvent(user, session.sessionId, {
        message: { role: "assistant", content: answer, artifactIds: [artifactId] },
        artifact: {
          artifactId,
          type: "requirement_analysis_report",
          title: useMulti ? `需求解析报告 v1（${allAttachments.length} 文件合并）` : "需求解析报告 v1",
          content: report,
          status: "generated",
        },
        pendingAction: {
          actionType: "supplement_requirement_report",
          title: "补充需求解析报告缺失信息",
          riskLevel: "low",
          payload: {
            artifactId,
            sourceFile: sourceFiles[0],
            sourceFiles,
            missingItems: report.missingItems,
          },
        },
      }) || getAiSession(user, session.sessionId) || sessionWithUserTurn;
      // RP-008: 报告生成后，若提取到客户名称，自动添加“检索主体”建议动作
      const reportSuggestedActions: Array<{ id: string; label: string; actionType: string; payload?: Record<string, string> }> = [];
      if (report.customerName && report.customerName !== "待补充") {
        reportSuggestedActions.push({
          id: `company_lookup_${randomUUID().slice(0, 8)}`,
          label: `检索主体：${report.customerName}`,
          actionType: "company_lookup",
          payload: { customerName: report.customerName },
        });
      }
      return res.json(ok({
        intent: "harness_report_generation",
        answer,
        businessRole: resolveBusinessRole(user),
        roleLabel: HOME_ROLE_PRESETS[resolveBusinessRole(user)].label,
        model: normalizeKimiModelName(config.kimi.model),
        rawContent: analysis.rawContent,
        session: updatedSession,
        suggestedActions: reportSuggestedActions,
        trace: { intentConfidence: 1, routingRule: useMulti ? "explicit_report_multi_attachment" : "explicit_report_with_attachment", contextRefs: sourceFiles.map((n) => `attachment:${n}`) },
      }, requestId));
    }

    // Phase 1G: 通过意图分发器路由（普通问答、附件问答、能力发现、数据查询、写动作等）。
    // 静态意图（能力发现、项目查询、写动作确认）不应依赖模型额度；只有实际模型问答时才解析 API Key。
    const businessRole = resolveBusinessRole(user);
    const roleLabel = HOME_ROLE_PRESETS[businessRole].label;
    const modelName = normalizeKimiModelName(config.kimi.model);

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
      modelChat: async ({ systemPrompt, userContent }) => {
        const { apiKey } = resolveActiveRequirementKimiApiKey();
        if (!apiKey) throw new Error("required_or_env_missing");
        const safeMessages = messages.slice(-12).map((message) => ({ role: message.role, content: buildHomeMessageContentForModel(message) }));
        // 覆盖最后一条用户消息的 system prompt
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
      },
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
      ...(dispatchData.suggestedActions?.length ? { suggestedActions: dispatchData.suggestedActions, intent: dispatchData.intent } : {}),
    };
    const updatedSession = appendAiSessionEvent(user, session.sessionId, {
      message: {
        role: "assistant",
        content: dispatchData.answer,
        ...(Object.keys(assistantMetadata).length > 0 ? { metadata: assistantMetadata } : {}),
      },
    }) || getAiSession(user, session.sessionId) || sessionWithUserTurn;
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
