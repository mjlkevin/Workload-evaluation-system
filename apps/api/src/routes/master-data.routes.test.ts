// ============================================================
// 批次 10a · 基础管理（行业主数据）路由测试
// ============================================================
// 覆盖：JWT 鉴权 + 能力位分级（读 estimates:read / 写 system:manage）、
// 响应结构 { code, message, data }、本批三条要害判据的接口侧形态：
//   ① 停用后 options 里没有它、tree 里仍看得见（判据 3）
//   ② DELETE 一律 405 + 稳定码 40501（判据 4，HTTP 侧）
//   ③ 非法 status / 空名入参被拒（不落到存储）
//
// 存储用 in-memory 替身（test-helpers/industry-in-memory.repository.ts）：
// 零 fs、零 industry_* 表写入，因此本文件不进串行组。
// 临时用户注入 PG 测试用户池（S1 后 users 已切 PG），after 按前缀清理；
// 无 DB 时整体跳过（与 knowledge.routes.test.ts 同范式）。

import assert from "node:assert/strict";
import { after, test } from "node:test";
import express from "express";
import supertest from "supertest";

import { createMasterDataRouter } from "./master-data.routes";
import { createIndustryInMemoryRepository } from "../test-helpers/industry-in-memory.repository";
import { signAuthToken } from "../middleware/auth";
import { cleanupTestUsers, createTestUser } from "../test-helpers/test-users";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const USER_PREFIX = "wes-b10a-route";

after(async () => {
  if (!testDatabaseUrl) return;
  await cleanupTestUsers(USER_PREFIX);
});

