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
import { Pool, type PoolClient } from "pg";

import { harnessRuns, harnessRunAttempts, harnessRunEvents, harnessRunCheckpoints, harnessRunOutputs, harnessToolEvents } from "../../db/schema";
import * as schema from "../../db/schema";
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

/**
 * 在「事务开始时刻的毫秒内微秒余数落在 [100, 900) 安全窗口」处开启事务，必要时重试。
 * 用途：钉死 BEGIN 时刻的微秒余数远离 0，使「毫秒截断比较」与「微秒直比」的
 * 差异必然可观测——回归用例的断言结果不依赖执行时序碰运气。
 */
async function beginInSafeMicrosecondWindow(client: PoolClient, maxAttempts = 10): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT (extract(microseconds FROM now()))::bigint % 1000 AS r");
    const r = Number((rows[0] as { r: string }).r);
    if (r >= 100 && r < 900) return;
    await client.query("ROLLBACK");
  }
  throw new Error("unable to begin transaction in a safe microsecond window");
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

describeOrSkip(
  "claimNextQueuedRun picks a run whose available_at carries microsecond precision (DB clock comparison regression)",
  { skip: !testDatabaseUrl },
  async () => {
    // 回归保护：available_at 由 PG now()（微秒精度）写入，队列筛选必须用数据库时钟直比。
    // 历史缺陷：比较值经 readDbNow 的 JS Date 中转被截断到毫秒，同一毫秒内 create → claim
    // 会把刚入队的 Run 误判为未到期而漏认领（间歇性，任务卡队列）。
    // 确定性构造：将「写 available_at」与「claim」放进同一个手动事务——PG 事务内 now() 恒定，
    // available_at == claim 事务 now() 恒成立，SQL now() 直比必然认领；
    // JS Date 毫秒截断版在 BEGIN 微秒余数非零（由 beginInSafeMicrosecondWindow 保证）时必然漏认领。
    const created = await repo!.createQueuedRun(makeQueuedRunInput());
    track(created.run.harnessRunId);

    const client = await pool!.connect();
    try {
      await beginInSafeMicrosecondWindow(client);
      // 事务内 now() 恒定：available_at 被显式写为 BEGIN 时刻的微秒值
      await client.query("UPDATE harness_runs SET available_at = now() WHERE harness_run_id = $1", [
        created.run.harnessRunId,
      ]);

      // 连接级 drizzle：claim 内部 dbInstance.transaction 的 begin 会被 PG 以 WARNING 忽略，
      // claim 的 now() 与 available_at 因此共享同一事务时钟。
      // cast：连接级 drizzle 的 $client 是 PoolClient，与工厂参数的 Pool 类型签名不同（运行时无差异）
      const connRepo = createHarnessRuntimeRepository(drizzle(client, { schema }) as unknown as NonNullable<typeof testDb>);
      const claimed = await connRepo.claimNextQueuedRun({ workerId: "worker-same-txn", leaseMs: 30_000 });
      assert.ok(claimed, "same-millisecond enqueue must be claimable via DB clock comparison");
      assert.equal(claimed.run.harnessRunId, created.run.harnessRunId);
    } finally {
      // claim 成功路径会 commit 整个手动事务，失败路径会 rollback；这里只负责释放连接。
      client.release();
    }
  },
);

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

