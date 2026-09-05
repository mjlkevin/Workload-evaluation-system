import type { ChatRole, ToolCall, ToolDefinition } from "../../ai/provider/model-provider";
import type { AgentEvent, AgentUser } from "../../agent/agent.types";
import type { ToolRegistry } from "../../agent/tool-registry";
import { createDefaultRegistry } from "../../agent/default-registry";
import type { RuntimeContext } from "../../agent/context/context.types";
import { getCombinedCapabilities } from "../../rbac/permissions";
import { legacyRoleToV2Roles } from "../../rbac/roles";
import type { AuthUser } from "../../types";
import type { StreamingChunk, WorkbenchToolCallTrace } from "./workbench-dispatch.service";
import { toWorkbenchModelVisibleToolMessage } from "./workbench-tool-event-surface";
import {
  WORKBENCH_TOOL_APPROVAL_UNWIRED_MESSAGE,
  normalizeWorkbenchToolCallId,
  resolveWorkbenchToolDecisionSlot,
  type WorkbenchToolApprovalGate,
} from "./workbench-tool-approval";

// ============================================================
// 工作台工具循环 · 批次 0（只读工具真跑）→ 批次 1a（写操作执行前审批闸门）
// ============================================================
// 批次 0 冻结口径「只注入 mutates === false」的原因是**当时没有确认闸门**。
// 批次 1a 做出闸门（workbench-tool-approval + run.status=waiting + confirmRunAction），
// 注入集因此扩到 allow ∪ ask，三个写工具（create_project / generate_wbs /
// export_report）放开但必须经用户确认。其余冻结口径不变：
//  · 模型返回的 tool_calls 必须被真正执行并回填，单个调用被拒也必须回填 ok:false；
//  · 工具异常/拒绝一律不阻断主链路（**唯一例外**：审批挂起不是异常，是就地停手）；
//  · 事件词汇表复用 AgentEvent 既有 kind，不自造；
//  · 轮次上限 12，达上限不抛错。
//
// 与 apps/api/src/agent/orchestrator.ts 的关系：只参照其回填消息形态，
// 不复用其循环——orchestrator 返回 Promise<string>，与工作台异步 Run 的
// 流式/幂等形态冲突（见雷达文档 §三①）；它的 `await confirm(...)` 是内存 Promise，
// 本批刻意不复用（判据④会失败）。
// ============================================================
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

/** 注入点解析结果：tools 供模型调用，两张集合供执行侧按决策槽分流 */
export type WorkbenchInjectableToolSet = {
  registry: ToolRegistry;
  agentUser: AgentUser;
  tools: ToolDefinition[];
  /** allow 档：服务端直接放行（mutates === false） */
  allowToolNames: Set<string>;
  /** ask 档：执行前必须拿到用户的持久决策（写工具） */
  approvalRequiredToolNames: Set<string>;
};

/**
 * ② 注入点硬约束（批次 1a 起）：解析「可注入给模型的工作台工具集」。
 *
 * 能力位必须由服务端可信身份（legacy role）推导，不接受模型或前端传入，
 * 否则等于让调用方自行扩权。registry 只做分流，不改注册表本身。
 *
 * 批次 0 冻结的口径是「只注入 mutates === false」，因为当时没有确认闸门；
 * 闸门（本模块的 toolApprovalGate）就位后注入集扩到「allow ∪ ask」。分流是**穷尽**的：
 * 一个工具要么在 allowToolNames（严格 mutates === false），要么落 ask
 * （mutates 为 true / 缺失 / 非布尔 / 注册表查不到）——不存在第三条放行路径，
 * 因此「新加一个工具忘了标 mutates」的后果是多问一次，而不是静默放行。
 */
