import { randomUUID } from "node:crypto";

import { config } from "../../config/env";
import { calculateEstimate, validateCalculateRequest } from "../../engine";
import { CalculateRequest, RuleSet, SessionEstimateContext, Template } from "../../types";
import { loadTemplate } from "../templates/templates.repository";
import { loadRuleSet } from "../rules/rules.repository";
import { cleanupExpiredSessions, getSession, saveSession } from "./sessions.repository";

type FailedResult = {
  ok: false;
  code: number;
  message: string;
  details?: Array<{ field: string; reason: string }>;
};

type SuccessResult<T> = {
  ok: true;
  data: T;
  requestId?: string;
};

export type SessionUsecaseResult<T> = FailedResult | SuccessResult<T>;

/**
 * 阶段 2 批 8：旁路直读 JSON 改经仓储选择器（与 estimates.usecase 同批修复，
 * 避免开关翻到 PG 后会话域仍读 JSON 造成读写分裂）。
 */
async function loadEstimateContext(): Promise<{ template: Template; ruleSet: RuleSet }> {
  return {
    template: await loadTemplate(),
    ruleSet: await loadRuleSet()
  };
}

/** 阶段 1 批 6：因内部调用 cleanupExpiredSessions / saveSession（已异步化）级联改 async，实现不动。 */
export async function startEstimateSession(
  ownerUserId: string,
  payload: { templateId?: string; ruleSetId?: string }
): Promise<SessionUsecaseResult<{ sessionId: string; templateId: string; ruleSetId: string; expiresAt: string }>> {
  const { templateId, ruleSetId } = payload;
  const { template, ruleSet } = await loadEstimateContext();

  if (!templateId || !ruleSetId) {
    return {
      ok: false,
      code: 40001,
      message: "参数错误",
      details: [
        { field: "templateId", reason: "required" },
        { field: "ruleSetId", reason: "required" }
      ]
    };
  }

  if (templateId !== template.templateId || ruleSetId !== ruleSet.ruleSetId) {
    return {
      ok: false,
      code: 40401,
      message: "资源不存在",
      details: [{ field: "templateId/ruleSetId", reason: "not_found" }]
    };
  }

  await cleanupExpiredSessions();

  const now = Date.now();
  const sessionId = randomUUID();
  const ctx: SessionEstimateContext = {
    sessionId,
    templateId,
    ruleSetId,
    ownerUserId,
    createdAt: now,
    expiresAt: now + config.constants.SESSION_TTL_MS
  };
  await saveSession(ctx);

  return {
    ok: true,
    data: {
      sessionId,
      templateId,
      ruleSetId,
      expiresAt: new Date(ctx.expiresAt).toISOString()
    }
  };
}

/** 阶段 1 批 6：因内部调用 cleanupExpiredSessions / getSession（已异步化）级联改 async，实现不动。 */
export async function calculateBySession(
  ownerUserId: string,
  sessionId: string,
  payload: Omit<CalculateRequest, "templateId" | "ruleSetId">
): Promise<SessionUsecaseResult<ReturnType<typeof calculateEstimate> & { sessionId: string }>> {
  await cleanupExpiredSessions();

  const session = await getSession(sessionId);
  if (!session) {
    return {
      ok: false,
      code: 40401,
      message: "资源不存在",
      details: [{ field: "sessionId", reason: "not_found_or_expired" }]
    };
  }

  if (session.ownerUserId !== ownerUserId) {
    return {
      ok: false,
      code: 40301,
      message: "权限不足",
      details: [{ field: "sessionId", reason: "cross_user_forbidden" }]
    };
  }

  const mergedBody: CalculateRequest = {
    templateId: session.templateId,
    ruleSetId: session.ruleSetId,
    userCount: payload.userCount,
    difficultyFactor: payload.difficultyFactor,
    orgCount: payload.orgCount,
    orgSimilarityFactor: payload.orgSimilarityFactor,
    items: payload.items
  };

  const { template, ruleSet } = await loadEstimateContext();
  const validation = validateCalculateRequest(mergedBody, template, ruleSet);
  if (!validation.ok) {
    return {
      ok: false,
      code: validation.code,
      message: validation.message,
      details: validation.details
    };
  }

  return {
    ok: true,
    data: {
      sessionId,
      ...calculateEstimate(mergedBody, template, ruleSet)
    },
    requestId: randomUUID()
  };
}
