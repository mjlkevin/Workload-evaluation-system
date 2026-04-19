/**
 * Moonshot / Kimi：部分模型（尤其 thinking / reasoning）仅支持 temperature = 1。
 * @example invalid temperature: only 1 is allowed for this model
 */
export function resolveKimiCompletionTemperature(modelId: string, preferred: number): number {
  const id = String(modelId || "").trim().toLowerCase();
  if (!id) return clamp01(preferred);
  if (id.includes("thinking")) return 1;
  return clamp01(preferred);
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
