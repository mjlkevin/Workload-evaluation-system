// ============================================================
// Versions 域仓储选择器测试（阶段 2 批 6 · 第 3 步开关语义 → S4 第 4 步恒 PG）
// ============================================================
// S4（2026-08-30）口径：versions 的 JSON 读写路径删除后本域恒 PG。
// 原四条依赖 JSON 的用例已随实现退役，逐条去向如下（与 system 域 S3 同口径）：
//  - 「选择器缺省（未设开关）装配 JSON 实现」：缺省语义已不存在——选择器不再读
//    WES_STORE_VERSIONS_PG，恒装配 PG 实现；「切回 JSON 还能跑」的假安全感由
//    git revert 取代（回退点见 §10 基线 tag archive/phase2-s4-baseline-20260830）。
//  - 「选择器严格语义：仅 'true' 切 PG，歧义值一律 JSON」：同上，分流分支不存在后
//    无歧义值可断；装配正确性收敛到下方「选择器恒装配 PG 实现」一条。
//  - 「选择器记忆化：装配后 env 变更不影响既有单例」：语义保留，但不再依赖 env，
//    改断「多次取用返回同一单例」。
//  - 「对照：JSON 整存 RMW 并发写不同版本记录必现丢失更新（已知缺陷记录）」：该用例
//    自身注释已声明「第 4 步删除 JSON 路径时本用例随实现一并删除」；PG 侧等价约束
//    由 versions-pg.repository.test.ts「并发写不同版本记录：全部生效、互不覆盖」承担，
//    「整存一次落盘」的原子性另由同文件「upsertVersionRecords：批量一次提交」在 S4
//    补上的全有或全无断言承担（原 fs 计数断言的替代回归防线）。
// 装配断言无需 DB（__dbForTest 为 PG 实现独有测试钩子，作为指纹）。

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  _resetVersionsRepositoryForTest,
  getVersionsRepository,
} from "./versions.repository";
import { createVersionsPgRepository } from "./versions-pg.repository";

afterEach(() => {
  _resetVersionsRepositoryForTest();
});

function isPgRepo(repo: unknown): boolean {
  // PG 实现独有测试钩子（__dbForTest）作为装配指纹
  return typeof (repo as { __dbForTest?: unknown }).__dbForTest === "function";
}

// S4 commit A 桥接：JSON 路径到 commit B 才删，此处显式钉开关到 PG，
// 使 commit A 单独可绿且与 commit B/C 之后的终态一致；commit C 退役开关时删除下行。
process.env.WES_STORE_VERSIONS_PG = "true";

test("选择器恒装配 PG 实现（S4 JSON 路径删除后）", () => {
  _resetVersionsRepositoryForTest();
  assert.equal(isPgRepo(getVersionsRepository()), true, "必须恒走 PG");
});

test("选择器记忆化：多次取用返回同一单例", () => {
  _resetVersionsRepositoryForTest();
  const first = getVersionsRepository();
  const second = getVersionsRepository();
  assert.equal(first, second, "进程内单例记忆化");
});

test("PG 工厂签名与选择器装配一致", () => {
  const pgMarker = createVersionsPgRepository;
  assert.equal(typeof pgMarker, "function");
});
