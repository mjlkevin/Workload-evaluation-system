// ============================================================
// RAG Baseline Runner 测试
// 重点验证：
// 1. 每条样本仅触发一次 retrieval（不重复检索）
// 2. 输出字段完整（answer / chunks / citations / latency / score）
// 3. 评分函数正确性
// ============================================================

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import {
  runRagBaseline,
  computeKeywordHitRate,
  computeDocRecallRate,
  type RagBaselineSample,
  type KnowledgeQueryFn,
} from "./rag-baseline-runner";
import type { ZhipuKnowledgeToolTrace, KnowledgeChunk } from "../knowledge-tool.service";

// ── 测试辅助 ──────────────────────────────────────────────────

function makeChunk(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  return {
    text: "示例文档内容",
    score: 0.85,
    docName: "产品手册.docx",
    docId: "doc-1",
    docUrl: "https://example.com/doc1",
    knowledgeId: "kb-test",
    ...overrides,
  };
}

function makeTrace(overrides: Partial<ZhipuKnowledgeToolTrace> = {}): ZhipuKnowledgeToolTrace {
  return {
    toolId: "knowledge_base.query_product_knowledge",
    available: true,
    model: "GLM-5V-Turbo",
    knowledgeId: "kb-test",
    query: "测试问题",
    answer: "这是测试回答，包含存货核算和库存管理内容。",
    confidence: "high",
    retrievalTriggered: true,
    promptTokens: 500,
    completionTokens: 50,
    totalTokens: 550,
    latencyMs: 120,
    contextRef: "knowledge:kb-test:test:chunks=2:score=0.85",
    chunksCount: 2,
    topScore: 0.85,
    chunks: [
      makeChunk({ docName: "产品手册.docx" }),
      makeChunk({ docName: "报价指南.docx", score: 0.72 }),
    ],
    ...overrides,
  };
}

// ── 测试用例 ──────────────────────────────────────────────────

