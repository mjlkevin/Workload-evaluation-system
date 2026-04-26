// ============================================================
// Collab Routes — 评估协同工作区 API
// ============================================================
// P2-1 端点：工作区 CRUD + 成员管理 + 消息(质询/回复/决策) + 线程查询
//
// 能力位映射：
//   - workspace CRUD    → evidence:read / evidence:write
//   - message CRUD      → evidence:read / evidence:write
//   - resolve/close     → evidence:write

import { Router } from "express";
import { requireCapability, requireAnyCapability } from "../rbac/middleware";
import { ApiError } from "../utils/errors";
import { collabWorkspaceService, collabMessageService } from "../services/collab";

const router = Router();

// ------------------------------------------------------------------
// Workspace 路由
// ------------------------------------------------------------------

router.post("/workspaces", requireCapability("evidence:write"), async (req, res, next) => {
  try {
    const b = req.body as Record<string, unknown>;
    if (typeof b.name !== "string" || !b.name.trim()) throw new ApiError(400, "name 必填");
    const ws = await collabWorkspaceService.create({
      name: b.name.trim(),
      assessmentVersionId: typeof b.assessmentVersionId === "string" ? b.assessmentVersionId : undefined,
      requirementPackId: typeof b.requirementPackId === "string" ? b.requirementPackId : undefined,
      createdByUserId: req.user?.id,
    });
    res.status(201).json({ success: true, data: ws });
  } catch (err) { next(err); }
});

router.get("/workspaces", requireAnyCapability("evidence:read", "evidence:write"), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, "未登录");
    const status = req.query.status as string | undefined;
    const list = await collabWorkspaceService.listByUser(userId, status);
    res.json({ success: true, data: list });
  } catch (err) { next(err); }
});

router.get("/workspaces/:id", requireAnyCapability("evidence:read", "evidence:write"), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const ws = await collabWorkspaceService.findById(id);
    if (!ws) throw new ApiError(404, "工作区不存在");
    res.json({ success: true, data: ws });
  } catch (err) { next(err); }
});

router.patch("/workspaces/:id", requireCapability("evidence:write"), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const b = req.body as Record<string, unknown>;
    const ws = await collabWorkspaceService.update(id, {
      name: typeof b.name === "string" ? b.name : undefined,
      status: b.status === "active" || b.status === "archived" ? b.status : undefined,
    });
    if (!ws) throw new ApiError(404, "工作区不存在");
    res.json({ success: true, data: ws });
  } catch (err) { next(err); }
});

router.delete("/workspaces/:id", requireCapability("evidence:write"), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const ok = await collabWorkspaceService.delete(id);
    if (!ok) throw new ApiError(404, "工作区不存在");
    res.json({ success: true });
  } catch (err) { next(err); }
});

// 成员管理
router.post("/workspaces/:id/members", requireCapability("evidence:write"), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const b = req.body as Record<string, unknown>;
    const userId = typeof b.userId === "string" ? b.userId : "";
    const role = typeof b.role === "string" ? b.role : "member";
    const ws = await collabWorkspaceService.addMember(id, {
      userId,
      role,
      joinedAt: new Date().toISOString(),
    });
    if (!ws) throw new ApiError(404, "工作区不存在");
    res.json({ success: true, data: ws });
  } catch (err) { next(err); }
});

router.delete("/workspaces/:id/members/:userId", requireCapability("evidence:write"), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const memberUserId = req.params.userId as string;
    const ws = await collabWorkspaceService.removeMember(id, memberUserId);
    if (!ws) throw new ApiError(404, "工作区不存在");
    res.json({ success: true, data: ws });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Message 路由
// ------------------------------------------------------------------

router.post("/workspaces/:id/messages", requireCapability("evidence:write"), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const b = req.body as Record<string, unknown>;
    if (typeof b.content !== "string" || !b.content.trim()) throw new ApiError(400, "content 必填");
    const messageType = b.messageType as string;
    if (!["question", "reply", "decision", "notice"].includes(messageType)) {
      throw new ApiError(400, "messageType 无效");
    }
    const msg = await collabMessageService.create({
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
});

router.get("/workspaces/:id/messages", requireAnyCapability("evidence:read", "evidence:write"), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const messageType = req.query.type as string | undefined;
    const status = req.query.status as string | undefined;
    const list = await collabMessageService.listByWorkspace(id, { messageType, status });
    res.json({ success: true, data: list });
  } catch (err) { next(err); }
});

router.get("/messages/:messageId", requireAnyCapability("evidence:read", "evidence:write"), async (req, res, next) => {
  try {
    const messageId = req.params.messageId as string;
    const msg = await collabMessageService.findById(messageId);
    if (!msg) throw new ApiError(404, "消息不存在");
    res.json({ success: true, data: msg });
  } catch (err) { next(err); }
});

router.patch("/messages/:messageId", requireCapability("evidence:write"), async (req, res, next) => {
  try {
    const messageId = req.params.messageId as string;
    const b = req.body as Record<string, unknown>;
    const msg = await collabMessageService.update(messageId, {
      content: typeof b.content === "string" ? b.content : undefined,
      status: b.status === "open" || b.status === "resolved" || b.status === "closed" ? b.status : undefined,
      evidenceId: typeof b.evidenceId === "string" ? b.evidenceId : undefined,
    });
    if (!msg) throw new ApiError(404, "消息不存在");
    res.json({ success: true, data: msg });
  } catch (err) { next(err); }
});

router.delete("/messages/:messageId", requireCapability("evidence:write"), async (req, res, next) => {
  try {
    const messageId = req.params.messageId as string;
    const ok = await collabMessageService.delete(messageId);
    if (!ok) throw new ApiError(404, "消息不存在");
    res.json({ success: true });
  } catch (err) { next(err); }
});

// 线程查询
router.get("/messages/:messageId/thread", requireAnyCapability("evidence:read", "evidence:write"), async (req, res, next) => {
  try {
    const messageId = req.params.messageId as string;
    const thread = await collabMessageService.getThread(messageId);
    if (thread.length === 0) throw new ApiError(404, "消息不存在");
    res.json({ success: true, data: thread });
  } catch (err) { next(err); }
});

// 工作区统计
router.get("/workspaces/:id/stats", requireAnyCapability("evidence:read", "evidence:write"), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const openQuestions = await collabMessageService.countOpenQuestions(id);
    res.json({ success: true, data: { openQuestions } });
  } catch (err) { next(err); }
});

export default router;
