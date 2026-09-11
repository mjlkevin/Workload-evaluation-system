import type { ToolDefinition } from "../ai/provider/model-provider";
import { type AgentTool, type AgentUser, toToolDefinition } from "./agent.types";
import type { RuntimeContext } from "./context/context.types";
import { MCP_TOOL_PREFIX, parseMcpToolName } from "./mcp/mcp-names";

/** SP-2026-007 MS3：内置发现类工具的 category 常量 */
export const DISCOVERY_CATEGORY = "discovery";

/** 批次 7：工具重名注册冲突（MCP 桥接工具与代码工具互顶属此类，必须显式失败） */
export class ToolNameConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolNameConflictError";
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    if (!tool.name) throw new Error("ToolRegistry.register: 工具名不能为空");
    // 批次 7（裁决四）·第一道：命名守卫落在注册点，不依赖调用方自觉。
    // 代码工具一律不得占用 mcp__ 保留前缀——否则内部工具可伪装成桥接工具绕开归属校验。
    if (tool.source !== "mcp" && tool.name.startsWith(MCP_TOOL_PREFIX)) {
      throw new ToolNameConflictError(
        `ToolRegistry.register: 代码工具不得使用保留前缀 ${MCP_TOOL_PREFIX}（${tool.name}）`,
      );
    }
    if (this.tools.has(tool.name)) {
      // 批次 7：重名必须显式失败（MCP 桥接撞内部工具名的最后防线；
      // 既有代码工具重名同样失败，此前是静默后写覆盖先写）。
      throw new ToolNameConflictError(`ToolRegistry.register: 工具名重复: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * 批次 7（裁决四）·第二道：注册归属自己服务的 MCP 工具。
   * 稳定名必须无前缀不成、服务 id 与本地登记不符不成——恶意服务上报
   * `mcp__other__tool` 或裸名 `create_project` 都会在这一层被拒。
   */
  attachMcpTool(serverId: string, tool: AgentTool): void {
    if (tool.source !== "mcp") {
      throw new Error(`attachMcpTool: 非 MCP 来源工具不得使用本入口（${tool.name}）`);
    }
    const parsed = parseMcpToolName(tool.name);
    if (!parsed) {
      throw new ToolNameConflictError(`attachMcpTool: MCP 工具稳定名不合法（缺前缀或形态错误）: ${tool.name}`);
    }
    if (parsed.serverId !== serverId) {
      throw new ToolNameConflictError(
        `attachMcpTool: 工具 ${tool.name} 申报的归属服务 ${serverId} 与稳定名前缀 ${parsed.serverId} 不符`,
      );
    }
    this.register(tool);
  }

  /** 全部已注册工具（注册顺序），供回合级快照合并 */
  allTools(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 批次 7（方案 C）：把本回合现问现得的 MCP 工具快照合并进一份**新**注册表。
   * 不原地改：调用方可能传入跨请求复用的 registry（如路由 deps），原地附加会让
   * 上一回合的服务残影活到下一回合——快照必须随回合生、随回合灭。
   */
  cloneWithMcpTools(mcpTools: readonly AgentTool[]): ToolRegistry {
    const clone = new ToolRegistry();
    for (const tool of this.allTools()) {
      clone.register(tool);
    }
    const seen = new Set<string>();
    for (const tool of mcpTools) {
      const parsed = parseMcpToolName(tool.name);
      if (!parsed) {
        throw new ToolNameConflictError(`cloneWithMcpTools: MCP 工具稳定名不合法: ${tool.name}`);
      }
      if (seen.has(tool.name)) continue; // 同一快照内重复上报取首份（防御，非语义）
      seen.add(tool.name);
      clone.attachMcpTool(parsed.serverId, tool);
    }
    return clone;
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  /** 仅返回用户能力位覆盖的工具的 Provider 定义 */
  listToolsFor(user: AgentUser): ToolDefinition[] {
    const caps = new Set(user.capabilities);
    return Array.from(this.tools.values())
      .filter((tool) => caps.has(tool.capability))
      .map(toToolDefinition);
  }

  /**
   * SP-2026-007 MS3：全量回退注入集（旧行为逐字节一致）——
   * 全部业务工具（排除内置 discovery 类），保持注册顺序。
   */
  listFullToolsFor(user: AgentUser): ToolDefinition[] {
    const caps = new Set(user.capabilities);
    return Array.from(this.tools.values())
      .filter((tool) => tool.category !== DISCOVERY_CATEGORY && caps.has(tool.capability))
      .map(toToolDefinition);
  }

  /** SP-2026-007 MS3：核心注入集（非 discoverable 且非 discovery 类） */
  listCoreToolsFor(user: AgentUser): ToolDefinition[] {
    const caps = new Set(user.capabilities);
    return Array.from(this.tools.values())
      .filter(
        (tool) =>
          tool.category !== DISCOVERY_CATEGORY && tool.discoverable !== true && caps.has(tool.capability),
      )
      .map(toToolDefinition);
  }

  /** SP-2026-007 MS3：内置发现工具（list_tools 本身） */
  listDiscoveryToolsFor(user: AgentUser): ToolDefinition[] {
    const caps = new Set(user.capabilities);
    return Array.from(this.tools.values())
      .filter((tool) => tool.category === DISCOVERY_CATEGORY && caps.has(tool.capability))
      .map(toToolDefinition);
  }

  /**
   * SP-2026-007 MS3：发现检索——仅在 discoverable 工具中匹配，且经 RBAC 能力位过滤。
   * category 精确匹配；intent 对 name/description/category 做大小写不敏感包含匹配，
   * intent 与 category 都缺省时返回全部权限内 discoverable 工具。
   */
  searchToolsFor(user: AgentUser, query: { intent?: string; category?: string }): AgentTool[] {
    const caps = new Set(user.capabilities);
    const intent = (query.intent ?? "").trim().toLowerCase();
    const tokens = intent.split(/\s+/).filter(Boolean);
    return Array.from(this.tools.values()).filter((tool) => {
      if (tool.discoverable !== true) return false;
      if (!caps.has(tool.capability)) return false;
      if (query.category && tool.category !== query.category) return false;
      if (tokens.length === 0) return true;
      const haystack = `${tool.name} ${tool.description} ${tool.category ?? ""}`.toLowerCase();
      return tokens.some((token) => haystack.includes(token));
    });
  }

  /** SP-2026-007 MS3：按名称取 discoverable 工具的 Provider 定义（RBAC 过滤，供发现后补注入） */
  listDiscoveredToolDefinitionsFor(user: AgentUser, names: string[]): ToolDefinition[] {
    const caps = new Set(user.capabilities);
    const wanted = new Set(names);
    return Array.from(this.tools.values())
      .filter((tool) => wanted.has(tool.name) && tool.discoverable === true && caps.has(tool.capability))
      .map(toToolDefinition);
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    user: AgentUser,
    runtime?: RuntimeContext,
  ): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`未注册工具: ${name}`);
    if (!user.capabilities.includes(tool.capability)) {
      throw new Error(`无权限调用工具 ${name}（需 ${tool.capability}）`);
    }
    return tool.execute(args, user, runtime);
  }
}
