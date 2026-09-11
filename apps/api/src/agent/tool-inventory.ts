import type { AuthUser } from "../types";
import type { ToolPolicyConfig, ToolPolicyEntry } from "../types";
import type { Capability } from "../rbac/permissions";
import type { V2Role } from "../rbac/roles";
import type { AgentTool } from "./agent.types";
import { toToolDefinition } from "./agent.types";
import { estimateToolsTokens } from "../services/ai/context/token-meter";
import { resolveToolPolicyEntry } from "./tool-policy";
import { createDefaultRegistry } from "./default-registry";

/** 后台工具清单条目：只暴露「有哪些、要什么权限、会不会写数据、会不会外发数据、查看者本人能不能调、定义占多少 token」，不含执行实现与参数 schema */
export interface ToolInventoryItem {
  name: string;
  description: string;
  capability: string;
  mutates: boolean;
  /** 批次 6b：数据外发维度（独立于 mutates；代码侧事实，不落库） */
  exfiltrates: boolean;
  category: string;
  discoverable: boolean;
  /** 当前查看者本人是否持有该工具所需能力位（即能否真的调用它） */
  callable: boolean;
  /** 批次 6b：该工具定义（名称+描述+参数 schema）注入模型时的 token 估算（批次 3 计量口径） */
  tokens: number;
  /**
   * 批次 6b：当前**生效策略**下该工具是否仍会进入查看者的注入集
   * （capability ∩ 启用 ∩ 角色可见 ∩ 注入模式）。缺省策略时 = callable 且非 on-demand 降档。
   */
  injected: boolean;
  /** 批次 6b：生效策略的该工具条目（无覆盖条目时为代码默认），供页面呈现当前生效决定 */
  activePolicy: ToolPolicyEntry;
}

/** 批次 6b：注入集合计（按查看者生效视图计算） */
export interface ToolInventoryInjectionSummary {
  /** 当前注入给该查看者的工具定义合计 token（批次 3 口径） */
  injectedTokens: number;
  /** 当前注入给该查看者的工具数量 */
  injectedCount: number;
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
 *
 * 批次 6b：追加只读派生字段——token 占用（批次 3 计量）、外发维度、生效策略下的注入判定。
 * 策略（activePolicy / injected）来自 system_configs.toolPolicy 的**生效值**，
 * 但本函数不读存储：策略由调用方取到后传入，保持清单派生路径无 DB 依赖。
 * 缺省（policy 未传）时全部工具走代码默认，与批次 6a 行为一致。
 */
export function buildToolInventory(
  user: AuthUser,
  viewerCapabilities: Capability[],
  options: { policy?: ToolPolicyConfig; viewerRoles?: readonly V2Role[] } = {},
): { items: ToolInventoryItem[]; summary: ToolInventoryInjectionSummary } {
  const registry = createDefaultRegistry(user);
  const viewerCaps = new Set(viewerCapabilities);
  const viewerRoles = options.viewerRoles ?? [];

  const items: ToolInventoryItem[] = registry
    .listToolsFor({ id: user.id, capabilities: ALL_CAPABILITIES })
    .map((definition) => registry.get(definition.function.name))
    .filter((tool): tool is AgentTool => tool !== undefined)
    .map((tool) => {
      const activePolicy = resolveToolPolicyEntry(options.policy, tool.name);
      // token 口径与出口预算完全同源：estimateToolsTokens 按序列化 JSON Schema 计费
      const [definition] = [toToolDefinition(tool)];
      const tokens = estimateToolsTokens([definition]);
      const capabilityOk = viewerCaps.has(tool.capability);
      const roleOk = activePolicy.visibleRoles.length === 0
        || activePolicy.visibleRoles.some((role) => (viewerRoles as readonly string[]).includes(role));
      // 与工作台全量通道（listFullToolsFor ∩ 策略减法）同一口径逐条对齐：
      // 内置 discovery 类（list_tools）不在此通道；discoverable 业务工具**在**。
      const injected =
        capabilityOk &&
        activePolicy.enabled !== false &&
        roleOk &&
        activePolicy.injectionMode !== "on-demand" &&
        tool.category !== "discovery";
      return {
        name: tool.name,
        description: tool.description,
        capability: tool.capability,
        mutates: tool.mutates,
        exfiltrates: tool.exfiltrates === true,
        category: tool.category ?? "",
        discoverable: tool.discoverable === true,
        // 与 ToolRegistry.execute 的调用门禁同口径：所需能力位在查看者能力位内才真的调得动
        callable: capabilityOk,
        tokens,
        injected,
        activePolicy,
      };
    });

  const summary: ToolInventoryInjectionSummary = {
    injectedCount: items.filter((item) => item.injected).length,
    injectedTokens: items.filter((item) => item.injected).reduce((sum, item) => sum + item.tokens, 0),
  };
  return { items, summary };
}
