// ============================================================
// RAG Baseline Runner — 知识库评测闭环
// 对固定样本集执行单次 queryZhipuKnowledgeBase 调用，
// 复用 trace.chunks 计算命中率 / 引用 / 延迟等指标。
//
// 设计要点：
// - 每条样本仅触发一次知识库查询（内部已含检索 + 生成）
// - 通过 trace.chunks 复用检索结果，不再额外调用 retrieveKnowledgeChunks
// - 支持注入 query 函数，便于测试验证调用次数
// ============================================================

import { createHash } from "node:crypto";

import {
  queryZhipuKnowledgeBase,
  type ZhipuKnowledgeToolConfig,
  type ZhipuKnowledgeToolTrace,
  type KnowledgeChunk,
} from "../knowledge-tool.service";

// ── 样本与结果类型 ──────────────────────────────────────────

/** 单条评测样本 */
export type RagBaselineSample = {
  /** 样本唯一标识 */
  id: string;
  /** 提给知识库的问题 */
  question: string;
  /** 期望答案中应包含的关键词（用于评分） */
  expectedKeywords?: string[];
  /** 期望引用的文档名（用于引用准确率评分） */
  expectedDocs?: string[];
  /** 该问题在受控知识库中是否应当有答案 */
  expectAnswer?: boolean;
};

/** 单条样本评测结果 */
export type RagBaselineResult = {
  sampleId: string;
  question: string;
  answer: string;
  /** 检索到的 chunks（来自 trace，无二次检索） */
  chunks: KnowledgeChunk[];
  /** 引用 / 来源文档列表 */
  citations: string[];
  /** 端到端延迟（ms） */
  latencyMs: number;
  /** 命中率：expectedKeywords 中被 answer 覆盖的比例 0-1 */
  keywordHitRate: number;
  /** 引用准确率：expectedDocs 中被 chunks 覆盖的比例 0-1 */
  docRecallRate: number;
  /** 置信度 */
  confidence: ZhipuKnowledgeToolTrace["confidence"];
  /** 降级原因（如有） */
  fallbackReason?: string;
  /** 模型使用的 token 数 */
  totalTokens: number;
  /** 对“应有答案 / 应无答案”的判定是否正确 */
  answerableCorrect: boolean;
};

export type RagBaselineFingerprints = {
  dataset: string;
  knowledge: string;
  config: string;
  prompt: string;
  scorer: string;
};

/** 整批评测汇总 */
export type RagBaselineReport = {
  sampleCount: number;
  avgLatencyMs: number;
  avgKeywordHitRate: number;
  avgDocRecallRate: number;
  highConfidenceRate: number;
  fallbackRate: number;
  p95LatencyMs: number;
  avgTokens: number;
  answerableAccuracy: number;
  fingerprints: RagBaselineFingerprints;
  results: RagBaselineResult[];
};

export type RagBaselineRunMetadata = {
  datasetFingerprint?: string;
  knowledgeFingerprint?: string;
};

// ── 评分工具函数 ─────────────────────────────────────────────

/** 计算关键词命中率 */
export function computeKeywordHitRate(answer: string, expectedKeywords: string[]): number {
  if (expectedKeywords.length === 0) return 1;
  const lower = answer.toLowerCase();
  const hits = expectedKeywords.filter((kw) => lower.includes(kw.toLowerCase()));
  return hits.length / expectedKeywords.length;
}

