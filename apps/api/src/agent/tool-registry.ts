import type { ToolDefinition } from "../ai/provider/model-provider";
import { type AgentTool, type AgentUser, toToolDefinition } from "./agent.types";
import type { RuntimeContext } from "./context/context.types";

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
