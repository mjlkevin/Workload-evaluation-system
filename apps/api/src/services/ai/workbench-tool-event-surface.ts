// ============================================================
// 批次 0.5 · ②：工作台工具调用的 UI 事件面（单一决策点）
// ============================================================
// 批次 0 让工具真跑了，但 AgentEvent 只到 onEvent 接缝即蒸发。本模块把
// 批次 0 冻结的两种工具事件（tool_call / tool_result）投影成四类 UI 事件，
// 由 workbench-chat.workflow 经 deps.appendRunEvent 落 harness_run_events。
//
// 口径：
//  · 四类名称与 HARNESS_RUN_EVENT_TYPES 的登记严格一致（dot 命名，与
//    text.delta / thought 同族）；不自造第五类，confirm 族归批次 1。
//  · tool.call.progress 是唯一真正新增的状态。批次 0 冻结了 AgentEvent
//    词汇表，循环侧不发明「执行中」事件，故本模块用心跳定时器派生它——
//    只有超过心跳间隔的长耗时调用才发，短调用不发（避免每次一噪音）。
//  · 载荷是**展示用**投影，必须自行截断：repository 的 assertSafeJsonObject
//    对超 1 MiB 的 payload 直接抛错，写链 .catch 后整条事件静默丢弃——
//    丢弃等于回到本批要消灭的不可见，因此宁少展示也不丢事件。
//  · 本模块只产 UI 可见事件；工具结果回灌模型上下文走 ④ 的模型可见视图，
//    完整参数与中间态一律不得进 messages。
//  · ③：sink 顺带累积**展示摘要**（不含参数与结果预览），供异步 workflow 镜像
//    到 assistant 会话消息顶层——否则 ② 的可视化只活在一次 SSE 连接内，刷新
//    页面即消失。摘要与会话消息同源受约束，故同样不得携带 UI 专用载荷。

import type { ChatRole } from "../../ai/provider/model-provider";
import type { AgentEvent } from "../../agent/agent.types";
import type { HarnessRunEventType } from "../../modules/harness/harness-runtime.types";

/** 本批登记的四类工具 UI 事件（严格子集于运行事件白名单） */
export const WORKBENCH_TOOL_UI_EVENT_TYPES = [
  "tool.call.started",
  "tool.call.progress",
  "tool.call.completed",
  "tool.call.failed",
] as const satisfies readonly HarnessRunEventType[];

export type WorkbenchToolUiEventType = (typeof WORKBENCH_TOOL_UI_EVENT_TYPES)[number];

/**
 * 工具调用三态。字符串值与前端 messageFormatter.TOOL_CALL_STATUS 逐字节一致
 * （会话消息 metadata.toolCalls 是两端唯一共享的载荷，状态词不一致即前端
 * 判定失效、静默丢状态）。改动必须同步改前端，由两侧用例共同守护。
 */
