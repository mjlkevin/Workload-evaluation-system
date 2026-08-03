// ============================================================
// Harness 持久运行 repository 测试
// ============================================================
// RP-047 Batch A2：基于 PostgreSQL 17 Testcontainers 验证 owner 隔离、
// 提交幂等、并发认领、lease 心跳、事件序号、检查点/输出/outbox 幂等
// 与安全错误边界。仅读取 TEST_DATABASE_URL；缺失时跳过。

import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { harnessRuns, harnessRunEvents, harnessRunCheckpoints, harnessRunOutputs, harnessSessionOutbox } from "../../db/schema";
import {
  HarnessRuntimeError,
  createHarnessRuntimeRepository,
  type CommitHarnessCheckpointInput,
  type CreateQueuedHarnessRunInput,
  type HarnessRuntimeRepository,
  type HarnessRuntimeValidation,
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

function makeValidRuntimeValidation(overrides: Record<string, unknown> = {}): HarnessRuntimeValidation {
  return {
    validatedAt: new Date().toISOString(),
    validatorVersion: "validator-1.0.0",
    checks: {
      ownerBound: true,
      workflowVersionMatched: true,
      stateHashMatched: true,
      nextStepKnown: true,
      effectsStable: true,
    },
    ...overrides,
  } as HarnessRuntimeValidation;
}

function makeCheckpointInput(runId: string, overrides: Partial<CommitHarnessCheckpointInput> = {}): CommitHarnessCheckpointInput {
  return {
    runId,
    checkpointKey: `key-${randomUUID()}`,
    checkpointKind: "structural",
    workflowId: "workbench_chat_v1",
    workflowVersion: "1.0.0",
    stepKey: "step-parse",
    resumePolicy: "resume_next",
    state: { marker: randomUUID() },
    stateHash: `hash-${randomUUID()}`,
    effectKeys: [],
    runtimeValidation: makeValidRuntimeValidation(),
    ...overrides,
  };
}

async function createTrackedRun(): Promise<string> {
  const created = await repo!.createQueuedRun(makeQueuedRunInput());
  return track(created.run.harnessRunId);
}

describeOrSkip("appendRunEvent assigns exact consecutive sequences under 20-way concurrency", { skip: !testDatabaseUrl }, async () => {
  const runId = await createTrackedRun();
  const run = await testDb!.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, runId));
  const startSequence = run[0].eventSequence;
  assert.equal(startSequence, 1, "run_queued event already consumed sequence 1");

  const events = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      repo!.appendRunEvent({ runId, eventType: "run_status_changed", payload: { ordinal: i } }),
    ),
  );

  const assigned = events.map((event) => event.sequence).sort((a, b) => a - b);
  assert.deepEqual(assigned, Array.from({ length: 20 }, (_, i) => startSequence + 1 + i));

  const persisted = await testDb!
    .select({ sequence: harnessRunEvents.sequence })
    .from(harnessRunEvents)
    .where(eq(harnessRunEvents.harnessRunId, runId));
  const sequences = persisted.map((row) => row.sequence).sort((a, b) => a - b);
  assert.deepEqual(sequences, Array.from({ length: 21 }, (_, i) => 1 + i), "no duplicates, no gaps");

  const finalRun = await testDb!.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, runId));
  assert.equal(finalRun[0].eventSequence, startSequence + 20);
});

describeOrSkip("appendRunEvent rejects unknown runs with a stable code", { skip: !testDatabaseUrl }, async () => {
  const err = await repo!.appendRunEvent({ runId: randomUUID(), eventType: "run_status_changed" }).then(
    () => null,
    (error: unknown) => error,
  );
  assert.ok(err instanceof HarnessRuntimeError);
  assert.equal(err.code, "HARNESS_RUN_NOT_FOUND");
});

describeOrSkip("commitCheckpoint is idempotent under concurrent replay", { skip: !testDatabaseUrl }, async () => {
  const runId = await createTrackedRun();
  const input = makeCheckpointInput(runId);
  const [left, right] = await Promise.all([
    repo!.commitCheckpoint(input).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    repo!.commitCheckpoint(input).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
  ]);
  const successes = [left, right].filter((item) => item.ok);
  assert.equal(successes.length, 2, `both replays must resolve, got ${JSON.stringify([left, right].map((item) => !item.ok && String((item as { error?: unknown }).error)))}`);
  const createdFlags = successes.map((item) => (item as { value: { created: boolean } }).value.created).sort();
  assert.deepEqual(createdFlags, [false, true]);

  const checkpointRows = await testDb!
    .select()
    .from(harnessRunCheckpoints)
    .where(eq(harnessRunCheckpoints.checkpointKey, input.checkpointKey));
  assert.equal(checkpointRows.length, 1);

  const commitEvents = await testDb!
    .select()
    .from(harnessRunEvents)
    .where(and(eq(harnessRunEvents.harnessRunId, runId), eq(harnessRunEvents.eventType, "checkpoint_committed")));
  assert.equal(commitEvents.length, 1, "replay must not append a second checkpoint event");

  const run = await testDb!.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, runId));
  assert.equal(run[0].lastCheckpointId, checkpointRows[0].harnessRunCheckpointId);
  assert.equal(run[0].currentStepKey, input.stepKey);
});

