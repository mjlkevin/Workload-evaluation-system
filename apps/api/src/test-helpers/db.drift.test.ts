// ============================================================
// 防漂移测试：schema pgTable 全集 ⊆ truncate 覆盖集
// ============================================================
// 口径（阶段 0 事项 6）：schema 里每张 pgTable 都必须出现在
// TRUNCATE_TEST_TABLE_NAMES 中，防止新增表漏加 truncate 导致
// 测试库状态跨用例泄漏。
//
// 断言用集合包含（差集为空），不用数量相等：数量相等在
// 「同时删一张表、加一张表」时会漏判；差集断言失败时能直接
// 指出漏了哪张表，不需要人工比对。
//
// 白名单：当前为空。无不可清理的迁移元数据表（drizzle 迁移表
// __drizzle_migrations 由 migrator 管理，不属于业务 schema）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";
import { TRUNCATE_TEST_TABLE_NAMES } from "./db";

test("schema 表全集 ⊆ truncate 覆盖集（差集为空）", () => {
  const schemaTables = new Set<string>();
  for (const value of Object.values(schema)) {
    if (is(value, PgTable)) {
      schemaTables.add(getTableName(value));
    }
  }
  assert.ok(schemaTables.size > 0, "schema 对象未提取到任何表，测试自身失效");

  const truncateSet = new Set(TRUNCATE_TEST_TABLE_NAMES);
  const missing = [...schemaTables].filter((t) => !truncateSet.has(t)).sort();
  assert.deepEqual(missing, [], `truncate 缺失表（schema 有、truncate 无）：${missing.join(", ")}`);

  // 反向也检查：truncate 里出现 schema 没有的表名属于笔误，会直接导致 TRUNCATE 报错
  const orphan = [...truncateSet].filter((t) => !schemaTables.has(t)).sort();
  assert.deepEqual(orphan, [], `truncate 存在 schema 中没有的表名（笔误）：${orphan.join(", ")}`);
});
