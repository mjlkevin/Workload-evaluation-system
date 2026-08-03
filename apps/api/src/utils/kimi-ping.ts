/** 最小化调用 Moonshot/OpenAI 兼容接口，校验 API Key 是否可用 */

import { isKimiTemperatureMustBeOneError, resolveKimiCompletionTemperatureParam } from "./kimi-completion-params";

export type KimiPingFailureKind = "overload" | "rate_limited" | "quota_exceeded" | "auth" | "model_not_found" | "unknown";

export class KimiPingFailure extends Error {
  readonly kind: KimiPingFailureKind;
  readonly httpStatus: number;

  constructor(kind: KimiPingFailureKind, httpStatus: number, message: string) {
    super(message);
    this.name = "KimiPingFailure";
    this.kind = kind;
    this.httpStatus = httpStatus;
  }
}

function extractErrorMessage(bodyText: string, httpStatus: number): string {
  let msg = bodyText.slice(0, 500);
  try {
    const j = JSON.parse(bodyText) as { error?: { message?: string } };
    if (j?.error?.message) msg = j.error.message;
  } catch {
    /* ignore */
  }
  return msg || `HTTP ${httpStatus}`;
}

function classifyPingFailure(status: number, msg: string): KimiPingFailureKind {
  const t = msg.toLowerCase();
  if (/insufficient|balance|quota|credit|arrears|欠费|余额|额度|账户余额/i.test(msg)) return "quota_exceeded";
  if (status === 401) return "auth";
  if (status === 429) return "rate_limited";
  if (
    status === 503 ||
    t.includes("overloaded") ||
    t.includes("overload") ||
    t.includes("engine is currently overloaded") ||
    (t.includes("try again later") && (t.includes("engine") || t.includes("server") || t.includes("busy")))
  ) {
    return "overload";
  }
  if ((status === 400 || status === 404) && (t.includes("model") && (t.includes("not found") || t.includes("invalid") || t.includes("not exist") || t.includes("permission denied")))) {
    return "model_not_found";
  }
  return "unknown";
}

export interface KimiPingResult {
  /** API 响应体中返回的实际模型名 */
  respondedModel: string;
  /** 请求耗时（ms） */
  latencyMs: number;
  /** HTTP 状态码 */
  httpStatus: number;
}

export async function pingKimiChatCompletion(params: {
  apiUrl: string;
  apiKey: string;
  model: string;
}): Promise<KimiPingResult> {
  const baseUrl = String(params.apiUrl || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("apiUrl 为空");

  const model = String(params.model || "").trim() || "kimi-k2.5";
  let temperature = resolveKimiCompletionTemperatureParam(model, 0.3);
  const payload = () =>
    JSON.stringify({
      model,
      messages: [{ role: "user", content: "ping" }],
      max_completion_tokens: 1,
      ...(temperature === undefined ? {} : { temperature }),
    });

  const startedAt = Date.now();
  let res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: payload(),
  });

  if (!res.ok) {
    const text = await res.text();
    if (isKimiTemperatureMustBeOneError(res.status, text) && temperature !== 1) {
      temperature = 1;
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          "Content-Type": "application/json",
        },
        body: payload(),
      });
    } else {
      const msg = extractErrorMessage(text, res.status);
      const kind = classifyPingFailure(res.status, msg);
      throw new KimiPingFailure(kind, res.status, msg);
    }
  }

  if (!res.ok) {
    const text = await res.text();
    const msg = extractErrorMessage(text, res.status);
    const kind = classifyPingFailure(res.status, msg);
    throw new KimiPingFailure(kind, res.status, msg);
  }

  // 解析响应体获取实际模型名
  const latencyMs = Date.now() - startedAt;
  let respondedModel = "";
  try {
    const json = (await res.json()) as { model?: string };
    respondedModel = json?.model || "";
  } catch {
    /* 响应体解析失败不影响连通性判定 */
  }

  return { respondedModel, latencyMs, httpStatus: res.status };
}
