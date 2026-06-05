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
import * as CollabModule from "../modules/collab/collab.module";

const router = Router();

// Workspace routes
router.post("/workspaces", requireCapability("evidence:write"), CollabModule.postWorkspace);
router.get("/workspaces", requireAnyCapability("evidence:read", "evidence:write"), CollabModule.listWorkspacesHandler);
router.get("/workspaces/:id", requireAnyCapability("evidence:read", "evidence:write"), CollabModule.getWorkspaceHandler);
router.patch("/workspaces/:id", requireCapability("evidence:write"), CollabModule.patchWorkspace);
router.delete("/workspaces/:id", requireCapability("evidence:write"), CollabModule.deleteWorkspaceHandler);
router.post("/workspaces/:id/members", requireCapability("evidence:write"), CollabModule.addMemberHandler);
router.delete("/workspaces/:id/members/:userId", requireCapability("evidence:write"), CollabModule.removeMemberHandler);
router.get("/workspaces/:id/stats", requireAnyCapability("evidence:read", "evidence:write"), CollabModule.getWorkspaceStatsHandler);

// Message routes
router.post("/workspaces/:id/messages", requireCapability("evidence:write"), CollabModule.postMessage);
router.get("/workspaces/:id/messages", requireAnyCapability("evidence:read", "evidence:write"), CollabModule.listMessagesHandler);
router.get("/messages/:messageId", requireAnyCapability("evidence:read", "evidence:write"), CollabModule.getMessageHandler);
router.patch("/messages/:messageId", requireCapability("evidence:write"), CollabModule.patchMessage);
router.delete("/messages/:messageId", requireCapability("evidence:write"), CollabModule.deleteMessageHandler);
router.get("/messages/:messageId/thread", requireAnyCapability("evidence:read", "evidence:write"), CollabModule.getThreadHandler);

export default router;
