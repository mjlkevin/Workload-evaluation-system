/**
 * Moonshot / Kimi：部分模型（尤其 thinking / reasoning）仅支持 temperature = 1。
 * K2 系列由平台按 thinking / 非 thinking 模式固定采样参数，不主动发送
 * temperature，避免 K2.5/K2.6/K2.7 请求因 temperature 不兼容失败。
 * @example invalid temperature: only 1 is allowed for this model
 */
export function resolveKimiCompletionTemperature(modelId: string, preferred: number): number {
  const resolved = resolveKimiCompletionTemperatureParam(modelId, preferred);
  if (resolved === undefined) return clamp01(preferred);
  return resolved;
}

export function resolveKimiCompletionTemperatureParam(modelId: string, preferred: number): number | undefined {
  const id = String(modelId || "").trim().toLowerCase();
  if (!id) return clamp01(preferred);
  if (isKimiK2Model(id)) return undefined;
  if (id.includes("thinking")) return 1;
  return clamp01(preferred);
}

export function isKimiK2Model(modelId: string): boolean {
  const id = String(modelId || "").trim().toLowerCase();
  return id === "kimi-k2" || id.startsWith("kimi-k2.") || id.startsWith("kimi-k2-");
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.3;
  return Math.min(1, Math.max(0, n));
}

export function isKimiTemperatureMustBeOneError(status: number, errorBodyText: string): boolean {
  if (status !== 400) return false;
  const t = String(errorBodyText || "").toLowerCase();
  return t.includes("invalid") && t.includes("temperature") && t.includes("only") && t.includes("1") && t.includes("allowed");
}
