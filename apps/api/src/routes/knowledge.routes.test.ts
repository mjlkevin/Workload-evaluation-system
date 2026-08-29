// ============================================================
// SP-2026-007 · MS1（M1 中文混合检索基线）
// knowledge.routes — JWT 鉴权 + 响应结构 { code, message, data }
// ============================================================

import test, { after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import supertest from "supertest";

import { createKnowledgeRouter } from "./knowledge.routes";
import {
  createKnowledgeInMemoryRepository,
  type KnowledgeInMemoryRepository,
} from "../test-helpers/knowledge-in-memory.repository";
import { signAuthToken } from "../middleware/auth";
import { cleanupTestUsers, createTestUser } from "../test-helpers/test-users";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
let repo: KnowledgeInMemoryRepository;

// 竞态隔离（S1 后形态）：阶段 2 S1（2026-08-25）users 域已切 PG，原 chdir
// 沙箱（isolate-config-root.ts）退役；临时用户注入 PG 测试用户池，after 按
// 前缀条件 DELETE（C5 数据集隔离）。无 DB 时用例整体 skip，钩子不得抛错。
//
// 语料侧（阶段 2 S6 · 2026-08-29）：knowledge JSON 仓储类删除后，本文件不再
// 写临时 store.json，改用 in-memory 替身（test-helpers/knowledge-in-memory.
// repository.ts）——零 fs、零 knowledge_entries 写入，因此本文件不进串行组。
after(async () => {
  if (!testDatabaseUrl) return;
  await cleanupTestUsers("wes-knowledge-route");
});

function setupApp() {
  repo = createKnowledgeInMemoryRepository([
    { id: "r-1", title: "售前估算流程", content: "售前估算用于评估实施工作量与人天。", status: "active" },
  ]);
  const app = express();
  app.use(express.json());
  app.use("/knowledge", createKnowledgeRouter({ repo }));
  return supertest(app);
}

async function createTempUser(role: "admin" | "user"): Promise<{ token: string }> {
  const user = await createTestUser("wes-knowledge-route", { role });
  return { token: signAuthToken(user) };
}

test("GET /knowledge/search 未带 token 返回 401", { skip: !testDatabaseUrl }, async () => {
  const request = setupApp();
  const res = await request.get("/knowledge/search").query({ q: "售前估算" });
  assert.equal(res.status, 401);
});

test("GET /knowledge/search 带 token 返回 { code:0, data.items }", { skip: !testDatabaseUrl }, async () => {
  const request = setupApp();
  const { token } = await createTempUser("user");
  const res = await request
    .get("/knowledge/search")
    .query({ q: "售前估算" })
    .set("Authorization", `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.code, 0);
  assert.ok(Array.isArray(res.body.data.items), "data.items 应为数组");
  assert.ok(res.body.data.items.length > 0, "种子条目应被检索到");
  assert.ok(res.body.data.guard, "响应应含护栏留痕");
});

test("GET /knowledge/search 缺 q 参数返回非零 code", { skip: !testDatabaseUrl }, async () => {
  const request = setupApp();
  const { token } = await createTempUser("user");
  const res = await request.get("/knowledge/search").set("Authorization", `Bearer ${token}`);
  assert.notEqual(res.body.code, 0, "缺 q 应报错");
});

test("GET /knowledge/entries 返回条目列表", { skip: !testDatabaseUrl }, async () => {
  const request = setupApp();
  const { token } = await createTempUser("user");
  const res = await request.get("/knowledge/entries").set("Authorization", `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.code, 0);
  assert.ok(Array.isArray(res.body.data.items));
});

test("POST /knowledge/entries admin 可创建，普通 user 返回 403", { skip: !testDatabaseUrl }, async () => {
  const request = setupApp();

  const admin = await createTempUser("admin");
  const okRes = await request
    .post("/knowledge/entries")
    .set("Authorization", `Bearer ${admin.token}`)
    .send({ title: "新增条目", content: "新增知识内容。" });
  assert.equal(okRes.status, 200);
  assert.equal(okRes.body.code, 0);
  assert.ok(okRes.body.data.entry.id, "应返回创建条目 id");

  const plainUser = await createTempUser("user");
  const deniedRes = await request
    .post("/knowledge/entries")
    .set("Authorization", `Bearer ${plainUser.token}`)
    .send({ title: "越权条目", content: "不应创建成功。" });
  assert.equal(deniedRes.status, 403, "user 角色无 system:manage 应 403");
});
