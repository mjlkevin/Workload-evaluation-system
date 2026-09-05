import type { AuthUser } from "../types";
import type { Capability } from "../rbac/permissions";
import type { AgentTool } from "./agent.types";
import { createDefaultRegistry } from "./default-registry";

/** 后台工具清单条目：只暴露「有哪些、要什么权限、会不会写数据」，不含执行实现与参数 schema */
export interface ToolInventoryItem {
  name: string;
  description: string;
  capability: string;
  mutates: boolean;
  category: string;
  discoverable: boolean;
}

/**
 * 批次 6a：从运行时 ToolRegistry 派生工具清单。
 *
 * 清单不落库——落库的清单会与代码注册表漂移，而漂移方向恰是「页面上说有、实际没有」，
 * 那种页面比没有页面更糟。名称取自 listToolsFor（注册表唯一的注册顺序视图），
 * 元数据经公开的 registry.get 回取，全程不改 ToolRegistry 的注册与注入行为。
 */
export function buildToolInventory(user: AuthUser, capabilities: Capability[]): ToolInventoryItem[] {
  const registry = createDefaultRegistry(user);
  const agentUser = { id: user.id, capabilities };

  return registry
    .listToolsFor(agentUser)
    .map((definition) => registry.get(definition.function.name))
    .filter((tool): tool is AgentTool => tool !== undefined)
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      capability: tool.capability,
      mutates: tool.mutates,
      category: tool.category ?? "",
      discoverable: tool.discoverable === true,
    }));
}
