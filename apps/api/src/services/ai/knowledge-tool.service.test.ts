import assert from "node:assert/strict";
import test from "node:test";

import { queryZhipuKnowledgeBase, retrieveKnowledgeChunks } from "./knowledge-tool.service";

function createJsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("knowledge tool returns missing_config fallback without calling any API", async () => {
  let called = false;
  const result = await queryZhipuKnowledgeBase("购买存货核算模块必须购买哪些相关模块？", {}, async () => {
    called = true;
    return createJsonResponse({});
  });

  assert.equal(called, false);
  assert.equal(result.toolId, "knowledge_base.query_product_knowledge");
  assert.equal(result.available, false);
  assert.equal(result.retrievalTriggered, false);
  assert.equal(result.confidence, "low");
  assert.equal(result.fallbackReason, "missing_config");
  assert.equal(result.promptTokens, 0);
  assert.equal(result.completionTokens, 0);
  assert.equal(result.totalTokens, 0);
  assert.equal(result.query, "购买存货核算模块必须购买哪些相关模块？");
  assert.equal(result.knowledgeId, "");
  assert.equal(result.contextRef, "knowledge:unconfigured:unavailable");
  assert.equal(result.chunksCount, 0);
  assert.equal(result.topScore, 0);
  assert.match(result.answer, /知识库.*配置|尚未配置/);
});

test("knowledge tool two-stage: retrieve then generate answer", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const result = await queryZhipuKnowledgeBase(
    "多组织业务往来一般包含哪些模块？",
    {
      apiKey: "zhipu-test-key",
      knowledgeId: "kb-sales",
      model: "GLM-5V-Turbo",
      apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
      // DEF-2026-09-02-001：默认 rerankStatus 已改 0，此处显式传 1 验证
      // 「显式取值不被覆盖」语义（也守护请求体里 rerank_status/rerank_model 透传）。
      retrievalParams: { rerankStatus: 1, rerankModel: "rerank" },
    },
    async (url, init) => {
      calls.push({ url: String(url), init });
      const urlStr = String(url);
      if (urlStr.includes("/knowledge/retrieve")) {
        // 阶段一：检索 API
        return createJsonResponse({
          data: [
            {
              text: "多组织业务往来涉及组织管理、客户管理、供应链协同、结算与权限等模块。",
              score: 0.92,
              metadata: { doc_name: "产品知识文档", doc_id: "doc-1", knowledge_id: "kb-sales" },
            },
          ],
          code: 200,
          message: "请求成功",
        });
      }
      // 阶段二：模型生成
      return createJsonResponse({
        choices: [{ message: { content: "多组织业务往来通常涉及组织、客户、供应链、结算与权限协同。" } }],
        usage: { prompt_tokens: 520, completion_tokens: 42, total_tokens: 562 },
      });
    }
  );

  // 验证两次调用
  assert.equal(calls.length, 2);
  // 第一次：检索 API
  assert.ok(calls[0].url.includes("/knowledge/retrieve"));
  assert.equal(calls[0].init?.method, "POST");
  const retrievePayload = JSON.parse(String(calls[0].init?.body || "{}")) as Record<string, unknown>;
  assert.deepEqual(retrievePayload.knowledge_ids, ["kb-sales"]);
  assert.equal(retrievePayload.recall_method, "mixed");
  assert.equal(retrievePayload.rerank_status, 1);
  assert.equal(retrievePayload.rerank_model, "rerank");
  // 第二次：模型生成
  assert.ok(calls[1].url.includes("/chat/completions"));
  const chatPayload = JSON.parse(String(calls[1].init?.body || "{}")) as Record<string, unknown>;
  assert.equal(chatPayload.model, "GLM-5V-Turbo");
  const messages = chatPayload.messages as Array<{ role: string; content: string }>;
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /产品知识助手/);
  assert.match(messages[0].content, /产品知识文档/);
  assert.equal(messages[1].role, "user");

  // 验证结果
  assert.equal(result.available, true);
  assert.equal(result.retrievalTriggered, true);
  assert.equal(result.confidence, "high");
  assert.equal(result.fallbackReason, undefined);
  assert.equal(result.promptTokens, 520);
  assert.equal(result.completionTokens, 42);
  assert.equal(result.totalTokens, 562);
  assert.equal(result.chunksCount, 1);
  assert.equal(result.topScore, 0.92);
  assert.match(result.answer, /多组织业务往来/);
});

