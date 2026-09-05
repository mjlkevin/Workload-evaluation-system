// ============================================================
// 批次 6a：AI 工具清单（系统管理 · 只读）
// ============================================================
// 清单每次请求从运行时 ToolRegistry 现取，不落库、不可在此编辑。
// 启用/停用、角色可见性与审批策略属批次 6b，本批不提供任何写端点。

import type { Request, Response } from "express";

import { buildToolInventory } from "../agent/tool-inventory";
import { getCombinedCapabilities } from "../rbac/permissions";
import { ok } from "../utils/response";

/** GET /system/ai-tools：返回调用方权限内可见的工具清单 */
export function listAiToolsHandler(req: Request, res: Response): void {
  const user = req.user;
  if (!user) {
    res.status(401).json({ code: 40101, message: "未登录", data: null });
    return;
  }

  const capabilities = getCombinedCapabilities(req.v2Roles ?? []);
  res.json(ok({ items: buildToolInventory(user, capabilities) }));
}
