export function normalizeKimiModelName(model: string): string {
  const normalized = (model || "").trim().toLowerCase()
  if (!normalized) return "kimi-k2.5"
  if (normalized.startsWith("moonshot-")) return "kimi-k2.5"
  return (model || "").trim()
}
