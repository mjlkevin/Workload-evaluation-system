// ============================================================
// SP-2026-007 · MS1（M1 中文混合检索基线）
// knowledge.guard — 三重预算护栏（条目数 / 字符预算 / 超时）
// 默认口径移植自 GT-009：8 条 / 6000 字符 / 3s
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";

import { applyGuard, DEFAULT_GUARD } from "./knowledge.guard";
import type { KnowledgeEntry } from "./knowledge.types";

function makeEntry(id: string, content: string): { entry: KnowledgeEntry; score: number } {
  return {
    entry: {
      id,
      title: id,
      content,
      category: "test",
      status: "active",
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
    },
    score: 1,
  };
}

test("guard 默认口径：8 条 / 6000 字符 / 3000ms", () => {
  assert.equal(DEFAULT_GUARD.maxItems, 8);
  assert.equal(DEFAULT_GUARD.charBudget, 6000);
  assert.equal(DEFAULT_GUARD.timeoutMs, 3000);
});

test("条目数护栏：超过 maxItems 截断并留痕", () => {
  const results = Array.from({ length: 12 }, (_, i) => makeEntry(`e${i}`, "短内容"));
  const guarded = applyGuard(results, { maxItems: 8, charBudget: 100000, timeoutMs: 3000 });
  assert.equal(guarded.items.length, 8, "应截断到 8 条");
  assert.equal(guarded.truncatedBy, "maxItems", "截断原因应为条目数");
  assert.equal(guarded.droppedCount, 4, "留痕应记录被丢弃 4 条");
});

test("字符预算护栏：累计超限的后续条目被截断", () => {
  const results = [
    makeEntry("big1", "甲".repeat(4000)),
    makeEntry("big2", "乙".repeat(4000)),
  ];
  const guarded = applyGuard(results, { maxItems: 8, charBudget: 6000, timeoutMs: 3000 });
  assert.equal(guarded.items.length, 1, "第二条累计超预算应被截断");
  assert.equal(guarded.truncatedBy, "charBudget");
  assert.ok(guarded.totalChars <= 6000, "输出总体积不得超预算");
});

test("护栏不触发时 truncatedBy 为 null", () => {
  const results = [makeEntry("ok", "正常内容")];
  const guarded = applyGuard(results);
  assert.equal(guarded.truncatedBy, null);
  assert.equal(guarded.droppedCount, 0);
});

test("超时护栏：超时的检索以空结果降级并留痕", async () => {
  const { searchWithTimeout } = await import("./knowledge.guard");
  const slowSearch = () =>
    new Promise<{ entryId: string; score: number }[]>((resolve) =>
      setTimeout(() => resolve([{ entryId: "late", score: 1 }]), 50),
    );
  const result = await searchWithTimeout(slowSearch, 10);
  assert.deepEqual(result.items, [], "超时应降级为空结果");
  assert.equal(result.timedOut, true, "应留痕 timedOut=true");
});
