// ============================================================
// Harness 持久运行 repository 测试
// ============================================================
// RP-047 Batch A2：基于 PostgreSQL 17 Testcontainers 验证 owner 隔离、
// 提交幂等、并发认领、lease 心跳、事件序号、检查点/输出/outbox 幂等
// 与安全错误边界。仅读取 TEST_DATABASE_URL；缺失时跳过。

import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";

import { harnessRuns, harnessRunEvents } from "../../db/schema";
import {
  HarnessRuntimeError,
  createHarnessRuntimeRepository,
  type CreateQueuedHarnessRunInput,
  type HarnessRuntimeRepository,
} from "./harness-runtime.repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeOrSkip = test;

let pool: Pool | null = null;
let testDb: ReturnType<typeof drizzle> | null = null;
let repo: HarnessRuntimeRepository | null = null;
const createdRunIds: string[] = [];

before(async () => {
  if (!testDatabaseUrl) return;
  pool = new Pool({ connectionString: testDatabaseUrl, max: 10 });
  testDb = drizzle(pool);
  repo = createHarnessRuntimeRepository(testDb);
});

after(async () => {
  if (pool) await pool.end();
});

afterEach(async () => {
  if (!testDb) return;
  for (const runId of createdRunIds.splice(0)) {
    await testDb.delete(harnessRuns).where(eq(harnessRuns.harnessRunId, runId));
  }
});

function makeQueuedRunInput(overrides: Partial<CreateQueuedHarnessRunInput> = {}): CreateQueuedHarnessRunInput {
  return {
    ownerUserId: `owner-${randomUUID()}`,
    ownerUsername: "runtime-tester",
    aiSessionId: `session-${randomUUID()}`,
    submissionKey: `submission-${randomUUID()}`,
    title: "持久运行测试",
    workflowId: "workbench_chat_v1",
    workflowVersion: "1.0.0",
    executionConfig: { model: "fake" },
    metadata: { source: "repository-test" },
    ...overrides,
  };
}

function track(runId: string): string {
  createdRunIds.push(runId);
  return runId;
}

describeOrSkip("createQueuedRun returns the same run for one owner and submission key", { skip: !testDatabaseUrl }, async () => {
  const input = makeQueuedRunInput();
  const first = await repo!.createQueuedRun(input);
  const second = await repo!.createQueuedRun(input);
  track(first.run.harnessRunId);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.run.harnessRunId, first.run.harnessRunId);
});

describeOrSkip("createQueuedRun returns the persisted eventSequence", { skip: !testDatabaseUrl }, async () => {
  const created = await repo!.createQueuedRun(makeQueuedRunInput());
  track(created.run.harnessRunId);
  const persisted = await repo!.findRunForOwner(created.run.harnessRunId, created.run.ownerUserId);
  assert.equal(created.run.eventSequence, 1);
  assert.equal(persisted?.eventSequence, 1);
});

describeOrSkip("createQueuedRun rolls back the run when run_queued event insert fails", { skip: !testDatabaseUrl }, async () => {
  const input = makeQueuedRunInput();
  const eventsBefore = await testDb!.select({ sequence: harnessRunEvents.sequence }).from(harnessRunEvents);
  await testDb!.execute(
    sql`ALTER TABLE harness_run_events ADD CONSTRAINT rp047_a2_fail_run_queued CHECK (event_type <> 'run_queued')`,
  );
  try {
    await assert.rejects(repo!.createQueuedRun(input), (err: unknown) => err instanceof HarnessRuntimeError);
    const residual = await testDb!
      .select()
      .from(harnessRuns)
      .where(and(eq(harnessRuns.ownerUserId, input.ownerUserId), eq(harnessRuns.submissionKey, input.submissionKey)));
    assert.equal(residual.length, 0, "failed create must not leave a half-committed run");
    const eventsAfter = await testDb!.select({ sequence: harnessRunEvents.sequence }).from(harnessRunEvents);
    assert.equal(eventsAfter.length, eventsBefore.length, "failed create must not leave a half-committed event");
  } finally {
    await testDb!.execute(sql`ALTER TABLE harness_run_events DROP CONSTRAINT rp047_a2_fail_run_queued`);
  }
});

describeOrSkip("one workbench session cannot hold two active runs", { skip: !testDatabaseUrl }, async () => {
  const session = `session-${randomUUID()}`;
  const owner = `owner-${randomUUID()}`;
  const first = await repo!.createQueuedRun(makeQueuedRunInput({ ownerUserId: owner, aiSessionId: session, submissionKey: "submit-a" }));
  track(first.run.harnessRunId);
  await assert.rejects(
    repo!.createQueuedRun(makeQueuedRunInput({ ownerUserId: owner, aiSessionId: session, submissionKey: "submit-b" })),
    /active workbench run/i,
  );
});

describeOrSkip("findRunForOwner never returns another owner's run", { skip: !testDatabaseUrl }, async () => {
  const created = await repo!.createQueuedRun(makeQueuedRunInput());
  track(created.run.harnessRunId);
  assert.equal(await repo!.findRunForOwner(created.run.harnessRunId, "other-owner"), null);
  assert.equal((await repo!.findRunForOwner(created.run.harnessRunId, created.run.ownerUserId))?.ownerUserId, created.run.ownerUserId);
});