describeOrSkip("payloads reject Date, Map and non-plain objects before any transaction", { skip: !testDatabaseUrl }, async () => {
  const runId = await createTrackedRun();

  class CustomState {
    marker = "custom-instance";
  }

  const nonPlainObjects: Array<{ label: string; value: unknown }> = [
    { label: "Date", value: new Date() },
    { label: "Map", value: new Map([["a", 1]]) },
    { label: "Set", value: new Set([1]) },
    { label: "class instance", value: new CustomState() },
  ];

  for (const { label, value } of nonPlainObjects) {
    const checkpointErr = await repo!
      .commitCheckpoint(makeCheckpointInput(runId, { state: value as never }))
      .then(() => null, (error: unknown) => error);
    assert.ok(checkpointErr instanceof HarnessRuntimeError, `${label} checkpoint state must be rejected`);
    assert.equal(checkpointErr.code, "HARNESS_RUNTIME_PAYLOAD_INVALID", `${label} checkpoint state must map to the fixed payload code`);

    const eventErr = await repo!
      .appendRunEvent({ runId, eventType: "run_status_changed", payload: value as never })
      .then(() => null, (error: unknown) => error);
    assert.ok(eventErr instanceof HarnessRuntimeError, `${label} event payload must be rejected`);
    assert.equal(eventErr.code, "HARNESS_RUNTIME_PAYLOAD_INVALID", `${label} event payload must map to the fixed payload code`);

    const outputErr = await repo!
      .upsertRunOutput({ runId, status: "partial", content: value as never, contentHash: `hash-${label}` })
      .then(() => null, (error: unknown) => error);
    assert.ok(outputErr instanceof HarnessRuntimeError, `${label} output content must be rejected`);
    assert.equal(outputErr.code, "HARNESS_RUNTIME_PAYLOAD_INVALID", `${label} output content must map to the fixed payload code`);
  }

  // 拒绝必须发生在事务之前：不得留下任何检查点/输出行，事件只保留 run_queued
  const checkpoints = await testDb!.select().from(harnessRunCheckpoints).where(eq(harnessRunCheckpoints.harnessRunId, runId));
  assert.equal(checkpoints.length, 0, "non-plain state must not persist");
  const outputs = await testDb!.select().from(harnessRunOutputs).where(eq(harnessRunOutputs.harnessRunId, runId));
  assert.equal(outputs.length, 0, "non-plain content must not persist");
  const events = await testDb!.select().from(harnessRunEvents).where(eq(harnessRunEvents.harnessRunId, runId));
  assert.equal(events.length, 1, "rejected payloads must not reach a database transaction");

  // null-prototype 对象与普通对象必须被接受
  const nullProto = Object.create(null) as Record<string, unknown>;
  nullProto.marker = "null-proto";
  const accepted = await repo!.commitCheckpoint(makeCheckpointInput(runId, { state: nullProto }));
  assert.equal(accepted.created, true, "null-prototype objects are plain objects");
  const plain = await repo!.commitCheckpoint(makeCheckpointInput(runId, { state: { marker: "plain" } }));
  assert.equal(plain.created, true);
});

describeOrSkip("upsertRunOutput assigns consecutive versions under concurrent distinct hashes", { skip: !testDatabaseUrl }, async () => {
  const runId = await createTrackedRun();
  const ways = 10;
  const results = await Promise.all(
    Array.from({ length: ways }, (_, i) =>
      repo!.upsertRunOutput({ runId, status: "partial", content: { ordinal: i }, contentHash: `hash-${randomUUID()}` }),
    ),
  );
  const versions = results.map((row) => row.version).sort((a, b) => a - b);
  assert.deepEqual(versions, Array.from({ length: ways }, (_, i) => i + 1), "versions must be exactly 1..N with no gaps or duplicates");

  const rows = await testDb!.select().from(harnessRunOutputs).where(eq(harnessRunOutputs.harnessRunId, runId));
  assert.equal(rows.length, 1, "one run keeps a single output row");
  assert.equal(rows[0].version, ways, "final version must equal the number of distinct hashes");

  const updatedEvents = await testDb!
    .select()
    .from(harnessRunEvents)
    .where(and(eq(harnessRunEvents.harnessRunId, runId), eq(harnessRunEvents.eventType, "output_updated")));
  assert.equal(updatedEvents.length, ways, "one output_updated event per version bump");
  const sequences = updatedEvents.map((event) => event.sequence).sort((a, b) => a - b);
  assert.deepEqual(sequences, Array.from({ length: ways }, (_, i) => 2 + i), "output_updated sequences must be consecutive after run_queued");

  const run = await testDb!.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, runId));
  assert.equal(run[0].eventSequence, 1 + ways, "run event counter must match persisted events");
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

// ============================================================
// RP-047 Batch B：Worker/Recovery/Projector repository 扩展（R1–R11）
// ============================================================

async function makeClaimedRun(leaseMs = 300_000) {
  const created = await repo!.createQueuedRun(makeQueuedRunInput());
  track(created.run.harnessRunId);
  const claimed = await repo!.claimNextQueuedRun({ workerId: "worker-batch-b", leaseMs });
  assert.ok(claimed, "claim must succeed for a freshly queued run");
  return claimed;
}

