// ============================================================
// O7 · Trace ↔ Langfuse 模型映射测试
// ============================================================
// RED 1: 映射完整性 — 自研 TraceSpan 全字段在 Langfuse 模型中有对应或显式标注「不可映射」
// RED 2: 导出可运行 — 导出脚本对 traces 表数据执行不报错
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  toLangfuseTrace,
  fromLangfuseTrace,
  toLangfuseObservation,
  type LangfuseTrace,
  type LangfuseObservation,
} from "./trace.langfuse";

import {
  createTraceRecord,
  createSpanId,
  appendTraceSpan,
  redactSensitiveFields,
  type TraceRecord,
  type TraceSpanData,
} from "./trace.types";

// ─── 测试辅助 ────────────────────────────────────────────────

function createSampleTrace(): TraceRecord {
  const trace = createTraceRecord({
    sourceDomain: "ai_session",
    sourceId: "sess-001",
    ownerUserId: "user-001",
    ownerUsername: "tester",
    userInputSummary: "帮我评估这个项目",
    requestId: "req-001",
  });

  trace.intentResult = {
    intent: "workbench_turn",
    confidence: 0.92,
    routingRule: "v2_default",
  };

  // Span 1: 意图路由
  const intentSpan: TraceSpanData = {
    spanId: createSpanId(),
    spanType: "intent_routing",
    name: "workbench-intent-routing",
    status: "completed",
    startedAt: trace.createdAt,
    endedAt: trace.createdAt,
    durationMs: 5,
    contextRefs: ["attachment:001"],
    attributes: { routingRule: "v2_default", confidence: 0.92 },
  };
  appendTraceSpan(trace, intentSpan);

  // Span 2: 模型调用
  const modelSpan: TraceSpanData = {
    spanId: createSpanId(),
    parentSpanId: intentSpan.spanId,
    spanType: "model_call",
    name: "model-call-general",
    status: "completed",
    startedAt: trace.createdAt,
    endedAt: trace.createdAt,
    durationMs: 1200,
    contextRefs: [],
    attributes: { runKind: "general", rawContentLength: 500 },
    tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    modelInfo: { provider: "kimi", model: "kimi-k2", finishReason: "stop" },
  };
  appendTraceSpan(trace, modelSpan);

  // Span 3: 知识库检索（degraded）
  const knowledgeSpan: TraceSpanData = {
    spanId: createSpanId(),
    parentSpanId: intentSpan.spanId,
    spanType: "knowledge_retrieval",
    name: "knowledge-base-query",
    status: "degraded",
    startedAt: trace.createdAt,
    endedAt: trace.createdAt,
    durationMs: 300,
    contextRefs: ["knowledge:001"],
    attributes: { chunksCount: 3, topScore: 0.85 },
    tokenUsage: { promptTokens: 200, completionTokens: 0, totalTokens: 200 },
    modelInfo: { provider: "zhipu", model: "embedding-2" },
    degradation: { reason: "timeout", fallbackTo: "model_generic_knowledge" },
  };
  appendTraceSpan(trace, knowledgeSpan);

  // Span 4: 失败的写动作
  const failedSpan: TraceSpanData = {
    spanId: createSpanId(),
    spanType: "write_action",
    name: "create-draft",
    status: "failed",
    startedAt: trace.createdAt,
    endedAt: trace.createdAt,
    durationMs: 50,
    contextRefs: [],
    attributes: {},
    error: { code: "validation_error", message: "项目名不能为空", retryable: false },
  };
  appendTraceSpan(trace, failedSpan);

  return trace;
}

// ─── 映射完整性测试 ──────────────────────────────────────────

