import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import { Pool } from "pg";
import type { Request, Response } from "express";
import type { AuthUser } from "../../types";
import { cleanupOneTestUser, createTestUser } from "../../test-helpers/test-users";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const originalCwd = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wes-rp031-kb-"));
// S3（2026-08-30）口径：system 四配置 JSON 读写路径删除后本域恒 PG，
// 不再强制切回 JSON 实现；状态隔离从「删 JSON 文件」改为「删 system_configs
// 的 knowledgeBaseConfig 行」。该表无隔离维度（config_key 固定枚举），与
// system-pg.repository.test.ts / assessment / workbench-dispatch / modules.handlers
// 共写同一行，故本文件必须待在 test:modules:serial-store 串行组内。
let pool: Pool | null = null;

// S1（2026-08-25）后 users 域恒 PG：测试 admin 改由 PG 行级注入
// （JSON 注入路径已删；固定 username 承载身份，id 用合法 uuid）。
let testAdmin: AuthUser | null = null;

before(async () => {
  const { _resetSystemRepositoryForTest } = await import("./system.repository");
  _resetSystemRepositoryForTest();
  process.chdir(tempRoot);
  fs.mkdirSync(path.join(tempRoot, "config", "auth"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "config", "system"), { recursive: true });
  if (!testDatabaseUrl) return;
  pool = new Pool({ connectionString: testDatabaseUrl, max: 5 });
  await cleanupOneTestUser("rp031-admin");
  testAdmin = await createTestUser("wes-kb-config", {
    id: randomUUID(),
    username: "rp031-admin",
    role: "admin",
    businessRole: "admin",
  });
});

