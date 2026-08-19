// ============================================================
// ISS-2026-08-08-001: 显式报告生成流程共享实现。
// 自 workbench-chat.handler.ts 闸门命中块逐句抽取，
// 供非流式与流式端点复用，保持流式/非流式行为对齐（G3）。
// ============================================================

import { randomUUID } from "node:crypto";

import { config } from "../../../config/env";
import { normalizeKimiModelName } from "../../../utils/model-name";
import { resolveBusinessRole } from "../../../middleware/auth";
import { resolveActiveRequirementKimiApiKey } from "../../../modules/system/system.repository";
import { appendAiSessionEvent, getAiSession } from "../../../modules/ai-sessions/ai-sessions.usecase";
import type { AuthUser } from "../../../types";
import type { AiSessionRecord } from "../../../modules/ai-sessions/ai-sessions.types";
import { HOME_ROLE_PRESETS, type HomeAttachmentInput } from "./workbench-shared";
import { analyzeMultipleAttachmentsByKimi, analyzeRequirementAttachmentByKimi } from "./report-analysis";

export type ExplicitHomeReportFlowResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; reason: "required_or_env_missing" };

export async function runExplicitHomeReportFlow(params: {
  user: AuthUser;
  workflowKey: string;
  session: AiSessionRecord;
  sessionWithUserTurn: AiSessionRecord;
  parsedAttachment: HomeAttachmentInput;
  allAttachments: HomeAttachmentInput[];
}): Promise<ExplicitHomeReportFlowResult> {
  const { user, workflowKey, session, sessionWithUserTurn, parsedAttachment, allAttachments } = params;
  const { apiKey } = resolveActiveRequirementKimiApiKey();
  if (!apiKey) return { ok: false, reason: "required_or_env_missing" };
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
  const updatedSession = (await appendAiSessionEvent(user, session.sessionId, {
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
  })) || (await getAiSession(user, session.sessionId)) || sessionWithUserTurn;
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
  return {
    ok: true,
    body: {
      intent: "harness_report_generation",
      answer,
      businessRole: resolveBusinessRole(user),
      roleLabel: HOME_ROLE_PRESETS[resolveBusinessRole(user)].label,
      model: normalizeKimiModelName(config.kimi.model),
      rawContent: analysis.rawContent,
      session: updatedSession,
      suggestedActions: reportSuggestedActions,
      trace: { intentConfidence: 1, routingRule: useMulti ? "explicit_report_multi_attachment" : "explicit_report_with_attachment", contextRefs: sourceFiles.map((n) => `attachment:${n}`) },
    },
  };
}
