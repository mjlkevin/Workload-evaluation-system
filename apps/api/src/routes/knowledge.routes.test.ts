// ============================================================
// SP-2026-007 · MS1（M1 中文混合检索基线）
// knowledge.routes — JWT 鉴权 + 响应结构 { code, message, data }
// ============================================================

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import supertest from "supertest";

import { createKnowledgeRouter } from "./knowledge.routes";
import { KnowledgeRepository } from "../modules/knowledge/knowledge.repository";
import { loadUsersStore, saveUsersStore, signAuthToken } from "../middleware/auth";
import type { AuthUser } from "../types";

const USERS_JSON = path.resolve(__dirname, "../../../../config/auth/users.json");
let originalUsersJson = "";
let storePath: string;
let repo: KnowledgeRepository;

before(() => {
  originalUsersJson = fs.readFileSync(USERS_JSON, "utf8");
});

after(() => {
  fs.writeFileSync(USERS_JSON, originalUsersJson);
});

function setupApp() {
  storePath = path.join(os.tmpdir(), `wes-knowledge-routes-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(
    storePath,
    JSON.stringify({
      entries: [
        { id: "r-1", title: "售前估算流程", content: "售前估算用于评估实施工作量与人天。", status: "active" },
      ],
    }),
    "utf-8",
  );
  repo = new KnowledgeRepository(storePath);
  const app = express();
  app.use(express.json());
  app.use("/knowledge", createKnowledgeRouter({ repo }));
  return supertest(app);
}

function createTempUser(role: "admin" | "user"): { token: string } {
  const uniqueId = randomUUID();
  const now = new Date().toISOString();
  const user: AuthUser = {
    id: `knowledge-route-user-${uniqueId}`,
    username: `knowledge-route-${uniqueId}`,
    role,
    status: "active",
    passwordHash: "",
    createdAt: now,
    lastLoginAt: now,
  };
  const store = loadUsersStore();
  store.users.push(user);
  saveUsersStore(store);
  return { token: signAuthToken(user) };
}

test("GET /knowledge/search 未带 token 返回 401", async () => {
  const request = setupApp();
  const res = await request.get("/knowledge/search").query({ q: "售前估算" });
  assert.equal(res.status, 401);
});

test("GET /knowledge/search 带 token 返回 { code:0, data.items }", async () => {
  const request = setupApp();
  const { token } = createTempUser("user");
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

test("GET /knowledge/search 缺 q 参数返回非零 code", async () => {
  const request = setupApp();
  const { token } = createTempUser("user");
  const res = await request.get("/knowledge/search").set("Authorization", `Bearer ${token}`);
  assert.notEqual(res.body.code, 0, "缺 q 应报错");
});

test("GET /knowledge/entries 返回条目列表", async () => {
  const request = setupApp();
  const { token } = createTempUser("user");
  const res = await request.get("/knowledge/entries").set("Authorization", `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.code, 0);
  assert.ok(Array.isArray(res.body.data.items));
});

test("POST /knowledge/entries admin 可创建，普通 user 返回 403", async () => {
  const request = setupApp();

  const admin = createTempUser("admin");
  const okRes = await request
    .post("/knowledge/entries")
    .set("Authorization", `Bearer ${admin.token}`)
    .send({ title: "新增条目", content: "新增知识内容。" });
  assert.equal(okRes.status, 200);
  assert.equal(okRes.body.code, 0);
  assert.ok(okRes.body.data.entry.id, "应返回创建条目 id");

  const plainUser = createTempUser("user");
  const deniedRes = await request
    .post("/knowledge/entries")
    .set("Authorization", `Bearer ${plainUser.token}`)
    .send({ title: "越权条目", content: "不应创建成功。" });
  assert.equal(deniedRes.status, 403, "user 角色无 system:manage 应 403");
});
