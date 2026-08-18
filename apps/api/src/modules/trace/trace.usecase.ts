// ============================================================
// RP-030 · Trace Usecase — 业务逻辑与适配器
// ============================================================
// 1. 提供 trace 写入入口（从 AI session / Harness / Agent runtime）
// 2. 提供 trace 查询入口（owner-scoped）
// 3. 将现有 WorkbenchDispatchData.trace 映射为统一 span 结构
// ============================================================

import type { Request, Response } from "express";

import {
  createSpanId,
  createTraceRecord,
  redactSensitiveFields,
  appendTraceSpan,
  type TraceQueryFilter,
  type TraceRecord,
  type TraceSpanData,
  type TraceSourceDomain,
  type TraceSpanType,
} from "./trace.types";

import {
  insertTraceRecord,
  findTraceById,
  queryTraces,
  updateTraceRecord,
  purgeTracesOlderThan,
} from "./trace.repository";

// ─── 写入入口 ────────────────────────────────────────────────

/**
 * 从 AI 工作台一次对话 turn 创建 trace。
 * 将 WorkbenchDispatchData.trace 映射为统一 span 结构。
 */
/** 阶段 1 批 7：因内部调用 insertTraceRecord（已异步化）级联改 async，实现不动。 */
export async function recordWorkbenchTurnTrace(input: {
  requestId?: string;
  ownerUserId: string;
  ownerUsername: string;
  aiSessionId?: string;
  userInputSummary?: string;
  dispatchTrace: {
    intentConfidence: number;
    routingRule: string;
    contextRefs: string[];
    knowledgeTool?: Record<string, unknown>;
    modelRun?: Record<string, unknown>;
    modelClassification?: Record<string, unknown>;
  };
  model?: string;
}): Promise<TraceRecord> {
  const trace = createTraceRecord({
    sourceDomain: "ai_session",
    sourceId: input.aiSessionId,
    ownerUserId: input.ownerUserId,
    ownerUsername: input.ownerUsername,
    userInputSummary: input.userInputSummary,
    requestId: input.requestId,
  });

  trace.intentResult = {
    intent: "workbench_turn",
    confidence: input.dispatchTrace.intentConfidence,
    routingRule: input.dispatchTrace.routingRule,
  };

  // Span 1: 意图路由
  const intentSpan: TraceSpanData = {
    spanId: createSpanId(),
    spanType: "intent_routing",
    name: "workbench-intent-routing",
    status: "completed",
    startedAt: trace.createdAt,
    endedAt: trace.createdAt,
    durationMs: 0,
    contextRefs: input.dispatchTrace.contextRefs,
    attributes: redactSensitiveFields({
      intentConfidence: input.dispatchTrace.intentConfidence,
      routingRule: input.dispatchTrace.routingRule,
      ...(input.dispatchTrace.modelClassification ? { modelClassification: input.dispatchTrace.modelClassification } : {}),
    }),
  };
  appendTraceSpan(trace, intentSpan);

  // Span 2: 知识库检索（如有）
  if (input.dispatchTrace.knowledgeTool) {
    const kt = input.dispatchTrace.knowledgeTool;
    const prompt = kt.prompt && typeof kt.prompt === "object" && !Array.isArray(kt.prompt)
      ? kt.prompt as Record<string, unknown>
      : {};
    const knowledgeSpan: TraceSpanData = {
      spanId: createSpanId(),
      parentSpanId: intentSpan.spanId,
      spanType: "knowledge_retrieval",
      name: "knowledge-base-query",
      status: kt.fallbackReason ? "degraded" : "completed",
      startedAt: trace.createdAt,
      endedAt: trace.createdAt,
      contextRefs: [String(kt.contextRef || "")].filter(Boolean),
      attributes: redactSensitiveFields({
        toolId: kt.toolId,
        available: kt.available,
        confidence: kt.confidence,
        retrievalTriggered: kt.retrievalTriggered,
        chunksCount: kt.chunksCount,
        topScore: kt.topScore,
        ...(kt.fallbackReason ? { fallbackReason: kt.fallbackReason } : {}),
        ...(kt.statusCode ? { statusCode: kt.statusCode } : {}),
        ...(kt.errorMessage ? { errorMessage: kt.errorMessage } : {}),
        ...(kt.requestId ? { requestId: kt.requestId } : {}),
        ...(kt.providerRequestId ? { providerRequestId: kt.providerRequestId } : {}),
        ...(kt.retrievalProviderRequestId ? { retrievalProviderRequestId: kt.retrievalProviderRequestId } : {}),
        ...(kt.configVersion ? { configVersion: kt.configVersion } : {}),
        ...(prompt.id ? { promptId: prompt.id } : {}),
        ...(prompt.version ? { promptVersion: prompt.version } : {}),
        ...(prompt.hash ? { promptHash: prompt.hash } : {}),
        ...(kt.retrievalParams ? { retrievalParams: kt.retrievalParams } : {}),
        ...(kt.knowledgeBaseProfileId ? { knowledgeBaseProfileId: kt.knowledgeBaseProfileId } : {}),
        ...(kt.knowledgeBaseName ? { knowledgeBaseName: kt.knowledgeBaseName } : {}),
        ...(kt.route ? { route: kt.route } : {}),
      }),
      tokenUsage: {
        promptTokens: Number(kt.promptTokens) || 0,
        completionTokens: Number(kt.completionTokens) || 0,
        totalTokens: Number(kt.totalTokens) || 0,
      },
      modelInfo: {
        provider: "zhipu",
        model: String(kt.model || "unknown"),
      },
      ...(kt.fallbackReason ? {
        degradation: {
          reason: String(kt.fallbackReason),
          fallbackTo: "model_generic_knowledge",
        },
      } : {}),
    };
    appendTraceSpan(trace, knowledgeSpan);
  }

  // Span 3: 模型调用（如有）
  if (input.dispatchTrace.modelRun) {
    const mr = input.dispatchTrace.modelRun;
    const modelSpan: TraceSpanData = {
      spanId: createSpanId(),
      parentSpanId: intentSpan.spanId,
      spanType: "model_call",
      name: `model-call-${mr.runKind || "general"}`,
      status: "completed",
      startedAt: trace.createdAt,
      endedAt: trace.createdAt,
      durationMs: Number(mr.latencyMs) || 0,
      contextRefs: Array.isArray(mr.contextRefs) ? mr.contextRefs as string[] : [],
      attributes: redactSensitiveFields({
        runKind: mr.runKind,
        auditMode: mr.auditMode,
        rawContentLength: mr.rawContentLength,
        ...(mr.attempts ? { attempts: mr.attempts } : {}),
        ...(mr.finishReason ? { finishReason: mr.finishReason } : {}),
      }),
      modelInfo: {
        provider: String(mr.provider || "unknown"),
        model: String(mr.model || input.model || "unknown"),
        finishReason: mr.finishReason as string | undefined,
        attempts: typeof mr.attempts === "number" ? mr.attempts : undefined,
      },
    };
    appendTraceSpan(trace, modelSpan);
  }

  return await insertTraceRecord(trace);
}

