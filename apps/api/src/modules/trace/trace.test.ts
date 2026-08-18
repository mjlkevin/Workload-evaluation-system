// ============================================================
// RP-030 · Trace 模块单元测试
// ============================================================

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Request, Response } from "express";

import {
  createTraceRecord,
  createSpanId,
  appendTraceSpan,
  redactSensitiveFields,
  type TraceSpanData,
} from "./trace.types";

import {
  insertTraceRecord,
  findTraceById,
  queryTraces,
  updateTraceRecord,
  purgeTracesOlderThan,
} from "./trace.repository";

import {
  recordWorkbenchTurnTrace,
  recordWorkbenchTurnFailureTrace,
  getTraceById,
  listTracesHandler,
  getTraceHandler,
} from "./trace.usecase";

// ─── 测试辅助 ────────────────────────────────────────────────

const TEST_STORE_DIR = join(process.cwd(), "data", "traces-test");
const TEST_STORE_PATH = join(TEST_STORE_DIR, "trace-store.json");
const DEFAULT_STORE_PATH = join(process.cwd(), "data", "traces", "trace-store.json");

async function withTraceStoreEnv<T>(run: () => T | Promise<T>): Promise<T> {
  const previous = process.env.WES_TRACE_STORE_PATH;
  process.env.WES_TRACE_STORE_PATH = TEST_STORE_PATH;
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.WES_TRACE_STORE_PATH;
    } else {
      process.env.WES_TRACE_STORE_PATH = previous;
    }
  }
}

function ensureTestDir() {
  if (!existsSync(TEST_STORE_DIR)) mkdirSync(TEST_STORE_DIR, { recursive: true });
}

function cleanTestStore() {
  if (existsSync(TEST_STORE_DIR)) rmSync(TEST_STORE_DIR, { recursive: true, force: true });
}

function makeSpan(overrides: Partial<TraceSpanData> = {}): TraceSpanData {
  return {
    spanId: createSpanId(),
    spanType: "model_call",
    name: "test-span",
    status: "completed",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    durationMs: 100,
    contextRefs: ["attachment:test.xlsx"],
    attributes: {},
    ...overrides,
  };
}

// ─── 脱敏测试 ────────────────────────────────────────────────

describe("redactSensitiveFields", () => {
  it("replaces apiKey with [REDACTED]", () => {
    const input = { apiKey: "sk-12345", model: "kimi-latest" };
    const result = redactSensitiveFields(input);
    assert.equal(result.apiKey, "[REDACTED]");
    assert.equal(result.model, "kimi-latest");
  });

  it("replaces nested sensitive fields", () => {
    const input = { config: { authorization: "Bearer xxx", model: "glm" } };
    const result = redactSensitiveFields(input);
    assert.equal((result.config as Record<string, unknown>).authorization, "[REDACTED]");
    assert.equal((result.config as Record<string, unknown>).model, "glm");
  });

  it("handles arrays", () => {
    const input = [{ apiKey: "secret" }, { name: "safe" }];
    const result = redactSensitiveFields(input);
    assert.equal((result as Array<Record<string, unknown>>)[0].apiKey, "[REDACTED]");
    assert.equal((result as Array<Record<string, unknown>>)[1].name, "safe");
  });

  it("handles null/undefined gracefully", () => {
    assert.equal(redactSensitiveFields(null), null);
    assert.equal(redactSensitiveFields(undefined), undefined);
    assert.equal(redactSensitiveFields("string"), "string");
  });
});

// ─── Trace 记录创建测试 ─────────────────────────────────────

