// ============================================================
// 批次 6b · 工具策略（system_configs 第五配置区）· PG 路径用例
// ============================================================
// 覆盖：
//  · draft→生效 + version 机制与其余四区同构（不另造草稿存储）；
//  · 判据⑤：变更轨迹可查——谁（JWT username）、何时、改了什么，且对得上 version 递增；
//  · 判据①② 的持久面：策略停用/角色可见落库后 resolveActiveToolPolicy 如实回读，
//    注入点据此裁切（注入行为本体见 workbench-tool-loop.test.ts）。
//
// 本文件写 system_configs.toolPolicy 行（config_key 固定、无隔离维度），
// 必须在 test:modules:serial-store 串行组内执行（同 system.kb-config.test.ts 判据）。
// ============================================================

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import { Pool } from "pg";
import type { Request, Response } from "express";
import type { AuthUser } from "../../types";
import { cleanupOneTestUser, createTestUser } from "../../test-helpers/test-users";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null;
let testAdmin: AuthUser | null = null;
let testUser: AuthUser | null = null;

before(async () => {
  const { _resetSystemRepositoryForTest } = await import("./system.repository");
  _resetSystemRepositoryForTest();
  if (!testDatabaseUrl) return;
  pool = new Pool({ connectionString: testDatabaseUrl, max: 5 });
  await cleanupOneTestUser("b6b-admin");
  await cleanupOneTestUser("b6b-user");
  testAdmin = await createTestUser("wes-tool-policy", { id: randomUUID(), username: "b6b-admin", role: "admin", businessRole: "admin" });
  testUser = await createTestUser("wes-tool-policy", { id: randomUUID(), username: "b6b-user", role: "user" });
});

after(async () => {
  if (testDatabaseUrl) {
    await cleanupOneTestUser("b6b-admin");
    await cleanupOneTestUser("b6b-user");
  }
  await resetStore();
  if (pool) await pool.end();
});

function responseCapture() {
  let statusCode = 200;
  let payload: any;
  const response = {
    locals: { requestId: "00000000-0000-4000-8000-000000000001" },
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { payload = value; return this; },
  } as unknown as Response;
  return { response, get statusCode() { return statusCode; }, get payload() { return payload; } };
}

async function requestFor(actor: AuthUser | null, body: unknown = {}) {
  const { signAuthToken } = await import("../../middleware/auth");
  const token = signAuthToken(actor as AuthUser);
  return {
    body,
    query: {},
    headers: { authorization: `Bearer ${token}` },
    header(name: string) { return name.toLowerCase() === "authorization" ? `Bearer ${token}` : undefined; },
  } as unknown as Request;
}

async function resetStore(): Promise<void> {
  if (!pool) return;
  await pool.query("DELETE FROM system_configs WHERE config_key = 'toolPolicy'");
}

test("第五配置区：缺行读回默认（version=1、空策略、零轨迹），与其余配置区同口径", { skip: !testDatabaseUrl, concurrency: false }, async () => {
  await resetStore();
  const { getToolPolicy } = await import("./system.usecase");
  const capture = responseCapture();
  await getToolPolicy(await requestFor(testAdmin), capture.response);
  assert.equal(capture.statusCode, 200);
  const data = capture.payload.data;
  assert.equal(data.version, 1);
  assert.deepEqual(data.active, { schemaVersion: 1, policies: {} });
  assert.deepEqual(data.draft, { schemaVersion: 1, policies: {} });
  assert.deepEqual(data.revisions, []);
});