describeOrSkip("concurrent checkpoint commits with different keys get consecutive sequences", { skip: !testDatabaseUrl }, async () => {
  const runId = await createTrackedRun();
  const [first, second] = await Promise.all([
    repo!.commitCheckpoint(makeCheckpointInput(runId, { checkpointKey: `key-a-${randomUUID()}` })),
    repo!.commitCheckpoint(makeCheckpointInput(runId, { checkpointKey: `key-b-${randomUUID()}` })),
  ]);
  const sequences = [first.checkpoint.sequence, second.checkpoint.sequence].sort((a, b) => a - b);
  assert.deepEqual(sequences, [1, 2]);
});

describeOrSkip("commitCheckpoint enforces strict runtime validation", { skip: !testDatabaseUrl }, async () => {
  const runId = await createTrackedRun();
  const badValidations: Array<Record<string, unknown> | null | unknown[]> = [
    null,
    [],
    { validatedAt: "not-a-date", validatorVersion: "1.0.0", checks: { ownerBound: true, workflowVersionMatched: true, stateHashMatched: true, nextStepKnown: true, effectsStable: true } },
    makeValidRuntimeValidation({ validatedAt: "" }),
    makeValidRuntimeValidation({ validatorVersion: "" }),
    makeValidRuntimeValidation({ checks: { ownerBound: true, workflowVersionMatched: true, stateHashMatched: true, nextStepKnown: true } }),
    makeValidRuntimeValidation({ checks: { ownerBound: false, workflowVersionMatched: true, stateHashMatched: true, nextStepKnown: true, effectsStable: true } }),
    makeValidRuntimeValidation({ checks: { ownerBound: 1, workflowVersionMatched: true, stateHashMatched: true, nextStepKnown: true, effectsStable: true } }),
    makeValidRuntimeValidation({ checks: null }),
  ];
  for (const bad of badValidations) {
    const err = await repo!
      .commitCheckpoint(makeCheckpointInput(runId, { runtimeValidation: bad as never }))
      .then(() => null, (error: unknown) => error);
    assert.ok(err instanceof HarnessRuntimeError, `validation ${JSON.stringify(bad)?.slice(0, 80)} must be rejected`);
    assert.equal(err.code, "HARNESS_RUNTIME_VALIDATION_INVALID");
  }
  const rows = await testDb!.select().from(harnessRunCheckpoints).where(eq(harnessRunCheckpoints.harnessRunId, runId));
  assert.equal(rows.length, 0, "no checkpoint must be persisted from invalid validation");
});

describeOrSkip("commitCheckpoint requires core fields", { skip: !testDatabaseUrl }, async () => {
  const runId = await createTrackedRun();
  const missing: Array<Partial<CommitHarnessCheckpointInput>> = [
    { stateHash: "" },
    { workflowVersion: "" },
    { stepKey: "" },
    { state: null as never },
    { resumePolicy: "" as never },
  ];
  for (const patch of missing) {
    const err = await repo!
      .commitCheckpoint(makeCheckpointInput(runId, patch))
      .then(() => null, (error: unknown) => error);
    assert.ok(err instanceof HarnessRuntimeError, `missing field ${Object.keys(patch)[0]} must be rejected`);
  }
});

describeOrSkip("upsertRunOutput versions, dedupes by contentHash and protects final", { skip: !testDatabaseUrl }, async () => {
  const runId = await createTrackedRun();
  const first = await repo!.upsertRunOutput({ runId, status: "partial", content: { text: "v1" }, contentHash: "hash-a" });
  assert.equal(first.version, 1);
  const second = await repo!.upsertRunOutput({ runId, status: "partial", content: { text: "v2" }, contentHash: "hash-b" });
  assert.equal(second.version, 2);
  assert.equal(second.harnessRunOutputId, first.harnessRunOutputId, "same run keeps a single output row");
  const replay = await repo!.upsertRunOutput({ runId, status: "partial", content: { text: "v2" }, contentHash: "hash-b" });
  assert.equal(replay.version, 2, "same contentHash must not bump version");
  const final = await repo!.upsertRunOutput({ runId, status: "final", content: { text: "v3" }, contentHash: "hash-c" });
  assert.equal(final.version, 3);
  assert.equal(final.status, "final");
  const err = await repo!
    .upsertRunOutput({ runId, status: "partial", content: { text: "v4" }, contentHash: "hash-d" })
    .then(() => null, (error: unknown) => error);
  assert.ok(err instanceof HarnessRuntimeError);
  assert.equal(err.code, "FINAL_OUTPUT_IMMUTABLE");
});