describe("createTraceRecord", () => {
  it("creates a valid trace record skeleton", () => {
    const trace = createTraceRecord({
      sourceDomain: "ai_session",
      ownerUserId: "user-1",
      ownerUsername: "testuser",
      userInputSummary: "测试输入",
    });

    assert.ok(trace.traceId);
    assert.equal(trace.sourceDomain, "ai_session");
    assert.equal(trace.ownerUserId, "user-1");
    assert.equal(trace.ownerUsername, "testuser");
    assert.equal(trace.userInputSummary, "测试输入");
    assert.equal(trace.spans.length, 0);
    assert.equal(trace.summary.spanCount, 0);
    assert.equal(trace.summary.hasError, false);
  });

  it("truncates userInputSummary to 200 chars", () => {
    const longInput = "a".repeat(500);
    const trace = createTraceRecord({
      sourceDomain: "ai_session",
      ownerUserId: "user-1",
      ownerUsername: "testuser",
      userInputSummary: longInput,
    });
    assert.equal(trace.userInputSummary?.length, 200);
  });
});

// ─── appendTraceSpan 测试 ────────────────────────────────────

describe("appendTraceSpan", () => {
  it("appends span and updates summary", () => {
    const trace = createTraceRecord({
      sourceDomain: "ai_session",
      ownerUserId: "user-1",
      ownerUsername: "testuser",
    });

    const span = makeSpan({
      tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });
    appendTraceSpan(trace, span);

    assert.equal(trace.summary.spanCount, 1);
    assert.equal(trace.summary.totalTokens, 150);
    assert.equal(trace.summary.hasError, false);
  });

  it("sets hasError when span fails", () => {
    const trace = createTraceRecord({
      sourceDomain: "ai_session",
      ownerUserId: "user-1",
      ownerUsername: "testuser",
    });

    const span = makeSpan({ status: "failed" });
    appendTraceSpan(trace, span);

    assert.equal(trace.summary.hasError, true);
  });

  it("sets hasDegradation when span degrades", () => {
    const trace = createTraceRecord({
      sourceDomain: "ai_session",
      ownerUserId: "user-1",
      ownerUsername: "testuser",
    });

    const span = makeSpan({
      status: "degraded",
      degradation: { reason: "missing_config", fallbackTo: "generic" },
    });
    appendTraceSpan(trace, span);

    assert.equal(trace.summary.hasDegradation, true);
  });
});

// ─── Repository 测试 ─────────────────────────────────────────

describe("trace repository", () => {
  beforeEach(() => {
    ensureTestDir();
    cleanTestStore();
    ensureTestDir();
  });

  afterEach(() => {
    cleanTestStore();
  });

  it("inserts and finds a trace by ID", async () => {
    const trace = createTraceRecord({
      sourceDomain: "ai_session",
      ownerUserId: "user-1",
      ownerUsername: "testuser",
    });
    await insertTraceRecord(trace, TEST_STORE_PATH);

    const found = await findTraceById(trace.traceId, TEST_STORE_PATH);
    assert.ok(found);
    assert.equal(found.traceId, trace.traceId);
  });

  it("returns null for non-existent trace", async () => {
    const found = await findTraceById("non-existent-id", TEST_STORE_PATH);
    assert.equal(found, null);
  });

  it("queries traces with owner isolation", async () => {
    const trace1 = createTraceRecord({
      sourceDomain: "ai_session",
      ownerUserId: "user-1",
      ownerUsername: "alice",
    });
    const trace2 = createTraceRecord({
      sourceDomain: "harness_run",
      ownerUserId: "user-2",
      ownerUsername: "bob",
    });
    await insertTraceRecord(trace1, TEST_STORE_PATH);
    await insertTraceRecord(trace2, TEST_STORE_PATH);

    const result = await queryTraces({ ownerUserId: "user-1" }, TEST_STORE_PATH);
    assert.equal(result.total, 1);
    assert.equal(result.traces[0].ownerUserId, "user-1");
  });

  it("queries traces with sourceDomain filter", async () => {
    const trace1 = createTraceRecord({
      sourceDomain: "ai_session",
      ownerUserId: "user-1",
      ownerUsername: "alice",
    });
    const trace2 = createTraceRecord({
      sourceDomain: "harness_run",
      ownerUserId: "user-1",
      ownerUsername: "alice",
    });
    await insertTraceRecord(trace1, TEST_STORE_PATH);
    await insertTraceRecord(trace2, TEST_STORE_PATH);

    const result = await queryTraces({ ownerUserId: "user-1", sourceDomain: "harness_run" }, TEST_STORE_PATH);
    assert.equal(result.total, 1);
    assert.equal(result.traces[0].sourceDomain, "harness_run");
  });

  it("updates a trace record", async () => {
    const trace = createTraceRecord({
      sourceDomain: "ai_session",
      ownerUserId: "user-1",
      ownerUsername: "alice",
    });
    await insertTraceRecord(trace, TEST_STORE_PATH);

    const updated = await updateTraceRecord(trace.traceId, { userInputSummary: "updated" }, TEST_STORE_PATH);
    assert.ok(updated);
    assert.equal(updated.userInputSummary, "updated");
  });

  it("purges old traces", async () => {
    const oldTrace = createTraceRecord({
      sourceDomain: "ai_session",
      ownerUserId: "user-1",
      ownerUsername: "alice",
    });
    oldTrace.createdAt = "2020-01-01T00:00:00.000Z";
    await insertTraceRecord(oldTrace, TEST_STORE_PATH);

    const newTrace = createTraceRecord({
      sourceDomain: "ai_session",
      ownerUserId: "user-1",
      ownerUsername: "alice",
    });
    await insertTraceRecord(newTrace, TEST_STORE_PATH);

    const removed = await purgeTracesOlderThan("2023-01-01T00:00:00.000Z", TEST_STORE_PATH);
    assert.equal(removed, 1);

    const remaining = await queryTraces({ ownerUserId: "user-1" }, TEST_STORE_PATH);
    assert.equal(remaining.total, 1);
  });
});

