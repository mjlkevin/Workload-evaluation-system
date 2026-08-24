// ============================================================
// SP-2026-007 · MS1（M1 中文混合检索基线）
// knowledge.usecase — 检索编排：分词 → BM25 → RRF → 三重护栏
// ============================================================

import { tokenize } from "./knowledge.tokenizer";
import { buildBm25Index } from "./knowledge.retrieval";
import { rrfFuse } from "./knowledge.fusion";
import { applyGuard, DEFAULT_GUARD } from "./knowledge.guard";
import type { KnowledgeStoreRepository } from "./knowledge.repository";
import type {
  GuardOptions,
  KnowledgeEntry,
  KnowledgeResultItem,
  KnowledgeSearchResult,
  RankedHit,
} from "./knowledge.types";

export interface SearchKnowledgeOptions {
  /** 融合后输出条数上限（护栏 maxItems 之前生效），默认 8 */
  limit?: number;
  guard?: Partial<GuardOptions>;
}

/**
 * 知识库检索编排。
 * 阶段 1：BM25 单路走 RRF 融合器（为阶段 2 向量路预留）；
 * 结果经条目数/字符预算护栏截断，留痕返回。
 */
/** 阶段 1 批 7：因内部调用 repo.list（已异步化）级联改 async，实现不动。 */
export async function searchKnowledge(
  repo: KnowledgeStoreRepository,
  query: string,
  options: SearchKnowledgeOptions = {},
): Promise<KnowledgeSearchResult> {
  const startedAt = Date.now();
  const guardOptions: GuardOptions = { ...DEFAULT_GUARD, ...(options.guard ?? {}) };
  const limit = options.limit ?? guardOptions.maxItems;

  const tokens = tokenize(query ?? "");
  const emptyGuard: KnowledgeSearchResult["guard"] = { truncatedBy: null, droppedCount: 0, totalChars: 0 };

  if (tokens.length === 0) {
    return { query: query ?? "", tokens: [], items: [], guard: emptyGuard, durationMs: Date.now() - startedAt };
  }

  const entries = await repo.list();
  const entryById = new Map<string, KnowledgeEntry>(entries.map((entry) => [entry.id, entry]));

  const index = buildBm25Index(entries);
  const bm25Hits: RankedHit[] = index.search(tokens, Math.max(limit * 3, 24));

  // 阶段 1 单路：RRF 框架内仅一路输入；阶段 2 追加向量路即可
  const fused = rrfFuse([bm25Hits], { limit });

  const scored = fused
    .map((hit) => {
      const entry = entryById.get(hit.entryId);
      return entry ? { entry, score: hit.score ?? 0 } : null;
    })
    .filter((item): item is { entry: KnowledgeEntry; score: number } => item !== null);

  const guarded = applyGuard(scored, guardOptions);

  const items: KnowledgeResultItem[] = guarded.items.map((item) => ({
    entry: item.entry,
    score: item.score,
    source: "bm25",
  }));

  return {
    query: query ?? "",
    tokens,
    items,
    guard: {
      truncatedBy: guarded.truncatedBy,
      droppedCount: guarded.droppedCount,
      totalChars: guarded.totalChars,
    },
    durationMs: Date.now() - startedAt,
  };
}
