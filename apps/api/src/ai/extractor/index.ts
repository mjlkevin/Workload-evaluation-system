// ============================================================
// 抽取器 - barrel
// ============================================================

export { extractByAi } from "./ai-extractor";
export { extractByRule, RULE_ID, RULE_VERSION } from "./rule-extractor";
export { extractRequirement, EXTRACTOR_VERSION } from "./requirement-extractor";
export type {
  ExtractRequest,
  ExtractOptions,
  ExtractDependencies,
  ExtractPathOutput,
} from "./types";
