// ============================================================
// Harness Session Projector 测试
// ============================================================
// RP-047 Batch B：outbox 认领、来源键幂等投影、发布标记、失败
// 重试与上限；崩溃类 C4b（Session 已写入、outbox 未确认）重放
// 不产生重复消息。仅读取 TEST_DATABASE_URL；缺失时跳过。
// Session 存储使用临时目录文件，不触碰真实 data/config。

import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { harnessRuns, harnessSessionOutbox, type HarnessRunRow } from "../../db/schema";
import {
  createHarnessRuntimeRepository,
  type CreateQueuedHarnessRunInput,
  type HarnessRuntimeRepository,
} from "./harness-runtime.repository";
import { HarnessFaultInjectedError } from "./harness-runtime.worker";
import {
  createHarnessSessionProjector,
  type HarnessSessionMessageSink,
} from "./harness-session-projector";
import { appendAiSessionMessageIdempotent } from "../ai-sessions/ai-sessions.repository";
import type { AiMessage, AiSessionsStore } from "../ai-sessions/ai-sessions.types";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let pool: Pool | null = null;
let testDb: ReturnType<typeof drizzle> | null = null;
let repo: HarnessRuntimeRepository | null = null;
const createdRunIds: string[] = [];
const tempDirs: string[] = [];

before(async () => {
  if (!testDatabaseUrl) return;
  pool = new Pool({ connectionString: testDatabaseUrl, max: 10 });
  testDb = drizzle(pool);
  repo = createHarnessRuntimeRepository(testDb);
});

