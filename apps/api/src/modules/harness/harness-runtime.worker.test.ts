// ============================================================
// Harness Runtime Worker 测试
// ============================================================
// RP-047 Batch B：Worker 认领/lease/heartbeat/优雅停机/硬退出、
// 混合检查点恢复、effectKey 工具幂等、模型流重做与取消安全边界。
// 故障注入：worker 级 faultInjector（步骤提交后崩溃）+ fake
// workflow 内部注入（工具副作用后、模型流中）。仅读取
// TEST_DATABASE_URL；缺失时跳过。

import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import {
  harnessRuns,
  harnessRunAttempts,
  harnessRunCheckpoints,
  harnessRunEvents,
  harnessRunOutputs,
  harnessToolEvents,
  type HarnessRunRow,
} from "../../db/schema";
import {
  createHarnessRuntimeRepository,
  type CreateQueuedHarnessRunInput,
  type HarnessRuntimeRepository,
} from "./harness-runtime.repository";
import {
  HarnessFaultInjectedError,
  HarnessWorkflowCancelledError,
  createHarnessRuntimeWorker,
  createHarnessWorkflowRegistry,
  type HarnessRuntimeWorker,
  type HarnessWorkflow,
  type HarnessWorkflowRegistry,
  type HarnessWorkflowStepOutcome,
} from "./harness-runtime.worker";
import { createHarnessRecoveryCoordinator } from "./harness-runtime.recovery";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

function track(runId: string): string {
  createdRunIds.push(runId);
  return runId;
}

async function makeRun(): Promise<HarnessRunRow> {
  const input: CreateQueuedHarnessRunInput = {
    ownerUserId: `owner-${randomUUID()}`,
    ownerUsername: "worker-tester",
    aiSessionId: `session-${randomUUID()}`,
    submissionKey: `submission-${randomUUID()}`,
    title: "Worker 测试",
    workflowId: "fake_workbench_chat",
    workflowVersion: "fake-v1",
    executionConfig: { model: "fake" },
    metadata: { clientMessageId: `cm-${randomUUID()}` },
  };
  const created = await repo!.createQueuedRun(input);
  track(created.run.harnessRunId);
  return created.run;
}

async function getRun(runId: string): Promise<HarnessRunRow> {
  const [row] = await testDb!.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, runId));
  return row;
}

async function listEvents(runId: string, eventType?: string) {
  const conditions = eventType
    ? and(eq(harnessRunEvents.harnessRunId, runId), eq(harnessRunEvents.eventType, eventType))
    : eq(harnessRunEvents.harnessRunId, runId);
  return testDb!.select().from(harnessRunEvents).where(conditions);
}

async function listCheckpoints(runId: string) {
  return testDb!
    .select()
    .from(harnessRunCheckpoints)
    .where(eq(harnessRunCheckpoints.harnessRunId, runId));
}

async function expireActiveLease(runId: string): Promise<void> {
  await testDb!
    .update(harnessRunAttempts)
    .set({ leaseExpiresAt: new Date(Date.now() - 10_000) })
    .where(eq(harnessRunAttempts.harnessRunId, runId));
}

async function makeAvailableNow(runId: string): Promise<void> {
  await testDb!
    .update(harnessRuns)
    .set({ availableAt: new Date(Date.now() - 1_000) })
    .where(eq(harnessRuns.harnessRunId, runId));
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await sleep(25);
  }
  throw new Error("waitFor condition timeout");
}

// ============================================================
// fake workflow / fake provider（工单 §9 规范）
// ============================================================

type FakeHooks = {
  crashAfterToolEffectOnAttempt?: number;
  modelChunksByAttempt?: Record<number, string[]>;
  modelFailAtChunkByAttempt?: Record<number, number>;
  chunkDelayMs?: number;
  stepGates?: Record<string, () => Promise<void>>;
};