describe("toLangfuseTrace — 映射完整性", () => {
  it("should map TraceRecord to LangfuseTrace with all core fields", () => {
    const trace = createSampleTrace();
    const lfTrace = toLangfuseTrace(trace);

    assert.ok(lfTrace.id, "Langfuse trace must have id");
    assert.equal(lfTrace.id, trace.traceId);
    assert.ok(lfTrace.name, "Langfuse trace must have name");
    assert.equal(lfTrace.sessionId, trace.sourceId);
    assert.equal(lfTrace.userId, trace.ownerUserId);
    assert.ok(Array.isArray(lfTrace.observations), "must have observations array");
    assert.equal(lfTrace.observations.length, trace.spans.length);
  });

  it("should map sourceDomain to Langfuse tags", () => {
    const trace = createSampleTrace();
    const lfTrace = toLangfuseTrace(trace);

    assert.ok(Array.isArray(lfTrace.tags), "tags must be an array");
    assert.ok(lfTrace.tags.includes(trace.sourceDomain), "tags must contain sourceDomain");
  });

  it("should map intentResult to Langfuse metadata", () => {
    const trace = createSampleTrace();
    const lfTrace = toLangfuseTrace(trace);

    assert.ok(lfTrace.metadata, "metadata must exist");
    assert.ok(lfTrace.metadata.intent, "metadata must contain intent");
    assert.equal(lfTrace.metadata.intent, trace.intentResult!.intent);
    assert.equal(lfTrace.metadata.confidence, trace.intentResult!.confidence);
  });

  it("should map userInputSummary to Langfuse input", () => {
    const trace = createSampleTrace();
    const lfTrace = toLangfuseTrace(trace);

    assert.equal(lfTrace.input, trace.userInputSummary);
  });

  it("should map timestamps correctly", () => {
    const trace = createSampleTrace();
    const lfTrace = toLangfuseTrace(trace);

    assert.ok(lfTrace.timestamp, "timestamp must exist");
    assert.equal(lfTrace.timestamp, trace.createdAt);
  });
});

describe("toLangfuseObservation — Span 映射", () => {
  it("should map TraceSpanData to LangfuseObservation with span type", () => {
    const trace = createSampleTrace();
    const lfTrace = toLangfuseTrace(trace);

    // 意图路由 span → Langfuse observation (type: span)
    const intentObs = lfTrace.observations[0];
    assert.equal(intentObs.id, trace.spans[0].spanId);
    assert.equal(intentObs.name, trace.spans[0].name);
    assert.ok(intentObs.startTime, "startTime must exist");
    assert.ok(intentObs.endTime, "endTime must exist");
  });

  it("should map parentSpanId to parentObservationId", () => {
    const trace = createSampleTrace();
    const lfTrace = toLangfuseTrace(trace);

    // modelSpan (index 1) has parentSpanId = intentSpan.spanId
    const modelObs = lfTrace.observations[1];
    assert.equal(modelObs.parentObservationId, trace.spans[0].spanId);
  });

  it("should map tokenUsage to Langfuse usage", () => {
    const trace = createSampleTrace();
    const lfTrace = toLangfuseTrace(trace);

    // modelSpan (index 1) has tokenUsage
    const modelObs = lfTrace.observations[1];
    assert.ok(modelObs.usage, "model observation must have usage");
    assert.equal(modelObs.usage!.input, trace.spans[1].tokenUsage!.promptTokens);
    assert.equal(modelObs.usage!.output, trace.spans[1].tokenUsage!.completionTokens);
    assert.equal(modelObs.usage!.total, trace.spans[1].tokenUsage!.totalTokens);
  });

  it("should map modelInfo to Langfuse model field", () => {
    const trace = createSampleTrace();
    const lfTrace = toLangfuseTrace(trace);

    const modelObs = lfTrace.observations[1];
    assert.equal(modelObs.model, trace.spans[1].modelInfo!.model);
  });

  it("should map failed status to Langfuse level ERROR", () => {
    const trace = createSampleTrace();
    const lfTrace = toLangfuseTrace(trace);

    // failedSpan (index 3) has status "failed"
    const failedObs = lfTrace.observations[3];
    assert.equal(failedObs.level, "ERROR");
    assert.ok(failedObs.statusMessage, "failed observation must have statusMessage");
  });

  it("should map degraded status to Langfuse level WARNING", () => {
    const trace = createSampleTrace();
    const lfTrace = toLangfuseTrace(trace);

    // knowledgeSpan (index 2) has status "degraded"
    const degradedObs = lfTrace.observations[2];
    assert.equal(degradedObs.level, "WARNING");
  });

  it("should map completed status to Langfuse level DEFAULT", () => {
    const trace = createSampleTrace();
    const lfTrace = toLangfuseTrace(trace);

    const completedObs = lfTrace.observations[0];
    assert.equal(completedObs.level, "DEFAULT");
  });

  it("should map spanType to Langfuse metadata.spanType", () => {
    const trace = createSampleTrace();
    const lfTrace = toLangfuseTrace(trace);

    const intentObs = lfTrace.observations[0];
    assert.equal(intentObs.metadata!.spanType, "intent_routing");

    const modelObs = lfTrace.observations[1];
    assert.equal(modelObs.metadata!.spanType, "model_call");
  });

  it("should map error info to Langfuse statusMessage and metadata", () => {
    const trace = createSampleTrace();
    const lfTrace = toLangfuseTrace(trace);

    const failedObs = lfTrace.observations[3];
    assert.equal(failedObs.statusMessage, trace.spans[3].error!.message);
    assert.equal(failedObs.metadata!.errorCode, trace.spans[3].error!.code);
    assert.equal(failedObs.metadata!.retryable, false);
  });

  it("should map degradation info to Langfuse metadata", () => {
    const trace = createSampleTrace();
    const lfTrace = toLangfuseTrace(trace);

    const degradedObs = lfTrace.observations[2];
    const degradation = degradedObs.metadata!.degradation as { reason: string; fallbackTo: string };
    assert.ok(degradation, "degraded observation must have degradation metadata");
    assert.equal(degradation.reason, "timeout");
    assert.equal(degradation.fallbackTo, "model_generic_knowledge");
  });
});

