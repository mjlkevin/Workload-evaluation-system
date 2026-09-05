// ============================================================
// 批次 6a：GET /system/ai-tools — 只读工具清单端点
// 覆盖：未登录 401 / 无 system:manage 403 / admin 200 与清单口径
// 挂载真实 system.routes，路径与权限判定均走线上装配，不用替身路由。
// ============================================================

import test, { after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import supertest from "supertest";

import systemRoutes from "./system.routes";
import { signAuthToken } from "../middleware/auth";
import { cleanupTestUsers, createTestUser } from "../test-helpers/test-users";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
type ToolItem = {
  name: string;
  mutates: boolean;
  capability: string;
  category: string;
  discoverable: boolean;
};

after(async () => {
  if (!testDatabaseUrl) return;
  await cleanupTestUsers("wes-tool-inventory");
});

function setupApp() {
  const app = express();
  app.use(express.json());
  app.use("/system", systemRoutes);
  return supertest(app);
}

async function tokenFor(role: "admin" | "user"): Promise<string> {
  const user = await createTestUser("wes-tool-inventory", { role });
  return signAuthToken(user);
}

test("GET /system/ai-tools: 未登录返回 401", { skip: !testDatabaseUrl }, async () => {
  const res = await setupApp().get("/system/ai-tools");

  assert.equal(res.status, 401);
});

test("GET /system/ai-tools: 无 system:manage 的普通用户返回 403", { skip: !testDatabaseUrl }, async () => {
  const res = await setupApp().get("/system/ai-tools").set("Authorization", `Bearer ${await tokenFor("user")}`);

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 40301);
  assert.equal(res.body.data, undefined, "拒绝时不得带出任何清单数据");
});

test("GET /system/ai-tools: admin 取到 9 个工具，其中写数据恰 3 个", { skip: !testDatabaseUrl }, async () => {
  const res = await setupApp().get("/system/ai-tools").set("Authorization", `Bearer ${await tokenFor("admin")}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.code, 0);

  const items = res.body.data.items as ToolItem[];
  assert.equal(items.length, 9);
  assert.deepEqual(
    items.filter((item) => item.mutates).map((item) => item.name).sort(),
    ["create_project", "export_report", "generate_wbs"],
  );
  for (const item of items) {
    assert.ok(item.capability, `${item.name} 应带所需能力位`);
    assert.equal(typeof item.discoverable, "boolean");
  }
});

test("GET /system/ai-tools: 响应不含参数 schema 与执行实现", { skip: !testDatabaseUrl }, async () => {
  const res = await setupApp().get("/system/ai-tools").set("Authorization", `Bearer ${await tokenFor("admin")}`);

  const items = res.body.data.items as ToolItem[];
  for (const item of items) {
    assert.equal("parameters" in item, false, `${item.name} 不应带出 parameters`);
    assert.equal("execute" in item, false, `${item.name} 不应带出 execute`);
  }
});
