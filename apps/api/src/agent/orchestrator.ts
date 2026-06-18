import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
} from "../ai/provider/model-provider";
import type { AgentEvent, AgentUser } from "./agent.types";
import type { ToolRegistry } from "./tool-registry";

/** 编排只依赖 chatCompletion，便于测试注入假 Provider */
export interface ChatRunner {
  chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse>;
}

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
}

const DEFAULT_MAX_TURNS = 12;

export async function runAgent(params: RunAgentParams): Promise<string> {
  const { userMessage, user, registry, runner, onEvent, confirm } = params;
  const maxTurns = params.maxTurns ?? DEFAULT_MAX_TURNS;
  const tools = registry.listToolsFor(user);

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
          const data = await registry.execute(call.name, call.arguments, user);
          onEvent({ kind: "tool_result", name: call.name, ok: true, data });
          messages.push(toolResultMessage(call.id, call.name, { ok: true, data }));
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
