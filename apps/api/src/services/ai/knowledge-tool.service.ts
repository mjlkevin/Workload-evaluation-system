// ============================================================
// WES 知识库工具服务 — 两阶段检索架构
// 阶段一：直接调用智谱 /llm-application/open/knowledge/retrieve API
//         支持混合检索（向量+关键词）、重排、相似度阈值
// 阶段二：将检索结果注入 prompt，让模型基于真实文档回答
// ============================================================

import type { KnowledgePromptProfile, KnowledgeRetrievalParams } from "../../types";
import {
  DEFAULT_KNOWLEDGE_PROMPT_PROFILE,
  normalizeKnowledgeRetrievalParams,
} from "../../modules/system/system.repository";
import { assertAllowedZhipuUrl } from "./knowledge-base-url-policy";
import { renderPrompt, resolvePrompt, type RagPromptVersion } from "./rag-eval/prompt-registry";

export type KnowledgeToolConfidence = "high" | "low";

export type KnowledgeToolFallbackReason =
  | "missing_config"
  | "retrieval_empty"
  | "retrieval_failed"
  | "answer_failed"
  | "empty_answer";

export type ZhipuKnowledgeToolConfig = {
  apiKey?: string;
  knowledgeId?: string;
  model?: string;
  apiBaseUrl?: string;
  retrievalParams?: Partial<KnowledgeRetrievalParams>;
  promptProfile?: Partial<KnowledgePromptProfile>;
  promptRegistryPath?: string;
  configVersion?: number;
  requestId?: string;
};

/** 知识库检索返回的单个知识片段 */
export type KnowledgeChunk = {
  text: string;
  score: number;
  docName: string;
  docId: string;
  docUrl: string;
  knowledgeId: string;
};

/** 知识库检索结果 */
export type KnowledgeRetrieveResult = {
  chunks: KnowledgeChunk[];
  latencyMs: number;
  statusCode: number;
  errorMessage?: string;
  providerRequestId?: string;
};

export type ZhipuKnowledgeToolTrace = {
  toolId: "knowledge_base.query_product_knowledge";
  available: boolean;
  model: string;
  knowledgeId: string;
  query: string;
  answer: string;
  confidence: KnowledgeToolConfidence;
  retrievalTriggered: boolean;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  contextRef: string;
  fallbackReason?: KnowledgeToolFallbackReason;
  statusCode?: number;
  errorMessage?: string;
  /** 检索到的知识片段数量 */
  chunksCount: number;
  /** 最高相似度分数 */
  topScore: number;
  /** 检索到的知识片段（供 baseline runner 等下游复用，避免重复检索） */
  chunks?: KnowledgeChunk[];
  requestId?: string;
  providerRequestId?: string;
  retrievalProviderRequestId?: string;
  configVersion?: number;
  prompt: Pick<RagPromptVersion, "id" | "version" | "hash">;
  retrievalParams: KnowledgeRetrievalParams;
  knowledgeBaseProfileId?: string;
  knowledgeBaseName?: string;
  route?: {
    mode: "explicit" | "rule" | "model" | "default" | "unresolved";
    confidence: number;
    reason: string;
    primaryProfileId?: string;
    fallbackProfileId?: string;
    attempts: Array<{
      profileId: string;
      fallbackReason?: KnowledgeToolFallbackReason;
      chunksCount: number;
      topScore: number;
      contextRef?: string;
    }>;
  };
};

const TOOL_ID = "knowledge_base.query_product_knowledge" as const;
const DEFAULT_MODEL = "GLM-5V-Turbo";
const DEFAULT_API_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

// 检索 API 使用 /api/ 根路径（不含 /paas/v4）
const RETRIEVE_API_PATH = "/llm-application/open/knowledge/retrieve";

function cleanConfigValue(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const raw = cleanConfigValue(value) || DEFAULT_API_BASE_URL;
  return raw.replace(/\/+$/, "");
}

function normalizePromptProfile(value: Partial<KnowledgePromptProfile> | undefined): KnowledgePromptProfile {
  const id = typeof value?.id === "string" && value.id.trim()
    ? value.id.trim()
    : DEFAULT_KNOWLEDGE_PROMPT_PROFILE.id;
  const version = Number.isInteger(Number(value?.version)) && Number(value?.version) > 0
    ? Math.trunc(Number(value?.version))
    : DEFAULT_KNOWLEDGE_PROMPT_PROFILE.version;
  return { id, version };
}

