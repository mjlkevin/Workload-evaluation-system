// ============================================================
// Harness Recovery Coordinator 测试
// ============================================================
// RP-047 Batch B：10s 扫描语义（scanOnce）、最多 3 次自动恢复、
// 2/10/30s 退避、RECOVERY_LIMIT_EXCEEDED、并发恢复互斥、取消优先、
// 最近兼容检查点选择与 RECOVERY_CHECKPOINT_INCOMPATIBLE。
// 仅读取 TEST_DATABASE_URL；缺失时跳过。

import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import {
  harnessRuns,
  harnessRunAttempts,
  harnessRunCheckpoints,
  type HarnessRunCheckpointRow,
  type HarnessRunRow,
} from "../../db/schema";
import {
  createHarnessRuntimeRepository,
  type CreateQueuedHarnessRunInput,
  type HarnessRuntimeRepository,
} from "./harness-runtime.repository";
import {
  HARNESS_RECOVERY_INCOMPATIBLE_ERROR_CODE,
  HARNESS_RECOVERY_LIMIT_ERROR_CODE,
  HARNESS_WORKER_VALIDATOR_VERSION,
} from "./harness-runtime.types";
import {
  createHarnessRuntimeWorker,
  createHarnessWorkflowRegistry,
  hashHarnessCheckpointState,
  selectHarnessResumeCheckpoint,
  type HarnessWorkflow,
  type HarnessWorkflowRegistry,
} from "./harness-runtime.worker";
import { createHarnessRecoveryCoordinator } from "./harness-runtime.recovery";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

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

function makeTinyWorkflow(): HarnessWorkflow {
  return {
    workflowId: "fake_workbench_chat",
    workflowVersion: "fake-v1",
    firstStepKey: "s1",
    stepKeys: ["s1", "s2", "s3"],
    async executeStep() {
      return { nextStepKey: null };
    },
  };
}

let registry: HarnessWorkflowRegistry;

function makeRun(): Promise<HarnessRunRow> {
  const input: CreateQueuedHarnessRunInput = {
    ownerUserId: `owner-${randomUUID()}`,
    ownerUsername: "recovery-tester",
    aiSessionId: `session-${randomUUID()}`,
    submissionKey: `submission-${randomUUID()}`,
    title: "Recovery 测试",
    workflowId: "fake_workbench_chat",
    workflowVersion: "fake-v1",
    metadata: {},
  };
  return repo!.createQueuedRun(input).then((created) => {
    createdRunIds.push(created.run.harnessRunId);
    return created.run;
  });
}

async function claimAndExpire(runId: string): Promise<void> {
  const claimed = await repo!.claimNextQueuedRun({ workerId: `w-${randomUUID()}`, leaseMs: 1_000 });
  assert.ok(claimed, "run must be claimable before expiry");
  assert.equal(claimed.run.harnessRunId, runId);
  await testDb!
    .update(harnessRunAttempts)
    .set({ leaseExpiresAt: new Date(Date.now() - 10_000) })
    .where(eq(harnessRunAttempts.harnessRunAttemptId, claimed.attempt.harnessRunAttemptId));
}

async function getRun(runId: string): Promise<HarnessRunRow> {
  const [row] = await testDb!.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, runId));
  return row;
}

function makeCoordinator() {
  return createHarnessRecoveryCoordinator({
    repository: repo!,
    registry,
    timing: { scanIntervalMs: 10_000, maxAutoRecoveries: 3, backoffMs: [100, 200, 300] },
  });
}

async function commitCp(
  runId: string,
  input: { key: string; stepKey: string; resumePolicy: "resume_next" | "restart_step" | "manual"; state: Record<string, unknown> },
): Promise<HarnessRunCheckpointRow> {
  const committed = await repo!.commitCheckpoint({
    runId,
    checkpointKey: input.key,
    checkpointKind: "structural",
    workflowId: "fake_workbench_chat",
    workflowVersion: "fake-v1",
    stepKey: input.stepKey,
    resumePolicy: input.resumePolicy,
    state: input.state,
    stateHash: hashHarnessCheckpointState(input.state),
    runtimeValidation: {
      validatedAt: new Date().toISOString(),
      validatorVersion: HARNESS_WORKER_VALIDATOR_VERSION,
      checks: { ownerBound: true, workflowVersionMatched: true, stateHashMatched: true, nextStepKnown: true, effectsStable: true },
    },
  });
  return committed.checkpoint;
}

