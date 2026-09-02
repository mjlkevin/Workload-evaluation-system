import assert from "node:assert/strict";
import test from "node:test";

import { probeKnowledgeBaseAccess } from "./knowledge-base-access-probe";

const config = {
  model: "glm-test",
  apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
  credentials: { apiKey: "fixture-key", knowledgeId: "kb-fixture" },
  knowledgeBases: [],
  retrievalParams: {
    topK: 8,
    topN: 20,
    recallMethod: "mixed" as const,
    rerankStatus: 1 as const,
    rerankModel: "rerank",
    fractionalThreshold: 0.2,
  },
};

test("probe sends knowledge_ids array and treats a zero-hit HTTP 200 as access success", async () => {
  let requestBody: Record<string, unknown> = {};
  const result = await probeKnowledgeBaseAccess(
    config,
    "00000000-0000-4000-8000-000000000001",
    async (_url, init) => {
      requestBody = JSON.parse(String(init?.body || "{}"));
      return new Response(JSON.stringify({ code: 200, data: [] }), {
        status: 200,
        headers: { "x-request-id": "provider-probe-1" },
      });
    },
  );
  assert.deepEqual(requestBody.knowledge_ids, ["kb-fixture"]);
  assert.equal(requestBody.request_id, "00000000-0000-4000-8000-000000000001");
  assert.equal(result.status, "success");
  assert.equal(result.warning, "retrieval_empty");
  assert.equal(result.providerRequestId, "provider-probe-1");
});

test("probe rejects unsafe URL before calling fetch", async () => {
  let called = false;
  const result = await probeKnowledgeBaseAccess(
    { ...config, apiBaseUrl: "http://127.0.0.1:3000" },
    undefined,
    async () => {
      called = true;
      return new Response("{}", { status: 200 });
    },
  );
  assert.equal(result.status, "failure");
  assert.equal(result.errorCode, "unsafe_api_base_url");
  assert.equal(called, false);
});

test("probe classifies authentication, rate, provider, timeout and network failures by HTTP semantics", async () => {
  const cases: Array<[string, typeof fetch, string]> = [
    ["auth", async () => new Response("{}", { status: 401 }), "authentication_failed"],
    ["rate", async () => new Response("{}", { status: 429 }), "rate_limited"],
    ["provider", async () => new Response("{}", { status: 503 }), "provider_unavailable"],
    ["timeout", async () => { throw new DOMException("timed out", "TimeoutError"); }, "timeout"],
    ["network", async () => { throw new Error("socket closed"); }, "network_error"],
  ];
  for (const [name, fetcher, expected] of cases) {
    const result = await probeKnowledgeBaseAccess(config, name, fetcher);
    assert.equal(result.status, "failure", name);
    assert.equal(result.errorCode, expected, name);
  }
});

test("probe classifies business codes separately from HTTP status and keeps raw code/msg (DEF-2026-09-02-001)", async () => {
  // 智谱一律 HTTP 200、错误码在响应体；业务码不得按 HTTP 语义分类。
  const okResult = await probeKnowledgeBaseAccess(
    config,
    "ok-200",
    async () => new Response(JSON.stringify({ code: 200, data: [{ id: "hit-1" }] }), { status: 200 }),
  );
  assert.equal(okResult.status, "success");
  assert.equal(okResult.errorCode, undefined);

  const authResult = await probeKnowledgeBaseAccess(
    config,
    "auth-401",
    async () => new Response(JSON.stringify({ code: 401, msg: "令牌已过期或验证不正确" }), { status: 200 }),
  );
  assert.equal(authResult.status, "failure");
  assert.equal(authResult.errorCode, "authentication_failed");
  assert.equal(authResult.providerCode, 401);
  assert.equal(authResult.providerMessage, "令牌已过期或验证不正确");

  const business500 = await probeKnowledgeBaseAccess(
    config,
    "biz-500",
    async () => new Response(JSON.stringify({ code: 500 }), { status: 200 }),
  );
  assert.equal(business500.status, "failure");
  assert.equal(business500.errorCode, "provider_unspecified_rejection");
  assert.equal(business500.providerCode, 500);
  assert.equal(business500.providerMessage, undefined);

  const fieldError = await probeKnowledgeBaseAccess(
    config,
    "biz-100013",
    async () => new Response(JSON.stringify({ code: 100013, msg: "字段错误" }), { status: 200 }),
  );
  assert.equal(fieldError.errorCode, "invalid_arguments");
  assert.equal(fieldError.providerCode, 100013);

  const unknownCode = await probeKnowledgeBaseAccess(
    config,
    "biz-99999",
    async () => new Response(JSON.stringify({ code: 99999, msg: "某种未取证错误" }), { status: 200 }),
  );
  assert.equal(unknownCode.errorCode, "unknown");
  assert.equal(unknownCode.providerCode, 99999);

  // HTTP 5xx 与业务码 500 分类互不串味：HTTP 失败不带业务字段。
  const http500 = await probeKnowledgeBaseAccess(
    config,
    "http-500",
    async () => new Response(JSON.stringify({ code: 500 }), { status: 500 }),
  );
  assert.equal(http500.status, "failure");
  assert.equal(http500.errorCode, "provider_unavailable");
  assert.equal(http500.providerCode, undefined);
});

test("probe truncates long provider messages", async () => {
  const longMsg = "x".repeat(500);
  const result = await probeKnowledgeBaseAccess(
    config,
    "long-msg",
    async () => new Response(JSON.stringify({ code: 401, msg: longMsg }), { status: 200 }),
  );
  assert.equal(result.providerMessage?.length, 200);
});
