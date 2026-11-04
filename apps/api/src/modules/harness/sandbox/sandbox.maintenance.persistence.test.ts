import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile, utimes, readFile, symlink, mkdir, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import { db, pool } from "../../../db/client";
import { aiSessions, harnessRuns, harnessRunOutputs, harnessRunEvents, harnessSandboxJobs, harnessSandboxArtifacts, users } from "../../../db/schema";
import { createTestUser, cleanupOneTestUser } from "../../../test-helpers/test-users";
import { createAiSession } from "../../ai-sessions/ai-sessions.usecase";
import { createHarnessRuntimeRepository } from "../harness-runtime.repository";
import { attachWorkbenchConversationFact, buildWorkbenchUserMessageFact } from "../workbench-conversation-fact";
import { enqueueSandboxContinuations, sweepSandboxResources } from "./sandbox.maintenance";
import { LocalSandboxArtifactStore } from "./sandbox-artifacts";
import type { SandboxProvider } from "../../../services/sandbox/sandbox-provider";

after(async () => { await pool.end(); });
const pg = { skip: !process.env.TEST_DATABASE_URL };

async function fixture(output: unknown = { answer: "合成分析结果" }) {
  const user = await createTestUser("wes-sandbox-maintenance");
  const session = await createAiSession(user, { title: "合成后续任务", workflowKey: "free_chat" });
  const repo = createHarnessRuntimeRepository();
  const content = "分析完成后生成报告";
  const { executionConfig, fact } = attachWorkbenchConversationFact({
    content,
    sandboxFollowUp: { content, selection: { type: "sandbox", id: "sandbox" } },
  });
  const { run } = await repo.createQueuedRun({
    ownerUserId: user.id, ownerUsername: user.username, aiSessionId: session.sessionId,
    submissionKey: randomUUID(), title: content, workflowId: "business-skills-v1", workflowVersion: "1.0.0",
    executionConfig, userMessageFact: runId => buildWorkbenchUserMessageFact({ runId, fact, content }),
  });
  await db.update(harnessRuns).set({ status: "completed", completedAt: new Date() }).where(eq(harnessRuns.harnessRunId, run.harnessRunId));
  await db.insert(harnessRunOutputs).values({ harnessRunOutputId: randomUUID(), harnessRunId: run.harnessRunId, status: "final", content: output, contentHash: "synthetic" });
  return {
    user, session, run, repo,
    child: async () => (await db.select().from(harnessRuns).where(and(eq(harnessRuns.ownerUserId, user.id), eq(harnessRuns.submissionKey, "sandbox-followup:" + run.harnessRunId))))[0],
    cleanup: async () => {
      await db.delete(harnessRuns).where(eq(harnessRuns.ownerUserId, user.id));
      await db.delete(aiSessions).where(eq(aiSessions.sessionId, session.sessionId));
      await cleanupOneTestUser(user.username);
    },
  };
}

test("oversized upstream output creates one bounded continuation explaining the omission", pg, async () => {
  const f = await fixture({ answer: "合成".repeat(100000) });
  try {
    await Promise.all([enqueueSandboxContinuations(), enqueueSandboxContinuations()]);
    await enqueueSandboxContinuations();
    const child = await f.child();
    assert.ok(child, "oversized output must not leave the durable intent stuck forever");
    const config = child.executionConfig as any;
    assert.equal(config.sourceRunId, f.run.harnessRunId);
    assert.equal(config.sandboxContext.upstreamResult.omitted, true);
    assert.match(config.content, /上一步结果过长/);
    assert.match(config.sandboxContext.upstreamResult.message, /未自动带入/);
    assert.ok(Buffer.byteLength(JSON.stringify(config)) < 160 * 1024);
    const children = await db.select().from(harnessRuns).where(and(eq(harnessRuns.ownerUserId, f.user.id), eq(harnessRuns.submissionKey, child.submissionKey!)));
    assert.equal(children.length, 1);
    const childEvents = await db.select().from(harnessRunEvents).where(eq(harnessRunEvents.harnessRunId, child.harnessRunId));
    assert.equal(childEvents.filter(e => e.eventType === "run_queued").length, 1);
    assert.equal(childEvents.filter(e => e.eventType === "user/message").length, 0);
    const original = await db.select().from(harnessRunEvents).where(eq(harnessRunEvents.harnessRunId, f.run.harnessRunId));
    assert.equal(original.filter(e => e.eventType === "user/message").length, 1);
  } finally { await f.cleanup(); }
});