async function backdateLease(attemptId: string, msAgo: number): Promise<void> {
  await testDb!
    .update(harnessRunAttempts)
    .set({ leaseExpiresAt: new Date(Date.now() - msAgo) })
    .where(eq(harnessRunAttempts.harnessRunAttemptId, attemptId));
}

describeOrSkip("R1 findRunsWithExpiredActiveLease returns only runs whose active lease expired", { skip: !testDatabaseUrl }, async () => {
  const expired = await makeClaimedRun(1_000);
  const healthy = await makeClaimedRun(300_000);
  const queuedOnly = await repo!.createQueuedRun(makeQueuedRunInput());
  track(queuedOnly.run.harnessRunId);
  await backdateLease(expired.attempt.harnessRunAttemptId, 10_000);

  const found = await repo!.findRunsWithExpiredActiveLease({});
  const ids = found.map((row) => row.run.harnessRunId);
  assert.ok(ids.includes(expired.run.harnessRunId), "expired lease run must be found");
  assert.ok(!ids.includes(healthy.run.harnessRunId), "healthy lease run must not be found");
  assert.ok(!ids.includes(queuedOnly.run.harnessRunId), "queued run without attempt must not be found");
  const match = found.find((row) => row.run.harnessRunId === expired.run.harnessRunId);
  assert.equal(match?.attempt.harnessRunAttemptId, expired.attempt.harnessRunAttemptId);
});

describeOrSkip("R2 claimNextQueuedRun picks recovering runs only after backoff elapses", { skip: !testDatabaseUrl }, async () => {
  const created = await repo!.createQueuedRun(makeQueuedRunInput());
  track(created.run.harnessRunId);
  await testDb!
    .update(harnessRuns)
    .set({ status: "recovering", availableAt: new Date(Date.now() + 60_000) })
    .where(eq(harnessRuns.harnessRunId, created.run.harnessRunId));
  const early = await repo!.claimNextQueuedRun({ workerId: "w-early", leaseMs: 1_000 });
  assert.equal(early, null, "recovering run before backoff must not be claimable");

  await testDb!
    .update(harnessRuns)
    .set({ availableAt: new Date(Date.now() - 1_000) })
    .where(eq(harnessRuns.harnessRunId, created.run.harnessRunId));
  const claimed = await repo!.claimNextQueuedRun({ workerId: "w-after", leaseMs: 1_000 });
  assert.ok(claimed, "recovering run after backoff must be claimable");
  assert.equal(claimed.run.status, "running");
});

describeOrSkip("R3 scheduleRunRecovery orphans attempt, applies backoff and appends recovery event", { skip: !testDatabaseUrl }, async () => {
  const claimed = await makeClaimedRun(1_000);
  await backdateLease(claimed.attempt.harnessRunAttemptId, 10_000);
  const result = await repo!.scheduleRunRecovery({
    runId: claimed.run.harnessRunId,
    maxAutoRecoveries: 3,
    backoffMs: [2_000, 10_000, 30_000],
  });
  assert.equal(result.outcome, "scheduled");

  const [run] = await testDb!.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, claimed.run.harnessRunId));
  assert.equal(run.status, "recovering");
  assert.equal(run.recoveryCount, 1);
  const backoffDelta = run.availableAt.getTime() - Date.now();
  assert.ok(backoffDelta > 500 && backoffDelta <= 2_500, `first backoff must be ~2000ms, got ${backoffDelta}`);

  const [attempt] = await testDb!
    .select()
    .from(harnessRunAttempts)
    .where(eq(harnessRunAttempts.harnessRunAttemptId, claimed.attempt.harnessRunAttemptId));
  assert.equal(attempt.status, "orphaned");

  const events = await testDb!
    .select()
    .from(harnessRunEvents)
    .where(and(eq(harnessRunEvents.harnessRunId, claimed.run.harnessRunId), eq(harnessRunEvents.eventType, "recovery_started")));
  assert.equal(events.length, 1, "exactly one recovery_started event");
});

