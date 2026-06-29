// ============================================================
// RP-030 · 统一 Trace Schema 类型定义
// ============================================================
// 将 AI session trace、Harness Run、ModelRun、ToolEvent、KnowledgeTool trace
// 统一为可查询链路。API Key / token / 敏感原文不得进入 trace 数据。
// ============================================================

import { randomUUID } from "node:crypto";

// ─── Span 类型枚举 ───────────────────────────────────────────

export const TRACE_SPAN_TYPES = [
  "intent_routing",        // 意图路由判定
  "knowledge_retrieval",   // 知识库检索
  "model_call",            // 模型调用（Kimi / 智谱等）
  "tool_call",             // 工具调用（含 Harness ToolEvent）
  "artifact_generation",   // 产物生成（报告、草稿等）
  "user_confirmation",     // 人工确认回写
  "write_action",          // 写动作执行
  "degradation",           // 降级事件
] as const;

export type TraceSpanType = (typeof TRACE_SPAN_TYPES)[number];

export const TRACE_SPAN_STATUSES = [
  "started",
  "running",
  "completed",
  "failed",
  "degraded",
  "cancelled",
] as const;

export type TraceSpanStatus = (typeof TRACE_SPAN_STATUSES)[number];

// ─── 来源域 ──────────────────────────────────────────────────

export const TRACE_SOURCE_DOMAINS = [
  "ai_session",           // AI 工作台对话
  "harness_run",          // Harness 评估流水线
  "agent_runtime",        // Agent 编排运行时
] as const;

export type TraceSourceDomain = (typeof TRACE_SOURCE_DOMAINS)[number];

// ─── 敏感字段脱敏白名单 ──────────────────────────────────────
// 以下字段名在写入 trace 时必须被脱敏（值替换为 "[REDACTED]"）

export const TRACE_REDACTED_FIELD_PATTERNS: readonly string[] = [
  "apiKey",
  "api_key",
  "authorization",
  "token",
  "secret",
  "password",
  "cookie",
  "privateKey",
  "private_key",
];

// ─── Span 数据 ───────────────────────────────────────────────

export type TraceSpanData = {
  spanId: string;
  parentSpanId?: string;
  spanType: TraceSpanType;
  name: string;
  status: TraceSpanStatus;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  /** 上下文引用（attachment:xxx, knowledge:xxx, project:xxx 等） */
  contextRefs: string[];
  /** 扩展属性（已脱敏） */
  attributes: Record<string, unknown>;
  /** 错误信息（如有） */
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  /** 降级信息（如有） */
  degradation?: {
    reason: string;
    fallbackTo: string;
  };
  /** Token 消耗（仅 model_call / knowledge_retrieval 类 span） */
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** 模型信息 */
  modelInfo?: {
    provider: string;
    model: string;
    finishReason?: string;
    attempts?: number;
  };
};

// ─── Trace 记录 ──────────────────────────────────────────────

export type TraceRecord = {
  traceId: string;
  /** 来源域 */
  sourceDomain: TraceSourceDomain;
  /** 关联的外部 ID（aiSessionId / harnessRunId 等） */
  sourceId?: string;
  /** 归属用户 */
  ownerUserId: string;
  ownerUsername: string;
  /** 触发本次 trace 的用户输入摘要（脱敏后，≤200 字） */
  userInputSummary?: string;
  /** 意图路由结果 */
  intentResult?: {
    intent: string;
    confidence: number;
    routingRule: string;
  };
  /** Span 列表 */
  spans: TraceSpanData[];
  /** 汇总统计 */
  summary: {
    totalDurationMs: number;
    spanCount: number;
    totalTokens: number;
    hasError: boolean;
    hasDegradation: boolean;
  };
  createdAt: string;
  updatedAt: string;
};

// ─── 存储结构 ────────────────────────────────────────────────

export type TraceStore = {
  version: 1;
  traces: TraceRecord[];
};

// ─── 查询参数 ────────────────────────────────────────────────

export type TraceQueryFilter = {
  ownerUserId: string;
  sourceDomain?: TraceSourceDomain;
  sourceId?: string;
  traceId?: string;
  spanType?: TraceSpanType;
  hasError?: boolean;
  hasDegradation?: boolean;
  /** ISO 时间范围 */
  fromIso?: string;
  toIso?: string;
  limit?: number;
  offset?: number;
};

export type TraceQueryResult = {
  traces: TraceRecord[];
  total: number;
  limit: number;
  offset: number;
};

// ─── 工具函数 ────────────────────────────────────────────────

export function createTraceId(): string {
  return randomUUID();
}

export function createSpanId(): string {
  return randomUUID();
}

/**
 * 脱敏：递归扫描对象，将匹配敏感字段名的值替换为 "[REDACTED]"。
 * 返回新对象，不修改原始输入。
 */
export function redactSensitiveFields<T>(input: T): T {
  if (input == null || typeof input !== "object") return input;
  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveFields(item)) as unknown as T;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const isSensitive = TRACE_REDACTED_FIELD_PATTERNS.some(
      (pattern) => key.toLowerCase().includes(pattern.toLowerCase())
    );
    if (isSensitive) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactSensitiveFields(value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * 构建一条新的 TraceRecord 骨架。
 */
export function createTraceRecord(input: {
  sourceDomain: TraceSourceDomain;
  sourceId?: string;
  ownerUserId: string;
  ownerUsername: string;
  userInputSummary?: string;
}): TraceRecord {
  const now = new Date().toISOString();
  return {
    traceId: createTraceId(),
    sourceDomain: input.sourceDomain,
    sourceId: input.sourceId,
    ownerUserId: input.ownerUserId,
    ownerUsername: input.ownerUsername,
    userInputSummary: input.userInputSummary?.slice(0, 200),
    spans: [],
    summary: {
      totalDurationMs: 0,
      spanCount: 0,
      totalTokens: 0,
      hasError: false,
      hasDegradation: false,
    },
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 向 TraceRecord 追加一个 span，并自动更新 summary。
 */
export function appendTraceSpan(trace: TraceRecord, span: TraceSpanData): TraceRecord {
  trace.spans.push(span);
  trace.summary.spanCount = trace.spans.length;
  trace.summary.hasError = trace.spans.some((s) => s.status === "failed" || s.status === "cancelled");
  trace.summary.hasDegradation = trace.spans.some((s) => s.status === "degraded" || Boolean(s.degradation));
  trace.summary.totalTokens = trace.spans.reduce(
    (sum, s) => sum + (s.tokenUsage?.totalTokens ?? 0),
    0
  );
  // 计算总耗时：从最早 startedAt 到最晚 endedAt
  const startedTimes = trace.spans.map((s) => new Date(s.startedAt).getTime()).filter((t) => Number.isFinite(t));
  const endedTimes = trace.spans.map((s) => s.endedAt ? new Date(s.endedAt).getTime() : 0).filter((t) => t > 0);
  if (startedTimes.length > 0 && endedTimes.length > 0) {
    trace.summary.totalDurationMs = Math.max(...endedTimes) - Math.min(...startedTimes);
  }
  trace.updatedAt = new Date().toISOString();
  return trace;
}
