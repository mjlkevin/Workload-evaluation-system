import type { ToolDefinition } from "../ai/provider/model-provider";
import type { Capability } from "../rbac/permissions";

/** 当前用户上下文（编排循环透传，用于权限与数据隔离） */
export interface AgentUser {
  id: string;
  capabilities: Capability[];
}

/** 一个可被 LLM 调用的工具 */
export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema 参数对象 */
  parameters: Record<string, unknown>;
  /** 所需 RBAC 能力位；调用前校验 */
  capability: Capability;
  /** 是否写操作（true 需用户确认） */
  mutates: boolean;
  /** 真正执行：调用底层 usecase */
  execute(args: Record<string, unknown>, user: AgentUser): Promise<unknown>;
}

/** 工具执行结果（回填给 LLM） */
export interface ToolResult {
  toolCallId: string;
  name: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** 编排单步事件（供上层流式上报前端） */
export type AgentEvent =
  | { kind: "tool_call"; name: string; arguments: Record<string, unknown> }
  | { kind: "tool_result"; name: string; ok: boolean; data?: unknown; error?: string }
  | { kind: "need_confirm"; name: string; arguments: Record<string, unknown> }
  | { kind: "final"; content: string };

/** 把 AgentTool 转为 Provider 的 ToolDefinition */
export function toToolDefinition(tool: AgentTool): ToolDefinition {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