describeOrSkip("R3 scheduleRunRecovery enforces RECOVERY_LIMIT_EXCEEDED at the recovery cap", { skip: !testDatabaseUrl }, async () => {
  const claimed = await makeClaimedRun(1_000);
  await backdateLease(claimed.attempt.harnessRunAttemptId, 10_000);
  await testDb!
    .update(harnessRuns)
    .set({ recoveryCount: 3 })
    .where(eq(harnessRuns.harnessRunId, claimed.run.harnessRunId));
  const result = await repo!.scheduleRunRecovery({
    runId: claimed.run.harnessRunId,
    maxAutoRecoveries: 3,
    backoffMs: [2_000, 10_000, 30_000],
  });
  assert.equal(result.outcome, "limit_exceeded");

  const [run] = await testDb!.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, claimed.run.harnessRunId));
  assert.equal(run.status, "failed");
  assert.equal(run.errorCode, "RECOVERY_LIMIT_EXCEEDED");

  const [attempt] = await testDb!
    .select()
    .from(harnessRunAttempts)
    .where(eq(harnessRunAttempts.harnessRunAttemptId, claimed.attempt.harnessRunAttemptId));
  assert.equal(attempt.status, "orphaned");

  const events = await testDb!
    .select()
    .from(harnessRunEvents)
    .where(and(eq(harnessRunEvents.harnessRunId, claimed.run.harnessRunId), eq(harnessRunEvents.eventType, "run_failed")));
  assert.equal(events.length, 1);
});

describeOrSkip("R3 scheduleRunRecovery honors pending cancel before scheduling recovery", { skip: !testDatabaseUrl }, async () => {
  const claimed = await makeClaimedRun(1_000);
  await backdateLease(claimed.attempt.harnessRunAttemptId, 10_000);
  const cancel = await repo!.requestRunCancel({ runId: claimed.run.harnessRunId, requestedBy: "tester" });
  assert.equal(cancel.changed, true);
  const result = await repo!.scheduleRunRecovery({
    runId: claimed.run.harnessRunId,
    maxAutoRecoveries: 3,
    backoffMs: [2_000, 10_000, 30_000],
  });
  assert.equal(result.outcome, "cancelled", "cancel request must win over recovery scheduling");

  const [run] = await testDb!.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, claimed.run.harnessRunId));
  assert.equal(run.status, "cancelled");
  assert.equal(run.recoveryCount, 0, "cancel path must not consume recovery budget");

  const cancelledEvents = await testDb!
    .select()
    .from(harnessRunEvents)
    .where(and(eq(harnessRunEvents.harnessRunId, claimed.run.harnessRunId), eq(harnessRunEvents.eventType, "run_cancelled")));
  assert.equal(cancelledEvents.length, 1);
});

describeOrSkip("R4 listCheckpointsForRun returns checkpoints newest first", { skip: !testDatabaseUrl }, async () => {
  const created = await repo!.createQueuedRun(makeQueuedRunInput());
  track(created.run.harnessRunId);
  await repo!.commitCheckpoint(makeCheckpointInput(created.run.harnessRunId, { stepKey: "step-1" }));
  await repo!.commitCheckpoint(makeCheckpointInput(created.run.harnessRunId, { stepKey: "step-2" }));
  const list = await repo!.listCheckpointsForRun({ runId: created.run.harnessRunId });
  assert.equal(list.length, 2);
  assert.equal(list[0].stepKey, "step-2", "newest checkpoint must come first");
  assert.equal(list[1].stepKey, "step-1");
});

describeOrSkip("R5 setAttemptResumeCheckpoint persists the resume pointer", { skip: !testDatabaseUrl }, async () => {
  const claimed = await makeClaimedRun(1_000);
  const committed = await repo!.commitCheckpoint(makeCheckpointInput(claimed.run.harnessRunId));
  const updated = await repo!.setAttemptResumeCheckpoint({
    attemptId: claimed.attempt.harnessRunAttemptId,
    checkpointId: committed.checkpoint.harnessRunCheckpointId,
  });
  assert.ok(updated);
  const [attempt] = await testDb!
    .select()
    .from(harnessRunAttempts)
    .where(eq(harnessRunAttempts.harnessRunAttemptId, claimed.attempt.harnessRunAttemptId));
  assert.equal(attempt.resumeCheckpointId, committed.checkpoint.harnessRunCheckpointId);
});