test("busy sessions retain the intent and retry exactly once when the active run ends", pg, async () => {
  const f = await fixture();
  try {
    const busy = await f.repo.createQueuedRun({ ownerUserId: f.user.id, ownerUsername: f.user.username, aiSessionId: f.session.sessionId, submissionKey: randomUUID(), title: "用户当前任务", workflowId: "workbench_chat_v1", workflowVersion: "1.0.0", executionConfig: {} });
    await enqueueSandboxContinuations();
    assert.equal(await f.child(), undefined);
    await db.update(harnessRuns).set({ status: "completed" }).where(eq(harnessRuns.harnessRunId, busy.run.harnessRunId));
    await enqueueSandboxContinuations();
    const first = await f.child();
    assert.ok(first);
    assert.deepEqual((first.executionConfig as any).sandboxContext.upstreamResult, { answer: "合成分析结果" });
    await enqueueSandboxContinuations();
    assert.equal((await f.child())!.harnessRunId, first.harnessRunId);
  } finally { await f.cleanup(); }
});

test("oversized intents advance beyond the twenty-parent sweep limit", pg, async () => {
  const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
  try {
    for (let i = 0; i < 21; i++) {
      const f = await fixture({ answer: "x".repeat(170 * 1024) });
      fixtures.push(f);
      await db.update(harnessRuns).set({ updatedAt: new Date("2000-01-01T00:00:00Z") }).where(eq(harnessRuns.harnessRunId, f.run.harnessRunId));
    }
    await enqueueSandboxContinuations();
    assert.equal((await Promise.all(fixtures.map(f => f.child()))).filter(Boolean).length, 20);
    await enqueueSandboxContinuations();
    assert.equal((await Promise.all(fixtures.map(f => f.child()))).filter(Boolean).length, 21);
  } finally { for (const f of fixtures) await f.cleanup(); }
});

test("archived sessions and inactive owners block continuation with a durable bounded audit", pg, async () => {
  for (const boundary of ["archived", "inactive"] as const) {
    const f = await fixture();
    try {
      if (boundary === "archived") await db.update(aiSessions).set({ status: "archived" }).where(eq(aiSessions.sessionId, f.session.sessionId));
      else await db.update(users).set({ status: "disabled" }).where(eq(users.userId, f.user.id));
      await enqueueSandboxContinuations();
      assert.equal(await f.child(), undefined);
      const [parent] = await db.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, f.run.harnessRunId));
      const audit = (parent.executionConfig as any).sandboxFollowUpDispatch;
      assert.equal(audit?.status, "blocked");
      assert.equal(audit.reason, "SANDBOX_SOURCE_UNAVAILABLE");
      await enqueueSandboxContinuations();
      const [same] = await db.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, f.run.harnessRunId));
      assert.deepEqual((same.executionConfig as any).sandboxFollowUpDispatch, audit);
    } finally { await f.cleanup(); }
  }
});

