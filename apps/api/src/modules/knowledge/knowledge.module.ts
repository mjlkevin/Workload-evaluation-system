// ============================================================
// SP-2026-007 · MS1（M1 中文混合检索基线）
// knowledge.module — 模块导出（barrel）+ 默认 repository 单例
// ============================================================
// 阶段 2 批 9：选择器分流（缺省 JSON / WES_STORE_KNOWLEDGE_PG=true
// 切 PG）；装配点与记忆化单例口径不变，返回类型放宽为接口。
// JSON 路径保留至第 4 步（删 JSON 路径 + 退役开关为独立后续批次）。

import { KnowledgePgRepository } from "./knowledge-pg.repository";
import { KnowledgeRepository, type KnowledgeStoreRepository } from "./knowledge.repository";

export { createKnowledgeHandlers } from "./knowledge.controller";
export {
  KnowledgeRepository,
  DEFAULT_STORE_RELATIVE,
} from "./knowledge.repository";
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

/** 进程内默认 repository 单例（生产路由使用）；开关只读一次，翻开关需重启 */
export function getKnowledgeRepository(): KnowledgeStoreRepository {
  if (!defaultRepo) {
    defaultRepo =
      process.env.WES_STORE_KNOWLEDGE_PG === "true"
        ? new KnowledgePgRepository()
        : new KnowledgeRepository();
  }
  return defaultRepo;
}

/** 测试专用：重置单例 */
export function _resetKnowledgeRepositoryForTest(): void {
  defaultRepo = null;
}
