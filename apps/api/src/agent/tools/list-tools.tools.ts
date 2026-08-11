import type { AgentTool } from "../agent.types";
import type { ToolRegistry } from "../tool-registry";
import { DISCOVERY_CATEGORY } from "../tool-registry";
import { asString } from "../../utils/helpers";

/**
 * SP-2026-007 MS3：内置工具 list_tools（读、自动执行）。
 * 入参意图描述/类别，返回权限内（RBAC 能力位过滤）匹配 discoverable 工具的
 * 说明书子集；编排循环据此把命中工具补入当轮 tools 参数（按需发现两段式）。
 */

export const LIST_TOOLS_TOOL_NAME = "list_tools";

/** 工具说明书（返回给模型的子集） */
export type ToolManual = {
  name: string;
  description: string;
  category: string;
  mutates: boolean;
  parameters: Record<string, unknown>;
};

export function buildListToolsTool(registry: ToolRegistry): AgentTool {
  return {
    name: LIST_TOOLS_TOOL_NAME,
    description:
      "按意图或类别发现当前可用的工具，返回匹配工具的说明书（名称/描述/类别/参数 schema）。需要未直接提供的工具时先调用本工具发现，再按说明书调用目标工具。",
    parameters: {
      type: "object",
      properties: {
        intent: { type: "string", description: "意图描述（可选），如「查知识库」「导出报告」" },
        category: { type: "string", description: "工具类别（可选），如 knowledge / estimate / export" },
      },
    },
    capability: "estimates:read",
    mutates: false,
    category: DISCOVERY_CATEGORY,
    discoverable: false,
    async execute(args, user) {
      const intent = asString(args.intent);
      const category = asString(args.category);
      const matches = registry.searchToolsFor(user, {
        ...(intent ? { intent } : {}),
        ...(category ? { category } : {}),
      });
      const tools: ToolManual[] = matches.map((tool) => ({
        name: tool.name,
        description: tool.description,
        category: tool.category ?? "",
        mutates: tool.mutates,
        parameters: tool.parameters,
      }));
      return { tools };
    },
  };
}

/** 从 list_tools 执行结果中解析发现的工具名（防御式解析，非法载荷返回空） */
export function extractDiscoveredToolNames(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const tools = (data as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return [];
  return tools
    .map((item) => (item && typeof item === "object" ? (item as { name?: unknown }).name : undefined))
    .filter((name): name is string => typeof name === "string" && name.length > 0);
}