/** 阶段 1 批 7：因内部调用 insertTraceRecord（已异步化）级联改 async，实现不动。 */
export async function recordWorkbenchTurnFailureTrace(input: {
  requestId?: string;
  ownerUserId: string;
  ownerUsername: string;
  aiSessionId?: string;
  userInputSummary?: string;
  routingRule?: string;
  contextRefs?: string[];
  error: { code: string; message: string; retryable: boolean };
}): Promise<TraceRecord> {
  const trace = createTraceRecord({
    sourceDomain: "ai_session",
    sourceId: input.aiSessionId,
    ownerUserId: input.ownerUserId,
    ownerUsername: input.ownerUsername,
    userInputSummary: input.userInputSummary,
    requestId: input.requestId,
  });

  trace.intentResult = {
    intent: "workbench_turn",
    confidence: 0,
    routingRule: input.routingRule || "failed_before_dispatch",
  };

  appendTraceSpan(trace, {
    spanId: createSpanId(),
    spanType: "model_call",
    name: input.error.code === "client_aborted" ? "workbench-turn-cancelled" : "workbench-turn-failed",
    status: input.error.code === "client_aborted" ? "cancelled" : "failed",
    startedAt: trace.createdAt,
    endedAt: trace.createdAt,
    durationMs: 0,
    contextRefs: input.contextRefs ?? [],
    attributes: redactSensitiveFields({
      routingRule: input.routingRule || "failed_before_dispatch",
    }),
    error: input.error,
  });

  return await insertTraceRecord(trace);
}

