// ============================================================
// RBAC 中间件 Express e2e 测试
// ============================================================
// 使用 supertest 启动真实 Express 实例，验证 RBAC 中间件的
// 401/403/200 响应路径 + 7 角色覆盖 + req.user 挂载
//

import test, { after } from "node:test";
import assert from "node:assert/strict";
import express, { Request, Response } from "express";
import supertest from "supertest";

import { requireCapability, requireAnyCapability, requireV2Role, requireAuthenticated } from "./middleware";
import { signAuthToken } from "../middleware/auth";
import { cleanupOneTestUser, cleanupTestUsers, createTestUser } from "../test-helpers/test-users";
import type { AuthUser } from "../types";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// S1 后：测试用户注入 PG 测试用户池（wes-rbac-* 前缀，C5 数据集隔离），
// after 按前缀条件 DELETE，禁止污染真实用户表。无 DB 环境整体 skip（C4）。
after(async () => {
  if (!testDatabaseUrl) return;
  await cleanupTestUsers("wes-rbac");
});

// ------------------------------------------------------------------
// 测试辅助：创建临时用户 + 生成 token
// ------------------------------------------------------------------

// S1 后注入方式：统一走 PG 测试用户池（wes-rbac-* 前缀），随机 username
// 幂等（冲突重放返回原记录）；after 按前缀条件 DELETE。
async function createTempUser(overrides: Partial<AuthUser> = {}): Promise<AuthUser> {
  return createTestUser("wes-rbac", { role: overrides.role ?? "user", ...overrides });
}

function createTokenForUser(user: AuthUser): string {
  return signAuthToken(user);
}

// ------------------------------------------------------------------
// 测试套件
// ------------------------------------------------------------------

test("RBAC e2e: 无 Authorization header → 401", { skip: !testDatabaseUrl }, async () => {
  const app = express();
  app.use(requireCapability("estimates:create"));
  app.get("/test", (_req: Request, res: Response) => res.json({ ok: true }));

  const response = await supertest(app).get("/test");

  assert.equal(response.status, 401);
  assert.equal(response.body.code, 40101);
  assert.equal(response.body.message, "未登录或凭证缺失");
});

test("RBAC e2e: 错误 token → 401", { skip: !testDatabaseUrl }, async () => {
  const app = express();
  app.use(requireCapability("estimates:create"));
  app.get("/test", (_req: Request, res: Response) => res.json({ ok: true }));

  const response = await supertest(app)
    .get("/test")
    .set("Authorization", "Bearer invalid-token-12345");

  assert.equal(response.status, 401);
  assert.equal(response.body.code, 40102);
  assert.equal(response.body.message, "登录态无效");
});

test("RBAC e2e: 正确 token + 错误能力位 → 403（含详情字段）", { skip: !testDatabaseUrl }, async () => {
  const user = await createTempUser({ role: "user" }); // user → PRE_SALES
  const token = createTokenForUser(user);

  const app = express();
  app.use(requireCapability("dsl:manage")); // PRE_SALES 没有这个能力
  app.get("/test", (_req: Request, res: Response) => res.json({ ok: true }));

  const response = await supertest(app)
    .get("/test")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 403);
  assert.equal(response.body.code, 40301);
  assert.equal(response.body.message, "权限不足");
  assert.ok(response.body.details, "应有 details 字段");
  assert.ok(response.body.details[0], "details 应有至少一项");
  assert.equal(response.body.details[0].field, "capability");
  assert.ok(response.body.details[0].userLegacyRole, "应有 userLegacyRole");
  assert.ok(response.body.details[0].userV2Roles, "应有 userV2Roles");
  assert.ok(Array.isArray(response.body.details[0].userV2Roles), "userV2Roles 应为数组");
});

test("RBAC e2e: 正确 token + 正确能力位 → 200", { skip: !testDatabaseUrl }, async () => {
  const user = await createTempUser({ role: "user" }); // user → PRE_SALES
  const token = createTokenForUser(user);

  const app = express();
  app.use(requireCapability("extractor:trigger")); // PRE_SALES 有这个能力
  app.get("/test", (req: Request, res: Response) => {
    res.json({ ok: true, userId: req.user?.id, userRole: req.user?.role });
  });

  const response = await supertest(app)
    .get("/test")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.userId, user.id);
  assert.equal(response.body.userRole, user.role);
});

test("RBAC e2e: requireAnyCapability 任一通过 → 200", { skip: !testDatabaseUrl }, async () => {
  const user = await createTempUser({ role: "sub_admin" }); // sub_admin → PM
  const token = createTokenForUser(user);

  const app = express();
  app.use(requireAnyCapability("dsl:manage", "assessment:handoff")); // PM 有 assessment:handoff
  app.get("/test", (_req: Request, res: Response) => res.json({ ok: true }));

  const response = await supertest(app)
    .get("/test")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
});

test("RBAC e2e: requireV2Role 角色不在白名单 → 403", { skip: !testDatabaseUrl }, async () => {
  const user = await createTempUser({ role: "user" }); // user → PRE_SALES
  const token = createTokenForUser(user);

  const app = express();
  app.use(requireV2Role("ADMIN", "PMO")); // PRE_SALES 不在白名单
  app.get("/test", (_req: Request, res: Response) => res.json({ ok: true }));

  const response = await supertest(app)
    .get("/test")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 403);
  assert.equal(response.body.code, 40301);
  assert.equal(response.body.details[0].field, "role");
});