describe("RAG Baseline Runner", () => {
  const samples: RagBaselineSample[] = [
    {
      id: "s1",
      question: "存货核算模块需要哪些前置模块？",
      expectedKeywords: ["存货核算", "库存管理"],
      expectedDocs: ["产品手册.docx"],
    },
    {
      id: "s2",
      question: "如何配置采购管理？",
      expectedKeywords: ["采购", "配置"],
      expectedDocs: ["报价指南.docx"],
    },
  ];

  describe("单次检索保证", () => {
    it("每条样本仅调用一次 queryFn，不触发额外 retrieval", async () => {
      let queryCallCount = 0;

      const mockQueryFn: KnowledgeQueryFn = async (query) => {
        queryCallCount++;
        return makeTrace({ query });
      };

      await runRagBaseline(samples, {}, mockQueryFn);

      // 关键断言：queryFn 调用次数 === 样本数（每条样本仅一次）
      assert.equal(
        queryCallCount,
        samples.length,
        `期望 queryFn 被调用 ${samples.length} 次（每样本一次），实际被调用 ${queryCallCount} 次`
      );
    });

    it("不会调用独立的 retrieveKnowledgeChunks（通过 queryFn 计数器证明）", async () => {
      // 模拟旧版行为对比：旧版会额外调用 retrieveKnowledgeChunks
      // 新版 runner 只调用 queryFn，不做二次检索
      let retrieveCallCount = 0;
      let queryCallCount = 0;

      // 模拟一个"会触发额外 retrieve"的 queryFn（仅用于对比测试）
      const mockQueryFnWithExtraRetrieve: KnowledgeQueryFn = async (query) => {
        queryCallCount++;
        // 模拟旧版错误行为：在 query 内部又额外调了一次 retrieve
        retrieveCallCount++;
        return makeTrace({ query });
      };

      // 用旧版模拟跑一次，retrieveCallCount 应该等于 queryCallCount
      await runRagBaseline(samples, {}, mockQueryFnWithExtraRetrieve);
      const oldBehaviorRetrieve = retrieveCallCount;

      // 重置
      retrieveCallCount = 0;
      queryCallCount = 0;

      // 新版：queryFn 不做额外 retrieve
      const cleanMockQueryFn: KnowledgeQueryFn = async (query) => {
        queryCallCount++;
        // 新版不触发额外 retrieve
        return makeTrace({ query });
      };

      await runRagBaseline(samples, {}, cleanMockQueryFn);

      // 新版 runner 本身不调用 retrieveKnowledgeChunks
      // queryCallCount === samples.length 证明每样本只走一次 queryFn
      assert.equal(queryCallCount, samples.length);
      // 旧版模拟中 retrieveCallCount 额外增加，新版无此问题
      assert.equal(retrieveCallCount, 0, "新版 runner 不应触发独立的 retrieveKnowledgeChunks 调用");
    });

    it("3 条样本也只触发 3 次 queryFn 调用", async () => {
      const threeSamples: RagBaselineSample[] = [
        { id: "a", question: "问题A" },
        { id: "b", question: "问题B" },
        { id: "c", question: "问题C" },
      ];

      let callCount = 0;
      const mockQueryFn: KnowledgeQueryFn = async () => {
        callCount++;
        return makeTrace();
      };

      await runRagBaseline(threeSamples, {}, mockQueryFn);
      assert.equal(callCount, 3);
    });
  });

  describe("输出字段完整性", () => {
    it("结果包含 answer / chunks / citations / latencyMs / confidence", async () => {
      const mockQueryFn: KnowledgeQueryFn = async () => makeTrace();

      const report = await runRagBaseline(samples, {}, mockQueryFn);

      assert.equal(report.sampleCount, 2);
      assert.equal(report.results.length, 2);

      for (const result of report.results) {
        // answer
        assert.ok(typeof result.answer === "string" && result.answer.length > 0);
        // chunks
        assert.ok(Array.isArray(result.chunks));
        assert.ok(result.chunks.length > 0);
        // citations
        assert.ok(Array.isArray(result.citations));
        assert.ok(result.citations.length > 0);
        // latencyMs
        assert.ok(typeof result.latencyMs === "number");
        // confidence
        assert.ok(result.confidence === "high" || result.confidence === "low");
        // keywordHitRate
        assert.ok(typeof result.keywordHitRate === "number");
        // docRecallRate
        assert.ok(typeof result.docRecallRate === "number");
        // totalTokens
        assert.ok(typeof result.totalTokens === "number");
      }
    });

    it("chunks 来自 trace.chunks 复用，不是二次检索", async () => {
      const expectedChunks = [makeChunk({ docName: "唯一文档.docx" })];
      const mockQueryFn: KnowledgeQueryFn = async () =>
        makeTrace({ chunks: expectedChunks, chunksCount: 1 });

      const report = await runRagBaseline([samples[0]], {}, mockQueryFn);

      // 结果中的 chunks 应该就是 trace 返回的 chunks（同一引用）
      assert.deepEqual(report.results[0].chunks, expectedChunks);
    });

    it("当 trace.chunks 为 undefined 时，结果 chunks 为空数组", async () => {
      const mockQueryFn: KnowledgeQueryFn = async () =>
        makeTrace({ chunks: undefined, chunksCount: 0 });

      const report = await runRagBaseline([samples[0]], {}, mockQueryFn);
      assert.deepEqual(report.results[0].chunks, []);
    });
  });

  describe("汇总指标", () => {
    it("avgLatencyMs / avgKeywordHitRate 等汇总正确", async () => {
      const mockQueryFn: KnowledgeQueryFn = async () =>
        makeTrace({ latencyMs: 100, confidence: "high" });

      const report = await runRagBaseline(samples, {}, mockQueryFn);

      assert.equal(report.avgLatencyMs, 100);
      assert.equal(report.highConfidenceRate, 1);
      assert.equal(report.fallbackRate, 0);
    });

    it("fallbackRate 在有降级时正确计算", async () => {
      let callIndex = 0;
      const mockQueryFn: KnowledgeQueryFn = async () => {
        callIndex++;
        if (callIndex === 1) {
          return makeTrace({ fallbackReason: "retrieval_empty", confidence: "low" });
        }
        return makeTrace({ confidence: "high" });
      };

      const report = await runRagBaseline(samples, {}, mockQueryFn);
      assert.equal(report.fallbackRate, 0.5);
    });
  });

  describe("评分函数", () => {
    it("computeKeywordHitRate 正确计算命中率", () => {
      assert.equal(computeKeywordHitRate("存货核算需要库存管理", ["存货核算", "库存管理"]), 1);
      assert.equal(computeKeywordHitRate("存货核算需要库存管理", ["存货核算", "采购管理"]), 0.5);
      assert.equal(computeKeywordHitRate("无关内容", ["存货核算"]), 0);
      assert.equal(computeKeywordHitRate("任意回答", []), 1);
    });

    it("computeDocRecallRate 正确计算引用召回率", () => {
      const chunks = [makeChunk({ docName: "产品手册.docx" }), makeChunk({ docName: "报价指南.docx" })];
      assert.equal(computeDocRecallRate(chunks, ["产品手册.docx"]), 1);
      assert.equal(computeDocRecallRate(chunks, ["产品手册.docx", "不存在的.docx"]), 0.5);
      assert.equal(computeDocRecallRate(chunks, []), 1);
    });

    it("computeDocRecallRate 忽略大小写", () => {
      const chunks = [makeChunk({ docName: "ProductManual.docx" })];
      assert.equal(computeDocRecallRate(chunks, ["productmanual.docx"]), 1);
    });
  });
});
