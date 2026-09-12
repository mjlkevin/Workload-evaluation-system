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
  /** 批次 7：工具来源。"code" = 代码工具（经 PR/CI 评审）；"mcp" = MCP 桥接工具（第三方撰写，逐个人工放行） */
  origin: "code" | "mcp";
  /** 批次 7：MCP 工具归属服务（本地登记的 id/name；代码工具为 null） */
  mcpServer: { id: string; name: string } | null;
  /**
   * 批次 7：MCP 工具的人工放行状态（按**当前**定义摘要复验）：
   *  - "approved" 已放行且定义未变；
   *  - "definition-changed" 放行过但第三方改了 description/schema → 已自动回落，需重新人工放行；
   *  - "not-approved" 未经放行。
   * 代码工具为 null。
   */
  mcpApproval: "approved" | "definition-changed" | "not-approved" | null;
  /** 批次 7：MCP 工具当前定义摘要（放行名单比对基准；代码工具为 null） */
  mcpDigest: string | null;
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
  "mcp:invoke": true,
  "dsl:manage": true,
  "template:manage": true,
  "rate-card:manage": true,
  "methodology:manage": true,
  "rule:manage": true,
  "user:manage": true,
  "system:manage": true,
} satisfies Record<Capability, true>;

const ALL_CAPABILITIES = Object.keys(CAPABILITY_UNIVERSE) as Capability[];

/** 桥接工具（mcp-bridge.McpBridgedTool）在 AgentTool 之上附加的归属字段；此处只做读取 */
type McpToolShape = { mcpServerId?: string; mcpDigest?: string };

function mcpServerIdOf(tool: AgentTool): string | undefined {
  return (tool as AgentTool & McpToolShape).mcpServerId;
}

function mcpDigestOf(tool: AgentTool): string | null {
  return (tool as AgentTool & McpToolShape).mcpDigest ?? null;
}

/**
 * 出现在注册表里的 MCP 工具**必然**是已放行且摘要相符的——未放行/已变卦的工具
 * 在采集层就被挡下，从不进入快照（裁决二：默认不可用是进不来，不是进来了被标灰）。
 */
function mcpApprovalOf(tool: AgentTool): "approved" {
  void tool;
  return "approved";
}

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
  options: {
    policy?: ToolPolicyConfig;
    viewerRoles?: readonly V2Role[];
    /**
     * 批次 7：本回合现问现得、已放行且摘要复验通过的 MCP 工具快照。
     * 合并进注册表副本后与代码工具走**同一条**派生路径——清单仍从运行时注册表
     * 派生（批次 6a 裁决的扩法：只把「代码」扩成「运行时注册表」一词），不落库、
     * 不缓存。未放行/已变卦的工具不在快照里，也就不会伪装成「存在但未注入」。
     */
    mcpTools?: readonly AgentTool[];
    /** 批次 7：MCP 服务展示名映射（本地登记的 id→name；不来自服务上报） */
    mcpServerNames?: Readonly<Record<string, string>>;
  } = {},
): { items: ToolInventoryItem[]; summary: ToolInventoryInjectionSummary } {
  const baseRegistry = createDefaultRegistry(user);
  const registry =
    options.mcpTools && options.mcpTools.length > 0
      ? baseRegistry.cloneWithMcpTools(options.mcpTools)
      : baseRegistry;
  const viewerCaps = new Set(viewerCapabilities);
  const viewerRoles = options.viewerRoles ?? [];
  const mcpServerNames = options.mcpServerNames ?? {};

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
      // 批次 7：MCP 工具的角色可见性只能来自放行记录 mcpAllowedRoles，不得回落策略条目的空 visibleRoles。
      const mcpAllowedRoles = tool.source === "mcp" ? tool.mcpAllowedRoles : undefined;
      const roleOk =
        mcpAllowedRoles !== undefined
          ? mcpAllowedRoles.length > 0 && mcpAllowedRoles.some((role) => (viewerRoles as readonly string[]).includes(role))
          : activePolicy.visibleRoles.length === 0 ||
            activePolicy.visibleRoles.some((role) => (viewerRoles as readonly string[]).includes(role));
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
        origin: tool.source === "mcp" ? "mcp" : "code",
        mcpServer: tool.source === "mcp" && mcpServerIdOf(tool)
          ? { id: mcpServerIdOf(tool) as string, name: mcpServerNames[mcpServerIdOf(tool) as string] ?? mcpServerIdOf(tool) as string }
          : null,
        mcpApproval: tool.source === "mcp" ? mcpApprovalOf(tool) : null,
        mcpDigest: tool.source === "mcp" ? mcpDigestOf(tool) : null,
      };
    });

  const summary: ToolInventoryInjectionSummary = {
    injectedCount: items.filter((item) => item.injected).length,
    injectedTokens: items.filter((item) => item.injected).reduce((sum, item) => sum + item.tokens, 0),
  };
  return { items, summary };
}
