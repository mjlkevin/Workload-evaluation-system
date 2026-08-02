import assert from "node:assert/strict";
import test from "node:test";

import { probeKnowledgeBaseAccess } from "./knowledge-base-access-probe";

const config = {
  model: "glm-test",
  apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
  credentials: { apiKey: "fixture-key", knowledgeId: "kb-fixture" },
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

test("probe classifies authentication, rate, provider, business, timeout and network failures", async () => {
  const cases: Array<[string, typeof fetch, string]> = [
    ["auth", async () => new Response("{}", { status: 401 }), "authentication_failed"],
    ["rate", async () => new Response("{}", { status: 429 }), "rate_limited"],
    ["provider", async () => new Response("{}", { status: 503 }), "provider_unavailable"],
    ["business", async () => new Response(JSON.stringify({ code: 500 }), { status: 200 }), "provider_unavailable"],
    ["timeout", async () => { throw new DOMException("timed out", "TimeoutError"); }, "timeout"],
    ["network", async () => { throw new Error("socket closed"); }, "network_error"],
  ];
  for (const [name, fetcher, expected] of cases) {
    const result = await probeKnowledgeBaseAccess(config, name, fetcher);
    assert.equal(result.status, "failure", name);
    assert.equal(result.errorCode, expected, name);
  }
});
