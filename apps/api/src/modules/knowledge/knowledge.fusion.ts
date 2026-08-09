// ============================================================
// SP-2026-007 · MS1（M1 中文混合检索基线）
// knowledge.fusion — RRF（Reciprocal Rank Fusion）融合器
// 阶段 1 仅 BM25 单路；阶段 2 接入向量路时本模块无需改动
// ============================================================

import type { RankedHit } from "./knowledge.types";

const DEFAULT_RRF_K = 60;

export interface RrfOptions {
  /** RRF 常数 k，默认 60（无需调参，GT-009 同口径） */
  k?: number;
  /** 输出条数上限；不传则不截断 */
  limit?: number;
}

/**
 * RRF 融合多路召回：score(d) = Σ 1/(k + rank)，rank 从 0 起。
 * 对两路召回鲁棒，无需归一化分数。
 */
export function rrfFuse(rankedLists: RankedHit[][], options: RrfOptions = {}): RankedHit[] {
  const k = options.k ?? DEFAULT_RRF_K;
  const scores = new Map<string, number>();

  for (const list of rankedLists) {
    list.forEach((hit, rank) => {
      scores.set(hit.entryId, (scores.get(hit.entryId) ?? 0) + 1 / (k + rank + 1));
    });
  }

  const fused: RankedHit[] = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([entryId, score]) => ({ entryId, score }));

  return options.limit != null ? fused.slice(0, options.limit) : fused;
}
