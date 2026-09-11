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
import type { ToolPolicyConfig } from "../types";
import { isToolDiscoverableUnderPolicy, isToolInjectableOnFullChannel, resolveToolPolicyEntry } from "./tool-policy";
import {
  resolveWorkbenchToolDecisionSlot,
  WORKBENCH_TOOL_APPROVAL_UNWIRED_MESSAGE,
} from "../services/ai/workbench-tool-approval";
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
  /**
   * 交互式确认端口，**可选**：只有调用方真的存在「能把确认请求送到人面前、并拿到
   * 一次可追溯回答」的链路时才传（返回 false 表示用户取消）。
   *
   * 批次 6b 返修（③）：缺省即本通道**没有审批闸门**——落 ask 档的工具一律失败关闭，
   * 不接受任何来自请求体的自证批准。此前 `/agent/chat` 传的是
   * `async () => req.body?.confirm === true`：一个布尔一次性批准本轮所有待确认调用，
   * 等于把「要不要审批」交回给被审方，写工具、外发工具与本批的 user-confirm 策略
   * 在该通道全部失效。口径与批次 1a 的同步兜底通道一致（workbench-tool-loop.ts:282）。
   */
  confirm?: (name: string, args: Record<string, unknown>) => Promise<boolean>;
  systemPrompt?: string;
  maxTurns?: number;
  /** 可信运行上下文（O2 · A4）：透传给工具执行，用于会话来源等可信字段 */
  runtimeContext?: RuntimeContext;
  /**
   * SP-2026-007 MS3：工具注入模式。缺省读配置项 config.agent.toolInjection
   * （环境变量 WES_AGENT_TOOL_INJECTION，默认 discovery；置 full 一键回退旧全量注入）。
   */
  toolInjectionMode?: ToolInjectionMode;
  /**
   * 批次 6b（additive）：生效工具策略（system_configs.toolPolicy）。由调用方从
   * 服务端可信存储读取后传入，不接受模型/前端提供。本层只做减法：capability 过滤
   * （注册表 selector 的既有逻辑，本批不动）之上再裁掉停用、角色不可见、
   * on-demand 降档三类；审批确认条件同时读取策略（user-confirm 收紧）。
   */
  toolPolicy?: ToolPolicyConfig;
}

const DEFAULT_MAX_TURNS = 12;

export async function runAgent(params: RunAgentParams): Promise<string> {
  const { userMessage, user, registry, runner, onEvent, confirm } = params;
  const maxTurns = params.maxTurns ?? DEFAULT_MAX_TURNS;
  const mode = params.toolInjectionMode ?? config.agent.toolInjection;
  const policy = params.toolPolicy;
  const roles = user.roles ?? [];
  // full：全量回退，注入集与旧行为逐字节一致（全部业务工具、无 list_tools）；
  // discovery：核心工具 + list_tools，其余经发现后补入当轮注入集。
  // 批次 6b 返修（④）：注入准入只有一处判据 isToolInjectableOnFullChannel——与工作台
  // 通道的 applyToolPolicyToDefinitions 共用同一函数，不再各内联一份三刀。
  // 无生效策略时每条都拿默认条目 → 全部通过，与批次 6a 行为逐字节一致。
  const rawTools: ToolDefinition[] =
    mode === "full"
      ? registry.listFullToolsFor(user)
      : [...registry.listCoreToolsFor(user), ...registry.listDiscoveryToolsFor(user)];
  const tools: ToolDefinition[] = rawTools.filter((definition) =>
    isToolInjectableOnFullChannel(registry.get(definition.function.name), policy, roles),
  );
  /**
   * 本回合**实际注入**给模型的工具名全集（含 list_tools 发现后补入的）。
   * 执行侧据此拒绝「注入集之外」的调用：停用 / 角色不可见 / on-demand 降档且未经发现
   * 的工具，即便被模型凭空点名，也拿不到执行机会，更拿不到审批机会。
   */
  const injectedToolNames = new Set(tools.map((definition) => definition.function.name));

  const messages: ChatMessage[] = [];
  if (params.systemPrompt) messages.push({ role: "system", content: params.systemPrompt });
  messages.push({ role: "user", content: userMessage });

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const reply = await runner.chatCompletion({ messages, tools, toolChoice: "auto" });

    if (reply.toolCalls && reply.toolCalls.length > 0) {
      for (const call of reply.toolCalls) {
        const tool = registry.get(call.name);
        const entry = resolveToolPolicyEntry(policy, call.name);
        // 批次 6b 返修（④）·第一道：注入集边界。未注入（停用 / 角色不可见 /
        // on-demand 降档且未经 list_tools 发现）的工具先挡掉，连审批机会都不给——
        // 「用户批准」只在「本可注入」的前提下有意义。与工作台 executeToolCallBatch 同形。
        if (!injectedToolNames.has(call.name)) {
          const error = `工具 ${call.name} 已被工具策略停用、对本角色不可见或未经发现，未执行`;
          onEvent({ kind: "tool_result", name: call.name, ok: false, error });
          messages.push(toolResultMessage(call.id, call.name, { ok: false, error }));
          continue;
        }
        // 批次 6b 返修（④）·第二道：要不要审批只有一处判据 resolveWorkbenchToolDecisionSlot
        // （写 / 外发 / 策略 user-confirm 落 ask；mutates 严格 false 才 allow；查不到工具一律 ask）。
        // 替代此前内联的三条件副本——两份判据今天碰巧一致，改一边就分家。
        if (resolveWorkbenchToolDecisionSlot(tool, entry) === "ask") {
          if (!confirm) {
            // 批次 6b 返修（③）：本通道没有审批闸门 → 失败关闭。不发 need_confirm
            // （没问过人，就不能对人说「已请求确认」），也不执行。
            const error = `${call.name}: ${WORKBENCH_TOOL_APPROVAL_UNWIRED_MESSAGE}`;
            onEvent({ kind: "tool_result", name: call.name, ok: false, error });
            messages.push(toolResultMessage(call.id, call.name, { ok: false, error }));
            continue;
          }
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
            const discovered = registry
              .listDiscoveredToolDefinitionsFor(user, extractDiscoveredToolNames(data))
              // 批次 6b：发现后的补注入同样过策略（停用/角色不可见不得经发现绕回来）。
              // 无策略时默认条目必过，与批次 6a 行为一致。
              .filter((definition) => {
                const discoveredTool = registry.get(definition.function.name);
                return discoveredTool !== undefined && isToolDiscoverableUnderPolicy(discoveredTool, policy, roles);
              });
            for (const def of discovered) {
              // 必须与注入集同步登记：漏一次就等于把刚发现的工具挡在执行边界外。
              if (!injectedToolNames.has(def.function.name)) {
                injectedToolNames.add(def.function.name);
                tools.push(def);
              }
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