test("knowledge tool handles empty retrieval results", async () => {
  const result = await queryZhipuKnowledgeBase(
    "无关问题xyz",
    { apiKey: "zhipu-test-key", knowledgeId: "kb-sales" },
    async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/knowledge/retrieve")) {
        return createJsonResponse({ data: [], code: 200, message: "请求成功" });
      }
      throw new Error("chat should not be called when retrieval is empty");
    }
  );

  assert.equal(result.available, true);
  assert.equal(result.retrievalTriggered, false);
  assert.equal(result.confidence, "low");
  assert.equal(result.fallbackReason, "retrieval_empty");
  assert.equal(result.chunksCount, 0);
  assert.equal(result.topScore, 0);
  assert.match(result.answer, /未检索到/);
});

test("knowledge tool handles retrieve API failure", async () => {
  const result = await queryZhipuKnowledgeBase(
    "查询失败时如何处理？",
    { apiKey: "zhipu-test-key", knowledgeId: "kb-sales" },
    async () => createJsonResponse({ error: { message: "upstream unavailable" } }, 503)
  );

  assert.equal(result.available, true);
  assert.equal(result.retrievalTriggered, false);
  assert.equal(result.confidence, "low");
  assert.equal(result.fallbackReason, "retrieval_failed");
  assert.equal(result.statusCode, 503);
  assert.equal(result.errorMessage, "upstream unavailable");
  assert.equal(result.chunksCount, 0);
  assert.match(result.answer, /检索服务异常|服务异常/);
});

test("knowledge tool detects business-level error when HTTP 200 but body code=500", async () => {
  const result = await queryZhipuKnowledgeBase(
    "金蝶IPD解决方案",
    { apiKey: "zhipu-test-key", knowledgeId: "kb-sales" },
    async () => createJsonResponse({ code: 500, message: "知识召回服务异常", timestamp: 1782402448880 }, 200)
  );

  assert.equal(result.available, true);
  assert.equal(result.retrievalTriggered, false);
  assert.equal(result.confidence, "low");
  assert.equal(result.fallbackReason, "retrieval_failed");
  assert.equal(result.statusCode, 500);
  assert.equal(result.errorMessage, "知识召回服务异常");
  assert.equal(result.chunksCount, 0);
  assert.match(result.answer, /服务异常/);
});

test("knowledge tool degrades gracefully when answer generation fails", async () => {
  let callCount = 0;
  const result = await queryZhipuKnowledgeBase(
    "测试降级",
    { apiKey: "zhipu-test-key", knowledgeId: "kb-sales" },
    async (url) => {
      callCount++;
      const urlStr = String(url);
      if (urlStr.includes("/knowledge/retrieve")) {
        return createJsonResponse({
          data: [
            { text: "测试文档内容", score: 0.85, metadata: { doc_name: "测试文档", doc_id: "doc-1" } },
          ],
          code: 200,
        });
      }
      // 模拟生成失败
      return createJsonResponse({ error: { message: "model error" } }, 500);
    }
  );

  assert.equal(callCount, 2);
  assert.equal(result.available, true);
  assert.equal(result.retrievalTriggered, true);
  assert.equal(result.confidence, "low");
  assert.equal(result.fallbackReason, "answer_failed");
  assert.equal(result.chunksCount, 1);
  assert.equal(result.topScore, 0.85);
  assert.match(result.answer, /测试文档/);
});

