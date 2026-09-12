// ============================================================
// 批次 7 · MCP 服务配置（system_configs 第六配置区）· PG 路径用例
// ============================================================
// 覆盖：
//  · draft→生效 + version + 轨迹与第五区同构；缺行读回默认；
//  · 裁决一的持久面：**允许清单 = active.servers**——草稿登记了服务、未生效 ⇒
//    注入路径零连接零工具（不存在「配了草稿就能连」的旁路）；
//  · 放行落章：新条目盖当前操作人；重放同摘要保留原放行人（不得冒充）；
//  · 裁决六：真实密钥存 credentials 域，配置读取响应不回显（扫描整个 payload）。
//
// 本文件写 system_configs.mcpConfig 行（config_key 固定、无隔离维度），
// 必须在 test:modules:serial-store 串行组内执行（同 system.tool-policy.test.ts 判据）。
// ============================================================

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import { Pool } from "pg";
import type { Request, Response } from "express";
import type { AuthUser } from "../../types";
import { cleanupOneTestUser, createTestUser } from "../../test-helpers/test-users";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null;
let testAdmin: AuthUser | null = null;

before(async () => {
  const { _resetSystemRepositoryForTest } = await import("./system.repository");
  _resetSystemRepositoryForTest();
  if (!testDatabaseUrl) return;
  pool = new Pool({ connectionString: testDatabaseUrl, max: 5 });
  await cleanupOneTestUser("b7-admin");
  testAdmin = await createTestUser("wes-mcp-config", { id: randomUUID(), username: "b7-admin", role: "admin", businessRole: "admin" });
});

