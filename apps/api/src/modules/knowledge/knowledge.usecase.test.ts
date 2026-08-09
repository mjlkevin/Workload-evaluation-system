// ============================================================
// SP-2026-007 · MS1（M1 中文混合检索基线）
// knowledge.usecase — 检索编排（分词 → BM25 → RRF → 护栏）+ 验收
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { KnowledgeRepository } from "./knowledge.repository";
import { searchKnowledge } from "./knowledge.usecase";
import { loadJsonFile } from "../../utils/file";

function tempRepoWithSeed(entries: Array<{ id: string; title: string; content: string }>): KnowledgeRepository {
  const storePath = path.join(os.tmpdir(), `wes-knowledge-usecase-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(storePath, JSON.stringify({ entries }), "utf-8");
  return new KnowledgeRepository(storePath);
}

const seed = [
  { id: "k1", title: "售前估算流程", content: "售前估算用于评估实施工作量，输出人天与报价建议。" },
  { id: "k2", title: "版本机制", content: "版本机制支持检出、检入与升版。" },
];

test("searchKnowledge：返回结构含 query/tokens/items/guard/durationMs", () => {
  const repo = tempRepoWithSeed(seed);
  const result = searchKnowledge(repo, "售前估算");
  assert.equal(result.query, "售前估算");
  assert.ok(Array.isArray(result.tokens) && result.tokens.length > 0, "应返回分词结果");
  assert.ok(Array.isArray(result.items), "items 为数组");
  assert.ok(result.items.length > 0, "应命中条目");
  assert.ok(result.items[0].entry.id === "k1", "应命中售前估算条目");
  assert.ok(result.guard, "应返回护栏信息");
  assert.ok(typeof result.durationMs === "number", "应返回耗时");
});

test("searchKnowledge：items 按分数降序且附带来源", () => {
  const repo = tempRepoWithSeed(seed);
  const result = searchKnowledge(repo, "售前估算人天");
  for (let i = 1; i < result.items.length; i++) {
    assert.ok(result.items[i].score <= result.items[i - 1].score, "应按分数降序");
  }
  assert.equal(result.items[0].source, "bm25", "阶段 1 来源标记为 bm25");
});

test("searchKnowledge：空查询返回空 items 不抛错", () => {
  const repo = tempRepoWithSeed(seed);
  const result = searchKnowledge(repo, "   ");
  assert.deepEqual(result.items, []);
});

test("searchKnowledge：默认护栏生效（items ≤ 8）", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    id: `m${i}`,
    title: `估算条目${i}`,
    content: `售前估算口径说明第${i}条，涉及人天与工作量评估。`,
  }));
  const repo = tempRepoWithSeed(many);
  const result = searchKnowledge(repo, "售前估算人天工作量评估");
  assert.ok(result.items.length <= 8, `默认护栏最多 8 条，实际 ${result.items.length}`);
});

// ─── MS1 验收：20 条中文术语样例 Top-5 命中率 ≥ 80% ───

interface EvalSample {
  id: string;
  question: string;
  expectedEntryIds: string[];
  expectAnswer: boolean;
}

test("验收：种子语料 × 20 条术语样例，BM25 路 Top-5 命中率 ≥ 80%", () => {
  const store = loadJsonFile<{ entries: Array<Record<string, unknown>> }>("config/knowledge/store.json");
  const samplesFile = loadJsonFile<{ samples: EvalSample[] }>("config/rag/knowledge-retrieval-samples.v1.json");

  const storePath = path.join(os.tmpdir(), `wes-knowledge-accept-${Date.now()}.json`);
  fs.writeFileSync(storePath, JSON.stringify(store), "utf-8");
  const repo = new KnowledgeRepository(storePath);

  const answerable = samplesFile.samples.filter((s) => s.expectAnswer);
  assert.ok(answerable.length >= 20, `可回答样例应 ≥ 20 条，实际 ${answerable.length}`);

  let hits = 0;
  const misses: string[] = [];
  for (const sample of answerable) {
    const result = searchKnowledge(repo, sample.question, { limit: 5 });
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

test("验收：无答案查询可返回空或低分结果，不抛错", () => {
  const store = loadJsonFile<{ entries: Array<Record<string, unknown>> }>("config/knowledge/store.json");
  const samplesFile = loadJsonFile<{ samples: EvalSample[] }>("config/rag/knowledge-retrieval-samples.v1.json");
  const storePath = path.join(os.tmpdir(), `wes-knowledge-na-${Date.now()}.json`);
  fs.writeFileSync(storePath, JSON.stringify(store), "utf-8");
  const repo = new KnowledgeRepository(storePath);

  const noAnswer = samplesFile.samples.filter((s) => !s.expectAnswer);
  for (const sample of noAnswer) {
    const result = searchKnowledge(repo, sample.question, { limit: 5 });
    assert.ok(Array.isArray(result.items), `${sample.id} 不得抛错`);
  }
});