before(() => {
  registry = createHarnessWorkflowRegistry([makeTinyWorkflow()]);
});

// ============================================================
// T6 扫描、退避序列与恢复上限
// ============================================================

test("T6 scan schedules recovery with the 2/10/30s backoff sequence", { skip: !testDatabaseUrl }, async () => {
  const run = await makeRun();
  await claimAndExpire(run.harnessRunId);

  const coordinator = makeCoordinator();
  const first = await coordinator.scanOnce();
  assert.deepEqual(
    first.map((r) => r.outcome),
    ["scheduled"],
  );
  let row = await getRun(run.harnessRunId);
  assert.equal(row.status, "recovering");
  assert.equal(row.recoveryCount, 1);
  const firstDelta = row.availableAt.getTime() - Date.now();
  assert.ok(firstDelta > 0 && firstDelta <= 150, `first backoff must be ~100ms (scaled 2s), got ${firstDelta}`);

  // 第三次恢复使用 30s 档（测试注入 300ms）
  await testDb!
    .update(harnessRuns)
    .set({ status: "queued", availableAt: new Date(Date.now() - 1_000), recoveryCount: 2 })
    .where(eq(harnessRuns.harnessRunId, run.harnessRunId));
  await claimAndExpire(run.harnessRunId);
  const third = await coordinator.scanOnce();
  assert.equal(third[0].outcome, "scheduled");
  row = await getRun(run.harnessRunId);
  assert.equal(row.recoveryCount, 3);
  const thirdDelta = row.availableAt.getTime() - Date.now();
  assert.ok(thirdDelta > 150 && thirdDelta <= 400, `third backoff must be ~300ms (scaled 30s), got ${thirdDelta}`);
});

test("T6b fourth loss triggers RECOVERY_LIMIT_EXCEEDED and fails the run", { skip: !testDatabaseUrl }, async () => {
  const run = await makeRun();
  await testDb!
    .update(harnessRuns)
    .set({ recoveryCount: 3 })
    .where(eq(harnessRuns.harnessRunId, run.harnessRunId));
  await claimAndExpire(run.harnessRunId);

  const coordinator = makeCoordinator();
  const results = await coordinator.scanOnce();
  assert.equal(results[0].outcome, "limit_exceeded");

  const row = await getRun(run.harnessRunId);
  assert.equal(row.status, "failed");
  assert.equal(row.errorCode, HARNESS_RECOVERY_LIMIT_ERROR_CODE);
});

// ============================================================
// T7 并发恢复互斥与取消优先
// ============================================================

test("T7a concurrent scans recover the same run exactly once", { skip: !testDatabaseUrl }, async () => {
  const run = await makeRun();
  await claimAndExpire(run.harnessRunId);

  const coordinator = makeCoordinator();
  const [a, b] = await Promise.all([coordinator.scanOnce(), coordinator.scanOnce()]);
  const outcomes = [...a, ...b].map((r) => r.outcome).sort();
  assert.deepEqual(outcomes, ["scheduled", "skipped"], "only one recovery actor may win per run");

  const row = await getRun(run.harnessRunId);
  assert.equal(row.recoveryCount, 1, "recovery budget consumed exactly once");
  const attempts = await testDb!
    .select()
    .from(harnessRunAttempts)
    .where(eq(harnessRunAttempts.harnessRunId, run.harnessRunId));
  assert.equal(attempts.filter((attempt) => attempt.status === "orphaned").length, 1);
});

test("T7b pending cancel wins over recovery scheduling", { skip: !testDatabaseUrl }, async () => {
  const run = await makeRun();
  await claimAndExpire(run.harnessRunId);
  await repo!.requestRunCancel({ runId: run.harnessRunId, requestedBy: "tester" });

  const coordinator = makeCoordinator();
  const results = await coordinator.scanOnce();
  assert.equal(results[0].outcome, "cancelled");

  const row = await getRun(run.harnessRunId);
  assert.equal(row.status, "cancelled");
  assert.equal(row.recoveryCount, 0, "cancel path must not consume the recovery budget");
});

