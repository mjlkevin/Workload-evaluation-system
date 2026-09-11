// ============================================================
// 批次 6a：AI 工具清单（系统管理 · 只读）
// 批次 6b：清单仍从运行时 ToolRegistry 现取派生（6a 裁决不变）；本文件叠加的
//   只是「挂在清单上的决定」的**生效视图**（activePolicy/injected）与批次 3 的
//   token 计量。策略本身的读写走 /system/tool-policy（system.usecase），
//   编辑只动草稿、生效才换 active——清单本身永不可编辑。
// ============================================================

import type { Request, Response } from "express";

import { buildToolInventory } from "../agent/tool-inventory";
import { resolveActiveToolPolicy } from "../modules/system/system.repository";
import { resolveActiveMcpTools } from "../agent/mcp/mcp-runtime";
import { getCombinedCapabilities } from "../rbac/permissions";
import { ok } from "../utils/response";

/**
 * GET /system/ai-tools：返回注册表全部工具，逐条标出查看者本人能否调用（不按查看者权限裁剪清单），
 * 并附批次 6b 的生效策略视图（activePolicy / injected / exfiltrates / tokens）与注入集合计。
 * 批次 7：叠加本回合现问现得的 MCP 快照——清单仍从**运行时注册表**派生（6a 裁决的扩法，
 * 只把「代码」扩成「运行时注册表」），MCP 工具与代码工具同页呈现、按 origin 可辨。
 */
export async function listAiToolsHandler(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) {
    res.status(401).json({ code: 40101, message: "未登录", data: null });
    return;
  }

  const capabilities = getCombinedCapabilities(req.v2Roles ?? []);
  // 读失败抛 SystemStoreError（失败方向关闭）：宁可页面报错，也不拿「无策略」假象放行。
  const policy = await resolveActiveToolPolicy();
  const mcp = await resolveActiveMcpTools();
  const { items, summary } = buildToolInventory(user, capabilities, {
    policy,
    viewerRoles: req.v2Roles ?? [],
    mcpTools: mcp.tools,
    mcpServerNames: mcp.serverNames,
  });
  res.json(ok({ items, summary }));
}
