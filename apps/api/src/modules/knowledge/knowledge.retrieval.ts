// ============================================================
// SP-2026-007 · MS1（M1 中文混合检索基线）
// knowledge.retrieval — 进程内倒排索引 + BM25 打分
// 语料规模 < 1 万条，零新增基础设施；增长后再迁 PG 全文检索
// ============================================================

import { tokenize } from "./knowledge.tokenizer";
import type { KnowledgeEntry, RankedHit } from "./knowledge.types";

const K1 = 1.2;
const B = 0.75;

interface DocIndex {
  entryId: string;
  /** 词 → 词频 */
  termFreq: Map<string, number>;
  /** 文档 token 总数（含重复） */
  length: number;
}

export interface Bm25Index {
  search(queryTokens: string[], limit: number): RankedHit[];
}

/** 取条目的可检索文本：标题 + 正文 + 标签 */
function entryText(entry: KnowledgeEntry): string {
  const tags = entry.tags?.length ? entry.tags.join(" ") : "";
  return `${entry.title} ${entry.content} ${tags}`;
}

/**
 * 构建 BM25 倒排索引。archived 条目不参与索引。
 */
export function buildBm25Index(entries: KnowledgeEntry[]): Bm25Index {
  const docs: DocIndex[] = [];
  /** 词 → 出现的文档数 */
  const docFreq = new Map<string, number>();

  for (const entry of entries) {
    if (entry.status === "archived") continue;
    const tokens = tokenize(entryText(entry));
    const termFreq = new Map<string, number>();
    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    }
    for (const term of termFreq.keys()) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
    docs.push({ entryId: entry.id, termFreq, length: tokens.length });
  }

  const docCount = docs.length;
  const avgLen = docCount > 0 ? docs.reduce((sum, d) => sum + d.length, 0) / docCount : 0;

  function search(queryTokens: string[], limit: number): RankedHit[] {
    if (docCount === 0 || queryTokens.length === 0) return [];

    const scores = new Map<string, number>();
    for (const doc of docs) {
      let score = 0;
      for (const term of queryTokens) {
        const tf = doc.termFreq.get(term);
        if (!tf) continue;
        const df = docFreq.get(term) ?? 0;
        // 非负 IDF 变体，避免高频词产生负分
        const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
        const norm = 1 - B + B * (doc.length / avgLen);
        score += idf * ((tf * (K1 + 1)) / (tf + K1 * norm));
      }
      if (score > 0) scores.set(doc.entryId, score);
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([entryId, score]) => ({ entryId, score }));
  }

  return { search };
}
