// ============================================================
// O7 · Trace ↔ Langfuse 模型映射
// ============================================================
// 建立自研 trace 数据模型（TraceRecord / TraceSpanData）与
// Langfuse 观测平台数据模型（Trace / Observation）的双向映射。
//
// 不引入 Langfuse SDK，不修改 traces 表结构。
// 映射层处理字段差异，不可映射字段显式标注。
// ============================================================

import type {
  TraceRecord,
  TraceSpanData,
  TraceSpanStatus,
  TraceSpanType,
  TraceSourceDomain,
} from "./trace.types";

// ─── Langfuse 数据模型类型（本地定义，不引入 SDK） ──────────

/** Langfuse Observation 类型 */
export type LangfuseObservationType = "span" | "event" | "generation";

/** Langfuse Observation 级别 */
export type LangfuseLevel = "DEBUG" | "DEFAULT" | "WARNING" | "ERROR";

/** Langfuse Usage 模型 */
export type LangfuseUsage = {
  input: number;
  output: number;
  total: number;
  unit?: string;
};

/** Langfuse Observation（对应自研 TraceSpanData） */
export type LangfuseObservation = {
  id: string;
  parentObservationId?: string;
  type: LangfuseObservationType;
  name: string;
  startTime: string;
  endTime?: string;
  metadata: Record<string, unknown>;
  level: LangfuseLevel;
  statusMessage?: string;
  input?: unknown;
  output?: unknown;
  model?: string;
  usage?: LangfuseUsage;
};

/** Langfuse Trace（对应自研 TraceRecord） */
export type LangfuseTrace = {
  id: string;
  name: string;
  sessionId?: string;
  userId?: string;
  input?: unknown;
  output?: unknown;
  tags: string[];
  metadata: Record<string, unknown>;
  timestamp: string;
  observations: LangfuseObservation[];
};

// ─── 映射函数 ────────────────────────────────────────────────

/**
 * 自研 spanType → Langfuse observation type 映射。
 * - model_call → generation（Langfuse 中模型调用使用 generation 类型）
 * - knowledge_retrieval → span（检索操作）
 * - intent_routing → span（路由判定）
 * - artifact_generation → span（产物生成）
 * - tool_call → span（工具调用）
 * - write_action → event（写动作是一个离散事件）
 * - user_confirmation → event（人工确认是一个离散事件）
 * - degradation → event（降级事件）
 */
function spanTypeToObservationType(spanType: TraceSpanType): LangfuseObservationType {
  if (spanType === "model_call") return "generation";
  if (spanType === "write_action" || spanType === "user_confirmation" || spanType === "degradation") return "event";
  return "span";
}

/**
 * 自研 span status → Langfuse level 映射。
 * - failed → ERROR
 * - degraded → WARNING
 * - cancelled → WARNING
 * - started / running / completed → DEFAULT
 */
function statusToLevel(status: TraceSpanStatus): LangfuseLevel {
  if (status === "failed") return "ERROR";
  if (status === "degraded" || status === "cancelled") return "WARNING";
  return "DEFAULT";
}

/**
 * 将自研 TraceSpanData 映射为 Langfuse Observation。
 */
export function toLangfuseObservation(span: TraceSpanData): LangfuseObservation {
  const metadata: Record<string, unknown> = {
    spanType: span.spanType,
    contextRefs: span.contextRefs,
    ...span.attributes,
  };

  // 不可映射字段：durationMs（Langfuse 从 startTime/endTime 计算，但在 metadata 保留）
  if (span.durationMs !== undefined) {
    metadata.durationMs = span.durationMs;
  }

  // 降级信息映射到 metadata
  if (span.degradation) {
    metadata.degradation = span.degradation;
  }

  // 错误信息映射
  let statusMessage: string | undefined;
  if (span.error) {
    statusMessage = span.error.message;
    metadata.errorCode = span.error.code;
    metadata.retryable = span.error.retryable;
  }

  const observation: LangfuseObservation = {
    id: span.spanId,
    type: spanTypeToObservationType(span.spanType),
    name: span.name,
    startTime: span.startedAt,
    endTime: span.endedAt,
    metadata,
    level: statusToLevel(span.status),
  };

  if (span.parentSpanId) {
    observation.parentObservationId = span.parentSpanId;
  }
  if (statusMessage) {
    observation.statusMessage = statusMessage;
  }
  if (span.tokenUsage) {
    observation.usage = {
      input: span.tokenUsage.promptTokens,
      output: span.tokenUsage.completionTokens,
      total: span.tokenUsage.totalTokens,
      unit: "TOKENS",
    };
  }
  if (span.modelInfo) {
    observation.model = span.modelInfo.model;
    metadata.provider = span.modelInfo.provider;
    if (span.modelInfo.finishReason) {
      metadata.finishReason = span.modelInfo.finishReason;
    }
    if (span.modelInfo.attempts !== undefined) {
      metadata.attempts = span.modelInfo.attempts;
    }
  }

  return observation;
}

/**
 * 将自研 TraceRecord 映射为 Langfuse Trace。
 * 不可映射字段（requestId、ownerUsername、summary 等）放入 metadata。
 */
