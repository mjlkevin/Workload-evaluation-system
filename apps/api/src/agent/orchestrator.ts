import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ToolDefinition,
} from "../ai/provider/model-provider";
import type { AgentEvent, AgentUser } from "./agent.types";
import type { RuntimeContext } from "./context/context.types";
import type { ToolRegistry } from "./tool-registry";
import { extractDiscoveredToolNames, LIST_TOOLS_TOOL_NAME } from "./tools/list-tools.tools";
import { config } from "../config/env";

/** 编排只依赖 chatCompletion，便于测试注入假 Provider */
export interface ChatRunner {
  chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse>;
}

/** SP-2026-007 MS3：工具注入模式——full 全量回退（旧行为）；discovery 按需发现（默认） */
export type ToolInjectionMode = "full" | "discovery";

export interface RunAgentParams {
  userMessage: string;
  user: AgentUser;
  registry: ToolRegistry;
  runner: ChatRunner;
  onEvent: (event: AgentEvent) => void;
  /** 写操作确认回调；返回 false 表示用户取消 */
  confirm: (name: string, args: Record<string, unknown>) => Promise<boolean>;
  systemPrompt?: string;
  maxTurns?: number;
  /** 可信运行上下文（O2 · A4）：透传给工具执行，用于会话来源等可信字段 */
  runtimeContext?: RuntimeContext;
  /**
   * SP-2026-007 MS3：工具注入模式。缺省读配置项 config.agent.toolInjection
   * （环境变量 WES_AGENT_TOOL_INJECTION，默认 discovery；置 full 一键回退旧全量注入）。
   */
  toolInjectionMode?: ToolInjectionMode;
}

const DEFAULT_MAX_TURNS = 12;

export async function runAgent(params: RunAgentParams): Promise<string> {
  const { userMessage, user, registry, runner, onEvent, confirm } = params;
  const maxTurns = params.maxTurns ?? DEFAULT_MAX_TURNS;
  const mode = params.toolInjectionMode ?? config.agent.toolInjection;
  // full：全量回退，注入集与旧行为逐字节一致（全部业务工具、无 list_tools）；
  // discovery：核心工具 + list_tools，其余经发现后补入当轮注入集。
  const tools: ToolDefinition[] =
    mode === "full"
      ? registry.listFullToolsFor(user)
      : [...registry.listCoreToolsFor(user), ...registry.listDiscoveryToolsFor(user)];

  const messages: ChatMessage[] = [];
  if (params.systemPrompt) messages.push({ role: "system", content: params.systemPrompt });
  messages.push({ role: "user", content: userMessage });

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const reply = await runner.chatCompletion({ messages, tools, toolChoice: "auto" });

    if (reply.toolCalls && reply.toolCalls.length > 0) {
      for (const call of reply.toolCalls) {
        const tool = registry.get(call.name);
        if (tool?.mutates) {
          onEvent({ kind: "need_confirm", name: call.name, arguments: call.arguments });
          const okToRun = await confirm(call.name, call.arguments);
          if (!okToRun) {
            messages.push(toolResultMessage(call.id, call.name, { ok: false, error: "用户取消" }));
            continue;
          }
        }

        onEvent({ kind: "tool_call", name: call.name, arguments: call.arguments });
        try {
          const data = await registry.execute(call.name, call.arguments, user, params.runtimeContext);
          onEvent({ kind: "tool_result", name: call.name, ok: true, data });
          messages.push(toolResultMessage(call.id, call.name, { ok: true, data }));
          // MS3：list_tools 命中后，把发现的 discoverable 工具补入后续轮注入集（去重）
          if (mode === "discovery" && call.name === LIST_TOOLS_TOOL_NAME) {
            const discovered = registry.listDiscoveredToolDefinitionsFor(
              user,
              extractDiscoveredToolNames(data),
            );
            const injected = new Set(tools.map((t) => t.function.name));
            for (const def of discovered) {
              if (!injected.has(def.function.name)) tools.push(def);
            }
          }
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          onEvent({ kind: "tool_result", name: call.name, ok: false, error });
          messages.push(toolResultMessage(call.id, call.name, { ok: false, error }));
        }
      }
      continue;
    }

    onEvent({ kind: "final", content: reply.content });
    return reply.content;
  }

  throw new Error(`Agent 编排已达到最大轮数 ${maxTurns}`);
}

/** v1 用 assistant 文本消息回填工具结果；后续可升级为标准 tool role。 */
function toolResultMessage(
  toolCallId: string,
  name: string,
  result: { ok: boolean; data?: unknown; error?: string },
): ChatMessage {
  return {
    role: "assistant",
    content: `[工具结果] ${name} (callId=${toolCallId}): ${JSON.stringify(result)}`,
  };
}