export function resolveWorkbenchInjectableTools(
  user: AuthUser,
  options: { runtime?: RuntimeContext; registry?: ToolRegistry } = {},
): WorkbenchInjectableToolSet {
  const agentUser: AgentUser = {
    id: user.id,
    capabilities: getCombinedCapabilities(legacyRoleToV2Roles(user.role)),
  };
  const registry = options.registry ?? createDefaultRegistry(user, options.runtime);
  const definitions = registry.listFullToolsFor(agentUser);
  const allowToolNames = new Set(
    definitions
      .filter((definition) => resolveWorkbenchToolDecisionSlot(registry.get(definition.function.name)) === "allow")
      .map((definition) => definition.function.name),
  );
  const approvalRequiredToolNames = new Set(
    definitions.map((definition) => definition.function.name).filter((name) => !allowToolNames.has(name)),
  );
  return { registry, agentUser, tools: definitions, allowToolNames, approvalRequiredToolNames };
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
  /**
   * allow 档白名单：ToolRegistry.execute 只校验能力位、不校验 mutates，
   * 故循环自带分流判定（批次 0 时它是唯一闸门；批次 1a 起它只覆盖只读侧）。
   */
  allowToolNames: Set<string>;
  /**
   * 批次 1a · ask 档审批端口（additive）。**未注入即拒绝执行任何 ask 档工具**：
   * 审批依赖可持久的 Run 事件流，只有异步 Run 通道有，同步兜底通道拿不到决策
   * 就不能放行——这是失败方向关闭，不是功能缺失。
   */
  toolApprovalGate?: WorkbenchToolApprovalGate;
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

/**
 * 批次 1a · ask 档执行前的审批取数。返回 undefined = 已获准，可继续执行；
 * 返回失败结果 = 用户拒绝（skip 档），回填给模型后继续作答；
 * 闸门抛 Pending = 本轮就地停手（由调用链把 Run 留在 waiting）。
 */
async function requireToolApproval(
  ctx: WorkbenchToolLoopCommon,
  call: { ordinal: number; toolName: string; callId: string; arguments: Record<string, unknown> },
): Promise<WorkbenchToolEffectOutput | undefined> {
  if (!ctx.toolApprovalGate) {
    return { ok: false, error: `${call.toolName}: ${WORKBENCH_TOOL_APPROVAL_UNWIRED_MESSAGE}` };
  }
  const gateResult = await ctx.toolApprovalGate(call);
  if (gateResult.decision === "reject") {
    return { ok: false, error: `${call.toolName}: ${gateResult.reason}` };
  }
  return undefined;
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
    // callId 在这一点归一化：UI 事件（参数唯一来源）与审批事件必须带同一份，
    // 否则 1b 按 callId 回查参数会查不到。模型给的原始 id 不直接落库。
    const callId = normalizeWorkbenchToolCallId(call.id);
    ctx.onEvent?.({ kind: "tool_call", name, arguments: args, toolCallId: callId });

    ctx.callCursor.value += 1;
    const ordinal = ctx.callCursor.value;

    const resolveOutcome = async (): Promise<WorkbenchToolEffectOutput> => {
      const registered = ctx.registry.get(name);
      if (!registered) {
        return { ok: false, error: `未注册工具: ${name}` };
      }
      if (resolveWorkbenchToolDecisionSlot(registered) === "ask") {
        // 闸门抛 Pending 时本函数不返回：异常向上传播，Run 停在 waiting，
        // 工具一次都没被执行（判据①）。effect 也因此在挂起时不落库，
        // 确认后重放才会第一次真正执行（判据②）。
        const gateOutcome = await requireToolApproval(ctx, { ordinal, toolName: name, callId, arguments: args });
        if (gateOutcome) return gateOutcome;
      } else if (!ctx.allowToolNames.has(name)) {
        return { ok: false, error: `工作台未开放该工具，${name} 未获准执行` };
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
        ? { kind: "tool_result", name, ok: true, data: outcome.data, toolCallId: callId }
        : { kind: "tool_result", name, ok: false, error: outcome.error, toolCallId: callId },
    );
    ctx.trace.push({ name });
    // ④：工具结果回灌模型必须走模型可见面的唯一构造点。完整参数（args）、
    // 心跳中间态（callIndex/elapsedMs）、结果预览（resultPreview）都只进 UI
    // 事件，不得进 messages；正文形态与批次 0 逐字节一致（同步通道共用）。
    ctx.workingMessages.push(toWorkbenchModelVisibleToolMessage({ toolName: name, callId, outcome }));
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
    // 轮内去重（执行侧兜底）：provider 可能把同一批调用投两次（结束帧 + 其后补发的用量帧），
    // 而 id 缺失时 provider 按 index 兜底成 call_0，故第二轮的同名调用是合法新调用。
    // 集合声明在轮循环内 → 每轮天然重置；若改成全局去重会吞掉后续轮次的调用。
    const seenTurnCallIds = new Set<string>();
    for await (const chunk of input.invokeStream({ messages: [...workingMessages], turnOrdinal: turn })) {
      yield chunk;
      if (chunk.kind !== "metadata") turnContent += chunk.contentDelta ?? "";
      for (const call of chunk.toolCalls ?? []) {
        const dedupKey = call.id || `${call.name}:${turnCalls.length}`;
        if (seenTurnCallIds.has(dedupKey)) continue;
        seenTurnCallIds.add(dedupKey);
        turnCalls.push(call);
      }
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
