import type { ToolDefinition } from "../ai/provider/model-provider";
import { type AgentTool, type AgentUser, toToolDefinition } from "./agent.types";
import type { RuntimeContext } from "./context/context.types";

/** SP-2026-007 MS3：内置发现类工具的 category 常量 */
export const DISCOVERY_CATEGORY = "discovery";

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    if (!tool.name) throw new Error("ToolRegistry.register: 工具名不能为空");
    this.tools.set(tool.name, tool);
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
