// ============================================================
// 批次 0 · AI 工作台只读工具循环
// ============================================================
// 冻结口径（工单 ②③，不可放宽）：
//  · 只把 mutates === false 的工具注入模型；过滤发生在注入点，
//    不改 ToolRegistry、不改任何工具定义（写操作确认闸门属批次 1）。
//  · 模型返回的 tool_calls 必须被真正执行并回填，否则「传了 tools
//    等于模型说了没人听」；单个调用被拒绝也必须回填 ok:false，
//    否则模型会认为调用成功而无限重试。
//  · 工具异常/拒绝一律不阻断主链路：回填失败结果后继续下一轮。
//  · 事件词汇表复用 agent.types 的 AgentEvent 既有 kind，不自造。
//  · 轮次上限沿用 orchestrator 的 DEFAULT_MAX_TURNS 口径（12）；达上限
//    不抛错，返回末轮内容并标记 truncated（工作台不能因工具轮数耗尽而报错）。
//
// 与 apps/api/src/agent/orchestrator.ts 的关系：只参照其回填消息形态，
// 不复用其循环——orchestrator 返回 Promise<string>，与工作台异步 Run 的
// 流式/幂等形态冲突（见雷达文档 §三①）。
// ============================================================

import type { ChatRole, ToolCall, ToolDefinition } from "../../ai/provider/model-provider";
import type { AgentEvent, AgentUser } from "../../agent/agent.types";
import type { ToolRegistry } from "../../agent/tool-registry";
import { createDefaultRegistry } from "../../agent/default-registry";
import type { RuntimeContext } from "../../agent/context/context.types";
import { getCombinedCapabilities } from "../../rbac/permissions";
import { legacyRoleToV2Roles } from "../../rbac/roles";
import type { AuthUser } from "../../types";
import type { StreamingChunk, WorkbenchToolCallTrace } from "./workbench-dispatch.service";

/** 轮次上限：与 orchestrator 的 DEFAULT_MAX_TURNS 同口径 */
export const WORKBENCH_TOOL_LOOP_MAX_TURNS = 12;

/** 工作台对话的消息形态（与 ChatMessage 兼容；本地定义以避免与 workbench-shared 形成模块环） */
export type WorkbenchToolLoopMessage = { role: ChatRole; content: string };

/**
 * 单次工具调用的副作用产出。
 * 必须是 type alias（而非 interface）：接入 Harness recordToolEffectOnce 时
 * 要求可赋值给 Record<string, unknown>，只有 type alias 带隐式索引签名。
 */
export type WorkbenchToolEffectOutput = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

/** 注入点解析结果：tools 供模型调用，readOnlyToolNames 供执行侧白名单校验 */
export type ReadOnlyWorkbenchToolSet = {
  registry: ToolRegistry;
  agentUser: AgentUser;
  tools: ToolDefinition[];
  readOnlyToolNames: Set<string>;
};

/**
 * ② 硬约束落点：在工作台侧解析「可注入给模型的只读工具集」。
 *
 * 能力位必须由服务端可信身份（legacy role）推导，不接受模型或前端传入，
 * 否则等于让调用方自行扩权。registry 过滤只读，不改注册表本身。
 */
export function resolveReadOnlyWorkbenchTools(
  user: AuthUser,
  options: { runtime?: RuntimeContext; registry?: ToolRegistry } = {},
): ReadOnlyWorkbenchToolSet {
  const agentUser: AgentUser = {
    id: user.id,
    capabilities: getCombinedCapabilities(legacyRoleToV2Roles(user.role)),
  };
  const registry = options.registry ?? createDefaultRegistry(user, options.runtime);
  const tools = registry
    .listFullToolsFor(agentUser)
    .filter((definition) => registry.get(definition.function.name)?.mutates === false);
  return {
    registry,
    agentUser,
    tools,
    readOnlyToolNames: new Set(tools.map((definition) => definition.function.name)),
  };
}

/** ④ 落 effect 时随附的审计信息：哪只工具、什么参数 */
export type WorkbenchToolEffectRecorderContext = {
  toolName: string;
  arguments: Record<string, unknown>;
};