describeOrSkip("R6 recordToolEffectOnce dedupes side effects by (runId, effectKey)", { skip: !testDatabaseUrl }, async () => {
  const claimed = await makeClaimedRun(1_000);
  const runId = claimed.run.harnessRunId;
  const effectKey = `${runId}:s3:fake.tool:1`;
  const first = await repo!.recordToolEffectOnce({
    runId,
    attemptId: claimed.attempt.harnessRunAttemptId,
    effectKey,
    toolName: "fake.tool",
    input: { query: "x" },
    output: { value: 1 },
  });
  assert.equal(first.created, true);
  const second = await repo!.recordToolEffectOnce({
    runId,
    attemptId: null,
    effectKey,
    toolName: "fake.tool",
    input: { query: "x" },
    output: { value: 999 },
  });
  assert.equal(second.created, false, "replay must not create a second effect record");
  assert.equal(second.toolEvent.harnessToolEventId, first.toolEvent.harnessToolEventId);
  assert.deepEqual(second.toolEvent.output, { value: 1 }, "recorded output of the first execution wins");

  const found = await repo!.findToolEffectByKey({ runId, effectKey });
  assert.equal(found?.harnessToolEventId, first.toolEvent.harnessToolEventId);

  const rows = await testDb!.select().from(harnessToolEvents).where(eq(harnessToolEvents.harnessRunId, runId));
  assert.equal(rows.length, 1, "exactly one tool event row per effect key");
});

describeOrSkip("R9 completeAttemptAndRun finalizes attempt and run exactly once", { skip: !testDatabaseUrl }, async () => {
  const claimed = await makeClaimedRun(1_000);
  const runId = claimed.run.harnessRunId;
  const first = await repo!.completeAttemptAndRun({
    attemptId: claimed.attempt.harnessRunAttemptId,
    runId,
    outcome: "succeeded",
  });
  assert.equal(first.changed, true);
  const second = await repo!.completeAttemptAndRun({
    attemptId: claimed.attempt.harnessRunAttemptId,
    runId,
    outcome: "succeeded",
  });
  assert.equal(second.changed, false, "terminal transition must be idempotent");

  const [run] = await testDb!.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, runId));
  assert.equal(run.status, "completed");
  assert.ok(run.completedAt);
  const [attempt] = await testDb!
    .select()
    .from(harnessRunAttempts)
    .where(eq(harnessRunAttempts.harnessRunAttemptId, claimed.attempt.harnessRunAttemptId));
  assert.equal(attempt.status, "succeeded");
  assert.ok(attempt.finishedAt);

  const events = await testDb!
    .select()
    .from(harnessRunEvents)
    .where(and(eq(harnessRunEvents.harnessRunId, runId), eq(harnessRunEvents.eventType, "run_completed")));
  assert.equal(events.length, 1, "terminal event must be appended exactly once");
});

describeOrSkip("R10 requestRunCancel marks cancelling and never touches terminal runs", { skip: !testDatabaseUrl }, async () => {
  const claimed = await makeClaimedRun(1_000);
  const runId = claimed.run.harnessRunId;
  const cancel = await repo!.requestRunCancel({ runId, requestedBy: "tester" });
  assert.equal(cancel.changed, true);
  const [run] = await testDb!.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, runId));
  assert.equal(run.status, "cancelling");
  assert.equal(run.cancelRequestedBy, "tester");
  assert.ok(run.cancelRequestedAt);
  const cancelEvents = await testDb!
    .select()
    .from(harnessRunEvents)
    .where(and(eq(harnessRunEvents.harnessRunId, runId), eq(harnessRunEvents.eventType, "cancel_requested")));
  assert.equal(cancelEvents.length, 1);

  const completed = await makeClaimedRun(1_000);
  await repo!.completeAttemptAndRun({ attemptId: completed.attempt.harnessRunAttemptId, runId: completed.run.harnessRunId, outcome: "succeeded" });
  const late = await repo!.requestRunCancel({ runId: completed.run.harnessRunId, requestedBy: "tester" });
  assert.equal(late.changed, false, "terminal run must reject cancel");
  const [terminalRun] = await testDb!.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, completed.run.harnessRunId));
  assert.equal(terminalRun.status, "completed");
});

