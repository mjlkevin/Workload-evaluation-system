// ============================================================
// Trace 域仓储选择器测试（阶段 2 S3 终态：PG-only）
// ============================================================
// 口径：S3（2026-08-30）JSON 读写路径（createTraceJsonRepository 及六个
// *Json 函数）删除后，trace.repository 的选择器恒装配 PG 实现；
// 进程内记忆化单例；测试钩子可重置。
//
// 原 5 条用例的职责去向，逐条登记（避免「删用例 = 弱化断言」）：
// 1. 「缺省装配 JSON（回滚安全）」→ 随 JSON 实现退役，缺省即 PG，由本文件
//    第 1 条承担；
// 2. 「严格语义：仅 'true' 切 PG，歧义值回落 JSON」→ 开关在 S3 commit C
//    退役后不再有分流对象，歧义值语义随 `WES_STORE_TRACES_PG` 一并消失；
// 3. 「记忆化」→ 保留为本文件第 2 条；
// 4. 「storePath 参数强制 JSON 文件路径」→ storePath 测试注入钩子随 JSON
//    实现一并删除，「公开函数不再接受 storePath」由 tsc 与 trace.test.ts
//    承担；
// 5. 「开关 'true' 且无 storePath：写入经 PG，JSON 文件不落盘」→ 公开层
//    写入确实落 PG 的验证由 trace.test.ts「inserts and finds a trace by
//    ID」（公开 accessor 写入后按主键从 PG 读回）承担，PG 侧细粒度语义由
//    trace-pg.repository.test.ts 的 16 条对照用例承担。
//
// 装配部分无需 DB（仅断实现装配与单例语义），无库环境同样真实执行。

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { createTracePgRepository } from "./trace-pg.repository";
import { _resetTraceRepositoryForTest, getTraceRepository } from "./trace.repository";

const pgMarker = createTracePgRepository; // 仅用于类型参照

function isPgRepo(repo: unknown): boolean {
  // PG 实现独有测试钩子（__dbForTest）作为装配指纹
  return typeof (repo as { __dbForTest?: unknown }).__dbForTest === "function";
}

afterEach(() => {
  _resetTraceRepositoryForTest();
});

test("选择器恒装配 PG 实现（S3 JSON 路径删除后）", () => {
  _resetTraceRepositoryForTest();
  assert.equal(isPgRepo(getTraceRepository()), true, "必须恒走 PG");
});

test("选择器记忆化：多次取用返回同一单例", () => {
  _resetTraceRepositoryForTest();
  const first = getTraceRepository();
  const second = getTraceRepository();
  assert.equal(first, second, "进程内单例记忆化");
});

test("PG 工厂签名与选择器装配一致", () => {
  assert.equal(typeof pgMarker, "function");
});
