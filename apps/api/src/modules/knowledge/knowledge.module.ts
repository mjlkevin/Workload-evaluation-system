// ============================================================
// SP-2026-007 · MS1（M1 中文混合检索基线）
// knowledge.module — 模块导出（barrel）+ 默认 repository 单例
// ============================================================

import { KnowledgeRepository } from "./knowledge.repository";

export { createKnowledgeHandlers } from "./knowledge.controller";
export { KnowledgeRepository, DEFAULT_STORE_RELATIVE } from "./knowledge.repository";
export { searchKnowledge } from "./knowledge.usecase";
export { tokenize } from "./knowledge.tokenizer";
export { buildBm25Index } from "./knowledge.retrieval";
export { rrfFuse } from "./knowledge.fusion";
export { applyGuard, searchWithTimeout, DEFAULT_GUARD } from "./knowledge.guard";

export type {
  KnowledgeEntry,
  KnowledgeStatus,
  KnowledgeResultItem,
  KnowledgeSearchResult,
  GuardOptions,
  GuardReport,
  RankedHit,
} from "./knowledge.types";

let defaultRepo: KnowledgeRepository | null = null;

/** 进程内默认 repository 单例（生产路由使用） */
export function getKnowledgeRepository(): KnowledgeRepository {
  if (!defaultRepo) {
    defaultRepo = new KnowledgeRepository();
  }
  return defaultRepo;
}
