import { asString } from "./helpers";

export function normalizeKimiModelName(modelName: string): string {
  const model = asString(modelName).toLowerCase();
  if (!model) return "kimi-k2.5";
  if (model.startsWith("moonshot-")) return "kimi-k2.5";
  return asString(modelName);
}