test("expired bytes and metadata are removed, failed releases retry, and orphan retention protects current files", pg, async () => {
  const f = await fixture();
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "wes-maintenance-")));
  const store = new LocalSandboxArtifactStore(root);
  const jobId = randomUUID(), expired = randomUUID(), current = randomUUID(), orphan = randomUUID();
  let releases = 0, failRelease = true;
  const provider = async () => ({
    connect: async (id: string) => ({ id, release: async () => { releases++; if (failRelease) throw Error("synthetic unavailable"); } }),
  }) as SandboxProvider;
  const dependencies = { provider, root, store };
  try {
    await db.insert(harnessSandboxJobs).values({ id: jobId, ownerId: f.user.id, sessionId: f.session.sessionId, runId: f.run.harnessRunId, ordinal: 1, requestDigest: "synthetic", request: {}, plan: {}, state: "completed", sandboxId: "synthetic-maintenance-instance", cleanup: "pending", expiresAt: new Date(Date.now() + 60000) });
    for (const [id, expiresAt] of [[expired, new Date(Date.now() - 1000)], [current, new Date(Date.now() + 60000)]] as const) {
      await store.write(id, Buffer.from("synthetic bytes"));
      await db.insert(harnessSandboxArtifacts).values({ id, jobId, ownerId: f.user.id, sessionId: f.session.sessionId, runId: f.run.harnessRunId, name: "report.html", title: "合成文件", format: "html", mimeType: "text/html", sha256: "synthetic", size: 15, expiresAt });
    }
    await writeFile(path.join(root, orphan), "orphan");
    await writeFile(path.join(root, "old.tmp"), "temporary");
    await writeFile(path.join(root, "fresh.tmp"), "fresh");
    const old = new Date(Date.now() - 2 * 86400000);
    for (const file of [current, orphan, "old.tmp"]) await utimes(path.join(root, file), old, old);
    await sweepSandboxResources(dependencies);
    assert.equal(releases, 1);
    assert.equal((await db.select().from(harnessSandboxJobs).where(eq(harnessSandboxJobs.id, jobId)))[0].cleanup, "pending");
    assert.equal((await db.select().from(harnessSandboxArtifacts).where(eq(harnessSandboxArtifacts.id, expired))).length, 0);
    await assert.rejects(readFile(path.join(root, expired)), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(root, orphan)), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(root, "old.tmp")), { code: "ENOENT" });
    assert.equal((await store.read(current)).toString(), "synthetic bytes");
    assert.equal((await readFile(path.join(root, "fresh.tmp"))).toString(), "fresh");
    failRelease = false;
    await sweepSandboxResources(dependencies);
    await sweepSandboxResources(dependencies);
    assert.equal(releases, 2, "successful cleanup must not release again");
    assert.equal((await db.select().from(harnessSandboxJobs).where(eq(harnessSandboxJobs.id, jobId)))[0].cleanup, "cleaned");
  } finally { await f.cleanup(); await rm(root, { recursive: true, force: true }); }
});

test("twenty failed pending releases rotate so the twenty-first resource is reclaimed", pg, async () => {
  const f = await fixture();
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "wes-maintenance-queue-")));
  const createdAt = new Date("2000-01-01T00:00:00Z");
  const expiresAt = new Date("2000-01-02T00:00:00Z");
  const rows = Array.from({ length: 21 }, (_, i) => ({
    id: randomUUID(), ownerId: f.user.id, sessionId: f.session.sessionId,
    runId: f.run.harnessRunId, ordinal: i + 1, requestDigest: "synthetic", request: {}, plan: {},
    state: "completed", sandboxId: `synthetic-fair-release-${i}`, cleanup: "pending",
    createdAt, updatedAt: new Date(createdAt.getTime() + i), expiresAt,
  }));
  const released: string[] = [];
  const failedIds = new Set<string>();
  const provider = async () => ({
    connect: async (id: string) => {
      if (failedIds.size < 20) failedIds.add(id);
      if (failedIds.has(id)) throw Error("synthetic missing sandbox");
      return { id, release: async () => { released.push(id); } };
    },
  }) as SandboxProvider;
  try {
    await db.insert(harnessSandboxJobs).values(rows);
    const dependencies = { provider, root, store: new LocalSandboxArtifactStore(root) };
    await sweepSandboxResources(dependencies);
    assert.deepEqual(released, []);
    assert.equal(failedIds.size, 20);
    await sweepSandboxResources(dependencies);
    assert.equal(released.length, 1, "the resource behind the twenty failing jobs must get a turn");
    const persisted = await db.select().from(harnessSandboxJobs).where(eq(harnessSandboxJobs.runId, f.run.harnessRunId));
    for (const job of persisted) {
      assert.equal(job.cleanup, job.sandboxId === released[0] ? "cleaned" : "pending");
      assert.equal(job.createdAt.toISOString(), createdAt.toISOString());
      assert.equal(job.expiresAt.toISOString(), expiresAt.toISOString());
      assert.ok(job.updatedAt.getTime() > createdAt.getTime() + 21);
    }
    await sweepSandboxResources(dependencies);
    assert.equal(released.length, 1);
  } finally { await f.cleanup(); await rm(root, { recursive: true, force: true }); }
});

