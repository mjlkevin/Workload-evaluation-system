// ============================================================
// RP-030 · Trace 模块单元测试
// ============================================================

import { after, before, describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
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
  _resetTraceRepositoryForTest,
} from "./trace.repository";

import {
  recordWorkbenchTurnTrace,
  recordWorkbenchTurnFailureTrace,
  getTraceById,
  listTracesHandler,
  getTraceHandler,
} from "./trace.usecase";

// ─── 测试辅助 ────────────────────────────────────────────────
// S3（2026-08-30）：JSON 读写路径删除后本文件走 PG。traces 表不是本文件
// 独占（CI 多测试文件并发共享同一测试库），故照 trace-pg.repository.test.ts
// 已确立的范式做数据集隔离：所有行用独占 owner 前缀，断言按 owner 过滤
// 收敛到自身数据集，清理为条件 DELETE（不整表 TRUNCATE）。
// 原 storePath 注入 + `delete WES_STORE_TRACES_PG` 的 JSON 隔离钩子随之移除。
// 前缀判据：必须与同表其他套件的前缀互不重叠、互不为前缀。本文件曾用
// wes-t-trace-*，与 trace-pg.repository.test.ts 的 LIKE 'wes-t-trace-%' 同名
// 命名空间，并发时两边 cleanOwnRows 会删掉对方在途的行、并把本文件的行
// 送进对方 ownIds.size === 5 的分页窗口（同跑必红、单跑绿）。故改用独占的
// wes-trace-repo-*，与 wes-t-trace-%、wes-chat-svc-% 均无 LIKE 交集。

const OWNER_A = "wes-trace-repo-user-1";
const OWNER_B = "wes-trace-repo-user-2";
const OWNER_LIKE = "wes-trace-repo-%";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null;

async function cleanOwnRows(): Promise<void> {
  if (pool) await pool.query("DELETE FROM traces WHERE owner_user_id LIKE $1", [OWNER_LIKE]);
}

before(async () => {
  if (!testDatabaseUrl) return;
  pool = new Pool({ connectionString: testDatabaseUrl, max: 5 });
  _resetTraceRepositoryForTest();
  // 清理历史残留（前次运行异常退出时 afterEach 可能未跑完）
  await cleanOwnRows();
});

after(async () => {
  await cleanOwnRows();
  _resetTraceRepositoryForTest();
  if (pool) await pool.end();
});

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
      ownerUserId: OWNER_A,
      ownerUsername: "testuser",
      userInputSummary: "测试输入",
    });

    assert.ok(trace.traceId);
    assert.equal(trace.sourceDomain, "ai_session");
    assert.equal(trace.ownerUserId, OWNER_A);
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
      ownerUserId: OWNER_A,
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
      ownerUserId: OWNER_A,
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
      ownerUserId: OWNER_A,
      ownerUsername: "testuser",
    });

    const span = makeSpan({ status: "failed" });
    appendTraceSpan(trace, span);

    assert.equal(trace.summary.hasError, true);
  });

  it("sets hasDegradation when span degrades", () => {
    const trace = createTraceRecord({
      sourceDomain: "ai_session",
      ownerUserId: OWNER_A,
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

// ─── Repository 测试（公开 accessor → 选择器 → PG） ───────────
// 原 6 条 JSON store 用例中的四条职责已有 PG 逐条对应承担（本文件改用
// 公开 accessor、trace-pg 直接实例化仓储类，两层各断一件事）：
//   「returns null for non-existent」→ trace-pg.repository.test.ts「findTraceById 未命中返回 null」
//   「queries with sourceDomain filter」→ 同文件「queryTraces：sourceDomain/sourceId/traceId 过滤」
//   「updates a trace record」→ 同文件「updateTraceRecord 合并 patch」（另含行锁并发用例）
//   「purges old traces」→ 同文件「purgeOlderThan 只删 cutoff 之前的行」（DB 时钟下
//     无法经公开入口造出历史 createdAt，带外 SQL 种入的覆盖仅在 PG 层）
// 此处保留 2 条，专断「公开函数不传 storePath 确实落到 PG 且归属隔离生效」。

describe("trace repository (public accessor → PG)", () => {
  beforeEach(cleanOwnRows);
  afterEach(cleanOwnRows);

  it("inserts and finds a trace by ID", { skip: !testDatabaseUrl }, async () => {
    const trace = createTraceRecord({
      sourceDomain: "ai_session",
      ownerUserId: OWNER_A,
      ownerUsername: "alice",
    });
    await insertTraceRecord(trace);

    const found = await findTraceById(trace.traceId);
    assert.ok(found, "公开 accessor 写入后必须能从 PG 读回");
    assert.equal(found.traceId, trace.traceId);
    assert.equal(found.ownerUserId, OWNER_A);
  });

  it("queries traces with owner isolation", { skip: !testDatabaseUrl }, async () => {
    const trace1 = createTraceRecord({
      sourceDomain: "ai_session",
      ownerUserId: OWNER_A,
      ownerUsername: "alice",
    });
    const trace2 = createTraceRecord({
      sourceDomain: "harness_run",
      ownerUserId: OWNER_B,
      ownerUsername: "bob",
    });
    await insertTraceRecord(trace1);
    await insertTraceRecord(trace2);

    const result = await queryTraces({ ownerUserId: OWNER_A });
    assert.equal(result.total, 1, "owner 过滤不得把别人的 trace 带进来");
    assert.equal(result.traces[0].ownerUserId, OWNER_A);
  });
});

// ─── Usecase 集成测试 ────────────────────────────────────────

describe("recordWorkbenchTurnTrace", () => {
  beforeEach(cleanOwnRows);
  afterEach(cleanOwnRows);

  it("creates a trace with intent routing span and persists it to PG", { skip: !testDatabaseUrl }, async () => {
    const trace = await recordWorkbenchTurnTrace({
      ownerUserId: OWNER_A,
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

    const stored = await findTraceById(trace.traceId);
    assert.equal(stored?.traceId, trace.traceId, "usecase 写入必须落 PG、可按主键读回");
  });

  it("records failed workbench turns as failed traces", { skip: !testDatabaseUrl }, async () => {
    const trace = await recordWorkbenchTurnFailureTrace({
      ownerUserId: OWNER_A,
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
    const stored = await findTraceById(trace.traceId);
    assert.equal(stored?.summary.hasError, true, "失败链路必须完整落 PG，不得只存部分字段");
  });

  it("creates knowledge retrieval span when knowledgeTool is present", async () => {
    const trace = await recordWorkbenchTurnTrace({
      ownerUserId: OWNER_A,
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
      ownerUserId: OWNER_A,
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
      ownerUserId: OWNER_A,
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
    // 未入库的 traceId：无论传哪个 owner 都必须 null（缺行 ≠ 失败）
    const result = await getTraceById("non-existent", OWNER_A);
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
      user: { id: OWNER_A, username: "alice", role: "user" },
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
      user: { id: OWNER_A, username: "alice", role: "user" },
      params: { traceId: "non-existent-id" },
    });
    await getTraceHandler(req, res);
    assert.equal(getStatusCode(), 404);
  });
});