/** 计算文档引用召回率 */
export function computeDocRecallRate(chunks: KnowledgeChunk[], expectedDocs: string[]): number {
  if (expectedDocs.length === 0) return 1;
  const chunkDocs = chunks.map((c) => c.docName.toLowerCase());
  const hits = expectedDocs.filter((d) => {
    const expected = d.toLowerCase();
    return chunkDocs.some((actual) => actual === expected || actual.includes(expected) || expected.includes(actual));
  });
  return hits.length / expectedDocs.length;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function p95(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function safeConfigFingerprint(config: ZhipuKnowledgeToolConfig): string {
  return sha256(JSON.stringify({
    model: config.model || "",
    apiBaseUrl: config.apiBaseUrl || "",
    retrievalParams: config.retrievalParams || {},
    promptProfile: config.promptProfile || {},
    configVersion: config.configVersion || 0,
    hasCredential: Boolean(config.apiKey),
  }));
}

// ── 查询函数类型（可注入，便于测试） ─────────────────────────

export type KnowledgeQueryFn = (
  query: string,
  config?: ZhipuKnowledgeToolConfig
) => Promise<ZhipuKnowledgeToolTrace>;

// ── Runner ────────────────────────────────────────────────────

/**
 * 执行 RAG baseline 评测。
 *
 * @param samples 评测样本集
 * @param config 知识库配置（apiKey / knowledgeId 等）
 * @param queryFn 可注入的查询函数，默认使用 queryZhipuKnowledgeBase
 *                注入后可用于断言每条样本仅触发一次检索
 */
export async function runRagBaseline(
  samples: RagBaselineSample[],
  config: ZhipuKnowledgeToolConfig = {},
  queryFn: KnowledgeQueryFn = (q, conf) => queryZhipuKnowledgeBase(q, conf),
  metadata: RagBaselineRunMetadata = {},
): Promise<RagBaselineReport> {
  const results: RagBaselineResult[] = [];
  let promptFingerprint = "";

  for (const sample of samples) {
    // 每条样本仅调用一次 queryFn（内部已包含检索 + 生成）
    const trace = await queryFn(sample.question, config);

    // 从 trace 复用 chunks，不做二次检索
    const chunks: KnowledgeChunk[] = trace.chunks ?? [];

    const citations = [...new Set(chunks.map((c) => c.docName).filter(Boolean))];

    const keywordHitRate = computeKeywordHitRate(
      trace.answer,
      sample.expectedKeywords ?? []
    );

    const docRecallRate = computeDocRecallRate(chunks, sample.expectedDocs ?? []);
    if (!promptFingerprint && trace.prompt?.hash) promptFingerprint = trace.prompt.hash;
    const answerableCorrect = sample.expectAnswer === false
      ? trace.fallbackReason === "retrieval_empty" || /未找到|未检索到|没有相关内容/.test(trace.answer)
      : !trace.fallbackReason && keywordHitRate > 0;

    results.push({
      sampleId: sample.id,
      question: sample.question,
      answer: trace.answer,
      chunks,
      citations,
      latencyMs: trace.latencyMs,
      keywordHitRate,
      docRecallRate,
      confidence: trace.confidence,
      fallbackReason: trace.fallbackReason,
      totalTokens: trace.totalTokens,
      answerableCorrect,
    });
  }

  const n = results.length;
  const denominator = n || 1;
  const datasetFingerprint = metadata.datasetFingerprint || sha256(JSON.stringify(samples));
  const knowledgeFingerprint = metadata.knowledgeFingerprint || sha256(String(config.knowledgeId || "unconfigured"));
  return {
    sampleCount: n,
    avgLatencyMs: results.reduce((s, r) => s + r.latencyMs, 0) / denominator,
    avgKeywordHitRate: results.reduce((s, r) => s + r.keywordHitRate, 0) / denominator,
    avgDocRecallRate: results.reduce((s, r) => s + r.docRecallRate, 0) / denominator,
    highConfidenceRate: results.filter((r) => r.confidence === "high").length / denominator,
    fallbackRate: results.filter((r) => r.fallbackReason != null).length / denominator,
    p95LatencyMs: p95(results.map((item) => item.latencyMs)),
    avgTokens: results.reduce((sum, item) => sum + item.totalTokens, 0) / denominator,
    answerableAccuracy: results.filter((item) => item.answerableCorrect).length / denominator,
    fingerprints: {
      dataset: datasetFingerprint,
      knowledge: knowledgeFingerprint,
      config: safeConfigFingerprint(config),
      prompt: promptFingerprint || sha256(JSON.stringify(config.promptProfile || { id: "rag-answer", version: 1 })),
      scorer: sha256("wes-rag-scorer-v1:keyword-doc-answerable-p95-token"),
    },
    results,
  };
}