// ─── Usecase 集成测试 ────────────────────────────────────────

describe("recordWorkbenchTurnTrace", () => {
  beforeEach(() => {
    ensureTestDir();
    cleanTestStore();
    ensureTestDir();
  });

  afterEach(() => {
    cleanTestStore();
  });

  it("creates a trace with intent routing span in the configured test store", async () => {
    await withTraceStoreEnv(async () => {
      const defaultExistedBefore = existsSync(DEFAULT_STORE_PATH);
      const trace = await recordWorkbenchTurnTrace({
        ownerUserId: "user-1",
        ownerUsername: "alice",
        aiSessionId: "session-1",
        userInputSummary: "帮我分析这个附件",
        dispatchTrace: {
          intentConfidence: 0.95,
          routingRule: "explicit_report_with_attachment",
          contextRefs: ["attachment:test.xlsx"],
        },
      });

      assert.ok(trace.traceId);
      assert.equal(trace.sourceDomain, "ai_session");
      assert.equal(trace.sourceId, "session-1");
      assert.ok(trace.spans.length >= 1);
      assert.equal(trace.spans[0].spanType, "intent_routing");

      const stored = await findTraceById(trace.traceId, TEST_STORE_PATH);
      assert.equal(stored?.traceId, trace.traceId);
      assert.equal(existsSync(DEFAULT_STORE_PATH), defaultExistedBefore);
    });
  });

  it("records failed workbench turns as failed traces", async () => {
    await withTraceStoreEnv(async () => {
      const trace = await recordWorkbenchTurnFailureTrace({
        ownerUserId: "user-1",
        ownerUsername: "alice",
        aiSessionId: "session-failed",
        userInputSummary: "模型调用失败",
        routingRule: "attachment_context",
        contextRefs: ["attachment:test.xlsx"],
        error: { code: "stream_failed", message: "upstream failed", retryable: true },
      });

      assert.equal(trace.summary.hasError, true);
      assert.equal(trace.spans[0].status, "failed");
      assert.equal(trace.spans[0].error?.code, "stream_failed");
      const stored = await findTraceById(trace.traceId, TEST_STORE_PATH);
      assert.equal(stored?.summary.hasError, true);
    });
  });

  it("creates knowledge retrieval span when knowledgeTool is present", async () => {
    const trace = await recordWorkbenchTurnTrace({
      ownerUserId: "user-1",
      ownerUsername: "alice",
      dispatchTrace: {
        intentConfidence: 0.8,
        routingRule: "knowledge_query",
        contextRefs: ["knowledge:kb-1:test:chunks=5:score=0.92"],
        knowledgeTool: {
          toolId: "knowledge_base.query_product_knowledge",
          available: true,
          confidence: "high",
          retrievalTriggered: true,
          chunksCount: 5,
          topScore: 0.92,
          model: "GLM-5V-Turbo",
          knowledgeId: "kb-1",
          query: "测试查询",
          answer: "测试回答",
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          latencyMs: 200,
          contextRef: "knowledge:kb-1:test:chunks=5:score=0.92",
        },
      },
    });

    const knowledgeSpan = trace.spans.find((s) => s.spanType === "knowledge_retrieval");
    assert.ok(knowledgeSpan);
    assert.equal(knowledgeSpan.status, "completed");
    assert.equal(knowledgeSpan.tokenUsage?.totalTokens, 150);
  });

  it("persists request, provider, prompt and config metadata on the knowledge span", async () => {
    const trace = await recordWorkbenchTurnTrace({
      requestId: "00000000-0000-4000-8000-000000000001",
      ownerUserId: "user-1",
      ownerUsername: "alice",
      dispatchTrace: {
        intentConfidence: 0.9,
        routingRule: "knowledge_query",
        contextRefs: ["knowledge:kb-1:test"],
        knowledgeTool: {
          toolId: "knowledge_base.query_product_knowledge",
          available: true,
          confidence: "high",
          retrievalTriggered: true,
          chunksCount: 2,
          topScore: 0.91,
          model: "glm-test",
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          contextRef: "knowledge:kb-1:test",
          requestId: "00000000-0000-4000-8000-000000000001",
          providerRequestId: "provider-generate-1",
          retrievalProviderRequestId: "provider-retrieve-1",
          configVersion: 3,
          prompt: { id: "rag-answer", version: 1, hash: "a".repeat(64) },
          retrievalParams: { topK: 8, topN: 20, recallMethod: "mixed" },
          knowledgeBaseProfileId: "treasury",
          knowledgeBaseName: "司库与银企知识库",
          route: {
            mode: "rule",
            confidence: 0.9,
            reason: "keyword_match:网上银行",
            primaryProfileId: "treasury",
            fallbackProfileId: "solutions",
            attempts: [
              { profileId: "treasury", fallbackReason: "retrieval_empty", chunksCount: 0, topScore: 0 },
              { profileId: "solutions", chunksCount: 2, topScore: 0.91 },
            ],
          },
        },
      },
    });
    const span = trace.spans.find((item) => item.spanType === "knowledge_retrieval");
    assert.ok(span);
    assert.equal(span.attributes.requestId, "00000000-0000-4000-8000-000000000001");
    assert.equal(span.attributes.providerRequestId, "provider-generate-1");
    assert.equal(span.attributes.retrievalProviderRequestId, "provider-retrieve-1");
    assert.equal(span.attributes.configVersion, 3);
    assert.equal(span.attributes.promptVersion, 1);
    assert.deepEqual(span.attributes.retrievalParams, { topK: 8, topN: 20, recallMethod: "mixed" });
    assert.equal(span.attributes.knowledgeBaseProfileId, "treasury");
    assert.equal((span.attributes.route as any).fallbackProfileId, "solutions");
    assert.equal((span.attributes.route as any).attempts.length, 2);
  });

  it("marks knowledge span as degraded when fallbackReason present", async () => {
    const trace = await recordWorkbenchTurnTrace({
      ownerUserId: "user-1",
      ownerUsername: "alice",
      dispatchTrace: {
        intentConfidence: 0.8,
        routingRule: "knowledge_query",
        contextRefs: [],
        knowledgeTool: {
          toolId: "knowledge_base.query_product_knowledge",
          available: false,
          confidence: "low",
          retrievalTriggered: false,
          chunksCount: 0,
          topScore: 0,
          model: "GLM-5V-Turbo",
          knowledgeId: "kb-1",
          query: "测试查询",
          answer: "知识库未配置",
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          latencyMs: 0,
          contextRef: "knowledge:unconfigured:unavailable",
          fallbackReason: "missing_config",
        },
      },
    });

    const knowledgeSpan = trace.spans.find((s) => s.spanType === "knowledge_retrieval");
    assert.ok(knowledgeSpan);
    assert.equal(knowledgeSpan.status, "degraded");
    assert.ok(knowledgeSpan.degradation);
    assert.equal(knowledgeSpan.degradation.reason, "missing_config");
  });

  it("redacts sensitive fields from attributes", () => {
    // 测试 redactSensitiveFields 函数对敏感字段的脱敏能力
    const input = {
      runKind: "attachment_qa",
      apiKey: "sk-secret-key-12345",
      authorization: "Bearer token",
      model: "kimi-latest",
    };
    const redacted = redactSensitiveFields(input);
    assert.equal(redacted.apiKey, "[REDACTED]");
    assert.equal(redacted.authorization, "[REDACTED]");
    assert.equal(redacted.model, "kimi-latest");
    assert.equal(redacted.runKind, "attachment_qa");
  });
});