test("判据⑤：草稿 PATCH 记 actor/时间/字段级 diff；version 不动（生效才递增）", { skip: !testDatabaseUrl, concurrency: false }, async () => {
  await resetStore();
  const { getToolPolicy, updateToolPolicyDraft } = await import("./system.usecase");
  const capture = responseCapture();
  await updateToolPolicyDraft(
    await requestFor(testAdmin, {
      policies: {
        export_report: { enabled: false, visibleRoles: [], approvalStrategy: "default", injectionMode: "default" },
        knowledge_query: { enabled: true, visibleRoles: ["PM", "ADMIN"], approvalStrategy: "default", injectionMode: "on-demand" },
      },
    }),
    capture.response,
  );
  assert.equal(capture.statusCode, 200);
  const data = capture.payload.data;
  assert.equal(data.version, 1, "草稿不动 version");
  assert.equal(data.draft.policies.export_report.enabled, false);
  assert.deepEqual(data.draft.policies.knowledge_query.visibleRoles, ["PM", "ADMIN"]);

  // 重新读取确认已持久化（不是响应体自说自话）
  const reload = responseCapture();
  await getToolPolicy(await requestFor(testAdmin), reload.response);
  const stored = reload.payload.data;
  assert.equal(stored.draft.policies.export_report.enabled, false);
  assert.equal(stored.active.policies.export_report, undefined, "未生效前 active 仍是默认");

  const revision = stored.revisions[stored.revisions.length - 1];
  assert.equal(revision.actor, "b6b-admin", "actor 取 JWT 可信身份");
  assert.equal(revision.action, "draft-update");
  assert.equal(revision.version, 1);
  assert.ok(Number.isFinite(Date.parse(revision.at)), "at 为合法时间戳");
  assert.deepEqual(
    revision.changes.map((change: any) => `${change.tool}.${change.field}:${change.from}→${change.to}`).sort(),
    [
      "export_report.enabled:true→false",
      "knowledge_query.injectionMode:default→on-demand",
      "knowledge_query.visibleRoles:（全部角色）→PM,ADMIN",
    ],
  );
});

test("判据⑤：生效 → active 换血、version 递增、轨迹记 activate 且 diff 对齐生效变化", { skip: !testDatabaseUrl, concurrency: false }, async () => {
  const { activateToolPolicy, getToolPolicy } = await import("./system.usecase");
  const capture = responseCapture();
  await activateToolPolicy(await requestFor(testAdmin), capture.response);
  assert.equal(capture.statusCode, 200);
  const data = capture.payload.data;
  assert.equal(data.version, 2, "生效即 +1");
  assert.equal(data.active.policies.export_report.enabled, false);

  const revision = data.revisions[data.revisions.length - 1];
  assert.equal(revision.action, "activate");
  assert.equal(revision.version, 2, "轨迹 version 与生效后值对账");
  assert.equal(revision.actor, "b6b-admin");
  assert.equal(revision.changes.length, 3, "diff 只记 prev active → new active 的真实变化");

  // 注入点读到的生效策略与页面一致
  const { resolveActiveToolPolicy } = await import("./system.repository");
  const active = await resolveActiveToolPolicy();
  assert.equal(active.policies.export_report.enabled, false);
});

test("生效幂等：active 与 draft 无差异时 version 仍递增、轨迹记空 changes（审计记「谁按了生效」）", { skip: !testDatabaseUrl, concurrency: false }, async () => {
  const { activateToolPolicy } = await import("./system.usecase");
  const capture = responseCapture();
  await activateToolPolicy(await requestFor(testAdmin), capture.response);
  const data = capture.payload.data;
  assert.equal(data.version, 3);
  const revision = data.revisions[data.revisions.length - 1];
  assert.equal(revision.action, "activate");
  assert.deepEqual(revision.changes, []);
});

test("非 admin 不得读写策略（403；策略是 system:manage + admin 双闸）", { skip: !testDatabaseUrl, concurrency: false }, async () => {
  const { activateToolPolicy, getToolPolicy, updateToolPolicyDraft } = await import("./system.usecase");
  const getCapture = responseCapture();
  await getToolPolicy(await requestFor(testUser), getCapture.response);
  assert.equal(getCapture.statusCode, 403);
  const patchCapture = responseCapture();
  await updateToolPolicyDraft(await requestFor(testUser, { policies: {} }), patchCapture.response);
  assert.equal(patchCapture.statusCode, 403);
  const activateCapture = responseCapture();
  await activateToolPolicy(await requestFor(testUser), activateCapture.response);
  assert.equal(activateCapture.statusCode, 403);
});

test("非法输入收敛：未知角色名/非法枚举/超长条目在归一化处收口，不原样落库", { skip: !testDatabaseUrl, concurrency: false }, async () => {
  await resetStore();
  const { updateToolPolicyDraft } = await import("./system.usecase");
  const capture = responseCapture();
  await updateToolPolicyDraft(
    await requestFor(testAdmin, {
      policies: {
        create_project: { enabled: true, visibleRoles: ["SUPERUSER", "PM"], approvalStrategy: "no-approval", injectionMode: "force-core" },
      },
    }),
    capture.response,
  );
  assert.equal(capture.statusCode, 200);
  const entry = capture.payload.data.draft.policies.create_project;
  assert.deepEqual(entry.visibleRoles, ["PM"], "非法角色剔除");
  assert.equal(entry.approvalStrategy, "default", "「免审批」类词汇不得生效");
  assert.equal(entry.injectionMode, "default", "「强制常驻」类词汇不得生效");
});
