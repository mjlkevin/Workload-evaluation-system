import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import type { Request, Response } from "express";

const originalCwd = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wes-rp031-kb-"));

before(() => {
  process.chdir(tempRoot);
  fs.mkdirSync(path.join(tempRoot, "config", "auth"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "config", "system"), { recursive: true });
});

after(() => {
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
  const admin = {
    id: "rp031-admin",
    username: "rp031-admin",
    passwordHash: "not-used",
    role: "admin" as const,
    businessRole: "admin" as const,
    status: "active" as const,
    createdAt: "2026-08-02T00:00:00.000Z",
    lastLoginAt: "",
  };
  fs.writeFileSync(
    path.join(tempRoot, "config", "auth", "users.json"),
    JSON.stringify({ users: [admin] }),
  );
  const token = signAuthToken(admin);
  return {
    body,
    query: {},
    headers: { authorization: `Bearer ${token}` },
    header(name: string) { return name.toLowerCase() === "authorization" ? `Bearer ${token}` : undefined; },
  } as unknown as Request;
}

function resetStore() {
  fs.rmSync(path.join(tempRoot, "config", "system", "knowledge-base-config.json"), { force: true });
}

test("activation is blocked until the current draft has a successful probe", { concurrency: false }, async () => {
  resetStore();
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

test("successful zero-hit probe activates only the unchanged draft", { concurrency: false }, async () => {
  resetStore();
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

test("activation rejects a successful probe older than 24 hours", { concurrency: false }, async () => {
  resetStore();
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
  const store = loadKnowledgeBaseConfigStore();
  assert.ok(store.probe);
  store.probe.checkedAt = "2026-07-01T00:00:00.000Z";
  saveKnowledgeBaseConfigStore(store);
  const activation = responseCapture();
  await activateKnowledgeBaseConfig(await adminRequest(), activation.response);
  assert.equal(activation.statusCode, 409);
  assert.equal(activation.payload.details[0].reason, "probe_expired");
});