/**
 * ④ 幂等接缝契约。
 * ordinal = 本次 Run 内「全局第 N 次工具调用」，实现方据此拼
 * `runId:stepKey:workbench_chat_tool_call:N`（结构由 ctx.makeEffectKey 冻结）。
 * 命中已记录 effect 时必须直接返回既有产出、不再调用 execute。
 */
export type WorkbenchToolEffectRecorder = (
  ordinal: number,
  execute: () => Promise<WorkbenchToolEffectOutput>,
  context: WorkbenchToolEffectRecorderContext,
) => Promise<WorkbenchToolEffectOutput>;

export type WorkbenchToolLoopResult = {
  /** 末轮（真正回答轮）的模型正文 */
  content: string;
  /** 实际发生的模型轮数 */
  turns: number;
  /** 是否因触达轮次上限而结束（末轮仍带工具调用请求） */
  truncated: boolean;
  /** 本会话内发生过的工具调用轨迹（供 MS3 工具 chip） */
  toolCalls: WorkbenchToolCallTrace[];
};

type WorkbenchToolLoopCommon = {
  /** 送模型的初始消息（系统提示词 + 历史窗口）；本函数不修改入参数组 */
  messages: WorkbenchToolLoopMessage[];
  registry: ToolRegistry;
  agentUser: AgentUser;
  /** 执行侧白名单：ToolRegistry.execute 只校验能力位、不校验 mutates，故循环自带判定 */
  readOnlyToolNames: Set<string>;
  runtime?: RuntimeContext;
  maxTurns?: number;
  onEvent?: (event: AgentEvent) => void;
  /**
   * ④ 幂等接缝：以「全局第 N 次工具调用」为 ordinal 落 effect。
   * 命中已记录的 effect 时必须直接返回既有产出、不再执行工具。
   */
  recordToolEffect?: WorkbenchToolEffectRecorder;
};

export type WorkbenchToolLoopInput = WorkbenchToolLoopCommon & {
  invoke: (params: {
    messages: WorkbenchToolLoopMessage[];
    turnOrdinal: number;
  }) => Promise<{ content: string; toolCalls?: ToolCall[] }>;
};

export type WorkbenchToolLoopStreamInput = WorkbenchToolLoopCommon & {
  invokeStream: (params: {
    messages: WorkbenchToolLoopMessage[];
    turnOrdinal: number;
  }) => AsyncIterable<StreamingChunk>;
};

function toEffectError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 回填正文必须可 JSON 序列化；工具返回不可序列化时降级为字符串，不得让循环抛出 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return '"[工具结果无法序列化]"';
  }
}

type ToolBatchContext = WorkbenchToolLoopCommon & {
  workingMessages: WorkbenchToolLoopMessage[];
  trace: WorkbenchToolCallTrace[];
  callCursor: { value: number };
};

/** 串行执行一批工具调用：逐个解析结果 → 落 effect → 发事件 → 回填消息 */
async function executeToolCallBatch(ctx: ToolBatchContext, calls: ToolCall[]): Promise<void> {
  for (const call of calls) {
    const name = call.name;
    const args = call.arguments ?? {};
    ctx.onEvent?.({ kind: "tool_call", name, arguments: args });

    ctx.callCursor.value += 1;
    const ordinal = ctx.callCursor.value;

    const resolveOutcome = async (): Promise<WorkbenchToolEffectOutput> => {
      if (!ctx.readOnlyToolNames.has(name)) {
        return { ok: false, error: `工作台仅开放只读工具，${name} 未获准执行` };
      }
      if (!ctx.registry.get(name)) {
        return { ok: false, error: `未注册工具: ${name}` };
      }
      try {
        const data = await ctx.registry.execute(name, args, ctx.agentUser, ctx.runtime);
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: toEffectError(err) };
      }
    };

    const outcome = ctx.recordToolEffect
      ? await ctx.recordToolEffect(ordinal, resolveOutcome, { toolName: name, arguments: args })
      : await resolveOutcome();

    ctx.onEvent?.(
      outcome.ok
        ? { kind: "tool_result", name, ok: true, data: outcome.data }
        : { kind: "tool_result", name, ok: false, error: outcome.error },
    );
    ctx.trace.push({ name });
    ctx.workingMessages.push({
      role: "assistant",
      content: `[工具结果] ${name} (callId=${call.id}): ${safeStringify(outcome)}`,
    });
  }
}