test("retrieveKnowledgeChunks parses response correctly", async () => {
  const result = await retrieveKnowledgeChunks(
    "汽配行业痛点",
    { apiKey: "key", knowledgeId: "kb-1", apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4" },
    async () => createJsonResponse({
      data: [
        {
          text: "汽配行业痛点包括库存管理混乱",
          score: 0.91,
          metadata: {
            _id: "chunk-1",
            knowledge_id: "kb-1",
            doc_id: "doc-1",
            doc_name: "汽配方案.docx",
            doc_url: "https://example.com/doc.docx",
          },
        },
        {
          text: "另一个相关片段",
          score: 0.67,
          metadata: { doc_name: "方案B.pptx", doc_id: "doc-2" },
        },
      ],
      code: 200,
    })
  );

  assert.equal(result.chunks.length, 2);
  assert.equal(result.chunks[0].text, "汽配行业痛点包括库存管理混乱");
  assert.equal(result.chunks[0].score, 0.91);
  assert.equal(result.chunks[0].docName, "汽配方案.docx");
  assert.equal(result.chunks[0].docId, "doc-1");
  assert.equal(result.chunks[0].knowledgeId, "kb-1");
  assert.equal(result.chunks[1].score, 0.67);
  assert.equal(result.statusCode, 200);
  assert.ok(result.latencyMs >= 0);
});

test("retrieveKnowledgeChunks strips /paas/v4 from base URL", async () => {
  let capturedUrl = "";
  await retrieveKnowledgeChunks(
    "test",
    { apiKey: "key", knowledgeId: "kb-1", apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4" },
    async (url) => {
      capturedUrl = String(url);
      return createJsonResponse({ data: [], code: 200 });
    }
  );

  assert.equal(capturedUrl, "https://open.bigmodel.cn/api/llm-application/open/knowledge/retrieve");
});

test("retrieveKnowledgeChunks sends configured parameters and trusted request ID", async () => {
  let body: Record<string, unknown> = {};
  const result = await retrieveKnowledgeChunks(
    "configured retrieval",
    {
      apiKey: "key",
      knowledgeId: "kb-1",
      requestId: "00000000-0000-4000-8000-000000000001",
      retrievalParams: {
        topK: 12,
        topN: 30,
        recallMethod: "keyword",
        rerankStatus: 0,
        rerankModel: "rerank-v2",
        fractionalThreshold: 0.35,
      },
    },
    async (_url, init) => {
      body = JSON.parse(String(init?.body || "{}"));
      return createJsonResponse({ code: 200, data: [] }, 200, { "x-request-id": "provider-retrieve-1" });
    },
  );
  assert.equal(body.top_k, 12);
  assert.equal(body.top_n, 30);
  assert.equal(body.recall_method, "keyword");
  assert.equal(body.rerank_status, 0);
  assert.equal(body.rerank_model, "rerank-v2");
  assert.equal(body.fractional_threshold, 0.35);
  assert.equal(body.request_id, "00000000-0000-4000-8000-000000000001");
  assert.equal(result.providerRequestId, "provider-retrieve-1");
});

test("knowledge tool persists request, provider, prompt and config metadata", async () => {
  const requestId = "00000000-0000-4000-8000-000000000001";
  const bodies: Array<Record<string, unknown>> = [];
  const result = await queryZhipuKnowledgeBase(
    "request correlation",
    {
      apiKey: "key",
      knowledgeId: "kb-1",
      requestId,
      configVersion: 3,
      promptProfile: { id: "rag-answer", version: 1 },
    },
    async (url, init) => {
      bodies.push(JSON.parse(String(init?.body || "{}")));
      if (String(url).includes("/knowledge/retrieve")) {
        return createJsonResponse({
          code: 200,
          data: [{ text: "fixture", score: 0.9, metadata: { doc_name: "fixture", doc_id: "doc-1" } }],
        }, 200, { "x-request-id": "provider-retrieve-1" });
      }
      return createJsonResponse({
        id: "provider-generate-1",
        choices: [{ message: { content: "answer" } }],
        usage: {},
      });
    },
  );
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].request_id, requestId);
  assert.equal(bodies[1].request_id, requestId);
  assert.equal(result.requestId, requestId);
  assert.equal(result.providerRequestId, "provider-generate-1");
  assert.equal(result.retrievalProviderRequestId, "provider-retrieve-1");
  assert.equal(result.configVersion, 3);
  assert.equal(result.prompt.id, "rag-answer");
  assert.equal(result.prompt.version, 1);
  assert.match(result.prompt.hash, /^[0-9a-f]{64}$/);
});

test("knowledge tool rejects a forbidden production URL before fetch", async () => {
  let called = false;
  const result = await queryZhipuKnowledgeBase(
    "unsafe url",
    { apiKey: "key", knowledgeId: "kb-1", apiBaseUrl: "http://127.0.0.1:3000" },
    async () => {
      called = true;
      return createJsonResponse({});
    },
  );
  assert.equal(called, false);
  assert.equal(result.fallbackReason, "retrieval_failed");
  assert.equal(result.errorMessage, "knowledge_base_url_not_allowed");
});