// ============================================================
// T8 最近兼容检查点选择与不兼容失败
// ============================================================

test("T8 selection skips incompatible checkpoints and fails when none are compatible", { skip: !testDatabaseUrl }, async () => {
  const run = await makeRun();
  const workflow = makeTinyWorkflow();
  const cp1 = await commitCp(run.harnessRunId, {
    key: "input_committed",
    stepKey: "s1",
    resumePolicy: "resume_next",
    state: { nextStepKey: "s2", marker: "first" },
  });
  const cp2 = await commitCp(run.harnessRunId, {
    key: "context_resolved",
    stepKey: "s2",
    resumePolicy: "resume_next",
    state: { nextStepKey: "s3", marker: "second" },
  });

  // 新检查点 stateHash 损坏 → 选择器必须回退到 cp1
  await testDb!
    .update(harnessRunCheckpoints)
    .set({ stateHash: "corrupted-hash" })
    .where(eq(harnessRunCheckpoints.harnessRunCheckpointId, cp2.harnessRunCheckpointId));

  const checkpoints = await repo!.listCheckpointsForRun({ runId: run.harnessRunId });
  const selected = selectHarnessResumeCheckpoint({ checkpoints, workflow, runId: run.harnessRunId });
  assert.equal(selected?.harnessRunCheckpointId, cp1.harnessRunCheckpointId, "latest compatible checkpoint wins");

  // 全部不兼容 → Coordinator 判 RECOVERY_CHECKPOINT_INCOMPATIBLE，不消耗恢复次数
  await testDb!
    .update(harnessRunCheckpoints)
    .set({ stateHash: "corrupted-hash" })
    .where(eq(harnessRunCheckpoints.harnessRunCheckpointId, cp1.harnessRunCheckpointId));
  await claimAndExpire(run.harnessRunId);
  const coordinator = makeCoordinator();
  const results = await coordinator.scanOnce();
  assert.equal(results[0].outcome, "incompatible");
  assert.equal(results[0].errorCode, HARNESS_RECOVERY_INCOMPATIBLE_ERROR_CODE);

  const row = await getRun(run.harnessRunId);
  assert.equal(row.status, "failed");
  assert.equal(row.errorCode, HARNESS_RECOVERY_INCOMPATIBLE_ERROR_CODE);
  assert.equal(row.recoveryCount, 0, "incompatible checkpoints must not burn recovery budget");
});

// ============================================================
// T9 零检查点 Run 从头重启
// ============================================================

test("T9 run without checkpoints restarts from the workflow first step", { skip: !testDatabaseUrl }, async () => {
  const run = await makeRun();
  await claimAndExpire(run.harnessRunId);

  const coordinator = makeCoordinator();
  const results = await coordinator.scanOnce();
  assert.equal(results[0].outcome, "scheduled", "zero-checkpoint run must be requeued for a fresh start");

  await testDb!
    .update(harnessRuns)
    .set({ availableAt: new Date(Date.now() - 1_000) })
    .where(eq(harnessRuns.harnessRunId, run.harnessRunId));
  const worker = createHarnessRuntimeWorker({
    repository: repo!,
    registry,
    workerId: `w-${randomUUID()}`,
    timing: { leaseMs: 1_000, heartbeatIntervalMs: 50, claimPollIntervalMs: 20 },
  });
  assert.equal(await worker.runNextAttempt(), true);
  assert.equal((await getRun(run.harnessRunId)).status, "completed");

  const attempts = await testDb!
    .select()
    .from(harnessRunAttempts)
    .where(eq(harnessRunAttempts.harnessRunId, run.harnessRunId));
  const resumed = attempts.find((attempt) => attempt.attemptNo === 2)!;
  assert.equal(resumed.resumeCheckpointId, null, "fresh restart has no resume checkpoint");
});