describe("fromLangfuseTrace — 反向映射", () => {
  it("should reverse-map LangfuseTrace to Partial<TraceRecord>", () => {
    const trace = createSampleTrace();
    const lfTrace = toLangfuseTrace(trace);
    const reversed = fromLangfuseTrace(lfTrace);

    assert.equal(reversed.traceId, trace.traceId);
    assert.equal(reversed.sourceId, trace.sourceId);
    assert.equal(reversed.ownerUserId, trace.ownerUserId);
    assert.ok(reversed.spans, "reversed trace must have spans");
    assert.ok((reversed.spans || []).length > 0, "reversed spans must not be empty");
  });

  it("should reverse-map tags to sourceDomain", () => {
    const trace = createSampleTrace();
    const lfTrace = toLangfuseTrace(trace);
    const reversed = fromLangfuseTrace(lfTrace);

    assert.equal(reversed.sourceDomain, trace.sourceDomain);
  });
});

describe("不可映射字段标注", () => {
  it("should preserve requestId in metadata as unmapped field", () => {
    const trace = createSampleTrace();
    const lfTrace = toLangfuseTrace(trace);

    assert.ok(lfTrace.metadata, "metadata must exist");
    // requestId 不在 Langfuse 标准字段中，映射到 metadata
    assert.equal(lfTrace.metadata.requestId, trace.requestId);
  });

  it("should preserve ownerUsername in metadata as unmapped field", () => {
    const trace = createSampleTrace();
    const lfTrace = toLangfuseTrace(trace);

    assert.equal(lfTrace.metadata.ownerUsername, trace.ownerUsername);
  });

  it("should preserve summary in metadata as unmapped field", () => {
    const trace = createSampleTrace();
    const lfTrace = toLangfuseTrace(trace);

    const summary = lfTrace.metadata.summary as { totalTokens: number };
    assert.ok(summary, "summary must be in metadata");
    assert.equal(summary.totalTokens, trace.summary.totalTokens);
  });
});