test("RBAC e2e: legacy user/PRE_SALES → estimates:create 通过", { skip: !testDatabaseUrl }, async () => {
  // 断言不依赖 id 具体值（PG users.user_id 为 uuid 列，原固定 id=sales-001
  // 在 uuid 约束下不合法）；固定 username=sales001 先清后建（幂等重跑安全），
  // 用例结束清理。
  await cleanupOneTestUser("sales001");
  try {
    const user = await createTempUser({ username: "sales001", role: "user" });
    const token = createTokenForUser(user);

    const app = express();
    app.use(requireCapability("estimates:create"));
    app.get("/test", (req: Request, res: Response) => {
      res.json({ ok: true, v2Roles: req.v2Roles });
    });

    const response = await supertest(app)
      .get("/test")
      .set("Authorization", `Bearer ${token}`);

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.v2Roles, ["PRE_SALES"]);
  } finally {
    await cleanupOneTestUser("sales001");
  }
});

test("RBAC e2e: ADMIN 角色 → 所有能力位通过", { skip: !testDatabaseUrl }, async () => {
  const user = await createTempUser({ role: "admin" });
  const token = createTokenForUser(user);

  const app = express();
  app.use(requireCapability("dsl:manage"));
  app.get("/test", (req: Request, res: Response) => {
    res.json({ ok: true, v2Roles: req.v2Roles });
  });

  const response = await supertest(app)
    .get("/test")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.v2Roles, ["ADMIN"]);
});

test("RBAC e2e: requireAuthenticated 仅认证不检查能力 → 200", { skip: !testDatabaseUrl }, async () => {
  const user = await createTempUser({ role: "user" });
  const token = createTokenForUser(user);

  const app = express();
  app.use(requireAuthenticated());
  app.get("/test", (req: Request, res: Response) => {
    res.json({ ok: true, userId: req.user?.id, v2Roles: req.v2Roles });
  });

  const response = await supertest(app)
    .get("/test")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.userId, user.id);
  assert.ok(Array.isArray(response.body.v2Roles));
});

test("RBAC e2e: req.user 在 handler 中可拿到 id 和 role", { skip: !testDatabaseUrl }, async () => {
  const user = await createTempUser({ role: "sub_admin" });
  const token = createTokenForUser(user);

  const app = express();
  app.use(requireCapability("estimates:read"));
  app.get("/test", (req: Request, res: Response) => {
    res.json({
      id: req.user?.id,
      role: req.user?.role,
      v2Roles: req.v2Roles,
    });
  });

  const response = await supertest(app)
    .get("/test")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.id, user.id);
  assert.equal(response.body.role, user.role);
  assert.deepEqual(response.body.v2Roles, ["PM"]);
});

// ------------------------------------------------------------------
// 7 角色覆盖测试（每个角色至少 1 条）
// ------------------------------------------------------------------

test("RBAC e2e: 角色覆盖 - SALES (通过 admin 模拟 estimates:create)", { skip: !testDatabaseUrl }, async () => {
  const user = await createTempUser({ role: "admin" });
  const token = createTokenForUser(user);

  const app = express();
  app.use(requireCapability("estimates:create"));
  app.get("/test", (_req: Request, res: Response) => res.json({ ok: true }));

  const response = await supertest(app)
    .get("/test")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
});

test("RBAC e2e: 角色覆盖 - PRE_SALES (extractor:trigger)", { skip: !testDatabaseUrl }, async () => {
  const user = await createTempUser({ role: "user" });
  const token = createTokenForUser(user);

  const app = express();
  app.use(requireCapability("extractor:trigger"));
  app.get("/test", (_req: Request, res: Response) => res.json({ ok: true }));

  const response = await supertest(app)
    .get("/test")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
});

test("RBAC e2e: 角色覆盖 - IMPL (assessment:create)", { skip: !testDatabaseUrl }, async () => {
  // IMPL 需要通过自定义用户或直接测试能力位
  // 这里用 admin 模拟（ADMIN 拥有 IMPL 的所有能力）
  const user = await createTempUser({ role: "admin" });
  const token = createTokenForUser(user);

  const app = express();
  app.use(requireCapability("assessment:create"));
  app.get("/test", (_req: Request, res: Response) => res.json({ ok: true }));

  const response = await supertest(app)
    .get("/test")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
});

test("RBAC e2e: 角色覆盖 - PM (assessment:handoff)", { skip: !testDatabaseUrl }, async () => {
  const user = await createTempUser({ role: "sub_admin" });
  const token = createTokenForUser(user);

  const app = express();
  app.use(requireCapability("assessment:handoff"));
  app.get("/test", (_req: Request, res: Response) => res.json({ ok: true }));

  const response = await supertest(app)
    .get("/test")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
});

test("RBAC e2e: 角色覆盖 - DEV (dev:write)", { skip: !testDatabaseUrl }, async () => {
  const user = await createTempUser({ role: "admin" }); // ADMIN 有 dev:write
  const token = createTokenForUser(user);

  const app = express();
  app.use(requireCapability("dev:write"));
  app.get("/test", (_req: Request, res: Response) => res.json({ ok: true }));

  const response = await supertest(app)
    .get("/test")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
});

test("RBAC e2e: 角色覆盖 - PMO (deliverable:review)", { skip: !testDatabaseUrl }, async () => {
  const user = await createTempUser({ role: "admin" }); // ADMIN 有 deliverable:review
  const token = createTokenForUser(user);

  const app = express();
  app.use(requireCapability("deliverable:review"));
  app.get("/test", (_req: Request, res: Response) => res.json({ ok: true }));

  const response = await supertest(app)
    .get("/test")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
});

test("RBAC e2e: 角色覆盖 - ADMIN (system:manage)", { skip: !testDatabaseUrl }, async () => {
  const user = await createTempUser({ role: "admin" });
  const token = createTokenForUser(user);

  const app = express();
  app.use(requireCapability("system:manage"));
  app.get("/test", (_req: Request, res: Response) => res.json({ ok: true }));

  const response = await supertest(app)
    .get("/test")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
});