function resolvePromptMetadata(config: ZhipuKnowledgeToolConfig): RagPromptVersion {
  const profile = normalizePromptProfile(config.promptProfile);
  return resolvePrompt(profile.id, profile.version, config.promptRegistryPath);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string {
  if (value == null || typeof value === "object" || typeof value === "boolean") return "";
  return String(value).trim();
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function extractAnswer(payload: unknown): string {
  const root = asRecord(payload);
  const choices = Array.isArray(root.choices) ? root.choices : [];
  for (const choice of choices) {
    const record = asRecord(choice);
    const messageContent = asString(asRecord(record.message).content);
    if (messageContent) return messageContent;
    const text = asString(record.text);
    if (text) return text;
  }
  return asString(root.answer || root.output_text || root.output);
}

function extractPromptTokens(payload: unknown): number {
  const usage = asRecord(asRecord(payload).usage);
  return asNumber(usage.prompt_tokens ?? usage.promptTokens);
}

function extractCompletionTokens(payload: unknown): number {
  const usage = asRecord(asRecord(payload).usage);
  return asNumber(usage.completion_tokens ?? usage.completionTokens);
}

function extractTotalTokens(payload: unknown, promptTokens: number, completionTokens: number): number {
  const usage = asRecord(asRecord(payload).usage);
  return asNumber(usage.total_tokens ?? usage.totalTokens) || promptTokens + completionTokens;
}

function extractErrorMessage(payload: unknown): string {
  const root = asRecord(payload);
  return asString(asRecord(root.error).message || root.message || root.msg || root.error);
}

function extractProviderRequestId(response: Response, payload: unknown): string | undefined {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const fromHeaders = response.headers.get("x-request-id")
    || response.headers.get("x-zhipu-request-id")
    || response.headers.get("x-ratelimit-request-id");
  const value = cleanConfigValue(fromHeaders || asString(root.request_id || root.requestId || root.id || data.request_id));
  return value ? value.slice(0, 128) : undefined;
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function buildContextRef(knowledgeId: string, query: string, chunksCount: number, topScore: number): string {
  const queryRef = encodeURIComponent(query.trim().replace(/\s+/g, " ").slice(0, 24)) || "empty";
  return `knowledge:${knowledgeId}:${queryRef}:chunks=${chunksCount}:score=${topScore.toFixed(2)}`;
}

function lowConfidenceTrace(input: {
  model: string;
  knowledgeId: string;
  query: string;
  answer: string;
  fallbackReason: KnowledgeToolFallbackReason;
  available: boolean;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  contextRef: string;
  retrievalTriggered?: boolean;
  statusCode?: number;
  errorMessage?: string;
  chunksCount?: number;
  topScore?: number;
  chunks?: KnowledgeChunk[];
  requestId?: string;
  providerRequestId?: string;
  retrievalProviderRequestId?: string;
  configVersion?: number;
  prompt: Pick<RagPromptVersion, "id" | "version" | "hash">;
  retrievalParams: KnowledgeRetrievalParams;
}): ZhipuKnowledgeToolTrace {
  return {
    toolId: TOOL_ID,
    available: input.available,
    model: input.model,
    knowledgeId: input.knowledgeId,
    query: input.query,
    answer: input.answer,
    confidence: "low",
    retrievalTriggered: input.retrievalTriggered ?? false,
    promptTokens: input.promptTokens ?? 0,
    completionTokens: input.completionTokens ?? 0,
    totalTokens: input.totalTokens ?? 0,
    latencyMs: input.latencyMs ?? 0,
    contextRef: input.contextRef,
    fallbackReason: input.fallbackReason,
    statusCode: input.statusCode,
    errorMessage: input.errorMessage,
    chunksCount: input.chunksCount ?? 0,
    topScore: input.topScore ?? 0,
    ...(input.chunks ? { chunks: input.chunks } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.providerRequestId ? { providerRequestId: input.providerRequestId } : {}),
    ...(input.retrievalProviderRequestId ? { retrievalProviderRequestId: input.retrievalProviderRequestId } : {}),
    ...(input.configVersion ? { configVersion: input.configVersion } : {}),
    prompt: input.prompt,
    retrievalParams: input.retrievalParams,
  };
}

/**
 * 阶段一：直接调用智谱知识库检索 API
 * POST /llm-application/open/knowledge/retrieve
 * 支持混合检索（向量+关键词）、重排模型、相似度阈值
 */
export async function retrieveKnowledgeChunks(
  query: string,
  config: ZhipuKnowledgeToolConfig,
  fetcher: typeof fetch = globalThis.fetch
): Promise<KnowledgeRetrieveResult> {
  const startedAt = Date.now();
  const apiKey = cleanConfigValue(config.apiKey);
  const knowledgeId = cleanConfigValue(config.knowledgeId);
  const apiBaseUrl = normalizeApiBaseUrl(config.apiBaseUrl);
  const retrievalParams = normalizeKnowledgeRetrievalParams(config.retrievalParams);

  // 检索 API 使用 /api/ 根路径，需要去掉 /paas/v4 后缀
  const retrieveBaseUrl = apiBaseUrl.replace(/\/paas\/v\d+$/, "");

  if (!apiKey || !knowledgeId) {
    return {
      chunks: [],
      latencyMs: Date.now() - startedAt,
      statusCode: 0,
      errorMessage: "missing_config",
    };
  }

  try {
    const retrieveUrl = `${retrieveBaseUrl}${RETRIEVE_API_PATH}`;
    assertAllowedZhipuUrl(retrieveUrl);
    const response = await fetcher(retrieveUrl, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        knowledge_ids: [knowledgeId],
        top_k: retrievalParams.topK,
        top_n: retrievalParams.topN,
        recall_method: retrievalParams.recallMethod,
        rerank_status: retrievalParams.rerankStatus,
        rerank_model: retrievalParams.rerankModel,
        fractional_threshold: retrievalParams.fractionalThreshold,
        ...(cleanConfigValue(config.requestId) ? { request_id: cleanConfigValue(config.requestId) } : {}),
      }),
    });

    const payload = await readJsonSafely(response);
    const providerRequestId = extractProviderRequestId(response, payload);

    if (!response.ok) {
      return {
        chunks: [],
        latencyMs: Date.now() - startedAt,
        statusCode: response.status,
        errorMessage: extractErrorMessage(payload) || response.statusText,
        ...(providerRequestId ? { providerRequestId } : {}),
      };
    }

    // 检查业务层 code（智谱 API 可能返回 HTTP 200 + body code=500）
    const root = asRecord(payload);
    const businessCode = asNumber(root.code);
    if (businessCode && businessCode !== 200) {
      return {
        chunks: [],
        latencyMs: Date.now() - startedAt,
        statusCode: businessCode,
        errorMessage: asString(root.message) || `business_error_${businessCode}`,
        ...(providerRequestId ? { providerRequestId } : {}),
      };
    }

    // 解析响应: { code: 200, data: [{ text, score, metadata: { doc_name, doc_id, doc_url, knowledge_id } }] }
    const dataArray = Array.isArray(root.data) ? root.data : [];
    const chunks: KnowledgeChunk[] = dataArray.map((item: unknown) => {
      const record = asRecord(item);
      const metadata = asRecord(record.metadata);
      return {
        text: asString(record.text),
        score: asNumber(record.score),
        docName: asString(metadata.doc_name || record.doc_name),
        docId: asString(metadata.doc_id || record.doc_id),
        docUrl: asString(metadata.doc_url || record.doc_url),
        knowledgeId: asString(metadata.knowledge_id || metadata.know_id || knowledgeId),
      };
    }).filter((c: KnowledgeChunk) => c.text.length > 0);

    return {
      chunks,
      latencyMs: Date.now() - startedAt,
      statusCode: response.status,
      ...(providerRequestId ? { providerRequestId } : {}),
    };
  } catch (error) {
    return {
      chunks: [],
      latencyMs: Date.now() - startedAt,
      statusCode: 0,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 阶段二：基于检索结果，调用模型生成回答
 * 将知识片段注入 system prompt，让模型基于真实文档回答
 */
async function generateAnswerFromChunks(
  query: string,
  chunks: KnowledgeChunk[],
  config: ZhipuKnowledgeToolConfig,
  fetcher: typeof fetch
): Promise<{
  answer: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  providerRequestId?: string;
  prompt: RagPromptVersion;
}> {
  const startedAt = Date.now();
  const apiKey = cleanConfigValue(config.apiKey);
  const model = cleanConfigValue(config.model) || DEFAULT_MODEL;
  const apiBaseUrl = normalizeApiBaseUrl(config.apiBaseUrl);

  // 构建带文档来源标注的上下文
  const contextText = chunks
    .map((c, i) => `[文档${i + 1}] ${c.docName}\n${c.text}`)
    .join("\n\n---\n\n");

  const prompt = resolvePromptMetadata(config);
  const systemPrompt = renderPrompt(prompt, { context: contextText });

  const answerUrl = `${apiBaseUrl}/chat/completions`;
  assertAllowedZhipuUrl(answerUrl);
  const response = await fetcher(answerUrl, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: query },
      ],
      ...(cleanConfigValue(config.requestId) ? { request_id: cleanConfigValue(config.requestId) } : {}),
    }),
  });

  const payload = await readJsonSafely(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload) || response.statusText || `http_${response.status}`);
  }
  const answer = extractAnswer(payload);
  const promptTokens = extractPromptTokens(payload);
  const completionTokens = extractCompletionTokens(payload);
  const totalTokens = extractTotalTokens(payload, promptTokens, completionTokens);

  const providerRequestId = extractProviderRequestId(response, payload);
  return {
    answer,
    promptTokens,
    completionTokens,
    totalTokens,
    latencyMs: Date.now() - startedAt,
    ...(providerRequestId ? { providerRequestId } : {}),
    prompt,
  };
}