function makeFakeWorkflow(hooks: FakeHooks, counters: { toolExecutions: number }): HarnessWorkflow {
  const stepKeys = ["s1", "s2", "s3", "s4", "s5", "s6"] as const;
  return {
    workflowId: "fake_workbench_chat",
    workflowVersion: "fake-v1",
    firstStepKey: "s1",
    stepKeys,
    async executeStep(stepKey, ctx): Promise<HarnessWorkflowStepOutcome> {
      const runId = ctx.run.harnessRunId;
      const gate = hooks.stepGates?.[stepKey];
      if (gate) await gate();
      switch (stepKey) {
        case "s1": {
          const clientMessageId = String(
            (ctx.run.metadata as Record<string, unknown> | null)?.clientMessageId ?? `cm-${runId}`,
          );
          return {
            nextStepKey: "s2",
            statePatch: { clientMessageId },
            checkpoint: { key: "input_committed", kind: "structural", resumePolicy: "resume_next" },
            // S7（2026-08-31）：原 fake 返回的 outbox 条目已删（字段与补偿链同步退役）；
            // 不得再产生 outbox_enqueued 行由下方守护断言拦截。
          };
        }
        case "s2": {
          return {
            nextStepKey: "s3",
            statePatch: { context: "fake-context" },
            checkpoint: { key: "context_resolved", kind: "combined", resumePolicy: "resume_next" },
          };
        }
        case "s3": {
          const effectKey = ctx.makeEffectKey("fake.tool", 1);
          const result = await ctx.recordToolEffectOnce({
            effectKey,
            toolName: "fake.tool",
            input: { query: "fake" },
            execute: async () => {
              counters.toolExecutions += 1;
              return { toolResult: "ok" };
            },
          });
          if (hooks.crashAfterToolEffectOnAttempt === ctx.attempt.attemptNo) {
            throw new HarnessFaultInjectedError("crash after tool effect, before checkpoint");
          }
          return {
            nextStepKey: "s4",
            statePatch: { toolOutput: result.output },
            checkpoint: {
              key: `tool_result_committed:${effectKey}`,
              kind: "structural",
              resumePolicy: "resume_next",
              effectKeys: [effectKey],
            },
          };
        }
        case "s4": {
          return {
            nextStepKey: "s5",
            statePatch: { s5Input: { systemPrompt: "sys", userContent: "u" } },
            checkpoint: { key: "model_input_ready:s5", kind: "structural", resumePolicy: "restart_step" },
          };
        }
        case "s5": {
          const attemptNo = ctx.attempt.attemptNo;
          const chunks = hooks.modelChunksByAttempt?.[attemptNo] ?? [`chunk-a${attemptNo}`, `chunk-b${attemptNo}`];
          const failAt = hooks.modelFailAtChunkByAttempt?.[attemptNo];
          let text = "";
          for (let i = 0; i < chunks.length; i += 1) {
            if (ctx.abortSignal.aborted) {
              throw new HarnessWorkflowCancelledError("cancelled during model stream");
            }
            if (hooks.chunkDelayMs) await sleep(hooks.chunkDelayMs);
            if (failAt === i) {
              throw new HarnessFaultInjectedError("model stream interrupted mid-generation");
            }
            text += chunks[i];
          }
          return { nextStepKey: "s6", statePatch: { modelText: text } };
        }
        case "s6": {
          const modelText = String(ctx.state.modelText ?? "");
          return {
            nextStepKey: null,
            statePatch: { finalText: modelText },
            checkpoint: { key: "final_response_committed", kind: "structural", resumePolicy: "restart_step" },
            output: {
              status: "final",
              content: { text: modelText },
              contentHash: createHash("sha256").update(modelText).digest("hex"),
            },
            // S7（2026-08-31）：原 fake 返回的 outbox 条目已删（字段与补偿链同步退役）。
          };
        }
        default:
          throw new Error(`unknown fake step ${stepKey}`);
      }
    },
  };
}

function makeWorker(
  registry: HarnessWorkflowRegistry,
  options: {
    workerId?: string;
    faultInjector?: (stepKey: string, phase: "beforeStep" | "afterStepCommit") => void;
    timing?: { leaseMs?: number; heartbeatIntervalMs?: number; claimPollIntervalMs?: number };
  } = {},
): HarnessRuntimeWorker {
  return createHarnessRuntimeWorker({
    repository: repo!,
    registry,
    workerId: options.workerId ?? `worker-${randomUUID()}`,
    timing: { leaseMs: 1_000, heartbeatIntervalMs: 50, claimPollIntervalMs: 20, ...options.timing },
    faultInjector: options.faultInjector,
  });
}

function makeCoordinator(registry: HarnessWorkflowRegistry) {
  return createHarnessRecoveryCoordinator({
    repository: repo!,
    registry,
    timing: { scanIntervalMs: 10_000, maxAutoRecoveries: 3, backoffMs: [100, 200, 300] },
  });
}

async function recoverAndFinish(runId: string, registry: HarnessWorkflowRegistry): Promise<void> {
  const coordinator = makeCoordinator(registry);
  const results = await coordinator.scanOnce();
  assert.equal(results.length, 1, "scanOnce must handle exactly the expired run");
  assert.equal(results[0].outcome, "scheduled");
  await makeAvailableNow(runId);
  const worker = makeWorker(registry, { workerId: `worker-resume-${randomUUID()}` });
  const did = await worker.runNextAttempt();
  assert.equal(did, true, "resumed run must be claimable");
}