after(async () => {
  if (pool) await pool.end();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

afterEach(async () => {
  if (!testDb) return;
  for (const runId of createdRunIds.splice(0)) {
    await testDb.delete(harnessRuns).where(eq(harnessRuns.harnessRunId, runId));
  }
});

function makeSessionStore(sessionId: string, ownerUserId: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "wes-projector-test-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "ai-sessions.json");
  const store: AiSessionsStore = {
    sessions: [
      {
        sessionId,
        ownerUserId,
        ownerUsername: "projector-tester",
        title: "投影测试会话",
        domain: "business_evaluation",
        workflowKey: "home_workbench",
        businessRole: "pm",
        status: "temporary_chat",
        summary: "",
        messages: [],
        attachments: [],
        artifacts: [],
        pendingActions: [],
        linkedRecords: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(store, null, 2), "utf-8");
  return filePath;
}

function readStore(filePath: string): AiSessionsStore {
  return JSON.parse(readFileSync(filePath, "utf-8")) as AiSessionsStore;
}

async function makeRun(): Promise<HarnessRunRow> {
  const input: CreateQueuedHarnessRunInput = {
    ownerUserId: `owner-${randomUUID()}`,
    ownerUsername: "projector-tester",
    aiSessionId: `session-${randomUUID()}`,
    submissionKey: `submission-${randomUUID()}`,
    title: "Projector 测试",
    workflowId: "fake_workbench_chat",
    workflowVersion: "fake-v1",
    metadata: {},
  };
  const created = await repo!.createQueuedRun(input);
  createdRunIds.push(created.run.harnessRunId);
  return created.run;
}

function makeSink(storePath: string, failures: { remaining: number }): HarnessSessionMessageSink {
  return {
    async append({ sessionId, message, source }) {
      if (failures.remaining > 0) {
        failures.remaining -= 1;
        throw new Error("SINK_UNAVAILABLE");
      }
      const result = appendAiSessionMessageIdempotent({
        sessionId,
        message: {
          messageId: message.messageId ?? `msg-${randomUUID()}`,
          role: message.role as AiMessage["role"],
          content: message.content,
          createdAt: new Date().toISOString(),
          metadata: message.metadata,
        },
        source,
        storePath,
      });
      if (!result.found) throw new Error("SESSION_NOT_FOUND");
      return { created: result.created, messageId: result.message.messageId };
    },
  };
}

function makeProjector(sink: HarnessSessionMessageSink, options: { lockMs?: number; maxAttempts?: number } = {}) {
  return createHarnessSessionProjector({
    repository: repo!,
    sink,
    projectorId: `projector-${randomUUID()}`,
    timing: { pollIntervalMs: 5_000, lockMs: options.lockMs ?? 50, maxAttempts: options.maxAttempts ?? 3, retryAfterMs: 60_000 },
  });
}

// ============================================================
// 单元：appendAiSessionMessageIdempotent 来源键幂等
// ============================================================

test("appendAiSessionMessageIdempotent dedupes by projection source key", () => {
  const sessionId = `session-${randomUUID()}`;
  const storePath = makeSessionStore(sessionId, "owner-1");
  const source = { deduplicationKey: "run:r1:user-message:cm1", runId: "r1", eventType: "user_message" };

  const first = appendAiSessionMessageIdempotent({
    sessionId,
    message: { messageId: "m-1", role: "user", content: "hello", createdAt: new Date().toISOString() },
    source,
    storePath,
  });
  assert.equal(first.created, true);
  const second = appendAiSessionMessageIdempotent({
    sessionId,
    message: { messageId: "m-2", role: "user", content: "hello replayed", createdAt: new Date().toISOString() },
    source,
    storePath,
  });
  assert.equal(second.created, false, "replay with the same source key must not append");
  assert.equal(second.message.messageId, "m-1", "the originally stored message wins");

  const store = readStore(storePath);
  assert.equal(store.sessions[0].messages.length, 1);
  const metadata = store.sessions[0].messages[0].metadata as { projectionSource?: { deduplicationKey?: string } };
  assert.equal(metadata.projectionSource?.deduplicationKey, source.deduplicationKey);
});

// ============================================================
// T9a 投影投递：pending → published，消息恰好一次
// ============================================================

test("T9a projector publishes pending outbox rows into the session exactly once", { skip: !testDatabaseUrl }, async () => {
  const run = await makeRun();
  const storePath = makeSessionStore(run.aiSessionId!, run.ownerUserId);
  await repo!.enqueueSessionOutbox({
    runId: run.harnessRunId,
    aiSessionId: run.aiSessionId!,
    eventType: "user_message",
    deduplicationKey: `run:${run.harnessRunId}:user-message:cm1`,
    payload: { message: { role: "user", content: "fake user message" } },
  });

  const projector = makeProjector(makeSink(storePath, { remaining: 0 }));
  const results = await projector.projectOnce();
  assert.deepEqual(
    results.map((r) => r.outcome),
    ["published"],
  );
  assert.equal(results[0].created, true);

  const store = readStore(storePath);
  assert.equal(store.sessions[0].messages.length, 1);
  assert.equal(store.sessions[0].messages[0].content, "fake user message");

  const secondPass = await projector.projectOnce();
  assert.equal(secondPass.length, 0, "published rows must not be projected again");
  assert.equal(readStore(storePath).sessions[0].messages.length, 1);

  const [row] = await testDb!
    .select()
    .from(harnessSessionOutbox)
    .where(eq(harnessSessionOutbox.harnessRunId, run.harnessRunId));
  assert.equal(row.status, "published");
  assert.ok(row.publishedAt);
});

// ============================================================
// T9b C4b：Session 已写入、outbox 未确认 → 重放不重复
// ============================================================

test("T9b crash between session append and outbox ack replays without a duplicate message", { skip: !testDatabaseUrl }, async () => {
  const run = await makeRun();
  const storePath = makeSessionStore(run.aiSessionId!, run.ownerUserId);
  await repo!.enqueueSessionOutbox({
    runId: run.harnessRunId,
    aiSessionId: run.aiSessionId!,
    eventType: "final_response",
    deduplicationKey: `run:${run.harnessRunId}:final-response`,
    payload: { message: { role: "assistant", content: "final answer" } },
  });

  const crashingProjector = createHarnessSessionProjector({
    repository: repo!,
    sink: makeSink(storePath, { remaining: 0 }),
    projectorId: `projector-${randomUUID()}`,
    timing: { pollIntervalMs: 5_000, lockMs: 50, maxAttempts: 3, retryAfterMs: 60_000 },
    faultInjector: (phase) => {
      if (phase === "afterAppend") {
        throw new HarnessFaultInjectedError("crash after session append, before outbox ack");
      }
    },
  });
  await assert.rejects(crashingProjector.projectOnce(), HarnessFaultInjectedError);

  const storeAfterCrash = readStore(storePath);
  assert.equal(storeAfterCrash.sessions[0].messages.length, 1, "message was appended before the crash");
  const [staleRow] = await testDb!
    .select()
    .from(harnessSessionOutbox)
    .where(eq(harnessSessionOutbox.harnessRunId, run.harnessRunId));
  assert.equal(staleRow.status, "processing", "outbox row stays unacked after the crash");

  await sleep(80); // 等待锁过期（lockMs=50）
  const healthyProjector = makeProjector(makeSink(storePath, { remaining: 0 }));
  const replay = await healthyProjector.projectOnce();
  assert.equal(replay.length, 1);
  assert.equal(replay[0].outcome, "published");
  assert.equal(replay[0].created, false, "source-key dedupe must absorb the replay");

  const finalStore = readStore(storePath);
  assert.equal(finalStore.sessions[0].messages.length, 1, "exactly one message survives the replay");
  const [acked] = await testDb!
    .select()
    .from(harnessSessionOutbox)
    .where(eq(harnessSessionOutbox.harnessRunId, run.harnessRunId));
  assert.equal(acked.status, "published");
});

// ============================================================
// T9c 失败重试与上限
// ============================================================

test("T9c sink failures retry with backoff and exhaust into failed", { skip: !testDatabaseUrl }, async () => {
  const run = await makeRun();
  const storePath = makeSessionStore(run.aiSessionId!, run.ownerUserId);
  await repo!.enqueueSessionOutbox({
    runId: run.harnessRunId,
    aiSessionId: run.aiSessionId!,
    eventType: "failure_notice",
    deduplicationKey: `run:${run.harnessRunId}:failure-notice:X`,
    payload: { message: { role: "assistant", content: "task failed" } },
  });

  const projector = makeProjector(makeSink(storePath, { remaining: 99 }), { maxAttempts: 2, lockMs: 50 });
  const first = await projector.projectOnce();
  assert.equal(first[0].outcome, "retry");
  const [row] = await testDb!
    .select()
    .from(harnessSessionOutbox)
    .where(eq(harnessSessionOutbox.harnessRunId, run.harnessRunId));
  assert.equal(row.status, "pending");
  assert.equal(row.attempts, 1);
  assert.equal(row.lastError, "SINK_UNAVAILABLE");
  assert.ok(row.availableAt.getTime() > Date.now(), "retry must be delayed");

  // 直接触发第二次失败以达到上限（不受 available_at 约束的强制路径由 lock 回收兜底）
  await testDb!
    .update(harnessSessionOutbox)
    .set({ availableAt: new Date(Date.now() - 1_000) })
    .where(eq(harnessSessionOutbox.harnessRunId, run.harnessRunId));
  const second = await projector.projectOnce();
  assert.equal(second[0].outcome, "failed");
  const [exhausted] = await testDb!
    .select()
    .from(harnessSessionOutbox)
    .where(eq(harnessSessionOutbox.harnessRunId, run.harnessRunId));
  assert.equal(exhausted.status, "failed");
  assert.equal(exhausted.attempts, 2);
  assert.equal(readStore(storePath).sessions[0].messages.length, 0, "failed projection never writes the session");
});
