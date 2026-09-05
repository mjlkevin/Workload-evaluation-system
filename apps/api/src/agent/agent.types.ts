import type { ToolDefinition } from "../ai/provider/model-provider";
import type { Capability } from "../rbac/permissions";
import type { RuntimeContext } from "./context/context.types";

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
  /** SP-2026-007 MS3：工具分类（发现/分组用）；内置发现工具为 "discovery" */
  category?: string;
  /** SP-2026-007 MS3：true 时默认不注入 tools 参数，经 list_tools 发现后进入当轮注入集 */
  discoverable?: boolean;
  /** 真正执行：调用底层 usecase；runtime 为可信运行上下文（O2 · A4 注入） */
  execute(args: Record<string, unknown>, user: AgentUser, runtime?: RuntimeContext): Promise<unknown>;
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
// 批次 1a（additive）：kind 词汇沿用批次 0 冻结的四种，只给 tool_call /
// tool_result 补可选 `toolCallId`。审批闸门与 UI 事件按 callId 对账——审批请求
// 只带 callId、参数以 tool.call.started 那一份为唯一来源，事件里就必须带得上这个 id。
export type AgentEvent =
  | { kind: "tool_call"; name: string; arguments: Record<string, unknown>; toolCallId?: string }
  | { kind: "tool_result"; name: string; ok: boolean; data?: unknown; error?: string; toolCallId?: string }
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
