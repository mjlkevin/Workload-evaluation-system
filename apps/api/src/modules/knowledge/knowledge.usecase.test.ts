// ============================================================
// SP-2026-007 · MS1（M1 中文混合检索基线）
// knowledge.usecase — 检索编排（分词 → BM25 → RRF → 护栏）+ 验收
// ============================================================
// 阶段 2 S6（2026-08-29）：仓储注入改用 in-memory 替身（test-helpers/
// knowledge-in-memory.repository.ts），原临时 JSON 文件 + KnowledgeRepository
// 实例化路径随 JSON 类删除。本文件断的是**检索编排**，与存储实现无关，
// 替身零 fs / 零 DB，因此不需要 TEST_DATABASE_URL、也不进串行组。
// MS1 验收两条仍以 config/knowledge/store.json 的 24 条为语料——该文件是
// db/seed.ts 的播种源（长期留存，台账 §10 P2），测试按静态 fixture 读取，
// 不构成运行时 JSON 读写路径。

import test from "node:test";
import assert from "node:assert/strict";

import { searchKnowledge } from "./knowledge.usecase";
import { loadJsonFile } from "../../utils/file";
import { createKnowledgeInMemoryRepository } from "../../test-helpers/knowledge-in-memory.repository";
import type { KnowledgeEntry } from "./knowledge.types";

function repoWithSeed(entries: Array<Partial<KnowledgeEntry>>) {
  return createKnowledgeInMemoryRepository(entries);
}

const seed = [
  { id: "k1", title: "售前估算流程", content: "售前估算用于评估实施工作量，输出人天与报价建议。" },
  { id: "k2", title: "版本机制", content: "版本机制支持检出、检入与升版。" },
];

test("searchKnowledge：返回结构含 query/tokens/items/guard/durationMs", async () => {
  const repo = repoWithSeed(seed);
  const result = await searchKnowledge(repo, "售前估算");
  assert.equal(result.query, "售前估算");
  assert.ok(Array.isArray(result.tokens) && result.tokens.length > 0, "应返回分词结果");
  assert.ok(Array.isArray(result.items), "items 为数组");
  assert.ok(result.items.length > 0, "应命中条目");
  assert.ok(result.items[0].entry.id === "k1", "应命中售前估算条目");
  assert.ok(result.guard, "应返回护栏信息");
  assert.ok(typeof result.durationMs === "number", "应返回耗时");
});

test("searchKnowledge：items 按分数降序且附带来源", async () => {
  const repo = repoWithSeed(seed);
  const result = await searchKnowledge(repo, "售前估算人天");
  for (let i = 1; i < result.items.length; i++) {
    assert.ok(result.items[i].score <= result.items[i - 1].score, "应按分数降序");
  }
  assert.equal(result.items[0].source, "bm25", "阶段 1 来源标记为 bm25");
});

test("searchKnowledge：空查询返回空 items 不抛错", async () => {
  const repo = repoWithSeed(seed);
  const result = await searchKnowledge(repo, "   ");
  assert.deepEqual(result.items, []);
});

test("searchKnowledge：默认护栏生效（items ≤ 8）", async () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    id: `m${i}`,
    title: `估算条目${i}`,
    content: `售前估算口径说明第${i}条，涉及人天与工作量评估。`,
  }));
  const repo = repoWithSeed(many);
  const result = await searchKnowledge(repo, "售前估算人天工作量评估");
  assert.ok(result.items.length <= 8, `默认护栏最多 8 条，实际 ${result.items.length}`);
});

// ─── MS1 验收：20 条中文术语样例 Top-5 命中率 ≥ 80% ───

interface EvalSample {
  id: string;
  question: string;
  expectedEntryIds: string[];
  expectAnswer: boolean;
}

/** 种子语料（config/knowledge/store.json）——seed 源文件，长期留存。 */
function loadSeedCorpus(): Array<Partial<KnowledgeEntry>> {
  const store = loadJsonFile<{ entries: Array<Partial<KnowledgeEntry>> }>("config/knowledge/store.json");
  assert.ok(Array.isArray(store.entries) && store.entries.length > 0, "种子语料不得为空");
  return store.entries;
}

test("验收：种子语料 × 20 条术语样例，BM25 路 Top-5 命中率 ≥ 80%", async () => {
  const repo = repoWithSeed(loadSeedCorpus());
  const samplesFile = loadJsonFile<{ samples: EvalSample[] }>("config/rag/knowledge-retrieval-samples.v1.json");

  const answerable = samplesFile.samples.filter((s) => s.expectAnswer);
  assert.ok(answerable.length >= 20, `可回答样例应 ≥ 20 条，实际 ${answerable.length}`);

  let hits = 0;
  const misses: string[] = [];
  for (const sample of answerable) {
    const result = await searchKnowledge(repo, sample.question, { limit: 5 });
    const topIds = result.items.map((item) => item.entry.id);
    const hit = sample.expectedEntryIds.some((expected) => topIds.includes(expected));
    if (hit) hits += 1;
    else misses.push(`${sample.id}: ${sample.question} → ${topIds.join(",") || "(空)"}`);
  }

  const hitRate = hits / answerable.length;
  assert.ok(
    hitRate >= 0.8,
    `Top-5 命中率 ${Math.round(hitRate * 100)}% 低于 80% 验收线。未命中：${misses.join(" | ")}`,
  );
});

test("验收：无答案查询可返回空或低分结果，不抛错", async () => {
  const repo = repoWithSeed(loadSeedCorpus());
  const samplesFile = loadJsonFile<{ samples: EvalSample[] }>("config/rag/knowledge-retrieval-samples.v1.json");

  const noAnswer = samplesFile.samples.filter((s) => !s.expectAnswer);
  assert.ok(noAnswer.length > 0, "无答案样例不得为空（否则本用例空跑）");
  for (const sample of noAnswer) {
    const result = await searchKnowledge(repo, sample.question, { limit: 5 });
    assert.ok(Array.isArray(result.items), `${sample.id} 不得抛错`);
  }
});