/** ③ 同步工具循环：调用模型 → 有工具则执行回填 → 再问，直到模型不再要求调用工具 */
export async function runWorkbenchToolLoop(
  input: WorkbenchToolLoopInput,
): Promise<WorkbenchToolLoopResult> {
  const maxTurns = input.maxTurns ?? WORKBENCH_TOOL_LOOP_MAX_TURNS;
  const workingMessages: WorkbenchToolLoopMessage[] = [...input.messages];
  const trace: WorkbenchToolCallTrace[] = [];
  const callCursor = { value: 0 };
  let content = "";

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const response = await input.invoke({ messages: [...workingMessages], turnOrdinal: turn });
    content = response.content ?? "";
    const calls = response.toolCalls ?? [];
    if (calls.length === 0) return { content, turns: turn, truncated: false, toolCalls: trace };
    // 已达上限：不再执行工具（避免无收敛的副作用），把末轮正文交回用户
    if (turn === maxTurns) return { content, turns: turn, truncated: true, toolCalls: trace };
    await executeToolCallBatch({ ...input, workingMessages, trace, callCursor }, calls);
  }

  return { content, turns: maxTurns, truncated: true, toolCalls: trace };
}

/**
 * ③ 流式工具循环（生产实际在跑的异步路径用这条）。
 *
 * chunk 逐条原样透传，无工具调用时零注入；一旦某轮携带 tool_calls，则执行
 * 该批调用并补发一个 kind:"metadata" 的 chunk 承载调用轨迹，使 dispatch
 * 能把 trace.toolCalls 落到 assistant metadata（与同步路径同一数据通路）。
 */
export async function* runWorkbenchToolLoopStream(
  input: WorkbenchToolLoopStreamInput,
): AsyncGenerator<StreamingChunk, WorkbenchToolLoopResult, void> {
  const maxTurns = input.maxTurns ?? WORKBENCH_TOOL_LOOP_MAX_TURNS;
  const workingMessages: WorkbenchToolLoopMessage[] = [...input.messages];
  const trace: WorkbenchToolCallTrace[] = [];
  const callCursor = { value: 0 };
  let content = "";

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    let turnContent = "";
    const turnCalls: ToolCall[] = [];
    for await (const chunk of input.invokeStream({ messages: [...workingMessages], turnOrdinal: turn })) {
      yield chunk;
      if (chunk.kind !== "metadata") turnContent += chunk.contentDelta ?? "";
      if (chunk.toolCalls?.length) turnCalls.push(...chunk.toolCalls);
    }
    content = turnContent;
    if (turnCalls.length === 0) return { content, turns: turn, truncated: false, toolCalls: trace };
    if (turn === maxTurns) return { content, turns: turn, truncated: true, toolCalls: trace };
    await executeToolCallBatch({ ...input, workingMessages, trace, callCursor }, turnCalls);
    yield { contentDelta: "", kind: "metadata", toolCalls: turnCalls };
  }

  return { content, turns: maxTurns, truncated: true, toolCalls: trace };
}

/**
 * ③ 流式消费侧的 trace 收集器。
 *
 * 流式分支不经过 modelChat，capturingModelChat 看不到工具调用；同一次调用还会
 * 在「provider 收尾 chunk」与「循环补发的 metadata chunk」上各出现一次。故按
 * call.id 去双投、再按 name 去重复调用（与 dispatch 的 capturingModelChat
 * name:source 键同口径），使流式/非流式两条路径产出同一形状的 trace.toolCalls。
 */
export function createWorkbenchToolCallTraceCollector(): {
  absorb: (chunk: StreamingChunk) => void;
  toTrace: () => WorkbenchToolCallTrace[] | undefined;
} {
  const seenCallIds = new Set<string>();
  const seenNames = new Set<string>();
  const trace: WorkbenchToolCallTrace[] = [];
  return {
    absorb: (chunk) => {
      for (const call of chunk.toolCalls ?? []) {
        if (!call || typeof call.name !== "string" || !call.name) continue;
        const callKey = call.id || `${call.name}:${trace.length}`;
        if (seenCallIds.has(callKey)) continue;
        seenCallIds.add(callKey);
        if (seenNames.has(call.name)) continue;
        seenNames.add(call.name);
        trace.push({ name: call.name });
      }
    },
    toTrace: () => (trace.length > 0 ? trace : undefined),
  };
}