describeOrSkip("R10b requestRunCancel finalizes runs that have no active attempt", { skip: !testDatabaseUrl }, async () => {
  // waiting / legacy 行没有活跃 attempt：claim 只取 queued/recovering，
  // recovery 只收割租约过期的 attempt，置 cancelling 会永久留在活跃集合。
  const created = await repo!.createQueuedRun(makeQueuedRunInput());
  const runId = track(created.run.harnessRunId);
  await testDb!.update(harnessRuns).set({ status: "waiting" }).where(eq(harnessRuns.harnessRunId, runId));

  const cancel = await repo!.requestRunCancel({ runId, requestedBy: "tester" });
  assert.equal(cancel.changed, true);
  assert.equal(cancel.run.status, "cancelled", "attempt 缺席时必须直接落终态");

  const [run] = await testDb!.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, runId));
  assert.equal(run.status, "cancelled");
  assert.ok(run.completedAt, "终态必须写 completedAt");
  assert.equal(run.cancelRequestedBy, "tester");
  const requested = await testDb!
    .select()
    .from(harnessRunEvents)
    .where(and(eq(harnessRunEvents.harnessRunId, runId), eq(harnessRunEvents.eventType, "cancel_requested")));
  assert.equal(requested.length, 1);
  const cancelled = await testDb!
    .select()
    .from(harnessRunEvents)
    .where(and(eq(harnessRunEvents.harnessRunId, runId), eq(harnessRunEvents.eventType, "run_cancelled")));
  assert.equal(cancelled.length, 1, "终态事件必须补齐");

  // 幂等：已终态的 Run 再取消不改行、不再追加事件。
  const again = await repo!.requestRunCancel({ runId, requestedBy: "tester" });
  assert.equal(again.changed, false);
  const cancelledAgain = await testDb!
    .select()
    .from(harnessRunEvents)
    .where(and(eq(harnessRunEvents.harnessRunId, runId), eq(harnessRunEvents.eventType, "run_cancelled")));
  assert.equal(cancelledAgain.length, 1);
});

describeOrSkip("R10c requestRunCancel rescues a run already stuck in cancelling without an attempt", { skip: !testDatabaseUrl }, async () => {
  // 修复前留下的存量：status=cancelling 且 cancelRequestedAt 已写，
  // 旧实现的 cancelRequestedAt 守卫会让重复点击也无法收尾。
  const created = await repo!.createQueuedRun(makeQueuedRunInput());
  const runId = track(created.run.harnessRunId);
  await testDb!
    .update(harnessRuns)
    .set({ status: "cancelling", cancelRequestedAt: new Date(), cancelRequestedBy: "earlier-click" })
    .where(eq(harnessRuns.harnessRunId, runId));

  const cancel = await repo!.requestRunCancel({ runId, requestedBy: "tester" });
  assert.equal(cancel.changed, true);
  const [run] = await testDb!.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, runId));
  assert.equal(run.status, "cancelled");
  assert.equal(run.cancelRequestedBy, "earlier-click", "首次取消请求人必须保留");
  const requested = await testDb!
    .select()
    .from(harnessRunEvents)
    .where(and(eq(harnessRunEvents.harnessRunId, runId), eq(harnessRunEvents.eventType, "cancel_requested")));
  assert.equal(requested.length, 0, "补落终态不得重复追加 cancel_requested");
});

describeOrSkip("R11 releaseAttemptForShutdown requeues the run or completes a pending cancel", { skip: !testDatabaseUrl }, async () => {
  const claimed = await makeClaimedRun(1_000);
  const released = await repo!.releaseAttemptForShutdown({
    attemptId: claimed.attempt.harnessRunAttemptId,
    runId: claimed.run.harnessRunId,
  });
  assert.equal(released.outcome, "requeued");
  const [run] = await testDb!.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, claimed.run.harnessRunId));
  assert.equal(run.status, "queued");
  const [attempt] = await testDb!
    .select()
    .from(harnessRunAttempts)
    .where(eq(harnessRunAttempts.harnessRunAttemptId, claimed.attempt.harnessRunAttemptId));
  assert.equal(attempt.status, "cancelled");

  const claimedCancel = await makeClaimedRun(1_000);
  await repo!.requestRunCancel({ runId: claimedCancel.run.harnessRunId, requestedBy: "tester" });
  const cancelled = await repo!.releaseAttemptForShutdown({
    attemptId: claimedCancel.attempt.harnessRunAttemptId,
    runId: claimedCancel.run.harnessRunId,
  });
  assert.equal(cancelled.outcome, "cancelled", "shutdown with pending cancel completes the cancellation");
  const [cancelledRun] = await testDb!.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, claimedCancel.run.harnessRunId));
  assert.equal(cancelledRun.status, "cancelled");
});