describeOrSkip("enqueueSessionOutbox dedupes per session key and validates session binding", { skip: !testDatabaseUrl }, async () => {
  const input = makeQueuedRunInput();
  const created = await repo!.createQueuedRun(input);
  track(created.run.harnessRunId);
  const dedupeKey = `dedupe-${randomUUID()}`;
  const first = await repo!.enqueueSessionOutbox({
    runId: created.run.harnessRunId,
    aiSessionId: input.aiSessionId,
    eventType: "run.progress",
    deduplicationKey: dedupeKey,
    payload: { progress: 1 },
  });
  assert.equal(first.created, true);
  const second = await repo!.enqueueSessionOutbox({
    runId: created.run.harnessRunId,
    aiSessionId: input.aiSessionId,
    eventType: "run.progress",
    deduplicationKey: dedupeKey,
    payload: { progress: 1 },
  });
  assert.equal(second.created, false);
  assert.equal(second.outbox.harnessSessionOutboxId, first.outbox.harnessSessionOutboxId);

  const other = await repo!.enqueueSessionOutbox({
    runId: created.run.harnessRunId,
    aiSessionId: input.aiSessionId,
    eventType: "run.progress",
    deduplicationKey: `dedupe-${randomUUID()}`,
    payload: { progress: 2 },
  });
  assert.equal(other.created, true, "different deduplication keys coexist");

  const rows = await testDb!
    .select()
    .from(harnessSessionOutbox)
    .where(eq(harnessSessionOutbox.aiSessionId, input.aiSessionId));
  assert.equal(rows.length, 2);

  const err = await repo!
    .enqueueSessionOutbox({
      runId: created.run.harnessRunId,
      aiSessionId: "session-other",
      eventType: "run.progress",
      deduplicationKey: `dedupe-${randomUUID()}`,
      payload: {},
    })
    .then(() => null, (error: unknown) => error);
  assert.ok(err instanceof HarnessRuntimeError);
  assert.equal(err.code, "RUN_SESSION_MISMATCH");
});

describeOrSkip("payloads must be plain JSON objects under 1 MiB", { skip: !testDatabaseUrl }, async () => {
  const runId = await createTrackedRun();

  const tooLarge = "x".repeat(1024 * 1024 + 1);
  const largeErr = await repo!
    .commitCheckpoint(makeCheckpointInput(runId, { state: { blob: tooLarge } }))
    .then(() => null, (error: unknown) => error);
  assert.ok(largeErr instanceof HarnessRuntimeError);
  assert.equal(largeErr.code, "HARNESS_RUNTIME_PAYLOAD_TOO_LARGE");
  assert.ok(!largeErr.message.includes("x".repeat(32)), "oversize error must not echo the payload");

  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const circularErr = await repo!
    .commitCheckpoint(makeCheckpointInput(runId, { state: circular }))
    .then(() => null, (error: unknown) => error);
  assert.ok(circularErr instanceof HarnessRuntimeError);
  assert.equal(circularErr.code, "HARNESS_RUNTIME_PAYLOAD_INVALID");

  const arrayErr = await repo!
    .commitCheckpoint(makeCheckpointInput(runId, { state: [1, 2] as never }))
    .then(() => null, (error: unknown) => error);
  assert.ok(arrayErr instanceof HarnessRuntimeError);
  assert.equal(arrayErr.code, "HARNESS_RUNTIME_PAYLOAD_INVALID");

  const eventErr = await repo!
    .appendRunEvent({ runId, eventType: "run_status_changed", payload: ["array"] as never })
    .then(() => null, (error: unknown) => error);
  assert.ok(eventErr instanceof HarnessRuntimeError);
  assert.equal(eventErr.code, "HARNESS_RUNTIME_PAYLOAD_INVALID");

  const outputErr = await repo!
    .upsertRunOutput({ runId, status: "partial", content: { blob: tooLarge }, contentHash: "hash-large" })
    .then(() => null, (error: unknown) => error);
  assert.ok(outputErr instanceof HarnessRuntimeError);
  assert.equal(outputErr.code, "HARNESS_RUNTIME_PAYLOAD_TOO_LARGE");

  const rows = await testDb!.select().from(harnessRunCheckpoints).where(eq(harnessRunCheckpoints.harnessRunId, runId));
  assert.equal(rows.length, 0, "invalid payloads must not persist");
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
