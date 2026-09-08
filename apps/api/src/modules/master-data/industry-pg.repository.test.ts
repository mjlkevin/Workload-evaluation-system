// ============================================================
// 批次 10a · 行业主数据 PG 仓储测试
// ============================================================
// 口径：按阶段 2 批 1–9 确立的五条硬性范式验证 industry_categories /
// industry_subcategories 两表的 PG 实现——安全错误边界、幂等、
// 事务内行锁更新、DB 时钟、读失败抛错；外加本批两条要害判据：
//   ① 禁止硬删（直接调仓储 removeCategory / removeSubcategory 必被拒）
//   ② 两级唯一性（同名细分可在不同大类下并存；二级名不得与一级名撞）
// 以及外键 ON DELETE RESTRICT 挡住「删掉有子节点的一级」。
//
// 隔离（批 3 / 批 5 先例）：CI 中多个测试文件并发共享同一测试库，
// 本域两表当前唯一写入者虽是本文件，仍一律按 wes-b10a-* 前缀数据集隔离
// + 条件 DELETE 清理，不做整表 TRUNCATE、不做全表计数断言
// （§10 批 5 教训：整表计数在共享库下不可判定）。
// 仅读取 TEST_DATABASE_URL；缺失时整体跳过（与 trace-pg 同范式）。

import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { industryCategories, industrySubcategories } from "../../db/schema";
import type { Database } from "../../db/client";
import {
  MasterDataError,
  createIndustryPgRepository,
  type IndustryPgRepository,
} from "./industry-pg.repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

let pool: Pool | null = null;
let db: Database | null = null;
let repo: IndustryPgRepository | null = null;

const OWN_PREFIX = "wes-b10a-";

