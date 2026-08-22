// ============================================================
// Versions 域仓储选择器测试（阶段 2 批 6 · 第 3 步开关语义）
// ============================================================
// 口径：与批 1/2/5 选择器同构——严格 === "true" 才切 PG；
// 缺省/歧义值一律 JSON（回滚安全）；进程内记忆化单例；测试钩子可重置。
// 装配断言无需 DB（__dbForTest 为 PG 实现独有测试钩子，作为指纹）。

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import path from "node:path";

import type { VersionRecord } from "../../types";
import {
  _resetVersionsRepositoryForTest,
  createVersionsJsonRepository,
  getVersionsRepository,
} from "./versions.repository";

afterEach(() => {
  delete process.env.WES_STORE_VERSIONS_PG;
  _resetVersionsRepositoryForTest();
});

function isPgRepo(repo: unknown): boolean {
  // PG 实现独有测试钩子（__dbForTest）作为装配指纹
  return typeof (repo as { __dbForTest?: unknown }).__dbForTest === "function";
}

test("选择器缺省（未设开关）装配 JSON 实现", () => {
  delete process.env.WES_STORE_VERSIONS_PG;
  _resetVersionsRepositoryForTest();
  const repo = getVersionsRepository();
  assert.equal(isPgRepo(repo), false, "缺省必须走 JSON（回滚安全）");
});

test("选择器严格语义：仅 'true' 切 PG，歧义值一律 JSON", () => {
  for (const value of ["1", "yes", "TRUE", "True", ""]) {
    process.env.WES_STORE_VERSIONS_PG = value;
    _resetVersionsRepositoryForTest();
    assert.equal(isPgRepo(getVersionsRepository()), false, `歧义值 ${JSON.stringify(value)} 必须回落 JSON`);
  }
  process.env.WES_STORE_VERSIONS_PG = "true";
  _resetVersionsRepositoryForTest();
  assert.equal(isPgRepo(getVersionsRepository()), true, "'true' 必须切 PG");
});

test("选择器记忆化：装配后 env 变更不影响既有单例", () => {
  process.env.WES_STORE_VERSIONS_PG = "true";
  _resetVersionsRepositoryForTest();
  const first = getVersionsRepository();
  process.env.WES_STORE_VERSIONS_PG = "false";
  const second = getVersionsRepository();
  assert.equal(first, second, "进程内只读一次开关（翻开关需重启，与 §3.1 对齐）");
});

// ─── JSON 整存 RMW 已知缺陷记录（并发写不同版本记录丢失更新） ─────
// 对照 versions-pg.repository.test.ts 的「并发写不同版本记录」用例：
// 整存 load→改→save 下，后写者把前写者的改动整个覆盖。本用例把缺陷
// 形态钉死为红线回归：若未来 JSON 路径被改造为真正行级写，断言会反转
// 失败，提醒同步更新本记录与 §5.1 遗留模式标注。第 4 步删除 JSON 路径
// 时本用例随实现一并删除。
//
// 隔离：node:test 按文件并行执行，本用例会整存覆写 records.json，故
// chdir 到临时沙箱根目录（自带 config/versions/records.json），
// resolveRootDir() 解析到沙箱内副本，与真实存储完全隔离。

function seedVersionRecord(id: string, versionCode: string): VersionRecord {
  const now = new Date("2026-08-22T00:00:00.000Z").toISOString();
  return {
    id,
    type: "assessment",
    versionCode,
    templateId: "default",
    ownerUserId: "wes-rmw-owner",
    status: "draft",
    payload: {},
    createdAt: now,
    updatedAt: now,
    createdByUserId: "wes-rmw-owner",
    createdByUsername: "wes-rmw",
    updatedByUserId: "wes-rmw-owner",
    updatedByUsername: "wes-rmw",
    checkoutStatus: "checked_in",
    versionDocStatus: "drafting",
    majorLetter: "A",
    minorNumber: 0,
    baseCode: versionCode,
    isHistoricalArchive: false,
  };
}

test("对照：JSON 整存 RMW 并发写不同版本记录必现丢失更新（已知缺陷记录）", async () => {
  const originalCwd = process.cwd();
  const sandboxRoot = path.resolve(originalCwd, "..", "..", ".tmp", "versions-rmw-sandbox");
  mkdirSync(path.join(sandboxRoot, "config", "versions"), { recursive: true });
  const filePath = path.join(sandboxRoot, "config", "versions", "records.json");

  process.chdir(sandboxRoot);
  try {
    const repo = createVersionsJsonRepository();
    let lostRounds = 0;
    const ROUNDS = 5;
    for (let i = 0; i < ROUNDS; i++) {
      writeFileSync(
        filePath,
        JSON.stringify({ records: [seedVersionRecord("wes-rmw-a", "IA-RMW-A"), seedVersionRecord("wes-rmw-b", "IA-RMW-B")] }, null, 2),
      );
      await Promise.all([
        repo.updateVersionRecord("wes-rmw-a", { payload: { writer: "a" } }),
        repo.updateVersionRecord("wes-rmw-b", { payload: { writer: "b" } }),
      ]);
      const after = JSON.parse(readFileSync(filePath, "utf8")).records as Array<{ id: string; payload: { writer?: string } }>;
      const a = after.find((r) => r.id === "wes-rmw-a")!;
      const b = after.find((r) => r.id === "wes-rmw-b")!;
      if (a.payload?.writer !== "a" || b.payload?.writer !== "b") lostRounds++;
    }
    assert.ok(lostRounds > 0, "整存 RMW 丢失更新应可复现；若未复现，说明 JSON 写路径已被改造，须同步更新本记录");
  } finally {
    process.chdir(originalCwd);
    rmSync(sandboxRoot, { recursive: true, force: true });
  }
});
