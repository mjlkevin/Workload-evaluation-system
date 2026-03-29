import { randomUUID } from "node:crypto";

import { config } from "../../config/env";
import { calculateEstimate, validateCalculateRequest } from "../../engine";
import { CalculateRequest, RuleSet, SessionEstimateContext, Template } from "../../types";
import { loadJsonFile } from "../../utils/file";
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

function loadEstimateContext(): { template: Template; ruleSet: RuleSet } {
  return {
    template: loadJsonFile<Template>("config/templates/example-template.json"),
    ruleSet: loadJsonFile<RuleSet>("config/rules/example-rule-set.json")
  };
}

export function startEstimateSession(
  ownerUserId: string,
  payload: { templateId?: string; ruleSetId?: string }
): SessionUsecaseResult<{ sessionId: string; templateId: string; ruleSetId: string; expiresAt: string }> {
  const { templateId, ruleSetId } = payload;
  const { template, ruleSet } = loadEstimateContext();

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

  cleanupExpiredSessions();

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
  saveSession(ctx);

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

export function calculateBySession(
  ownerUserId: string,
  sessionId: string,
  payload: Omit<CalculateRequest, "templateId" | "ruleSetId">
): SessionUsecaseResult<ReturnType<typeof calculateEstimate> & { sessionId: string }> {
  cleanupExpiredSessions();

  const session = getSession(sessionId);
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

  const { template, ruleSet } = loadEstimateContext();
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
