// ============================================================
// SP-2026-007 · MS1（M1 中文混合检索基线）
// knowledge.fusion — RRF（Reciprocal Rank Fusion）融合器
// 阶段 1 仅 BM25 单路，接口预留第二路（向量）
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";

import { rrfFuse } from "./knowledge.fusion";

test("RRF：单路输入保持原排名", () => {
  const fused = rrfFuse([[{ entryId: "a" }, { entryId: "b" }]]);
  assert.deepEqual(fused.map((r) => r.entryId), ["a", "b"]);
});

test("RRF：两路都靠前的条目胜出", () => {
  const fused = rrfFuse([
    [{ entryId: "b" }, { entryId: "a" }, { entryId: "c" }],
    [{ entryId: "b" }, { entryId: "a" }, { entryId: "d" }],
  ]);
  assert.ok(fused.length >= 4, "应覆盖全部候选");
  assert.equal(fused[0].entryId, "b", `两路均第一的 b 应排第一，实际：${fused[0].entryId}`);
});

test("RRF：仅出现在一路的条目排在双路命中之后", () => {
  const fused = rrfFuse([
    [{ entryId: "x" }, { entryId: "only1" }],
    [{ entryId: "x" }, { entryId: "only2" }],
  ]);
  const order = fused.map((r) => r.entryId);
  assert.ok(order.indexOf("x") < order.indexOf("only1"), "双路命中的 x 应先于单路 only1");
  assert.ok(order.indexOf("x") < order.indexOf("only2"), "双路命中的 x 应先于单路 only2");
});

test("RRF：limit 生效", () => {
  const fused = rrfFuse(
    [[{ entryId: "a" }, { entryId: "b" }, { entryId: "c" }]],
    { limit: 2 },
  );
  assert.equal(fused.length, 2);
});

test("RRF：空输入返回空数组", () => {
  assert.deepEqual(rrfFuse([]), []);
  assert.deepEqual(rrfFuse([[]]), []);
});
