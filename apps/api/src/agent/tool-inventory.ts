import type { AuthUser } from "../types";
import type { Capability } from "../rbac/permissions";
import type { AgentTool } from "./agent.types";
import { createDefaultRegistry } from "./default-registry";

/** 后台工具清单条目：只暴露「有哪些、要什么权限、会不会写数据、查看者本人能不能调」，不含执行实现与参数 schema */
export interface ToolInventoryItem {
  name: string;
  description: string;
  capability: string;
  mutates: boolean;
  category: string;
  discoverable: boolean;
  /** 当前查看者本人是否持有该工具所需能力位（即能否真的调用它） */
  callable: boolean;
}

/**
 * 能力位全集，用作「把注册表里所有工具都问出来」的探针。
 *
 * 用 satisfies Record<Capability, true> 绑定 RBAC 的类型定义：新增能力位时这里编译失败，
 * 逼着清单同步扩容。若只写一个数组，新工具挂上新能力位后会在审计页静默消失——
 * 而静默少报恰恰是这类页面最坏的失效方式。
 */
const CAPABILITY_UNIVERSE = {
  "estimates:create": true,
  "estimates:read": true,
  "estimates:write": true,
  "contract:initiate": true,
  "requirement:upload": true,
  "extractor:trigger": true,
  "requirement:maintain": true,
  "assessment:create": true,
  "dev:assign": true,
  "assumption:write": true,
  "assessment:handoff": true,
  "man-day:adjust": true,
  "dev:read": true,
  "dev:write": true,
  "deliverable:generate": true,
  "deliverable:review": true,
  "deliverable:reject": true,
  "evidence:read": true,
  "evidence:write": true,
  "dsl:manage": true,
  "template:manage": true,
  "rate-card:manage": true,
  "methodology:manage": true,
  "rule:manage": true,
  "user:manage": true,
  "system:manage": true,
} satisfies Record<Capability, true>;

const ALL_CAPABILITIES = Object.keys(CAPABILITY_UNIVERSE) as Capability[];

/**
 * 批次 6a：从运行时 ToolRegistry 派生工具清单。
 *
 * 清单不落库——落库的清单会与代码注册表漂移，而漂移方向恰是「页面上说有、实际没有」，
 * 那种页面比没有页面更糟。名称取自 listToolsFor（注册表唯一的注册顺序视图），
 * 元数据经公开的 registry.get 回取，全程不改 ToolRegistry 的注册与注入行为。
 *
 * 过滤口径：清单列的是【注册表里的全部工具】，不按查看者的业务权限裁剪。
 * 本端点由 system:manage 守卫，目标用户是系统管理员——他们通常不持有 estimates:* 等业务
 * 能力位，一旦按查看者权限过滤，审计页会对真实存在的工具静默少报。查看者本人的权限差异
 * 改为逐条 `callable` 标记呈现：看得见这个工具，也知道你本人调不了它。
 */
export function buildToolInventory(user: AuthUser, viewerCapabilities: Capability[]): ToolInventoryItem[] {
  const registry = createDefaultRegistry(user);
  const viewerCaps = new Set(viewerCapabilities);

  return registry
    .listToolsFor({ id: user.id, capabilities: ALL_CAPABILITIES })
    .map((definition) => registry.get(definition.function.name))
    .filter((tool): tool is AgentTool => tool !== undefined)
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      capability: tool.capability,
      mutates: tool.mutates,
      category: tool.category ?? "",
      discoverable: tool.discoverable === true,
      // 与 ToolRegistry.execute 的调用门禁同口径：所需能力位在查看者能力位内才真的调得动
      callable: viewerCaps.has(tool.capability),
    }));
}