export function toLangfuseTrace(trace: TraceRecord): LangfuseTrace {
  const metadata: Record<string, unknown> = {};

  // 不可映射字段 → metadata
  // requestId: Langfuse 无对应标准字段
  if (trace.requestId) {
    metadata.requestId = trace.requestId;
  }
  // ownerUsername: Langfuse 只有 userId，无 username
  metadata.ownerUsername = trace.ownerUsername;
  // intentResult: 部分映射到 metadata
  if (trace.intentResult) {
    metadata.intent = trace.intentResult.intent;
    metadata.confidence = trace.intentResult.confidence;
    metadata.routingRule = trace.intentResult.routingRule;
  }
  // summary: Langfuse 无对应标准字段
  metadata.summary = trace.summary;

  return {
    id: trace.traceId,
    name: `${trace.sourceDomain}_${trace.sourceId || "unknown"}`,
    sessionId: trace.sourceId,
    userId: trace.ownerUserId,
    input: trace.userInputSummary,
    tags: [trace.sourceDomain],
    metadata,
    timestamp: trace.createdAt,
    observations: trace.spans.map(toLangfuseObservation),
  };
}

/**
 * 将 Langfuse Trace 反向映射为 Partial<TraceRecord>。
 * 用于从 Langfuse 导入数据时的逆向转换（PoC 性质）。
 */
export function fromLangfuseTrace(lfTrace: LangfuseTrace): Partial<TraceRecord> {
  const metadata = lfTrace.metadata || {};
  const metaRecord = metadata as Record<string, unknown>;

  // 从 tags 反推 sourceDomain（取第一个匹配的）
  const knownDomains = ["ai_session", "harness_run", "agent_runtime"] as const;
  const sourceDomain = (lfTrace.tags || []).find((t) =>
    knownDomains.includes(t as TraceSourceDomain)
  ) as TraceSourceDomain | undefined;

  // 从 metadata 反推 intentResult
  let intentResult: TraceRecord["intentResult"] | undefined;
  if (metaRecord.intent) {
    intentResult = {
      intent: String(metaRecord.intent),
      confidence: Number(metaRecord.confidence) || 0,
      routingRule: String(metaRecord.routingRule || ""),
    };
  }

  // 反向映射 observations → spans
  const spans: TraceSpanData[] = (lfTrace.observations || []).map((obs) => {
    const obsMeta = (obs.metadata || {}) as Record<string, unknown>;
    const span: TraceSpanData = {
      spanId: obs.id,
      spanType: (obsMeta.spanType as TraceSpanType) || "tool_call",
      name: obs.name,
      status: levelToStatus(obs.level),
      startedAt: obs.startTime,
      contextRefs: Array.isArray(obsMeta.contextRefs) ? obsMeta.contextRefs as string[] : [],
      attributes: { ...obsMeta },
    };

    // 清理已映射的属性
    delete span.attributes.spanType;
    delete span.attributes.contextRefs;

    if (obs.endTime) {
      span.endedAt = obs.endTime;
    }
    if (obs.parentObservationId) {
      span.parentSpanId = obs.parentObservationId;
    }
    if (obs.model) {
      span.modelInfo = {
        provider: String(obsMeta.provider || "unknown"),
        model: obs.model,
        ...(obsMeta.finishReason ? { finishReason: String(obsMeta.finishReason) } : {}),
        ...(obsMeta.attempts !== undefined ? { attempts: Number(obsMeta.attempts) } : {}),
      };
      delete span.attributes.provider;
      delete span.attributes.finishReason;
      delete span.attributes.attempts;
    }
    if (obs.usage) {
      span.tokenUsage = {
        promptTokens: obs.usage.input,
        completionTokens: obs.usage.output,
        totalTokens: obs.usage.total,
      };
    }
    if (obs.statusMessage) {
      span.error = {
        code: String(obsMeta.errorCode || "unknown"),
        message: obs.statusMessage,
        retryable: Boolean(obsMeta.retryable),
      };
      delete span.attributes.errorCode;
      delete span.attributes.retryable;
    }
    if (obsMeta.degradation) {
      span.degradation = obsMeta.degradation as { reason: string; fallbackTo: string };
      delete span.attributes.degradation;
    }
    if (obsMeta.durationMs !== undefined) {
      span.durationMs = Number(obsMeta.durationMs);
      delete span.attributes.durationMs;
    }

    return span;
  });

  return {
    traceId: lfTrace.id,
    sourceDomain,
    sourceId: lfTrace.sessionId,
    ownerUserId: lfTrace.userId,
    ownerUsername: metaRecord.ownerUsername ? String(metaRecord.ownerUsername) : undefined,
    userInputSummary: typeof lfTrace.input === "string" ? lfTrace.input : undefined,
    requestId: metaRecord.requestId ? String(metaRecord.requestId) : undefined,
    intentResult,
    summary: metaRecord.summary as TraceRecord["summary"] | undefined,
    spans,
    createdAt: lfTrace.timestamp,
  };
}

/**
 * Langfuse level → 自研 span status 反向映射。
 */
function levelToStatus(level: LangfuseLevel): TraceSpanStatus {
  if (level === "ERROR") return "failed";
  if (level === "WARNING") return "degraded";
  return "completed";
}
