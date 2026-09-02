import type { KnowledgeBaseConfig, KnowledgeBaseProbeRecord } from "../../types";
import { assertAllowedZhipuUrl } from "../../services/ai/knowledge-base-url-policy";

const RETRIEVE_API_PATH = "/llm-application/open/knowledge/retrieve";

export type KnowledgeBaseProbeResult = Omit<KnowledgeBaseProbeRecord, "configHash" | "checkedAt">;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asBusinessCode(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asProviderMessage(value: unknown): string | undefined {
  const text = asString(value);
  return text ? text.slice(0, 200) : undefined;
}

async function readJsonSafely(response: Response): Promise<Record<string, unknown>> {
  try {
    return asRecord(await response.json());
  } catch {
    return {};
  }
}

function providerRequestId(response: Response, payload: Record<string, unknown>): string | undefined {
  const value = response.headers.get("x-request-id")
    || response.headers.get("x-zhipu-request-id")
    || asString(payload.request_id)
    || asString(payload.requestId)
    || asString(payload.id);
  return value ? value.slice(0, 128) : undefined;
}

// HTTP 状态分类（网络/网关语义），与供应商业务码分开，不得共用。
function classifyHttpFailure(status: number): string {
  if (status === 401 || status === 403) return "authentication_failed";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  return "provider_rejected";
}

// 供应商业务码分类（智谱一律 HTTP 200、错误码在响应体）。映射仅建立在
// 已取证事实之上（DEF-2026-09-02-001 逐参数二分）：401=令牌无效、
// 100013=字段错误、500=无 msg 的拒绝；无依据的码归 unknown 并原样带出。
function classifyBusinessFailure(code: number): string {
  if (code === 401) return "authentication_failed";
  if (code === 100013) return "invalid_arguments";
  if (code === 500) return "provider_unspecified_rejection";
  return "unknown";
}

function resolveRetrieveUrl(apiBaseUrl: string): string {
  const parsed = assertAllowedZhipuUrl(apiBaseUrl);
  const base = parsed.toString().replace(/\/+$/, "").replace(/\/paas\/v\d+$/, "");
  return `${base}${RETRIEVE_API_PATH}`;
}

export async function probeKnowledgeBaseAccess(
  knowledgeConfig: KnowledgeBaseConfig,
  requestId?: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<KnowledgeBaseProbeResult> {
  const startedAt = Date.now();
  const apiKey = knowledgeConfig.credentials.apiKey.trim();
  const knowledgeId = knowledgeConfig.credentials.knowledgeId.trim();
  if (!apiKey || !knowledgeId) {
    return { status: "failure", latencyMs: Date.now() - startedAt, errorCode: "missing_config" };
  }

  let retrieveUrl: string;
  try {
    retrieveUrl = resolveRetrieveUrl(knowledgeConfig.apiBaseUrl);
  } catch {
    return { status: "failure", latencyMs: Date.now() - startedAt, errorCode: "unsafe_api_base_url" };
  }

  try {
    const params = knowledgeConfig.retrievalParams;
    const response = await fetcher(retrieveUrl, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: "知识库连通性测试",
        knowledge_ids: [knowledgeId],
        top_k: params.topK,
        top_n: params.topN,
        recall_method: params.recallMethod,
        rerank_status: params.rerankStatus,
        rerank_model: params.rerankModel,
        fractional_threshold: params.fractionalThreshold,
        ...(requestId ? { request_id: requestId } : {}),
      }),
    });
    const payload = await readJsonSafely(response);
    const requestIdFromProvider = providerRequestId(response, payload);
    if (!response.ok) {
      return {
        status: "failure",
        latencyMs: Date.now() - startedAt,
        providerRequestId: requestIdFromProvider,
        errorCode: classifyHttpFailure(response.status),
      };
    }
    const businessCode = asBusinessCode(payload.code);
    if (businessCode != null && businessCode !== 200) {
      return {
        status: "failure",
        latencyMs: Date.now() - startedAt,
        providerRequestId: requestIdFromProvider,
        providerCode: businessCode,
        ...(asProviderMessage(payload.msg ?? payload.message)
          ? { providerMessage: asProviderMessage(payload.msg ?? payload.message) }
          : {}),
        errorCode: classifyBusinessFailure(businessCode),
      };
    }
    const data = Array.isArray(payload.data) ? payload.data : [];
    return {
      status: "success",
      latencyMs: Date.now() - startedAt,
      providerRequestId: requestIdFromProvider,
      ...(data.length === 0 ? { warning: "retrieval_empty" as const } : {}),
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return {
      status: "failure",
      latencyMs: Date.now() - startedAt,
      errorCode: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network_error",
    };
  }
}