after(async () => {
  if (testDatabaseUrl) {
    await cleanupOneTestUser("b7-admin");
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
  await pool.query("DELETE FROM system_configs WHERE config_key = 'mcpConfig'");
  const { clearApiKey, resetCredentialCache } = await import("./credentials.store");
  try {
    await clearApiKey("mcp:b7-secret", "b7-admin", pool ?? undefined);
  } catch {
    /* 未播种即空操作 */
  }
  resetCredentialCache();
}

function httpServerInput(overrides: Record<string, unknown> = {}) {
  return {
    id: "im_hub",
    name: "IM Hub",
    transport: "http",
    url: "https://im.example.internal/mcp",
    authType: "none",
    command: "",
    args: [],
    env: {},
    credentialScope: "",
    timeoutMs: 3000,
    approvedTools: {},
    ...overrides,
  };
}

const dbOnly = { skip: !testDatabaseUrl, concurrency: false } as const;

test("第六配置区：缺行读回默认（version=1、空清单、零轨迹），与其余配置区同口径", dbOnly, async () => {
  await resetStore();
  const { getMcpConfig } = await import("./system.usecase");
  const capture = responseCapture();
  await getMcpConfig(await requestFor(testAdmin), capture.response);
  assert.equal(capture.statusCode, 200);
  const data = capture.payload.data;
  assert.equal(data.version, 1);
  assert.deepEqual(data.draft.servers, []);
  assert.deepEqual(data.active.servers, []);
  assert.deepEqual(data.revisions, []);
});

test("草稿登记服务未生效：注入路径零工具（允许清单=active，不存在草稿旁路）", dbOnly, async () => {
  await resetStore();
  const { updateMcpConfigDraft, getMcpConfig } = await import("./system.usecase");
  const capture = responseCapture();
  await updateMcpConfigDraft(
    await requestFor(testAdmin, { servers: [httpServerInput()] }),
    capture.response,
  );
  assert.equal(capture.statusCode, 200);
  assert.equal(capture.payload.data.draft.servers.length, 1, "草稿已登记");
  const read = responseCapture();
  await getMcpConfig(await requestFor(testAdmin), read.response);
  assert.equal(read.payload.data.active.servers.length, 0, "未生效 ⇒ active 仍空");

  const { resolveActiveMcpTools } = await import("../../agent/mcp/mcp-runtime");
  const snapshot = await resolveActiveMcpTools();
  assert.deepEqual(snapshot.tools, [], "active 清单为空 ⇒ 不连任何服务（裁决一：配了才连）");
  assert.deepEqual(snapshot.outcomes, []);
});

test("生效链路：version 递增、active←draft、轨迹记字段级 diff 与操作人", dbOnly, async () => {
  await resetStore();
  const { updateMcpConfigDraft, activateMcpConfig } = await import("./system.usecase");
  const draft = responseCapture();
  await updateMcpConfigDraft(await requestFor(testAdmin, { servers: [httpServerInput()] }), draft.response);
  const act = responseCapture();
  await activateMcpConfig(await requestFor(testAdmin, {}), act.response);
  assert.equal(act.statusCode, 200);
  assert.equal(act.payload.data.version, 2, "activate 使 version 1→2");
  assert.equal(act.payload.data.active.servers.length, 1);
  const activateRevision = act.payload.data.revisions.find((r: { action: string }) => r.action === "activate");
  assert.ok(activateRevision, "轨迹里有生效条目");
  assert.equal(activateRevision.actor, "b7-admin", "操作人取自 JWT 可信身份");
  assert.ok(
    activateRevision.changes.some((c: { target: string; field: string }) => c.target === "server:im_hub" && c.field === "server"),
    "字段级 diff 记到服务粒度",
  );
});

test("放行落章：新条目盖当前操作人；重放同摘要保留原放行人（不得冒充重章）", dbOnly, async () => {
  await resetStore();
  const { updateMcpConfigDraft, getMcpConfig } = await import("./system.usecase");
  const { computeMcpToolDigest } = await import("../../agent/mcp/mcp-bridge");
  const digest = computeMcpToolDigest({ name: "send_summary", description: "d", inputSchema: { type: "object" } });
  const allowedRoles = ["ADMIN", "SALES"] as [string, string];
  const first = responseCapture();
  await updateMcpConfigDraft(
    await requestFor(testAdmin, {
      servers: [httpServerInput({ approvedTools: { send_summary: { digest, allowedRoles } } })],
    }),
    first.response,
  );
  const stamped = first.payload.data.draft.servers[0].approvedTools.send_summary;
  assert.equal(stamped.approvedBy, "b7-admin", "未盖章条目由服务端按 JWT 身份落章");
  assert.ok(stamped.approvedAt, "落章带时间");
  assert.deepEqual(stamped.allowedRoles, allowedRoles, "落章必须保留放行角色");

  const second = responseCapture();
  await updateMcpConfigDraft(
    await requestFor(testAdmin, {
      servers: [httpServerInput({ approvedTools: { send_summary: { digest, allowedRoles, approvedBy: "someone-else", approvedAt: "2020-01-01" } } })],
    }),
    second.response,
  );
  const replayed = second.payload.data.draft.servers[0].approvedTools.send_summary;
  assert.equal(replayed.approvedBy, "b7-admin", "同摘要重放保留原放行人，不接受载荷伪造的 approvedBy");
  assert.notEqual(replayed.approvedBy, "someone-else");
  assert.deepEqual(replayed.allowedRoles, allowedRoles, "重放必须保留原放行角色");
});

test("裁决六：真实密钥在 credentials 域，配置读取整个 payload 不回显密钥值", dbOnly, async () => {
  await resetStore();
  assert.ok(pool);
  process.env.CREDENTIAL_KEK = randomBytes(32).toString("base64");
  const { setApiKey } = await import("./credentials.store");
  const secret = "sk-B7MCPTEST-supersecret-9e7f";
  await setApiKey("mcp:b7-secret", secret, "b7-admin", pool ?? undefined);

  const { updateMcpConfigDraft, getMcpConfig } = await import("./system.usecase");
  const draft = responseCapture();
  await updateMcpConfigDraft(
    await requestFor(testAdmin, { servers: [httpServerInput({ authType: "bearer", credentialScope: "mcp:b7-secret" })] }),
    draft.response,
  );
  assert.equal(JSON.stringify(draft.payload).includes(secret), false, "PATCH 响应不回显密钥");
  const read = responseCapture();
  await getMcpConfig(await requestFor(testAdmin), read.response);
  assert.equal(read.payload.data.draft.servers[0].credentialScope, "mcp:b7-secret", "配置里只有 scope 引用");
  assert.equal(JSON.stringify(read.payload).includes(secret), false, "GET 响应不回显密钥");
});

test("注入路径不回显密钥：collect 结果与 outcome/pending 任何字段不含凭据值", dbOnly, async () => {
  await resetStore();
  assert.ok(pool);
  process.env.CREDENTIAL_KEK = randomBytes(32).toString("base64");
  const { setApiKey } = await import("./credentials.store");
  const secret = "sk-B7MCPTEST-anothersecret-1a2b";
  await setApiKey("mcp:b7-secret", secret, "b7-admin", pool ?? undefined);
  const { collectMcpInjectableTools } = await import("../../agent/mcp/mcp-manager");
  const { getApiKey } = await import("./credentials.store");
  // 指向一个必然连不上的本地端口：错误形态也不得携带凭据（凭据解析成功与否都不回显）
  const server = {
    ...httpServerInput(),
    transport: "http" as const,
    url: "http://127.0.0.1:1/mcp",
    authType: "bearer" as const,
    credentialScope: "mcp:b7-secret",
    timeoutMs: 600,
  };
  const result = await collectMcpInjectableTools([server], {
    resolveCredential: async (scope) => (await getApiKey(scope)).apiKey,
  });
  assert.equal(result.outcomes[0].ok, false, "连不上的服务缺席本轮（裁决五）");
  assert.equal(JSON.stringify(result).includes(secret), false, "采集结果任何字段不含密钥");
});
