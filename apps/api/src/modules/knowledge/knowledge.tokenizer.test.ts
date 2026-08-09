// ============================================================
// SP-2026-007 · MS1（M1 中文混合检索基线）
// knowledge.tokenizer — jieba 中文分词 + 停用词过滤 + 单字二元组增强
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";

import { tokenize } from "./knowledge.tokenizer";

test("tokenize：中文短语切出业务词", () => {
  const tokens = tokenize("售前估算与实施评估");
  assert.ok(tokens.includes("售前"), `应含「售前」，实际：${tokens.join("/")}`);
  assert.ok(tokens.includes("估算"), `应含「估算」，实际：${tokens.join("/")}`);
  assert.ok(tokens.includes("实施"), `应含「实施」，实际：${tokens.join("/")}`);
  assert.ok(tokens.includes("评估"), `应含「评估」，实际：${tokens.join("/")}`);
});

test("tokenize：过滤功能停用词（的/与/是）", () => {
  const tokens = tokenize("知识库的检索与召回");
  assert.ok(!tokens.includes("的"), "应过滤「的」");
  assert.ok(!tokens.includes("与"), "应过滤「与」");
});

test("tokenize：单字相邻产出二元组增强召回（人天 → 人天 bigram）", () => {
  const tokens = tokenize("实施评估人天");
  assert.ok(
    tokens.includes("人天"),
    `单字「人」「天」相邻应合成 bigram「人天」，实际：${tokens.join("/")}`,
  );
});

test("tokenize：混合中英文与数字统一小写保留", () => {
  const tokens = tokenize("JWT 鉴权与 RBAC 能力位 v2");
  assert.ok(tokens.includes("jwt"), "英文应小写保留");
  assert.ok(tokens.includes("rbac"), "英文应小写保留");
  assert.ok(tokens.includes("鉴权"), "中文词保留");
});

test("tokenize：纯标点与空白返回空数组", () => {
  assert.deepEqual(tokenize("，。！？  "), []);
});