/** 阶段 1 批 7：因内部调用 findTraceById + updateTraceRecord（已异步化）级联改 async，实现不动。 */
export async function appendHarnessSpan(input: {
  traceId: string;
  spanType: TraceSpanType;
  name: string;
  status: "completed" | "failed" | "degraded";
  contextRefs?: string[];
  attributes?: Record<string, unknown>;
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  modelInfo?: { provider: string; model: string; finishReason?: string; attempts?: number };
  error?: { code: string; message: string; retryable: boolean };
}): Promise<TraceRecord | null> {
  const trace = await findTraceById(input.traceId);
  if (!trace) return null;

  const span: TraceSpanData = {
    spanId: createSpanId(),
    spanType: input.spanType,
    name: input.name,
    status: input.status,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    contextRefs: input.contextRefs ?? [],
    attributes: redactSensitiveFields(input.attributes ?? {}),
    ...(input.tokenUsage ? { tokenUsage: input.tokenUsage } : {}),
    ...(input.modelInfo ? { modelInfo: input.modelInfo } : {}),
    ...(input.error ? { error: input.error } : {}),
  };

  return await updateTraceRecord(input.traceId, {
    spans: [...trace.spans, span],
    summary: {
      ...trace.summary,
      spanCount: trace.spans.length + 1,
      hasError: trace.summary.hasError || input.status === "failed",
      hasDegradation: trace.summary.hasDegradation || input.status === "degraded",
      totalTokens: trace.summary.totalTokens + (input.tokenUsage?.totalTokens ?? 0),
    },
  });
}

// ─── 查询入口 ────────────────────────────────────────────────

/** 阶段 1 批 7：因内部调用 findTraceById（已异步化）级联改 async，实现不动。 */
export async function getTraceById(traceId: string, ownerUserId: string): Promise<TraceRecord | null> {
  const trace = await findTraceById(traceId);
  if (!trace) return null;
  // Owner 隔离
  if (trace.ownerUserId !== ownerUserId) return null;
  return trace;
}

/** 阶段 1 批 7：因内部调用 queryTraces（已异步化）级联改 async，实现不动。 */
export async function queryUserTraces(filter: TraceQueryFilter): Promise<{ traces: TraceRecord[]; total: number; limit: number; offset: number }> {
  return await queryTraces(filter);
}

/** 阶段 1 批 7：因内部调用 purgeTracesOlderThan（已异步化）级联改 async，实现不动。 */
export async function purgeOldTraces(isoDate: string): Promise<number> {
  return await purgeTracesOlderThan(isoDate);
}

// ─── HTTP Handler ────────────────────────────────────────────

/** 阶段 1 批 7：因内部调用 queryUserTraces（已异步化）级联改 async，实现不动。 */
export async function listTracesHandler(req: Request, res: Response) {
  // req.user 由 requireCapability 中间件挂载
  const user = req.user;
  if (!user) {
    res.status(401).json({ code: 40101, message: "未认证", data: null });
    return;
  }

  // admin 可通过 ?all=true 查全量；普通用户只能查自己的 trace
  const isAdmin = user.role === "admin";
  const queryAll = isAdmin && req.query.all === "true";

  const filter: TraceQueryFilter = {
    ownerUserId: queryAll ? "" : user.id,
    sourceDomain: req.query.sourceDomain as TraceSourceDomain | undefined,
    sourceId: req.query.sourceId as string | undefined,
    spanType: req.query.spanType as TraceSpanType | undefined,
    hasError: req.query.hasError === "true" ? true : undefined,
    hasDegradation: req.query.hasDegradation === "true" ? true : undefined,
    fromIso: req.query.from as string | undefined,
    toIso: req.query.to as string | undefined,
    limit: req.query.limit ? Number(req.query.limit) : 20,
    offset: req.query.offset ? Number(req.query.offset) : 0,
  };

  const result = await queryUserTraces(filter);
  res.json({ code: 0, message: "ok", data: result });
}

/** 阶段 1 批 7：因内部调用 getTraceById + findTraceById（已异步化）级联改 async，实现不动。 */
export async function getTraceHandler(req: Request, res: Response) {
  // req.user 由 requireCapability 中间件挂载
  const user = req.user;
  if (!user) {
    res.status(401).json({ code: 40101, message: "未认证", data: null });
    return;
  }

  const traceId = String(req.params.traceId || "");
  const trace = await getTraceById(traceId, user.id);

  // admin 可查看任意 trace；普通用户只能看自己的
  if (!trace) {
    const isAdmin = user.role === "admin";
    const adminTrace = isAdmin ? await findTraceById(traceId) : null;
    if (!adminTrace) {
      res.status(404).json({ code: 40401, message: "Trace 不存在或无权访问", data: null });
      return;
    }
    res.json({ code: 0, message: "ok", data: adminTrace });
    return;
  }

  res.json({ code: 0, message: "ok", data: trace });
}
