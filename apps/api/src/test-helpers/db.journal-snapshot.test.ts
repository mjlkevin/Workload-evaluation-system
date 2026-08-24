// ============================================================
// 防漂移测试：drizzle journal 每个迁移条目必须有配套快照文件
// ============================================================
// 口径（2026-08-24 架构侧裁决约束 C8 配套守卫）：
// `db:generate` 以 journal 中**最大 idx 的快照**为基线做 schema diff，
// 该快照缺失或断链会产出错误迁移（批 5 修 0016/0017、批 9 修 0019
// 均为此类隐患，第二次复发后升级为正式约束）。本测试让快照断链
// 在提交当时即暴露，而不是三个批次之后才被发现。
//
// 断言两层：
// 1. 最大 idx 的快照必须存在（generate 直接依赖的那一个）；
// 2. 其余所有 idx 的快照也必须存在，历史缺口走白名单显式豁免。
// 失败信息直接指出缺失的 idx，不需要人工比对。
//
// 白名单（历史缺口，不影响 generate，不予补齐）：
// - idx 9、idx 16：早期迁移未生成快照，属历史惰性缺口。
//   generate 只读末位快照，中段缺口不污染基线，故不回填；
//   新增条目不得加入白名单（C8：迁移一律 db:generate 产出，
//   工具链会自动生成配套快照）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// 路径口径：test:modules 在 apps/api 目录下执行（package.json scripts），
// process.cwd() 即 apps/api。不用 import.meta.url——tsconfig module=CommonJS
// 下 import.meta 会被 tsc 拒绝（分支 CI tsc job 实测失败）。
// 若从其他 CWD 单跑本文件，loadJournal 的 existsSync 断言会给出带实际路径的清晰失败，不会假绿。
const META_DIR = path.resolve(process.cwd(), "drizzle", "meta");
const JOURNAL_PATH = path.join(META_DIR, "_journal.json");

// 历史缺口，不影响 generate，不予补齐（见文件头说明）。新增条目禁止入列。
const HISTORICAL_SNAPSHOT_GAPS = new Set([9, 16]);

const snapshotFile = (idx: number) =>
  path.join(META_DIR, `${String(idx).padStart(4, "0")}_snapshot.json`);

type JournalEntry = { idx: number; tag: string };

function loadJournal(): JournalEntry[] {
  assert.ok(existsSync(JOURNAL_PATH), `journal 不存在：${JOURNAL_PATH}`);
  const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) as {
    entries: JournalEntry[];
  };
  assert.ok(Array.isArray(journal.entries) && journal.entries.length > 0, "journal 条目为空，测试自身失效");
  return journal.entries;
}

test("journal 末位（最大 idx）快照必须存在——generate 的 diff 基线", () => {
  const entries = loadJournal();
  const maxIdx = Math.max(...entries.map((e) => e.idx));
  assert.ok(
    existsSync(snapshotFile(maxIdx)),
    `journal 最大 idx=${maxIdx} 缺少配套快照 ${String(maxIdx).padStart(4, "0")}_snapshot.json` +
      "——db:generate 将退化为更早的基线产出错误迁移（C8 约束背景：批 5/批 9 两次快照链断裂）。" +
      "修复：用工具链重建末位快照或重新 db:generate，禁止手写迁移",
  );
});

test("journal 全部条目快照齐全（历史缺口白名单豁免：idx 9、16）", () => {
  const entries = loadJournal();

  const idxs = entries.map((e) => e.idx);
  assert.equal(new Set(idxs).size, idxs.length, `journal 存在重复 idx：${idxs.join(", ")}`);

  const missing = idxs
    .filter((idx) => !HISTORICAL_SNAPSHOT_GAPS.has(idx))
    .filter((idx) => !existsSync(snapshotFile(idx)))
    .sort((a, b) => a - b);
  assert.deepEqual(
    missing,
    [],
    `快照缺失的 idx：${missing.join(", ")}（白名单仅豁免历史缺口 9、16，新增迁移必须由 db:generate 产出配套快照）`,
  );

  // 白名单自检：豁免的 idx 必须真实存在于 journal，否则白名单已失效（条目被删或写错）
  const orphanGaps = [...HISTORICAL_SNAPSHOT_GAPS].filter((idx) => !idxs.includes(idx)).sort((a, b) => a - b);
  assert.deepEqual(
    orphanGaps,
    [],
    `白名单中的历史缺口 idx 在 journal 中不存在（白名单失效）：${orphanGaps.join(", ")}`,
  );
});
