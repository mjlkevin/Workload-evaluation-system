// ============================================================
// SP-2026-007 · MS1（M1 中文混合检索基线）
// knowledge.retrieval — 进程内倒排索引 + BM25 打分
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";

import { buildBm25Index } from "./knowledge.retrieval";
import { tokenize } from "./knowledge.tokenizer";
import type { KnowledgeEntry } from "./knowledge.types";

function makeEntry(id: string, title: string, content: string): KnowledgeEntry {
  return {
    id,
    title,
    content,
    category: "test",
    status: "active",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  };
}

const corpus: KnowledgeEntry[] = [
  makeEntry("k-presales", "售前估算流程", "售前估算用于在项目立项前评估实施工作量与报价区间，输出人天与报价建议。"),
  makeEntry("k-assessment", "实施评估人天口径", "实施评估按功能点与复杂度折算人天，区分标准人天与建议人天。"),
  makeEntry("k-version", "版本机制", "版本机制支持检出、检入、撤销检出、升版与管理员强制解锁。"),
];

test("BM25：相关条目排名第一", () => {
  const index = buildBm25Index(corpus);
  const hits = index.search(tokenize("售前估算"), 5);
  assert.ok(hits.length > 0, "应有命中");
  assert.equal(hits[0]?.entryId, "k-presales", `第一名应为售前估算条目，实际：${hits[0]?.entryId}`);
});

test("BM25：术语「实施评估人天」命中口径条目", () => {
  const index = buildBm25Index(corpus);
  const hitIds = index.search(tokenize("实施评估人天"), 5).map((h) => h.entryId);
  assert.ok(hitIds.includes("k-assessment"), `应命中 k-assessment，实际：${hitIds.join(",")}`);
});

test("BM25：无关查询不返回强相关结果（分数单调下降）", () => {
  const index = buildBm25Index(corpus);
  const hits = index.search(tokenize("量子厨房管理"), 5);
  const scores = hits.map((h) => h.score);
  for (let i = 1; i < scores.length; i++) {
    const prev = scores[i - 1];
    const cur = scores[i];
    assert.ok(prev != null && cur != null && cur <= prev, "BM25 结果应按分数降序");
  }
});

test("BM25：limit 生效且分数为正", () => {
  const index = buildBm25Index(corpus);
  const hits = index.search(tokenize("评估"), 1);
  assert.equal(hits.length, 1, "limit=1 只返回 1 条");
  const top = hits[0];
  assert.ok(top, "应返回命中");
  assert.ok(top.score != null && top.score > 0, "命中分数应为正");
});

test("BM25：空语料返回空数组", () => {
  const index = buildBm25Index([]);
  assert.deepEqual(index.search(tokenize("任意查询"), 5), []);
});

test("BM25：archived 条目不参与索引", () => {
  const withArchived = [
    ...corpus,
    { ...makeEntry("k-old", "旧版售前估算", "售前估算旧口径已归档。"), status: "archived" as const },
  ];
  const index = buildBm25Index(withArchived);
  const hitIds = index.search(tokenize("售前估算旧口径"), 5).map((h) => h.entryId);
  assert.ok(!hitIds.includes("k-old"), "archived 条目不得被检索到");
});
