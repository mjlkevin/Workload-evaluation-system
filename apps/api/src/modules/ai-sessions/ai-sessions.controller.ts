import { randomUUID } from "node:crypto";
import { Request, Response } from "express";

import { requireAuth } from "../../middleware/auth";
import { asString } from "../../utils";
import { fail, ok } from "../../utils/response";
import { appendAiSessionEvent, createAiSession, deleteAiSession, getAiSession, listAiSessions } from "./ai-sessions.usecase";

export function createSession(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  return res.json(ok({ session: createAiSession(auth.user, req.body || {}) }, randomUUID()));
}

export function listSessions(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  return res.json(ok({ items: listAiSessions(auth.user, req.query || {}) }, randomUUID()));
}

export function getSession(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const session = getAiSession(auth.user, asString(req.params.sessionId));
  if (!session) return fail(res, 40404, "会话不存在", [{ field: "sessionId", reason: "not_found" }]);
  return res.json(ok({ session }, randomUUID()));
}

export function deleteSession(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const sessionId = asString(req.params.sessionId);
  if (!deleteAiSession(auth.user, sessionId)) {
    return fail(res, 40404, "会话不存在", [{ field: "sessionId", reason: "not_found" }]);
  }
  return res.json(ok({ deletedSessionId: sessionId }, randomUUID()));
}

export function appendSessionEvent(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const session = appendAiSessionEvent(auth.user, asString(req.params.sessionId), req.body || {});
  if (!session) return fail(res, 40404, "会话不存在", [{ field: "sessionId", reason: "not_found" }]);
  return res.json(ok({ session }, randomUUID()));
}

export function createStandardDraft(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const sessionId = asString(req.params.sessionId);
  const body = (req.body || {}) as { fileName?: unknown; fileSize?: unknown; fileType?: unknown };
  const fileName = asString(body.fileName) || "金蝶官方评估文件";
  const session = appendAiSessionEvent(auth.user, sessionId, {
    artifact: {
      type: "standard_draft",
      title: "标准差异草稿",
      content: `已接收 ${fileName}，识别新增模块 2 个，人天基准变更 3 项。`,
      status: "generated",
    },
    pendingAction: {
      actionType: "publish_standard_version",
      title: "发布标准版本",
      riskLevel: "high",
      payload: {
        fileName,
        fileSize: typeof body.fileSize === "number" ? body.fileSize : undefined,
        fileType: asString(body.fileType) || undefined,
      },
    },
  });
  if (!session) return fail(res, 40404, "会话不存在", [{ field: "sessionId", reason: "not_found" }]);
  return res.json(ok({
    session,
    artifact: session.artifacts[session.artifacts.length - 1],
  }, randomUUID()));
}