describeOrSkip("two claimers cannot claim the same queued run", { skip: !testDatabaseUrl }, async () => {
  const created = await repo!.createQueuedRun(makeQueuedRunInput());
  track(created.run.harnessRunId);
  const [left, right] = await Promise.all([
    repo!.claimNextQueuedRun({ workerId: "worker-a", leaseMs: 30_000 }),
    repo!.claimNextQueuedRun({ workerId: "worker-b", leaseMs: 30_000 }),
  ]);
  const claimed = [left, right].filter(Boolean);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]?.run.harnessRunId, created.run.harnessRunId);
  assert.equal(claimed[0]?.attempt.attemptNo, 1);
  assert.equal(claimed[0]?.run.status, "running");
});

describeOrSkip("claim rejects lease outside the 1s..300s window", { skip: !testDatabaseUrl }, async () => {
  await assert.rejects(repo!.claimNextQueuedRun({ workerId: "worker-a", leaseMs: 10 }), HarnessRuntimeError);
  await assert.rejects(repo!.claimNextQueuedRun({ workerId: "worker-a", leaseMs: 300_001 }), HarnessRuntimeError);
});

describeOrSkip("heartbeat extends lease for the owning worker only", { skip: !testDatabaseUrl }, async () => {
  const created = await repo!.createQueuedRun(makeQueuedRunInput());
  track(created.run.harnessRunId);
  const claimed = await repo!.claimNextQueuedRun({ workerId: "worker-a", leaseMs: 30_000 });
  assert.ok(claimed);
  const now = new Date();
  const extended = await repo!.heartbeatAttempt({ attemptId: claimed.attempt.harnessRunAttemptId, workerId: "worker-a", leaseMs: 60_000, now });
  assert.ok(extended);
  assert.equal(extended.status, "running");
  assert.ok(extended.leaseExpiresAt.getTime() >= now.getTime() + 59_000);
  const stolen = await repo!.heartbeatAttempt({ attemptId: claimed.attempt.harnessRunAttemptId, workerId: "worker-b", leaseMs: 30_000, now: new Date(now.getTime() + 1) });
  assert.equal(stolen, null);
});

describeOrSkip("heartbeat rejects expired lease", { skip: !testDatabaseUrl }, async () => {
  const created = await repo!.createQueuedRun(makeQueuedRunInput());
  track(created.run.harnessRunId);
  const claimed = await repo!.claimNextQueuedRun({ workerId: "worker-a", leaseMs: 30_000 });
  assert.ok(claimed);
  const expiredAt = claimed.attempt.leaseExpiresAt;
  const result = await repo!.heartbeatAttempt({
    attemptId: claimed.attempt.harnessRunAttemptId,
    workerId: "worker-a",
    leaseMs: 30_000,
    now: new Date(expiredAt.getTime() + 1),
  });
  assert.equal(result, null);
});

describeOrSkip("heartbeat rejects out-of-window leaseMs", { skip: !testDatabaseUrl }, async () => {
  const created = await repo!.createQueuedRun(makeQueuedRunInput());
  track(created.run.harnessRunId);
  const claimed = await repo!.claimNextQueuedRun({ workerId: "worker-a", leaseMs: 30_000 });
  assert.ok(claimed);
  await assert.rejects(
    repo!.heartbeatAttempt({ attemptId: claimed.attempt.harnessRunAttemptId, workerId: "worker-a", leaseMs: 5 }),
    HarnessRuntimeError,
  );
});

describeOrSkip("safe errors never leak SQL params or state", { skip: !testDatabaseUrl }, async () => {
  const sentinel = `sentinel-${randomUUID()}`;
  const input = makeQueuedRunInput();
  const created = await repo!.createQueuedRun(input);
  track(created.run.harnessRunId);
  // 制造 checkpoint key 冲突：同 key 不同 stateHash（Task 3 实现后生效）
  const maybeRepo = repo as unknown as { commitCheckpoint?: (input: unknown) => Promise<unknown> };
  if (typeof maybeRepo.commitCheckpoint === "function") {
    const base = {
      runId: created.run.harnessRunId,
      checkpointKey: `key-${randomUUID()}`,
      checkpointKind: "structural" as const,
      workflowId: "workbench_chat_v1",
      workflowVersion: "1.0.0",
      stepKey: "step-1",
      resumePolicy: "resume_next" as const,
      state: { marker: sentinel },
      stateHash: "hash-1",
      runtimeValidation: {
        validatedAt: new Date().toISOString(),
        validatorVersion: "1.0.0",
        checks: { ownerBound: true, workflowVersionMatched: true, stateHashMatched: true, nextStepKnown: true, effectsStable: true },
      },
    };
    await maybeRepo.commitCheckpoint(base);
    const err = await maybeRepo.commitCheckpoint({ ...base, stateHash: "hash-2" }).then(
      () => null,
      (error: unknown) => error,
    );
    assert.ok(err instanceof HarnessRuntimeError);
    assert.equal(err.code, "CHECKPOINT_KEY_CONFLICT");
    const text = `${err.message} ${err.stack ?? ""}`;
    assert.ok(!text.includes(sentinel), "error must not echo state content");
    assert.ok(!text.includes("INSERT INTO"), "error must not echo SQL");
  }
});
