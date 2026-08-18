import { randomUUID } from "node:crypto";
import { Request, Response, RequestHandler } from "express";

import { requireAuth } from "../../middleware/auth";
import { asString } from "../../utils";
import { fail, ok } from "../../utils/response";
import { AiRunsConflictError } from "../harness/harness-runtime.usecase";
import { appendAiSessionEvent, createAiSession, deleteAiSession, getAiSession, listAiSessions, listAllAiSessionsForAdmin, renameAiSession } from "./ai-sessions.usecase";

export async function createSession(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const session = createAiSession(auth.user, req.body || {});
  return res.json(ok({ session }, randomUUID()));
}

export async function listSessions(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  return res.json(ok({ items: listAiSessions(auth.user, req.query || {}) }, randomUUID()));
}

// 管理员审计视图：跨用户聚合全部 AI 会话摘要，仅挂载在 system:manage 能力位路由下
export async function listAllSessionsForAdmin(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  return res.json(ok({ items: listAllAiSessionsForAdmin(req.query || {}) }, randomUUID()));
}

export async function getSession(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const session = getAiSession(auth.user, asString(req.params.sessionId));
  if (!session) return fail(res, 40404, "会话不存在", [{ field: "sessionId", reason: "not_found" }]);
  return res.json(ok({ session }, randomUUID()));
}

export async function deleteSession(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const sessionId = asString(req.params.sessionId);
  if (!deleteAiSession(auth.user, sessionId)) {
    return fail(res, 40404, "会话不存在", [{ field: "sessionId", reason: "not_found" }]);
  }
  return res.json(ok({ deletedSessionId: sessionId }, randomUUID()));
}

// RP-047 Batch D（E1）：旧 DELETE 端点接入活跃 Run 守护。
// 注入 activeRunChecker 时命中活跃 Run 返回 409 SESSION_HAS_ACTIVE_RUN
// 且不删除；未注入时保持 deleteSession 同步语义，既有调用方零改动。
export function createGuardedDeleteSessionHandler(
  deps: { activeRunChecker?: (sessionId: string) => Promise<boolean> } = {},
): RequestHandler {
  return async (req, res) => {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const sessionId = asString(req.params.sessionId);
    try {
      const checker = deps.activeRunChecker;
      let deleted: boolean;
      if (checker) {
        deleted = await deleteAiSession(auth.user, sessionId, { activeRunChecker: checker });
      } else {
        deleted = deleteAiSession(auth.user, sessionId);
      }
      if (!deleted) {
        fail(res, 40404, "会话不存在", [{ field: "sessionId", reason: "not_found" }]);
        return;
      }
      res.json(ok({ deletedSessionId: sessionId }, randomUUID()));
    } catch (err) {
      if (err instanceof AiRunsConflictError) {
        // 与 Batch C harness-runtime.controller 的 409 映射同形（业务码为字符串）
        res.status(409).json({ code: err.code, message: err.message, details: [], requestId: randomUUID() });
        return;
      }
      throw err;
    }
  };
}

export async function renameSession(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const sessionId = asString(req.params.sessionId);
  const title = (req.body || {}).title;
  const session = renameAiSession(auth.user, sessionId, title);
  if (!session) return fail(res, 40404, "会话不存在或标题无效", [{ field: "sessionId", reason: "not_found_or_invalid_title" }]);
  return res.json(ok({ session }, randomUUID()));
}

export async function appendSessionEvent(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const session = appendAiSessionEvent(auth.user, asString(req.params.sessionId), req.body || {});
  if (!session) return fail(res, 40404, "会话不存在", [{ field: "sessionId", reason: "not_found" }]);
  return res.json(ok({ session }, randomUUID()));
}

export async function createStandardDraft(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
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