test("fifty failed expired deletions do not starve later artifacts and remain retryable after wraparound", pg, async () => {
  const f = await fixture();
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "wes-maintenance-expired-")));
  const jobId = randomUUID();
  const ids = Array.from({ length: 51 }, () => randomUUID()).sort();
  const failing = new Set<string>();
  let initialBatch = true;
  const attempts = new Map<string, number>();
  class FailingStore extends LocalSandboxArtifactStore {
    async remove(id: string) {
      attempts.set(id, (attempts.get(id) ?? 0) + 1);
      if (initialBatch) failing.add(id);
      if (failing.has(id)) throw Error("synthetic file unavailable");
      await super.remove(id);
    }
  }
  const store = new FailingStore(root);
  const expiresAt = new Date("2000-01-02T00:00:00Z");
  const provider = async () => { throw Error("cloud must not be used"); };
  try {
    await db.insert(harnessSandboxJobs).values({ id: jobId, ownerId: f.user.id, sessionId: f.session.sessionId, runId: f.run.harnessRunId, ordinal: 1, requestDigest: "synthetic", request: {}, plan: {}, state: "completed", cleanup: "none", expiresAt });
    for (const id of ids) {
      await store.write(id, Buffer.from("synthetic bytes"));
      await db.insert(harnessSandboxArtifacts).values({ id, jobId, ownerId: f.user.id, sessionId: f.session.sessionId, runId: f.run.harnessRunId, name: "report.html", title: "合成文件", format: "html", mimeType: "text/html", sha256: "synthetic", size: 15, expiresAt });
    }
    const dependencies = { provider, root, store };
    await sweepSandboxResources(dependencies);
    initialBatch = false;
    assert.equal(failing.size, 50);
    const laterId = ids.find(id => !failing.has(id))!;
    await sweepSandboxResources(dependencies);
    await assert.rejects(readFile(path.join(root, laterId)), { code: "ENOENT" });
    const retained = await db.select().from(harnessSandboxArtifacts).where(eq(harnessSandboxArtifacts.jobId, jobId));
    assert.equal(retained.length, 50);
    assert.ok(retained.every(a => a.expiresAt.toISOString() === expiresAt.toISOString()));
    await sweepSandboxResources(dependencies);
    assert.ok([...failing].every(id => (attempts.get(id) ?? 0) >= 2), "failed artifacts must be retried after the cursor wraps");
    failing.clear();
    await sweepSandboxResources(dependencies);
    assert.equal((await db.select().from(harnessSandboxArtifacts).where(eq(harnessSandboxArtifacts.jobId, jobId))).length, 0);
  } finally { await f.cleanup(); await rm(root, { recursive: true, force: true }); }
});

test("orphan sweeping refuses symlink roots and roots reached through symlink ancestors", pg, async () => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "wes-maintenance-root-")));
  const target = path.join(base, "target");
  const link = path.join(base, "redirect");
  await mkdir(target);
  await mkdir(path.join(target, "nested"));
  await symlink(target, link, "dir");
  const old = new Date(Date.now() - 2 * 86400000);
  const provider = async () => { throw Error("cloud must not be used"); };
  try {
    for (const root of [link, path.join(link, "nested")]) {
      const file = path.join(root, randomUUID());
      await writeFile(file, "must survive redirected root");
      await utimes(file, old, old);
      await sweepSandboxResources({ provider, root, store: new LocalSandboxArtifactStore(root) });
      assert.equal((await readFile(file)).toString(), "must survive redirected root");
    }
    const canonical = path.join(target, "nested");
    const outside = path.join(base, "outside.tmp");
    await writeFile(outside, "outside");
    await utimes(outside, old, old);
    const fileLink = path.join(canonical, randomUUID());
    await symlink(outside, fileLink);
    await sweepSandboxResources({ provider, root: canonical, store: new LocalSandboxArtifactStore(canonical) });
    assert.equal((await readFile(outside)).toString(), "outside");
    assert.equal((await lstat(fileLink)).isSymbolicLink(), true);
  } finally { await rm(base, { recursive: true, force: true }); }
});
