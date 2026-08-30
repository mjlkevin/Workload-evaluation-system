// ============================================================
// SP-2026-007 · MS1（M1 中文混合检索基线）
// knowledge.module — 模块导出（barrel）+ 默认 repository 单例
// ============================================================
// 阶段 2 S6（2026-08-29）：JSON 实现类与 WES_STORE_KNOWLEDGE_PG 开关分流均已
// 删除，选择器恒装配 PG 实现；装配点与记忆化单例口径不变。

import { KnowledgePgRepository } from "./knowledge-pg.repository";
import type { KnowledgeStoreRepository } from "./knowledge.repository";

export { createKnowledgeHandlers } from "./knowledge.controller";
export type { KnowledgeStoreRepository, CreateEntryInput, UpdateEntryPatch } from "./knowledge.repository";
export { KnowledgePgRepository, KnowledgeStoreError } from "./knowledge-pg.repository";
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

let defaultRepo: KnowledgeStoreRepository | null = null;

/** 进程内默认 repository 单例（生产路由使用）；S6 后恒 PG 实现 */
export function getKnowledgeRepository(): KnowledgeStoreRepository {
  if (!defaultRepo) defaultRepo = new KnowledgePgRepository();
  return defaultRepo;
}

/** 测试专用：重置单例 */
export function _resetKnowledgeRepositoryForTest(): void {
  defaultRepo = null;
}