function uniqueId(kind: string): string {
  return `${OWN_PREFIX}${kind}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 只清本文件自己种的前缀行；子表先删，避免外键 RESTRICT 挡住父表清理。 */
async function cleanOwnRows(): Promise<void> {
  if (!db) return;
  await db
    .delete(industrySubcategories)
    .where(sqlStartsWith(industrySubcategories.id, OWN_PREFIX));
  await db
    .delete(industryCategories)
    .where(sqlStartsWith(industryCategories.id, OWN_PREFIX));
}

/** 前缀匹配即 startsWith（drizzle like 语义）。 */
function sqlStartsWith(column: Parameters<typeof like>[0], prefix: string) {
  return like(column, `${prefix}%`);
}

before(async () => {
  if (!testDatabaseUrl) return;
  pool = new Pool({ connectionString: testDatabaseUrl, max: 10 });
  db = drizzle(pool);
  repo = createIndustryPgRepository(db);
  await cleanOwnRows();
});

afterEach(async () => {
  await cleanOwnRows();
});

after(async () => {
  if (pool) await pool.end();
});

async function makeCategory(name: string, overrides: { sortOrder?: number } = {}) {
  return repo!.createCategory({ id: uniqueId("cat"), name, ...overrides });
}

/** assert.rejects 的校验器：必须同步返回函数，写成 async 会得到 Promise 而报 ERR_INVALID_ARG_VALUE。 */
function expectCode(code: MasterDataError["code"]) {
  return (err: unknown) => err instanceof MasterDataError && err.code === code;
}

// ---------------------------------------------------------------
// 创建 / 读取
// ---------------------------------------------------------------

test("createCategory 落库后可按 id 读回，时间取自 DB 时钟", { skip: !testDatabaseUrl }, async () => {
  const cat = await makeCategory(`${OWN_PREFIX}制造业`);
  const read = await repo!.getCategory(cat.id);
  assert.ok(read, "按 id 应读到刚创建的行");
  assert.equal(read!.name, `${OWN_PREFIX}制造业`);
  assert.equal(read!.status, "active", "新建默认启用");
  assert.ok(Date.parse(read!.createdAt) > 0, "createdAt 必须是可解析时间");
  assert.equal(read!.createdAt, read!.updatedAt, "首写两个时间应同源同一刻");
});

test("createCategory 空名/纯空白名被拒（MASTER_DATA_INVALID），不留残行", { skip: !testDatabaseUrl }, async () => {
  for (const bad of ["", "   ", "\t\n"]) {
    await assert.rejects(
      () => repo!.createCategory({ id: uniqueId("cat"), name: bad }),
      expectCode("MASTER_DATA_INVALID"),
      `空白名 ${JSON.stringify(bad)} 必须被拒`,
    );
  }
  const rows = await repo!.listCategories();
  assert.equal(rows.filter((r) => r.id.startsWith(`${OWN_PREFIX}cat-`)).length, 0, "被拒的创建不得留下任何行");
});

test("createCategory 名称重复返回 MASTER_DATA_NAME_EXISTS，不产生第二行", { skip: !testDatabaseUrl }, async () => {
  await makeCategory(`${OWN_PREFIX}重名`);
  await assert.rejects(
    () => repo!.createCategory({ id: uniqueId("cat"), name: `${OWN_PREFIX}重名` }),
    expectCode("MASTER_DATA_NAME_EXISTS"),
  );
  const rows = (await repo!.listCategories()).filter((r) => r.name === `${OWN_PREFIX}重名`);
  assert.equal(rows.length, 1);
});

test("createCategory 指定 id 重复时被拒（seed 幂等依赖该行为）", { skip: !testDatabaseUrl }, async () => {
  const id = uniqueId("cat");
  await repo!.createCategory({ id, name: `${OWN_PREFIX}幂等` });
  await assert.rejects(
    () => repo!.createCategory({ id, name: `${OWN_PREFIX}幂等-二次` }),
    expectCode("MASTER_DATA_NAME_EXISTS"),
  );
});

test("createSubcategory 挂到不存在的一级被拒（MASTER_DATA_NOT_FOUND）", { skip: !testDatabaseUrl }, async () => {
  await assert.rejects(
    () =>
      repo!.createSubcategory({
        id: uniqueId("sub"),
        categoryId: `${OWN_PREFIX}不存在`,
        name: `${OWN_PREFIX}细分`,
      }),
    expectCode("MASTER_DATA_NOT_FOUND"),
  );
});

test("同名二级可在不同一级下并存，同一大类下不得重名", { skip: !testDatabaseUrl }, async () => {
  const a = await makeCategory(`${OWN_PREFIX}大类甲`);
  const b = await makeCategory(`${OWN_PREFIX}大类乙`);
  const sharedName = `${OWN_PREFIX}同名细分`;
  await repo!.createSubcategory({ id: uniqueId("sub"), categoryId: a.id, name: sharedName });
  await repo!.createSubcategory({ id: uniqueId("sub"), categoryId: b.id, name: sharedName });
  const subs = (await repo!.listSubcategories()).filter((s) => s.name === sharedName);
  assert.equal(subs.length, 2, "跨大类同名应允许");
  await assert.rejects(
    () => repo!.createSubcategory({ id: uniqueId("sub"), categoryId: a.id, name: sharedName }),
    expectCode("MASTER_DATA_NAME_EXISTS"),
    "同一大类下重名必须被拒",
  );
});

test("二级名不得与任一大类名相同：选项 value 是名称文本，跨层撞名会让停用与历史值语义分叉", { skip: !testDatabaseUrl }, async () => {
  const cat = await makeCategory(`${OWN_PREFIX}跨层同名`);
  await assert.rejects(
    () => repo!.createSubcategory({ id: uniqueId("sub"), categoryId: cat.id, name: `${OWN_PREFIX}跨层同名` }),
    expectCode("MASTER_DATA_NAME_EXISTS"),
  );
});

// ---------------------------------------------------------------
// 停用 / 启用（本批唯一允许的「下线」形态）
// ---------------------------------------------------------------

test("setCategoryStatus 停用后行仍在，且能读回 inactive", { skip: !testDatabaseUrl }, async () => {
  const cat = await makeCategory(`${OWN_PREFIX}停用对象`);
  const off = await repo!.setCategoryStatus(cat.id, "inactive");
  assert.equal(off.status, "inactive");
  const stillThere = await repo!.getCategory(cat.id);
  assert.ok(stillThere, "停用不是删除：行必须仍在库里");
  assert.equal(stillThere!.name, `${OWN_PREFIX}停用对象`);
});

test("setCategoryStatus 幂等：重复停用只刷新 updatedAt，不产生第二行", { skip: !testDatabaseUrl }, async () => {
  const cat = await makeCategory(`${OWN_PREFIX}重复停用`);
  const first = await repo!.setCategoryStatus(cat.id, "inactive");
  const again = await repo!.setCategoryStatus(cat.id, "inactive");
  assert.equal(again.status, "inactive");
  assert.equal(again.id, first.id);
  const rows = (await repo!.listCategories()).filter((r) => r.id === cat.id);
  assert.equal(rows.length, 1, "状态切换不得新增行");
  assert.ok(Date.parse(again.updatedAt) >= Date.parse(first.updatedAt));
});

test("setCategoryStatus 对不存在的 id 抛 NOT_FOUND", { skip: !testDatabaseUrl }, async () => {
  await assert.rejects(
    () => repo!.setCategoryStatus(`${OWN_PREFIX}查无此行`, "inactive"),
    expectCode("MASTER_DATA_NOT_FOUND"),
  );
});

// ---------------------------------------------------------------
// 修改
// ---------------------------------------------------------------

test("updateCategory 改名未列字段不被抹掉", { skip: !testDatabaseUrl }, async () => {
  const cat = await makeCategory(`${OWN_PREFIX}改名前`, { sortOrder: 7 });
  const updated = await repo!.updateCategory(cat.id, { name: `${OWN_PREFIX}改名后` });
  assert.equal(updated.name, `${OWN_PREFIX}改名后`);
  assert.equal(updated.sortOrder, 7, "补丁未带 sortOrder 时不得回落到默认 0");
  assert.equal(updated.status, "active", "补丁未带 status 时不得改状态");
});

test("updateCategory 改名撞已有名称被拒", { skip: !testDatabaseUrl }, async () => {
  await makeCategory(`${OWN_PREFIX}占用名`);
  const other = await makeCategory(`${OWN_PREFIX}待改名`);
  await assert.rejects(
    () => repo!.updateCategory(other.id, { name: `${OWN_PREFIX}占用名` }),
    expectCode("MASTER_DATA_NAME_EXISTS"),
  );
});

// ---------------------------------------------------------------
// 禁止硬删（判据 ④ 的仓储侧）
// ---------------------------------------------------------------

test("removeCategory 恒抛 MASTER_DATA_DELETE_FORBIDDEN，且行仍在", { skip: !testDatabaseUrl }, async () => {
  const cat = await makeCategory(`${OWN_PREFIX}硬删目标`);
  await assert.rejects(() => repo!.removeCategory(cat.id), expectCode("MASTER_DATA_DELETE_FORBIDDEN"), "仓储层直接调用也必须被拒");
  assert.ok(await repo!.getCategory(cat.id), "被拒后行必须完好");
});

test("removeSubcategory 恒抛 MASTER_DATA_DELETE_FORBIDDEN，且行仍在", { skip: !testDatabaseUrl }, async () => {
  const cat = await makeCategory(`${OWN_PREFIX}硬删父级`);
  const sub = await repo!.createSubcategory({
    id: uniqueId("sub"),
    categoryId: cat.id,
    name: `${OWN_PREFIX}硬删子级`,
  });
  await assert.rejects(() => repo!.removeSubcategory(sub.id), expectCode("MASTER_DATA_DELETE_FORBIDDEN"));
  assert.ok(await repo!.getSubcategory(sub.id), "被拒后行必须完好");
});

test("绕开仓储直连 DELETE 有子节点的一级，被外键 RESTRICT 挡住（23001）", { skip: !testDatabaseUrl }, async () => {
  const cat = await makeCategory(`${OWN_PREFIX}RESTRICT父`);
  await repo!.createSubcategory({ id: uniqueId("sub"), categoryId: cat.id, name: `${OWN_PREFIX}RESTRICT子` });
  // 码值取 23001 而非 23503：实跑 pg 驱动 err.code 确认，ON DELETE RESTRICT 命中
  // 的是 restrict_violation（23001），「父键不存在」才是 foreign_key_violation（23503，
  // 见下一条「三级无处可挂」用例）。两者混用会让断言在约束被改动后静默失真。
  await assert.rejects(
    () => pool!.query("DELETE FROM industry_categories WHERE id = $1", [cat.id]),
    (err: unknown) => (err as { code?: string }).code === "23001",
    "外键 RESTRICT 应抛 23001（restrict_violation）",
  );
});

// ---------------------------------------------------------------
// 两层级结构性不可能：三级无处可挂
// ---------------------------------------------------------------

test("表结构不存在「父指向二级」的落点：category_id 外键只指一级", { skip: !testDatabaseUrl }, async () => {
  const cat = await makeCategory(`${OWN_PREFIX}两级验证`);
  const sub = await repo!.createSubcategory({ id: uniqueId("sub"), categoryId: cat.id, name: `${OWN_PREFIX}二级行` });
  // 把某节点的父指向一个二级 id —— 父列引用的是 industry_categories(id)，
  // 二级行根本不在那张表里，外键必然失败。这就是「三级挂不上去」的结构性原因。
  await assert.rejects(
    () =>
      pool!.query(
        "INSERT INTO industry_subcategories " +
          "(id, category_id, name, status, sort_order, created_at, updated_at) " +
          "VALUES ($1, $2, $3, 'active', 0, now(), now())",
        [uniqueId("sub3"), sub.id, `${OWN_PREFIX}三级尝试`],
      ),
    (err: unknown) => (err as { code?: string }).code === "23503",
  );
  const subs = (await repo!.listSubcategories()).filter((s) => s.categoryId === cat.id);
  assert.equal(subs.length, 1, "本用例里合法的二级行仍只有一条，失败的插入不得留痕");
});

// ---------------------------------------------------------------
// 范式 #1：错误边界不泄基础设施细节
// ---------------------------------------------------------------

test("底层读失败收敛为 MASTER_DATA_STORE_INTERNAL，不泄 SQL 与连接串", { skip: !testDatabaseUrl }, async () => {
  // 指向一个必然连不上的端口：底层报错含连接串与 SQL，经 toSafeError 后必须只剩稳定码。
  const deadPool = new Pool({ connectionString: "postgres://nobody:secret@127.0.0.1:1/wes_no_db", max: 1 });
  const brokenRepo = createIndustryPgRepository(drizzle(deadPool));
  try {
    await assert.rejects(
      () => brokenRepo.listCategories(),
      (err: unknown) => {
        assert.ok(err instanceof MasterDataError, "必须是 MasterDataError");
        assert.equal(err.code, "MASTER_DATA_STORE_INTERNAL");
        assert.ok(
          !/postgres:\/\/|password|secret|SELECT|ECONNREFUSED/i.test(err.message),
          `错误消息不得含 SQL/连接串/底层错误：${err.message}`,
        );
        return true;
      },
    );
  } finally {
    await deadPool.end().catch(() => undefined);
  }
});

test("空表合法：本域无数据时 list 返回空数组而非抛错", { skip: !testDatabaseUrl }, async () => {
  const cats = (await repo!.listCategories()).filter((c) => c.id.startsWith(OWN_PREFIX));
  const subs = (await repo!.listSubcategories()).filter((s) => s.id.startsWith(OWN_PREFIX));
  assert.deepEqual(cats, []);
  assert.deepEqual(subs, []);
});