export const WORKBENCH_TOOL_CALL_STATUS = {
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export type WorkbenchToolCallStatus =
  (typeof WORKBENCH_TOOL_CALL_STATUS)[keyof typeof WORKBENCH_TOOL_CALL_STATUS];

/** 心跳间隔默认值：3s 后仍在执行才认为「值得告诉用户进度」 */
export const WORKBENCH_TOOL_CALL_PROGRESS_INTERVAL_MS = 3_000;

/** 单字段（字符串值 / 预览）上限，远超此长度的内容对 UI 无展示价值 */
const MAX_UI_FIELD_CHARS = 4_000;
/** 整体序列化上限：逐字段截断后仍超限（超宽数组/对象）则降级为字符串预览 */
const MAX_UI_JSON_CHARS = 8_000;
const MAX_UI_ITEMS = 20;
const MAX_UI_KEYS = 20;
const MAX_UI_DEPTH = 4;
/**
 * 失败原因上限：与前端 messageFormatter.MAX_ERROR_PREVIEW_CHARS 同值。
 * 摘要要落进会话消息（整棵列表随每条消息持久化），长度上限只能在这一侧收，
 * 不能指望前端截断——前端截断只覆盖 SSE 事件面。
 */
const MAX_UI_ERROR_PREVIEW_CHARS = 120;

/** 展示摘要：② 的四类事件归约后的单工具调用状态，UI 专用载荷一律不入 */
export type WorkbenchToolCallSummary = {
  callIndex: number;
  name: string;
  status: WorkbenchToolCallStatus;
  elapsedMs: number;
  errorPreview?: string;
};

/** 会话消息 metadata.toolCalls 的落库形状（摘要 + 按名合并的 source） */
export type WorkbenchToolCallMetadata = WorkbenchToolCallSummary & { source?: string };

export type WorkbenchToolEventEmit = (
  eventType: WorkbenchToolUiEventType,
  payload: Record<string, unknown>,
) => void;

export type WorkbenchToolEventSink = {
  /** 交给 dispatch/工具循环的 onEvent 接缝；非工具类事件不产 UI 事件 */
  onToolEvent: (event: AgentEvent) => void;
  /** 无条件停止心跳定时器（dispatch 抛错时不留活体定时器） */
  stop: () => void;
  /** ③：本轮已发生的工具调用展示摘要快照（无调用时为空数组） */
  getToolCalls: () => WorkbenchToolCallSummary[];
};

function clipString(value: string, max: number = MAX_UI_FIELD_CHARS): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…[truncated ${value.length - max} chars]`;
}

/** 硬上限截断（含省略号）：用于进会话消息的字段，超一个字符都是污染持久化数据 */
function clipInline(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function tryStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}

function shrinkJsonValue(value: unknown, depth: number): unknown {
  if (depth > MAX_UI_DEPTH) return "[depth-limit]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return clipString(value);
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_UI_ITEMS).map((item) => shrinkJsonValue(item, depth + 1));
    if (value.length > MAX_UI_ITEMS) items.push(`[+${value.length - MAX_UI_ITEMS} more items]`);
    return items;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const [key, item] of entries.slice(0, MAX_UI_KEYS)) {
      out[key] = shrinkJsonValue(item, depth + 1);
    }
    if (entries.length > MAX_UI_KEYS) {
      out["[truncatedKeys]"] = `${entries.length - MAX_UI_KEYS} more keys`;
    }
    return out;
  }
  return clipString(String(value));
}

/** 展示用 JSON：保持对象形状（UI 可按字段渲染），但保证不会撑爆 1 MiB 闸门 */
function toUiVisibleJson(value: unknown): unknown {
  const shrunk = shrinkJsonValue(value, 0);
  const serialized = tryStringify(shrunk);
  if (serialized === null) return "[unserializable]";
  if (serialized.length <= MAX_UI_JSON_CHARS) return shrunk;
  return clipString(serialized, MAX_UI_JSON_CHARS);
}

function toResultPreview(data: unknown): string {
  const shrunk = toUiVisibleJson(data);
  const serialized = typeof shrunk === "string" ? shrunk : (tryStringify(shrunk) ?? "[unserializable]");
  return clipString(serialized, MAX_UI_JSON_CHARS);
}

export function createWorkbenchToolEventSink(input: {
  emit: WorkbenchToolEventEmit;
  /** 心跳间隔；0 或负数关闭 progress（测试构造短调用用） */
  progressIntervalMs?: number;
  now?: () => number;
}): WorkbenchToolEventSink {
  const now = input.now ?? (() => Date.now());
  const progressIntervalMs = input.progressIntervalMs ?? WORKBENCH_TOOL_CALL_PROGRESS_INTERVAL_MS;
  let callIndex = 0;
  let startedAt = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  // ③ 展示摘要：与四类 UI 事件同源于同一个 onToolEvent 接缝，故两面的状态不可能
  // 漂移（事件说 completed、镜像说 running 这类分裂在本设计下无法构造）。
  const summaries: WorkbenchToolCallSummary[] = [];
  let current: WorkbenchToolCallSummary | null = null;

  const clearTimer = () => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };

  return {
    onToolEvent(event: AgentEvent): void {
      if (event.kind === "tool_call") {
        clearTimer();
        callIndex += 1;
        startedAt = now();
        const index = callIndex;
        const name = event.name;
        current = { callIndex: index, name, status: WORKBENCH_TOOL_CALL_STATUS.RUNNING, elapsedMs: 0 };
        summaries.push(current);
        // 批次 1a · 约束②：本事件是工具参数的**唯一**持久来源，审批事件只带
        // callId 不带第二份参数——那么 callId 必须落在这一行上，界面才能按它回查参数。
        input.emit("tool.call.started", {
          callIndex: index,
          name,
          ...(event.toolCallId ? { callId: event.toolCallId } : {}),
          arguments: toUiVisibleJson(event.arguments),
        });
        if (progressIntervalMs > 0) {
          timer = setInterval(() => {
            const elapsedMs = Math.max(0, now() - startedAt);
            if (current) current.elapsedMs = elapsedMs;
            input.emit("tool.call.progress", { callIndex: index, name, elapsedMs });
          }, progressIntervalMs);
          // 心跳不得阻止进程退出（Run 结束后定时器只该是惰性的）
          timer.unref?.();
        }
        return;
      }

      if (event.kind === "tool_result") {
        if (callIndex === 0) return;
        clearTimer();
        const elapsedMs = Math.max(0, now() - startedAt);
        const ok = event.ok;
        const errorPreview = ok ? undefined : clipInline(event.error ?? "工具执行失败", MAX_UI_ERROR_PREVIEW_CHARS);
        if (current) {
          current.elapsedMs = elapsedMs;
          current.status = ok ? WORKBENCH_TOOL_CALL_STATUS.COMPLETED : WORKBENCH_TOOL_CALL_STATUS.FAILED;
          // started 侧的名字优先：镜像与实时列表（前端按 callIndex 配对、保留
          // 首次名字）必须逐字段一致，否则同一轮刷新前后会看到两个工具名。
          if (!current.name && event.name) current.name = event.name;
          if (errorPreview) current.errorPreview = errorPreview;
        }
        const base = { callIndex, name: current?.name || event.name, elapsedMs };
        if (ok) {
          input.emit("tool.call.completed", { ...base, resultPreview: toResultPreview(event.data) });
        } else {
          input.emit("tool.call.failed", { ...base, error: clipString(event.error ?? "工具执行失败") });
        }
      }
      // final / need_confirm：批次 0 冻结词汇表且 confirm 归批次 1，本批不产事件
    },
    stop: clearTimer,
    getToolCalls: () => summaries.map((summary) => ({ ...summary })),
  };
}

/**
 * ③：把展示摘要投影成会话消息的 metadata.toolCalls。
 *
 * 只补一件事：按工具名合并 trace.toolCalls 的 source（`list_tools` 等），
 * 让「· 经发现」这个批次 0 已有的标注在刷新后仍然可见——source 只在工具循环
 * 侧知道，sink 无从得知。trace 是持久化的自由形状，因此入参按 unknown 收、
 * 运行期收窄，不在这一层信任任何字段。
 *
 * 空列表返回 undefined 而不是 []：前端 normalizeToolCalls 对空数组也返回
 * undefined，写空键只会让 sameMessageList 产生无意义 diff。
 */
export function toWorkbenchToolCallMetadata(
  summaries: readonly WorkbenchToolCallSummary[],
  traceToolCalls: unknown,
): WorkbenchToolCallMetadata[] | undefined {
  if (summaries.length === 0) return undefined;
  const sourceByName = new Map<string, string>();
  if (Array.isArray(traceToolCalls)) {
    for (const item of traceToolCalls) {
      if (!item || typeof item !== "object") continue;
      const { name, source } = item as { name?: unknown; source?: unknown };
      if (typeof name === "string" && typeof source === "string" && source && !sourceByName.has(name)) {
        sourceByName.set(name, source);
      }
    }
  }
  return summaries.map((summary) => {
    const source = sourceByName.get(summary.name);
    return source ? { ...summary, source } : { ...summary };
  });
}

// ============================================================
// 批次 0.5 · ④：模型可见面与 UI 可见面的分层闸门
// ============================================================
// ②把工具调用投影成四类 UI 事件（含完整参数、心跳中间态、结果预览），这
// 些事件的正当归宿是 harness_run_events → SSE → UI，永远不是模型上下文。
// 工具循环回填给模型的只有一类：tool/result（批次 0 冻结的 [工具结果] 形态）。
//
// 参照 dsh 的 SurfaceEventType：只有 user/message、assistant/message、
// tool/result 进模型可见折叠。WES 此前没有这一层——messages 里的东西全部
// 默认可见，于是「哪些事件能进模型」只能靠约定。本层把它变成运行时判定：
// surfaceType 是 string（不是字面量联合），因此编译期放过、运行期必拒，
// 有人新增第五类 UI 事件时不会因为类型收窄而"顺手就通过"。
// ============================================================

/** 允许进入模型上下文的事件面；本批只有三类，工具 UI 事件一律不在其中 */
export const WORKBENCH_MODEL_VISIBLE_SURFACE_TYPES = [
  "user/message",
  "assistant/message",
  "tool/result",
] as const;

export type WorkbenchModelVisibleSurfaceType = (typeof WORKBENCH_MODEL_VISIBLE_SURFACE_TYPES)[number];

/** 模型可见消息形态（与 WorkbenchToolLoopMessage 结构一致；本地声明以避免与工具循环形成模块环） */
export type WorkbenchModelVisibleMessage = { role: ChatRole; content: string };

/** 工具执行产出（与 WorkbenchToolEffectOutput 结构一致；同上理由） */
export type WorkbenchModelVisibleToolOutcome = { ok: boolean; data?: unknown; error?: string };

/** 运行时准入判定：UI 专用面（tool.call.*）永远返回 false */
export function isWorkbenchModelVisibleSurfaceType(value: string): value is WorkbenchModelVisibleSurfaceType {
  return (WORKBENCH_MODEL_VISIBLE_SURFACE_TYPES as readonly string[]).includes(value);
}

/** 回填正文必须可 JSON 序列化；工具返回不可序列化时降级为字符串，不得让循环抛出 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return '"[工具结果无法序列化]"';
  }
}

/**
 * 进模型上下文的消息的唯一构造点。surfaceType 声明为 string 是刻意的：
 * 调用方传错（把 UI 事件类型传进来）必须在运行期被拦下，而不是被类型系统
 * 悄悄"纠正"掉。UI 可见与模型可见的边界由本函数的抛错保证，不靠调用方自觉。
 */
export function toWorkbenchModelVisibleMessage(input: {
  surfaceType: WorkbenchModelVisibleSurfaceType | string;
  role: ChatRole;
  content: string;
}): WorkbenchModelVisibleMessage {
  if (!isWorkbenchModelVisibleSurfaceType(input.surfaceType)) {
    throw new Error(`workbench_model_visible_surface_not_allowed: ${input.surfaceType}`);
  }
  return { role: input.role, content: input.content };
}

/**
 * 工具结果回灌模型的唯一构造点。
 * 正文形态逐字节沿用批次 0（`[工具结果] name (callId=...): {json}`）：同步通道
 * 也在用这个形态，改动它等于动同步通道的模型输入，超出本批范围。
 * 只带 outcome（模型需要的结论），不带 callIndex/elapsedMs/resultPreview 等 UI 状态。
 */
export function toWorkbenchModelVisibleToolMessage(input: {
  toolName: string;
  callId: string;
  outcome: WorkbenchModelVisibleToolOutcome;
}): WorkbenchModelVisibleMessage {
  return toWorkbenchModelVisibleMessage({
    surfaceType: "tool/result",
    role: "assistant",
    content: `[工具结果] ${input.toolName} (callId=${input.callId}): ${safeStringify(input.outcome)}`,
  });
}