/**
 * 两阶段知识库查询：先检索，再生成
 */
export async function queryZhipuKnowledgeBase(
  query: string,
  config: ZhipuKnowledgeToolConfig = {},
  fetcher: typeof fetch = globalThis.fetch
): Promise<ZhipuKnowledgeToolTrace> {
  const startedAt = Date.now();
  const apiKey = cleanConfigValue(config.apiKey);
  const knowledgeId = cleanConfigValue(config.knowledgeId);
  const model = cleanConfigValue(config.model) || DEFAULT_MODEL;
  const requestId = cleanConfigValue(config.requestId);
  const retrievalParams = normalizeKnowledgeRetrievalParams(config.retrievalParams);
  const promptProfile = normalizePromptProfile(config.promptProfile);
  let prompt: Pick<RagPromptVersion, "id" | "version" | "hash">;
  try {
    const resolved = resolvePromptMetadata(config);
    prompt = { id: resolved.id, version: resolved.version, hash: resolved.hash };
  } catch (error) {
    return lowConfidenceTrace({
      model,
      knowledgeId,
      query,
      available: Boolean(apiKey && knowledgeId),
      fallbackReason: "answer_failed",
      answer: "知识库回答模板不存在，请管理员检查 Prompt 版本配置。",
      contextRef: `knowledge:${knowledgeId || "unconfigured"}:prompt-unavailable`,
      errorMessage: error instanceof Error ? error.message : String(error),
      ...(requestId ? { requestId } : {}),
      ...(config.configVersion ? { configVersion: config.configVersion } : {}),
      prompt: { id: promptProfile.id, version: promptProfile.version, hash: "unresolved" },
      retrievalParams,
    });
  }
  const traceMetadata = {
    ...(requestId ? { requestId } : {}),
    ...(config.configVersion ? { configVersion: config.configVersion } : {}),
    prompt,
    retrievalParams,
  };

  if (!apiKey || !knowledgeId) {
    return lowConfidenceTrace({
      model,
      knowledgeId,
      query,
      available: false,
      fallbackReason: "missing_config",
      answer: "知识库功能尚未配置（缺少 API Key 或知识库 ID），无法检索真实文档。建议管理员在系统管理 → 知识库中补充配置后重试。",
      contextRef: `knowledge:${knowledgeId || "unconfigured"}:unavailable`,
      ...traceMetadata,
    });
  }

  // 阶段一：直接检索
  const retrieveResult = await retrieveKnowledgeChunks(query, config, fetcher);

  if (retrieveResult.statusCode !== 200 || retrieveResult.chunks.length === 0) {
    const isServiceError = Boolean(retrieveResult.errorMessage)
      || (retrieveResult.statusCode !== 0 && retrieveResult.statusCode !== 200);
    return lowConfidenceTrace({
      model,
      knowledgeId,
      query,
      available: true,
      fallbackReason: isServiceError ? "retrieval_failed" : (retrieveResult.chunks.length === 0 ? "retrieval_empty" : "retrieval_failed"),
      answer: isServiceError
        ? `知识库检索服务异常（HTTP ${retrieveResult.statusCode}）：${retrieveResult.errorMessage || "未知错误"}，请稍后重试。`
        : "知识库中未检索到与当前问题相关的文档内容。建议调整问题表述或确认知识库已上传相关文档。",
      latencyMs: Date.now() - startedAt,
      contextRef: buildContextRef(knowledgeId, query, 0, 0),
      statusCode: retrieveResult.statusCode || undefined,
      errorMessage: retrieveResult.errorMessage,
      chunksCount: 0,
      topScore: 0,
      ...(retrieveResult.providerRequestId ? { retrievalProviderRequestId: retrieveResult.providerRequestId } : {}),
      ...traceMetadata,
    });
  }

  const topScore = Math.max(...retrieveResult.chunks.map((c) => c.score));
  const chunksCount = retrieveResult.chunks.length;

  // 阶段二：基于检索结果生成回答
  try {
    const { answer, promptTokens, completionTokens, totalTokens, providerRequestId, prompt: answerPrompt } =
      await generateAnswerFromChunks(query, retrieveResult.chunks, config, fetcher);
    const answerPromptMetadata = { id: answerPrompt.id, version: answerPrompt.version, hash: answerPrompt.hash };

    if (!answer) {
      return lowConfidenceTrace({
        model,
        knowledgeId,
        query,
        available: true,
        fallbackReason: "empty_answer",
        answer: "模型未返回有效回答，但已成功检索到知识文档。",
        promptTokens,
        completionTokens,
        totalTokens,
        latencyMs: Date.now() - startedAt,
        contextRef: buildContextRef(knowledgeId, query, chunksCount, topScore),
        retrievalTriggered: true,
        chunksCount,
        topScore,
        chunks: retrieveResult.chunks,
        ...(providerRequestId ? { providerRequestId } : {}),
        ...(retrieveResult.providerRequestId ? { retrievalProviderRequestId: retrieveResult.providerRequestId } : {}),
        ...traceMetadata,
        prompt: answerPromptMetadata,
      });
    }

    // 置信度：最高相似度足够高即可认为检索质量高
    const confidence: KnowledgeToolConfidence = topScore > 0.5 ? "high" : "low";

    return {
      toolId: TOOL_ID,
      available: true,
      model,
      knowledgeId,
      query,
      answer,
      confidence,
      retrievalTriggered: true,
      promptTokens,
      completionTokens,
      totalTokens,
      latencyMs: Date.now() - startedAt,
      contextRef: buildContextRef(knowledgeId, query, chunksCount, topScore),
      chunksCount,
      topScore,
      chunks: retrieveResult.chunks,
      ...(providerRequestId ? { providerRequestId } : {}),
      ...(retrieveResult.providerRequestId ? { retrievalProviderRequestId: retrieveResult.providerRequestId } : {}),
      ...traceMetadata,
      prompt: answerPromptMetadata,
    };
  } catch (error) {
    // 检索成功但生成失败：返回检索摘要作为降级回答
    const summary = retrieveResult.chunks
      .slice(0, 3)
      .map((c, i) => `[文档${i + 1}] ${c.docName}（相关度${c.score.toFixed(2)}）：${c.text.slice(0, 200)}...`)
      .join("\n\n");

    return lowConfidenceTrace({
      model,
      knowledgeId,
      query,
      available: true,
      fallbackReason: "answer_failed",
      answer: `模型回答生成失败，但已检索到以下相关文档供参考：\n\n${summary}`,
      latencyMs: Date.now() - startedAt,
      contextRef: buildContextRef(knowledgeId, query, chunksCount, topScore),
      retrievalTriggered: true,
      errorMessage: error instanceof Error ? error.message : String(error),
      chunksCount,
      topScore,
      chunks: retrieveResult.chunks,
      ...(retrieveResult.providerRequestId ? { retrievalProviderRequestId: retrieveResult.providerRequestId } : {}),
      ...traceMetadata,
    });
  }
}