// ============================================================
// T1 Worker 认领与正常完成
// ============================================================

test("T1 worker claims a queued run and drives the fake workflow to completion", { skip: !testDatabaseUrl }, async () => {
  const counters = { toolExecutions: 0 };
  const registry = createHarnessWorkflowRegistry([makeFakeWorkflow({}, counters)]);
  const run = await makeRun();
  const worker = makeWorker(registry);

  const did = await worker.runNextAttempt();
  assert.equal(did, true);

  const row = await getRun(run.harnessRunId);
  assert.equal(row.status, "completed");
  assert.ok(row.completedAt);
  assert.equal(counters.toolExecutions, 1);

  const checkpoints = await listCheckpoints(run.harnessRunId);
  const keys = checkpoints.map((cp) => cp.checkpointKey).sort();
  assert.deepEqual(keys, [
    "context_resolved",
    "final_response_committed",
    "input_committed",
    "model_input_ready:s5",
    `tool_result_committed:${run.harnessRunId}:s3:fake.tool:1`,
  ]);

  assert.equal((await listEvents(run.harnessRunId, "run_completed")).length, 1);
  // S2b-2（2026-08-28）：worker 不再消费 workflow outbox（补偿链已删）。
  // S7（2026-08-31）：`outbox` 字段与 fake workflow 的 outbox 返回值已一并删除，
  // 本守护的职责由「带 outbox 输入仍须忽略」转为「不再产生新行」：生产者
  // 结构上已不存在，任何 outbox_enqueued 新行即为缺陷。事件名本身因已入库
  // 历史行（2026-08-31 实取 68 行）保留，留档注见 harness-runtime.types.ts。
  assert.equal((await listEvents(run.harnessRunId, "outbox_enqueued")).length, 0, "S7 后不得再产生 outbox_enqueued 事件行");

  const outputs = await testDb!
    .select()
    .from(harnessRunEvents)
    .where(and(eq(harnessRunEvents.harnessRunId, run.harnessRunId), eq(harnessRunEvents.eventType, "output_updated")));
  assert.equal(outputs.length, 1);

  const attempts = await testDb!
    .select()
    .from(harnessRunAttempts)
    .where(eq(harnessRunAttempts.harnessRunId, run.harnessRunId));
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, "succeeded");
});

// ============================================================
// T2a 优雅停机：停止认领 + 安全边界释放 + Run 回 queued
// ============================================================

test("T2a graceful stop releases the attempt at a safe boundary and requeues the run", { skip: !testDatabaseUrl }, async () => {
  let openGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  const counters = { toolExecutions: 0 };
  const registry = createHarnessWorkflowRegistry([
    makeFakeWorkflow({ stepGates: { s2: () => gate } }, counters),
  ]);
  const run = await makeRun();
  const worker = makeWorker(registry);

  const pending = worker.runNextAttempt();
  await waitFor(async () => (await listCheckpoints(run.harnessRunId)).some((cp) => cp.checkpointKey === "input_committed"));
  const stopPromise = worker.stop();
  openGate();
  await stopPromise;
  await pending;

  const row = await getRun(run.harnessRunId);
  assert.equal(row.status, "queued", "graceful stop must requeue the run at the step boundary");

  const attempts = await testDb!
    .select()
    .from(harnessRunAttempts)
    .where(eq(harnessRunAttempts.harnessRunId, run.harnessRunId));
  assert.equal(attempts[0].status, "cancelled", "released attempt ends as cancelled");

  // 后续 Worker 可立即认领并完成
  const second = makeWorker(registry);
  assert.equal(await second.runNextAttempt(), true);
  assert.equal((await getRun(run.harnessRunId)).status, "completed");
});

// ============================================================
// T2b 硬退出：lease 自然过期被扫描发现（真实时序）
// ============================================================