after(async () => {
  if (testDatabaseUrl) await cleanupOneTestUser("rp031-admin");
  await resetStore();
  if (pool) await pool.end();
  process.chdir(originalCwd);
  fs.rmSync(tempRoot, { recursive: true, force: true });
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

async function adminRequest(body: unknown = {}) {
  const { signAuthToken } = await import("../../middleware/auth");
  const token = signAuthToken(testAdmin as AuthUser);
  return {
    body,
    query: {},
    headers: { authorization: `Bearer ${token}` },
    header(name: string) { return name.toLowerCase() === "authorization" ? `Bearer ${token}` : undefined; },
  } as unknown as Request;
}

async function resetStore(): Promise<void> {
  if (!pool) return;
  await pool.query("DELETE FROM system_configs WHERE config_key = 'knowledgeBaseConfig'");
}

test("activation is blocked until the current draft has a successful probe", { skip: !testDatabaseUrl, concurrency: false }, async () => {
  await resetStore();
  const { activateKnowledgeBaseConfig, updateKnowledgeBaseConfigDraft } = await import("./system.usecase");
  await updateKnowledgeBaseConfigDraft(
    await adminRequest({ credentials: { apiKey: "fixture-key", knowledgeId: "kb-fixture" } }),
    responseCapture().response,
  );
  const activation = responseCapture();
  await activateKnowledgeBaseConfig(await adminRequest(), activation.response);
  assert.equal(activation.statusCode, 409);
  assert.equal(activation.payload.details[0].reason, "probe_missing");
});

test("successful zero-hit probe activates only the unchanged draft", { skip: !testDatabaseUrl, concurrency: false }, async () => {
  await resetStore();
  const {
    activateKnowledgeBaseConfig,
    testKnowledgeBaseConnectivityWithFetcher,
    updateKnowledgeBaseConfigDraft,
  } = await import("./system.usecase");
  await updateKnowledgeBaseConfigDraft(
    await adminRequest({ credentials: { apiKey: "fixture-key", knowledgeId: "kb-fixture" } }),
    responseCapture().response,
  );
  const probe = responseCapture();
  await testKnowledgeBaseConnectivityWithFetcher(
    await adminRequest(),
    probe.response,
    async () => new Response(JSON.stringify({ code: 200, data: [] }), { status: 200 }),
  );
  assert.equal(probe.statusCode, 200);
  assert.equal(probe.payload.data.warning, "retrieval_empty");

  const activation = responseCapture();
  await activateKnowledgeBaseConfig(await adminRequest(), activation.response);
  assert.equal(activation.statusCode, 200);

  await updateKnowledgeBaseConfigDraft(
    await adminRequest({ retrievalParams: { topK: 9 } }),
    responseCapture().response,
  );
  const changed = responseCapture();
  await activateKnowledgeBaseConfig(await adminRequest(), changed.response);
  assert.equal(changed.statusCode, 409);
  assert.equal(changed.payload.details[0].reason, "config_changed_after_probe");
});

test("activation rejects a successful probe older than 24 hours", { skip: !testDatabaseUrl, concurrency: false }, async () => {
  await resetStore();
  const {
    activateKnowledgeBaseConfig,
    testKnowledgeBaseConnectivityWithFetcher,
    updateKnowledgeBaseConfigDraft,
  } = await import("./system.usecase");
  const { loadKnowledgeBaseConfigStore, saveKnowledgeBaseConfigStore } = await import("./system.repository");
  await updateKnowledgeBaseConfigDraft(
    await adminRequest({ credentials: { apiKey: "fixture-key", knowledgeId: "kb-fixture" } }),
    responseCapture().response,
  );
  await testKnowledgeBaseConnectivityWithFetcher(
    await adminRequest(),
    responseCapture().response,
    async () => new Response(JSON.stringify({ code: 200, data: [] }), { status: 200 }),
  );
  // 阶段 1 批 5：store accessor 已异步化，补 await（断言不变）。
  const store = await loadKnowledgeBaseConfigStore();
  assert.ok(store.probe);
  store.probe.checkedAt = "2026-07-01T00:00:00.000Z";
  await saveKnowledgeBaseConfigStore(store);
  const activation = responseCapture();
  await activateKnowledgeBaseConfig(await adminRequest(), activation.response);
  assert.equal(activation.statusCode, 409);
  assert.equal(activation.payload.details[0].reason, "probe_expired");
});

test("multi knowledge draft rejects duplicate profile and provider ids", { skip: !testDatabaseUrl, concurrency: false }, async () => {
  await resetStore();
  const { updateKnowledgeBaseConfigDraft } = await import("./system.usecase");
  const result = responseCapture();
  await updateKnowledgeBaseConfigDraft(
    await adminRequest({
      credentials: { apiKey: "fixture-key" },
      knowledgeBases: [
        { id: "solutions", name: "方案库", knowledgeId: "same", enabled: true, isDefault: true },
        { id: "solutions", name: "案例库", knowledgeId: "same", enabled: true, isDefault: true },
      ],
    }),
    result.response,
  );

  assert.equal(result.statusCode, 400);
  assert.deepEqual(result.payload.details.map((item: any) => item.reason), [
    "duplicate_profile_id",
    "duplicate_knowledge_id",
    "multiple_default_profiles",
  ]);
});

test("connectivity tests are stored per selected knowledge base profile", { skip: !testDatabaseUrl, concurrency: false }, async () => {
  await resetStore();
  const {
    testKnowledgeBaseConnectivityWithFetcher,
    updateKnowledgeBaseConfigDraft,
  } = await import("./system.usecase");
  const { loadKnowledgeBaseConfigStore } = await import("./system.repository");
  await updateKnowledgeBaseConfigDraft(
    await adminRequest({
      credentials: { apiKey: "fixture-key" },
      knowledgeBases: [
        { id: "solutions", name: "方案库", knowledgeId: "kb-solutions", enabled: true, isDefault: true },
        { id: "cases", name: "案例库", knowledgeId: "kb-cases", enabled: true },
      ],
    }),
    responseCapture().response,
  );

  const probe = responseCapture();
  let requestedKnowledgeIds: string[] = [];
  await testKnowledgeBaseConnectivityWithFetcher(
    await adminRequest({ profileId: "cases" }),
    probe.response,
    async (_url, init) => {
      requestedKnowledgeIds = JSON.parse(String(init?.body)).knowledge_ids;
      return new Response(JSON.stringify({ code: 200, data: [] }), { status: 200 });
    },
  );

  assert.equal(probe.statusCode, 200);
  assert.equal(probe.payload.data.profileId, "cases");
  assert.deepEqual(requestedKnowledgeIds, ["kb-cases"]);
  // 阶段 1 批 5：store accessor 已异步化，补 await（断言不变）。
  const store = await loadKnowledgeBaseConfigStore();
  assert.equal(store.probes?.cases?.status, "success");
  assert.equal(store.probes?.solutions, undefined);
});

test("activation requires a fresh matching probe for every enabled profile", { skip: !testDatabaseUrl, concurrency: false }, async () => {
  await resetStore();
  const {
    activateKnowledgeBaseConfig,
    testKnowledgeBaseConnectivityWithFetcher,
    updateKnowledgeBaseConfigDraft,
  } = await import("./system.usecase");
  await updateKnowledgeBaseConfigDraft(
    await adminRequest({
      credentials: { apiKey: "fixture-key" },
      knowledgeBases: [
        { id: "solutions", name: "方案库", knowledgeId: "kb-solutions", enabled: true, isDefault: true },
        { id: "cases", name: "案例库", knowledgeId: "kb-cases", enabled: true },
      ],
    }),
    responseCapture().response,
  );
  const okFetcher = async () => new Response(JSON.stringify({ code: 200, data: [] }), { status: 200 });
  await testKnowledgeBaseConnectivityWithFetcher(
    await adminRequest({ profileId: "solutions" }),
    responseCapture().response,
    okFetcher,
  );

  const blocked = responseCapture();
  await activateKnowledgeBaseConfig(await adminRequest(), blocked.response);
  assert.equal(blocked.statusCode, 409);
  assert.deepEqual(blocked.payload.details, [
    { field: "knowledgeBases.cases.probe", reason: "probe_missing", profileId: "cases" },
  ]);

  await testKnowledgeBaseConnectivityWithFetcher(
    await adminRequest({ profileId: "cases" }),
    responseCapture().response,
    okFetcher,
  );
  const activated = responseCapture();
  await activateKnowledgeBaseConfig(await adminRequest(), activated.response);
  assert.equal(activated.statusCode, 200);
  assert.equal(activated.payload.data.active.knowledgeBases.length, 2);
});

test("probe failure carries classified reason and raw provider code/msg into fail details", { skip: !testDatabaseUrl, concurrency: false }, async () => {
  await resetStore();
  const {
    testKnowledgeBaseConnectivityWithFetcher,
    updateKnowledgeBaseConfigDraft,
  } = await import("./system.usecase");
  const { loadKnowledgeBaseConfigStore } = await import("./system.repository");
  await updateKnowledgeBaseConfigDraft(
    await adminRequest({ credentials: { apiKey: "fixture-key", knowledgeId: "kb-fixture" } }),
    responseCapture().response,
  );
  const probe = responseCapture();
  await testKnowledgeBaseConnectivityWithFetcher(
    await adminRequest(),
    probe.response,
    async () => new Response(JSON.stringify({ code: 500, msg: "x".repeat(300) }), { status: 200 }),
  );
  assert.equal(probe.statusCode, 400);
  assert.equal(probe.payload.message, "知识库连通性测试未通过");
  assert.deepEqual(probe.payload.details, [{
    field: "knowledgeBase",
    reason: "provider_unspecified_rejection",
    providerCode: 500,
    providerMessage: "x".repeat(200),
  }]);
  const store = await loadKnowledgeBaseConfigStore();
  const persisted = store.probes?.["legacy-default"];
  assert.equal(persisted?.errorCode, "provider_unspecified_rejection");
  assert.equal(persisted?.providerCode, 500);
  assert.equal(persisted?.providerMessage, "x".repeat(200));
});