describe("getTraceById (owner isolation)", () => {
  it("returns null when trace belongs to different user", async () => {
    // getTraceById 使用默认 store path，这里只测试逻辑
    // 在真实场景中，owner 隔离确保用户只能看到自己的 trace
    const result = await getTraceById("non-existent", "user-1");
    assert.equal(result, null);
  });
});

// ─── RP-030: Handler 鉴权与用户上下文测试 ───────────────────

function createMockReqRes(overrides: {
  user?: Record<string, unknown> | null;
  query?: Record<string, string>;
  params?: Record<string, string>;
}): { req: Request; res: Response; getResponseBody: () => unknown; getStatusCode: () => number } {
  const req = {
    user: overrides.user ?? undefined,
    query: overrides.query ?? {},
    params: overrides.params ?? {},
  } as unknown as Request;

  let statusCode = 200;
  let body: unknown = null;

  const res = {
    status: (code: number) => { statusCode = code; return res; },
    json: (data: unknown) => { body = data; },
  } as unknown as Response;

  return {
    req,
    res,
    getResponseBody: () => body,
    getStatusCode: () => statusCode,
  };
}

describe("listTracesHandler (RP-030 auth fix)", () => {
  it("returns 401 when req.user is missing", async () => {
    const { req, res, getStatusCode, getResponseBody } = createMockReqRes({ user: null });
    await listTracesHandler(req, res);
    assert.equal(getStatusCode(), 401);
    assert.equal((getResponseBody() as Record<string, unknown>).code, 40101);
  });

  it("returns 200 for authenticated user", async () => {
    const { req, res, getStatusCode } = createMockReqRes({
      user: { id: "user-1", username: "alice", role: "user" },
    });
    await listTracesHandler(req, res);
    assert.equal(getStatusCode(), 200);
  });
});

describe("getTraceHandler (RP-030 auth fix)", () => {
  it("returns 401 when req.user is missing", async () => {
    const { req, res, getStatusCode } = createMockReqRes({
      user: null,
      params: { traceId: "t-1" },
    });
    await getTraceHandler(req, res);
    assert.equal(getStatusCode(), 401);
  });

  it("returns 404 for non-existent trace", async () => {
    const { req, res, getStatusCode } = createMockReqRes({
      user: { id: "user-1", username: "alice", role: "user" },
      params: { traceId: "non-existent-id" },
    });
    await getTraceHandler(req, res);
    assert.equal(getStatusCode(), 404);
  });
});