test("T2b hard exit leaves the lease to expire naturally (real timing)", { skip: !testDatabaseUrl }, async () => {
  const counters = { toolExecutions: 0 };
  const registry = createHarnessWorkflowRegistry([makeFakeWorkflow({}, counters)]);
  const run = await makeRun();
  const worker = makeWorker(registry, {
    timing: { leaseMs: 1_000, heartbeatIntervalMs: 50 },
    faultInjector: (stepKey, phase) => {
      if (phase === "afterStepCommit" && stepKey === "s1") {
        throw new HarnessFaultInjectedError("simulated hard crash after s1 commit");
      }
    },
  });

  await worker.runNextAttempt();
  const immediate = await repo!.findRunsWithExpiredActiveLease({});
  assert.ok(!immediate.some((row) => row.run.harnessRunId === run.harnessRunId), "lease still valid right after crash");

  await sleep(1_200);
  const expired = await repo!.findRunsWithExpiredActiveLease({});
  assert.ok(
    expired.some((row) => row.run.harnessRunId === run.harnessRunId),
    "expired lease must surface the crashed run without any memory cleanup",
  );
});

// ============================================================
// T3 C1 输入后崩：从 input_committed 恢复，用户消息不重复
// ============================================================

test("T3 crash after input commit recovers from input_committed without duplicating the user message", { skip: !testDatabaseUrl }, async () => {
  const counters = { toolExecutions: 0 };
  const registry = createHarnessWorkflowRegistry([makeFakeWorkflow({}, counters)]);
  const run = await makeRun();
  const crashed = makeWorker(registry, {
    faultInjector: (stepKey, phase) => {
      if (phase === "afterStepCommit" && stepKey === "s1") {
        throw new HarnessFaultInjectedError("crash after input_committed");
      }
    },
  });
  await crashed.runNextAttempt();
  await expireActiveLease(run.harnessRunId);

  await recoverAndFinish(run.harnessRunId, registry);

  const row = await getRun(run.harnessRunId);
  assert.equal(row.status, "completed");
  assert.equal(row.recoveryCount, 1);

  const attempts = await testDb!
    .select()
    .from(harnessRunAttempts)
    .where(eq(harnessRunAttempts.harnessRunId, run.harnessRunId));
  assert.equal(attempts.length, 2);
  const resumed = attempts.find((attempt) => attempt.attemptNo === 2)!;
  const inputCheckpoint = (await listCheckpoints(run.harnessRunId)).find((cp) => cp.checkpointKey === "input_committed")!;
  assert.equal(resumed.resumeCheckpointId, inputCheckpoint.harnessRunCheckpointId, "resume pointer must target input_committed");
  assert.equal(attempts.find((attempt) => attempt.attemptNo === 1)!.status, "orphaned");

  // S2b-2（2026-08-28）：outbox 表已删，用户消息幂等由 workflow 直写路径 +
  // repository 来源键查重守护（harness_session_outbox 断言随补偿链移除）。

  assert.equal((await listEvents(run.harnessRunId, "recovery_started")).length, 1);
  assert.equal((await listEvents(run.harnessRunId, "recovery_completed")).length, 1);
});

// ============================================================
// T4 C2 工具成功后崩：effectKey 复用，副作用不重复
// ============================================================

test("T4 crash after tool effect reuses the effectKey and never repeats the side effect", { skip: !testDatabaseUrl }, async () => {
  const counters = { toolExecutions: 0 };
  const registry = createHarnessWorkflowRegistry([
    makeFakeWorkflow({ crashAfterToolEffectOnAttempt: 1 }, counters),
  ]);
  const run = await makeRun();
  const crashed = makeWorker(registry);
  await crashed.runNextAttempt();
  await expireActiveLease(run.harnessRunId);

  await recoverAndFinish(run.harnessRunId, registry);

  assert.equal(counters.toolExecutions, 1, "tool side effect must execute exactly once across attempts");
  const toolEvents = await testDb!
    .select()
    .from(harnessToolEvents)
    .where(eq(harnessToolEvents.harnessRunId, run.harnessRunId));
  assert.equal(toolEvents.length, 1);
  assert.equal(toolEvents[0].effectKey, `${run.harnessRunId}:s3:fake.tool:1`);
  assert.equal((await getRun(run.harnessRunId)).status, "completed");
});

// ============================================================
// T5 C3 模型流中断：从 model_input_ready 重做，不拼接中断文本
// ============================================================

