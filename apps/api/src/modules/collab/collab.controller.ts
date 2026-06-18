import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../../utils/errors";
import * as C from "./collab.usecase";

// ------------------------------------------------------------------
// Workspace handlers
// ------------------------------------------------------------------

export async function postWorkspace(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body as Record<string, unknown>;
    if (typeof b.name !== "string" || !b.name.trim()) throw new ApiError(400, "name 必填");
    const ws = await C.createWorkspace({
      name: b.name.trim(),
      assessmentVersionId: typeof b.assessmentVersionId === "string" ? b.assessmentVersionId : undefined,
      requirementPackId: typeof b.requirementPackId === "string" ? b.requirementPackId : undefined,
      createdByUserId: req.user?.id,
    });
    res.status(201).json({ success: true, data: ws });
  } catch (err) { next(err); }
}

export async function listWorkspacesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, "未登录");
    const status = req.query.status as string | undefined;
    const list = await C.listWorkspacesByUser(userId, status);
    res.json({ success: true, data: list });
  } catch (err) { next(err); }
}

export async function getWorkspaceHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const ws = await C.findWorkspaceById(id);
    if (!ws) throw new ApiError(404, "工作区不存在");
    res.json({ success: true, data: ws });
  } catch (err) { next(err); }
}

export async function patchWorkspace(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const b = req.body as Record<string, unknown>;
    const ws = await C.updateWorkspace(id, {
      name: typeof b.name === "string" ? b.name : undefined,
      status: b.status === "active" || b.status === "archived" ? b.status : undefined,
    });
    if (!ws) throw new ApiError(404, "工作区不存在");
    res.json({ success: true, data: ws });
  } catch (err) { next(err); }
}

export async function deleteWorkspaceHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const ok = await C.deleteWorkspace(id);
    if (!ok) throw new ApiError(404, "工作区不存在");
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function addMemberHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const b = req.body as Record<string, unknown>;
    const userId = typeof b.userId === "string" ? b.userId : "";
    const role = typeof b.role === "string" ? b.role : "member";
    const ws = await C.addWorkspaceMember(id, {
      userId,
      role,
      joinedAt: new Date().toISOString(),
    });
    if (!ws) throw new ApiError(404, "工作区不存在");
    res.json({ success: true, data: ws });
  } catch (err) { next(err); }
}

export async function removeMemberHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const memberUserId = req.params.userId as string;
    const ws = await C.removeWorkspaceMember(id, memberUserId);
    if (!ws) throw new ApiError(404, "工作区不存在");
    res.json({ success: true, data: ws });
  } catch (err) { next(err); }
}

// ------------------------------------------------------------------
// Message handlers
// ------------------------------------------------------------------

export async function postMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const b = req.body as Record<string, unknown>;
    if (typeof b.content !== "string" || !b.content.trim()) throw new ApiError(400, "content 必填");
    const messageType = b.messageType as string;
    if (!["question", "reply", "decision", "notice"].includes(messageType)) {
      throw new ApiError(400, "messageType 无效");
    }
    const msg = await C.createMessage({
      workspaceId: id,
      messageType: messageType as any,
      parentMessageId: typeof b.parentMessageId === "string" ? b.parentMessageId : undefined,
      senderUserId: req.user?.id,
      senderRole: (req as any).v2Roles?.[0],
      content: b.content.trim(),
      relatedFieldPath: typeof b.relatedFieldPath === "string" ? b.relatedFieldPath : undefined,
      decisionPayload: b.decisionPayload && typeof b.decisionPayload === "object" ? b.decisionPayload as Record<string, unknown> : undefined,
    });
    res.status(201).json({ success: true, data: msg });
  } catch (err) { next(err); }
}

export async function listMessagesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const messageType = req.query.type as string | undefined;
    const status = req.query.status as string | undefined;
    const list = await C.listMessagesByWorkspace(id, { messageType, status });
    res.json({ success: true, data: list });
  } catch (err) { next(err); }
}

export async function getMessageHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const messageId = req.params.messageId as string;
    const msg = await C.findMessageById(messageId);
    if (!msg) throw new ApiError(404, "消息不存在");
    res.json({ success: true, data: msg });
  } catch (err) { next(err); }
}

export async function patchMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const messageId = req.params.messageId as string;
    const b = req.body as Record<string, unknown>;
    const msg = await C.updateMessage(messageId, {
      content: typeof b.content === "string" ? b.content : undefined,
      status: b.status === "open" || b.status === "resolved" || b.status === "closed" ? b.status : undefined,
      evidenceId: typeof b.evidenceId === "string" ? b.evidenceId : undefined,
    });
    if (!msg) throw new ApiError(404, "消息不存在");
    res.json({ success: true, data: msg });
  } catch (err) { next(err); }
}

export async function deleteMessageHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const messageId = req.params.messageId as string;
    const ok = await C.deleteMessage(messageId);
    if (!ok) throw new ApiError(404, "消息不存在");
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function getThreadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const messageId = req.params.messageId as string;
    const thread = await C.getMessageThread(messageId);
    if (thread.length === 0) throw new ApiError(404, "消息不存在");
    res.json({ success: true, data: thread });
  } catch (err) { next(err); }
}

export async function getWorkspaceStatsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const openQuestions = await C.countOpenQuestions(id);
    res.json({ success: true, data: { openQuestions } });
  } catch (err) { next(err); }
}