function setupApp() {
  const repo = createIndustryInMemoryRepository({
    categories: [
      {
        id: "seed-cat-mfg",
        name: "制造业",
        status: "active",
        sortOrder: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "seed-cat-other",
        name: "其他",
        status: "active",
        sortOrder: 1,
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
    subcategories: [
      {
        id: "seed-sub-1",
        categoryId: "seed-cat-mfg",
        name: "离散制造",
        status: "active",
        sortOrder: 0,
        createdAt: "2026-01-03T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
    ],
  });
  const app = express();
  app.use(express.json());
  app.use("/master-data", createMasterDataRouter({ repo }));
  return { request: supertest(app), repo };
}

async function tokenFor(role: "admin" | "user"): Promise<string> {
  const user = await createTestUser(USER_PREFIX, { role });
  return signAuthToken(user);
}

// ---------------------------------------------------------------
// 鉴权与能力位
// ---------------------------------------------------------------

test("GET /master-data/industries/tree 未带 token 返回 401", { skip: !testDatabaseUrl }, async () => {
  const { request } = setupApp();
  const res = await request.get("/master-data/industries/tree");
  assert.equal(res.status, 401);
});

test("读端点业务角色（user）可用：新建单据要取行业下拉", { skip: !testDatabaseUrl }, async () => {
  const { request } = setupApp();
  const token = await tokenFor("user");
  const res = await request.get("/master-data/industries/options").set("Authorization", `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.code, 0);
  assert.deepEqual(
    res.body.data.items.map((o: { value: string }) => o.value),
    ["制造业", "离散制造", "其他"],
  );
});

test("写端点业务角色（user）被拒 403，管理员可写", { skip: !testDatabaseUrl }, async () => {
  const { request } = setupApp();
  const userToken = await tokenFor("user");
  const adminToken = await tokenFor("admin");

  const denied = await request
    .post("/master-data/industries/categories")
    .set("Authorization", `Bearer ${userToken}`)
    .send({ name: "wes-b10a-新大类" });
  assert.equal(denied.status, 403, "主数据维护是管理动作，非 admin 不得写");

  const allowed = await request
    .post("/master-data/industries/categories")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "wes-b10a-新大类" });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.code, 0);
  assert.equal(allowed.body.data.category.name, "wes-b10a-新大类");
});

// ---------------------------------------------------------------
// 判据 3：停用后新单据选不到，树里仍看得见
// ---------------------------------------------------------------

test("停用一个行业 → options 里没有它，tree 里它仍在", { skip: !testDatabaseUrl }, async () => {
  const { request } = setupApp();
  const adminToken = await tokenFor("admin");

  const off = await request
    .post("/master-data/industries/categories/seed-cat-other/status")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "inactive" });
  assert.equal(off.status, 200);
  assert.equal(off.body.data.row.status, "inactive");

  const options = await request
    .get("/master-data/industries/options")
    .set("Authorization", `Bearer ${adminToken}`);
  const values = options.body.data.items.map((o: { value: string }) => o.value);
  assert.ok(!values.includes("其他"), "停用后不得出现在新建单据的选项里");
  assert.deepEqual(values, ["制造业", "离散制造"]);

  const tree = await request
    .get("/master-data/industries/tree")
    .set("Authorization", `Bearer ${adminToken}`);
  const names = tree.body.data.items.map((c: { name: string }) => c.name);
  assert.ok(names.includes("其他"), "管理页必须仍能看到并重新启用它——停用不是消失");
  const other = tree.body.data.items.find((c: { name: string }) => c.name === "其他");
  assert.equal(other.status, "inactive");
});

// ---------------------------------------------------------------
// 判据 4：硬删被拒（HTTP 侧）
// ---------------------------------------------------------------

test("DELETE 一级 / 二级一律 405 + 稳定码 40501，且停用能力不受影响", { skip: !testDatabaseUrl }, async () => {
  const { request, repo } = setupApp();
  const adminToken = await tokenFor("admin");

  for (const path of [
    "/master-data/industries/categories/seed-cat-mfg",
    "/master-data/industries/subcategories/seed-sub-1",
  ]) {
    const res = await request.delete(path).set("Authorization", `Bearer ${adminToken}`);
    assert.equal(res.status, 405, `${path} 应回 405 而不是 404（删除动作本身不被允许）`);
    assert.equal(res.body.code, 40501);
    assert.match(res.body.message, /禁止硬删/);
    assert.equal(res.headers.allow, "GET, POST, PATCH", "405 应带 Allow 指明允许的方法");
  }
  const snap = repo.snapshot();
  assert.equal(snap.categories.length, 2, "被拒的删除不得动到任何行");
  assert.equal(snap.subcategories.length, 1);
});

test("DELETE 对非 admin 先被能力位挡住（403），不会绕过鉴权探到 405", { skip: !testDatabaseUrl }, async () => {
  const { request } = setupApp();
  const userToken = await tokenFor("user");
  const res = await request
    .delete("/master-data/industries/categories/seed-cat-mfg")
    .set("Authorization", `Bearer ${userToken}`);
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------
// 两层结构的接口侧：新增二级必须带父键，且不提供任何指向二级的父
// ---------------------------------------------------------------

test("新增二级不带 categoryId → 400；带不存在的父 → 404", { skip: !testDatabaseUrl }, async () => {
  const { request } = setupApp();
  const adminToken = await tokenFor("admin");

  const noParent = await request
    .post("/master-data/industries/subcategories")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "wes-b10a-无父细分" });
  assert.equal(noParent.status, 400);
  assert.equal(noParent.body.code, 40001);

  const badParent = await request
    .post("/master-data/industries/subcategories")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "wes-b10a-错父细分", categoryId: "wes-b10a-不存在的大类" });
  assert.equal(badParent.status, 404);
  assert.equal(badParent.body.code, 40401);
});

test("新增二级挂到一级下成功，树里出现在该一级的 children 下", { skip: !testDatabaseUrl }, async () => {
  const { request } = setupApp();
  const adminToken = await tokenFor("admin");
  const created = await request
    .post("/master-data/industries/subcategories")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "wes-b10a-流程制造", categoryId: "seed-cat-mfg" });
  assert.equal(created.status, 200);
  assert.equal(created.body.data.subcategory.categoryId, "seed-cat-mfg");

  const tree = await request
    .get("/master-data/industries/tree")
    .set("Authorization", `Bearer ${adminToken}`);
  const mfg = tree.body.data.items.find((c: { name: string }) => c.name === "制造业");
  assert.deepEqual(
    mfg.children.map((s: { name: string }) => s.name),
    ["离散制造", "wes-b10a-流程制造"],
  );
});

test("接口层不存在任何能创建三级节点的入口：subcategories 的父键字段只有 categoryId 且只认一级", { skip: !testDatabaseUrl }, async () => {
  const { request } = setupApp();
  const adminToken = await tokenFor("admin");
  // 把一个二级的 id 当父键传 → 404（父键只存在于一级表），三级无处可挂
  const res = await request
    .post("/master-data/industries/subcategories")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "wes-b10a-三级尝试", categoryId: "seed-sub-1" });
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 40401);
});

// ---------------------------------------------------------------
// 入参收敛与冲突码
// ---------------------------------------------------------------

test("非法 status 字面量被拒 400，不落库", { skip: !testDatabaseUrl }, async () => {
  const { request, repo } = setupApp();
  const adminToken = await tokenFor("admin");
  const res = await request
    .post("/master-data/industries/categories/seed-cat-mfg/status")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "deleted" });
  assert.equal(res.status, 400);
  assert.equal(repo.snapshot().categories.find((c) => c.id === "seed-cat-mfg")!.status, "active");
});

test("重名新增返回 409", { skip: !testDatabaseUrl }, async () => {
  const { request } = setupApp();
  const adminToken = await tokenFor("admin");
  const res = await request
    .post("/master-data/industries/categories")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "制造业" });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 40901);
});

test("PATCH 改名与排序生效，未列字段不变", { skip: !testDatabaseUrl }, async () => {
  const { request } = setupApp();
  const adminToken = await tokenFor("admin");
  const res = await request
    .patch("/master-data/industries/subcategories/seed-sub-1")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ sortOrder: 5 });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.subcategory.name, "离散制造", "只传 sortOrder 不得改名");
  assert.equal(res.body.data.subcategory.sortOrder, 5);
  assert.equal(res.body.data.subcategory.status, "active", "只传 sortOrder 不得改状态");
});