test("T5 model stream interruption restarts the model step from model_input_ready without splicing text", { skip: !testDatabaseUrl }, async () => {
  const counters = { toolExecutions: 0 };
  const registry = createHarnessWorkflowRegistry([
    makeFakeWorkflow(
      {
        modelChunksByAttempt: { 1: ["A1-part1", "A1-part2", "A1-part3"], 2: ["A2-full-1", "A2-full-2"] },
        modelFailAtChunkByAttempt: { 1: 2 },
      },
      counters,
    ),
  ]);
  const run = await makeRun();
  const crashed = makeWorker(registry);
  await crashed.runNextAttempt();
  await expireActiveLease(run.harnessRunId);

  await recoverAndFinish(run.harnessRunId, registry);

  const row = await getRun(run.harnessRunId);
  assert.equal(row.status, "completed");

  const outputs = await testDb!.select().from(harnessRunOutputs).where(eq(harnessRunOutputs.harnessRunId, run.harnessRunId));
  assert.equal(outputs.length, 1);
  const finalText = String((outputs[0].content as { text?: string }).text ?? "");
  assert.equal(finalText, "A2-full-1A2-full-2", "final output must come solely from the second attempt");
  assert.ok(!finalText.includes("A1-part"), "interrupted attempt text must never be spliced into the final output");

  const modelReadyCheckpoints = (await listCheckpoints(run.harnessRunId)).filter(
    (cp) => cp.checkpointKey === "model_input_ready:s5",
  );
  assert.equal(modelReadyCheckpoints.length, 1, "replayed s4 must not duplicate the model_input_ready checkpoint");
});

// ============================================================
// T11 取消请求在安全边界结束
// ============================================================

test("T11 cancel request ends the run at a safe boundary with zero post-cancel effects", { skip: !testDatabaseUrl }, async () => {
  const counters = { toolExecutions: 0 };
  const registry = createHarnessWorkflowRegistry([
    makeFakeWorkflow(
      {
        chunkDelayMs: 30,
        modelChunksByAttempt: { 1: Array.from({ length: 20 }, (_, i) => `c${i}`) },
      },
      counters,
    ),
  ]);
  const run = await makeRun();
  const worker = makeWorker(registry, { timing: { leaseMs: 5_000, heartbeatIntervalMs: 50 } });

  const pending = worker.runNextAttempt();
  await waitFor(async () =>
    (await listCheckpoints(run.harnessRunId)).some((cp) => cp.checkpointKey === "model_input_ready:s5"),
  );
  const cancel = await repo!.requestRunCancel({ runId: run.harnessRunId, requestedBy: "tester" });
  assert.equal(cancel.changed, true);
  await pending;

  const row = await getRun(run.harnessRunId);
  assert.equal(row.status, "cancelled");

  const checkpoints = await listCheckpoints(run.harnessRunId);
  assert.ok(!checkpoints.some((cp) => cp.checkpointKey === "final_response_committed"), "no checkpoint after cancel");

  assert.equal((await listEvents(run.harnessRunId, "cancel_requested")).length, 1);
  assert.equal((await listEvents(run.harnessRunId, "run_cancelled")).length, 1);

  const attempts = await testDb!
    .select()
    .from(harnessRunAttempts)
    .where(eq(harnessRunAttempts.harnessRunId, run.harnessRunId));
  assert.equal(attempts[0].status, "cancelled");

  const outputs = await testDb!.select().from(harnessRunOutputs).where(eq(harnessRunOutputs.harnessRunId, run.harnessRunId));
  assert.equal(outputs.length, 0, "no output may be persisted after the cancel boundary");
});

// ============================================================
// T1b lease 失效禁写守卫
// ============================================================

test("T1b worker stops writing after the lease is lost mid-step", { skip: !testDatabaseUrl }, async () => {
  let openGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  const counters = { toolExecutions: 0 };
  const registry = createHarnessWorkflowRegistry([
    makeFakeWorkflow({ stepGates: { s1: () => gate } }, counters),
  ]);
  const run = await makeRun();
  const worker = makeWorker(registry, { timing: { leaseMs: 1_000, heartbeatIntervalMs: 50 } });

  const pending = worker.runNextAttempt();
  await waitFor(async () => {
    const attempts = await testDb!
      .select()
      .from(harnessRunAttempts)
      .where(eq(harnessRunAttempts.harnessRunId, run.harnessRunId));
    return attempts.length === 1;
  });

  // 外部力量（如 Recovery Coordinator）把 attempt 标记为 orphaned
  const [attempt] = await testDb!
    .select()
    .from(harnessRunAttempts)
    .where(eq(harnessRunAttempts.harnessRunId, run.harnessRunId));
  await repo!.orphanAttempt({ attemptId: attempt.harnessRunAttemptId });
  await sleep(150); // 等待 heartbeat 发现租约失效
  openGate();
  await pending;

  const checkpoints = await listCheckpoints(run.harnessRunId);
  assert.equal(checkpoints.length, 0, "lease-lost worker must not commit any checkpoint");
  // S2b-2（2026-08-28）：outbox 表已随补偿链删除，原“不得入队 outbox”断言
  // 随之移除；lease 失守禁写守卫由 checkpoint 零提交断言覆盖。
});
