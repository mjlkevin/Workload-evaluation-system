// ============================================================
// Harness 持久运行 repository
// ============================================================
// RP-047 Batch A2：封装 durable Run 的原子创建、owner 隔离查询、
// 队列认领（FOR UPDATE SKIP LOCKED）、lease 心跳与事件序号分配。
//
// 安全边界：所有对外错误统一映射为 HarnessRuntimeError 固定 code，
// Drizzle/pg 原始错误（可能包含 SQL params、state、prompt 或凭据）
// 绝不原样穿透给调用方。

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import {
  harnessRunAttempts,
  harnessRunCheckpoints,
  harnessRunEvents,
  harnessRunOutputs,
  harnessRuns,
  harnessToolEvents,
  type HarnessRunAttemptRow,
  type HarnessRunCheckpointRow,
  type HarnessRunEventRow,
  type HarnessRunOutputRow,
  type HarnessRunRow,
  type HarnessToolEventRow,
} from "../../db/schema";
import {
  HARNESS_RECOVERY_LIMIT_ERROR_CODE,
  HARNESS_RUN_ACTIVE_STATUSES,
  HARNESS_RUN_EVENT_TYPES,
  HARNESS_RUN_TERMINAL_STATUSES,
  type HarnessCheckpointKind,
  type HarnessOutputStatus,
  type HarnessResumePolicy,
  type HarnessRunEventType,
} from "./harness-runtime.types";

// ============================================================
// 安全错误
// ============================================================

export class HarnessRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "HarnessRuntimeError";
    this.code = code;
  }
}

function toSafeError(err: unknown): HarnessRuntimeError {
  if (err instanceof HarnessRuntimeError) return err;
  return new HarnessRuntimeError("HARNESS_RUNTIME_INTERNAL", "harness runtime persistence failed");
}

// ============================================================
// 输入类型与接口
// ============================================================

export type CreateQueuedHarnessRunInput = {
  ownerUserId: string;
  ownerUsername: string;
  aiSessionId: string;
  submissionKey: string;
  title: string;
  workflowId: string;
  workflowVersion: string;
  executionConfig?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  // RP-047 Batch C（additive）：retry 动作创建新 Run 时指向原 failed Run
  retryOfRunId?: string;
};

export type ClaimNextHarnessRunInput = {
  workerId: string;
  leaseMs: number;
  now?: Date;
};

export type HeartbeatHarnessAttemptInput = {
  attemptId: string;
  workerId: string;
  leaseMs: number;
  now?: Date;
};

export type AppendHarnessRunEventInput = {
  runId: string;
  eventType: HarnessRunEventType;
  payload?: Record<string, unknown>;
};

export type HarnessRuntimeValidation = {
  validatedAt: string;
  validatorVersion: string;
  checks: {
    ownerBound: true;
    workflowVersionMatched: true;
    stateHashMatched: true;
    nextStepKnown: true;
    effectsStable: true;
  };
};

export type CommitHarnessCheckpointInput = {
  runId: string;
  attemptId?: string;
  checkpointKey: string;
  checkpointKind: HarnessCheckpointKind;
  workflowId: string;
  workflowVersion: string;
  stepKey: string;
  resumePolicy: HarnessResumePolicy;
  state: Record<string, unknown>;
  stateHash: string;
  inputHash?: string;
  effectKeys?: string[];
  aiMilestone?: Record<string, unknown>;
  runtimeValidation: HarnessRuntimeValidation;
};

export type UpsertHarnessRunOutputInput = {
  runId: string;
  attemptId?: string;
  status: HarnessOutputStatus;
  content: Record<string, unknown>;
  contentHash: string;
};

// ============================================================
// RP-047 Batch B：Worker / Recovery 扩展输入类型
// ============================================================

export type FindRunsWithExpiredActiveLeaseInput = {
  now?: Date;
  limit?: number;
};

export type OrphanHarnessAttemptInput = {
  attemptId: string;
  now?: Date;
};

export type ScheduleHarnessRunRecoveryInput = {
  runId: string;
  maxAutoRecoveries: number;
  backoffMs: readonly number[];
  now?: Date;
};

export type HarnessRunRecoveryOutcome = "scheduled" | "limit_exceeded" | "cancelled" | "not_active";

export type RecordHarnessToolEffectInput = {
  runId: string;
  attemptId?: string | null;
  effectKey: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
};

export type CompleteHarnessAttemptAndRunInput = {
  attemptId: string;
  runId: string;
  outcome: "succeeded" | "failed" | "cancelled";
  errorCode?: string;
  errorMessage?: string;
  now?: Date;
};

export type RequestHarnessRunCancelInput = {
  runId: string;
  requestedBy: string;
  now?: Date;
};

export type ReleaseHarnessAttemptForShutdownInput = {
  attemptId: string;
  runId: string;
  now?: Date;
};

// ============================================================
// RP-047 Batch C：AI Runs API 读取与动作输入类型（additive）
// ============================================================

export type HarnessRunSnapshot = {
  run: HarnessRunRow;
  attempt: HarnessRunAttemptRow | null;
  checkpoint: HarnessRunCheckpointRow | null;
  output: HarnessRunOutputRow | null;
};

export type ListHarnessRunEventsAfterInput = {
  runId: string;
  afterSequence: number;
  limit: number;
};

export type SubmitHarnessRunInputInput = {
  runId: string;
  input: Record<string, unknown>;
  requestedBy: string;
};

export type ConfirmHarnessRunActionInput = {
  runId: string;
  actionId: string;
  confirmedBy: string;
};

export interface HarnessRuntimeRepository {
  createQueuedRun(input: CreateQueuedHarnessRunInput): Promise<{ run: HarnessRunRow; created: boolean }>;
  findRunForOwner(runId: string, ownerUserId: string): Promise<HarnessRunRow | null>;
  claimNextQueuedRun(
    input: ClaimNextHarnessRunInput,
  ): Promise<{ run: HarnessRunRow; attempt: HarnessRunAttemptRow } | null>;
  heartbeatAttempt(input: HeartbeatHarnessAttemptInput): Promise<HarnessRunAttemptRow | null>;
  appendRunEvent(input: AppendHarnessRunEventInput): Promise<HarnessRunEventRow>;
  commitCheckpoint(input: CommitHarnessCheckpointInput): Promise<{ checkpoint: HarnessRunCheckpointRow; created: boolean }>;
  upsertRunOutput(input: UpsertHarnessRunOutputInput): Promise<HarnessRunOutputRow>;
  findRunsWithExpiredActiveLease(
    input: FindRunsWithExpiredActiveLeaseInput,
  ): Promise<Array<{ run: HarnessRunRow; attempt: HarnessRunAttemptRow }>>;
  orphanAttempt(input: OrphanHarnessAttemptInput): Promise<HarnessRunAttemptRow | null>;
  scheduleRunRecovery(
    input: ScheduleHarnessRunRecoveryInput,
  ): Promise<{ outcome: HarnessRunRecoveryOutcome; run: HarnessRunRow }>;
  listCheckpointsForRun(input: { runId: string }): Promise<HarnessRunCheckpointRow[]>;
  setAttemptResumeCheckpoint(input: {
    attemptId: string;
    checkpointId: string;
  }): Promise<HarnessRunAttemptRow | null>;
  recordToolEffectOnce(
    input: RecordHarnessToolEffectInput,
  ): Promise<{ toolEvent: HarnessToolEventRow; created: boolean }>;
  findToolEffectByKey(input: { runId: string; effectKey: string }): Promise<HarnessToolEventRow | null>;
  completeAttemptAndRun(
    input: CompleteHarnessAttemptAndRunInput,
  ): Promise<{ changed: boolean; run: HarnessRunRow }>;
  requestRunCancel(input: RequestHarnessRunCancelInput): Promise<{ changed: boolean; run: HarnessRunRow }>;
  releaseAttemptForShutdown(
    input: ReleaseHarnessAttemptForShutdownInput,
  ): Promise<{ outcome: "requeued" | "cancelled" | "noop"; run: HarnessRunRow }>;
  // RP-047 Batch C（additive）：AI Runs API 读取与动作方法
  listActiveRunsForOwner(ownerUserId: string): Promise<HarnessRunRow[]>;
  // ISS-2026-08-10-001（后台任务角标数据源）：近期已完成 Run 查询，
  // 供统一视图合并——Run 进入 completed 终态后不再从视图立即消失。
  listRecentlyCompletedRunsForOwner(ownerUserId: string, limit?: number): Promise<HarnessRunRow[]>;
  getRunSnapshot(runId: string): Promise<HarnessRunSnapshot | null>;
  hasActiveRunForSession(aiSessionId: string): Promise<boolean>;
  listRunEventsAfter(input: ListHarnessRunEventsAfterInput): Promise<HarnessRunEventRow[]>;
  submitRunInput(input: SubmitHarnessRunInputInput): Promise<{ run: HarnessRunRow; event: HarnessRunEventRow }>;
  confirmRunAction(
    input: ConfirmHarnessRunActionInput,
  ): Promise<{ created: boolean; run: HarnessRunRow; event: HarnessRunEventRow | null }>;
}

type HarnessTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const MIN_LEASE_MS = 1_000;
const MAX_LEASE_MS = 300_000;

function assertLeaseMs(leaseMs: number): void {
  if (!Number.isFinite(leaseMs) || leaseMs < MIN_LEASE_MS || leaseMs > MAX_LEASE_MS) {
    throw new HarnessRuntimeError(
      "HARNESS_RUNTIME_LEASE_INVALID",
      "lease must be between 1000ms and 300000ms",
    );
  }
}

// ============================================================
// 事务内原语
// ============================================================

/** 用 Run 行原子递增事件序号；同一事务内与事件 INSERT 配对使用。 */
async function allocateEventSequence(tx: HarnessTx, runId: string): Promise<number> {
  const result = await tx.execute(sql`
    UPDATE harness_runs
    SET event_sequence = event_sequence + 1, updated_at = now()
    WHERE harness_run_id = ${runId}
    RETURNING event_sequence
  `);
  const rows = result.rows as Array<{ event_sequence: number }>;
  if (rows.length === 0) {
    throw new HarnessRuntimeError("HARNESS_RUN_NOT_FOUND", "harness run not found");
  }
  return Number(rows[0].event_sequence);
}

async function appendRunEventInTransaction(
  tx: HarnessTx,
  input: { runId: string; eventType: HarnessRunEventType; payload?: Record<string, unknown> },
): Promise<HarnessRunEventRow> {
  const sequence = await allocateEventSequence(tx, input.runId);
  const [event] = await tx
    .insert(harnessRunEvents)
    .values({
      harnessRunEventId: randomUUID(),
      harnessRunId: input.runId,
      sequence,
      eventType: input.eventType,
      payload: input.payload ?? {},
    })
    .returning();
  return event;
}

/** 读取数据库时钟，避免主机与 DB 时钟偏差导致 lease/队列比较漂移。 */
async function readDbNow(tx: HarnessTx): Promise<Date> {
  const result = await tx.execute(sql`SELECT now() AS db_now`);
  const value = (result.rows as Array<{ db_now: Date | string }>)[0]?.db_now;
  return value instanceof Date ? value : new Date(value);
}

const MAX_PAYLOAD_BYTES = 1024 * 1024;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  // 只接受原型为 Object.prototype 或 null 的对象；Date/Map/Set/类实例
  // 会被 JSON 序列化为标量或空对象，破坏持久化契约。
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** 校验 JSON 载荷：必须是普通对象、可序列化且 UTF-8 JSON 不超过 1 MiB。 */
function assertSafeJsonObject(value: unknown): void {
  if (!isPlainObject(value)) {
    throw new HarnessRuntimeError("HARNESS_RUNTIME_PAYLOAD_INVALID", "payload must be a plain JSON object");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new HarnessRuntimeError("HARNESS_RUNTIME_PAYLOAD_INVALID", "payload is not JSON serializable");
  }
  if (serialized === undefined) {
    throw new HarnessRuntimeError("HARNESS_RUNTIME_PAYLOAD_INVALID", "payload is not JSON serializable");
  }
  if (Buffer.byteLength(serialized, "utf-8") > MAX_PAYLOAD_BYTES) {
    throw new HarnessRuntimeError("HARNESS_RUNTIME_PAYLOAD_TOO_LARGE", "payload exceeds 1 MiB JSON limit");
  }
}

/** 校验通过后归一化为标准原型对象，避免 null-prototype 对象在 pg 序列化路径报错。 */
function normalizeJsonObject(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function assertNonEmptyText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HarnessRuntimeError("HARNESS_RUNTIME_INPUT_INVALID", `${field} must be a non-empty string`);
  }
}

const RUNTIME_VALIDATION_CHECK_KEYS = [
  "ownerBound",
  "workflowVersionMatched",
  "stateHashMatched",
  "nextStepKnown",
  "effectsStable",
] as const;

function assertRuntimeValidation(value: unknown): asserts value is HarnessRuntimeValidation {
  if (!isPlainObject(value)) {
    throw new HarnessRuntimeError(
      "HARNESS_RUNTIME_VALIDATION_INVALID",
      "runtime validation must be a plain object",
    );
  }
  const validatedAt = value.validatedAt;
  if (typeof validatedAt !== "string" || validatedAt.trim().length === 0 || Number.isNaN(Date.parse(validatedAt))) {
    throw new HarnessRuntimeError(
      "HARNESS_RUNTIME_VALIDATION_INVALID",
      "runtime validation requires a parseable validatedAt",
    );
  }
  const validatorVersion = value.validatorVersion;
  if (typeof validatorVersion !== "string" || validatorVersion.trim().length === 0) {
    throw new HarnessRuntimeError(
      "HARNESS_RUNTIME_VALIDATION_INVALID",
      "runtime validation requires a non-empty validatorVersion",
    );
  }
  const checks = value.checks;
  if (!isPlainObject(checks)) {
    throw new HarnessRuntimeError(
      "HARNESS_RUNTIME_VALIDATION_INVALID",
      "runtime validation requires a checks object",
    );
  }
  for (const key of RUNTIME_VALIDATION_CHECK_KEYS) {
    if (checks[key] !== true) {
      throw new HarnessRuntimeError(
        "HARNESS_RUNTIME_VALIDATION_INVALID",
        "runtime validation checks must all be true",
      );
    }
  }
}

/** 事务内锁定 Run 行，串行化同一 Run 的检查点/输出/事件原语。 */
async function lockRunRow(tx: HarnessTx, runId: string): Promise<HarnessRunRow> {
  const locked = await tx.execute(sql`
    SELECT harness_run_id
    FROM harness_runs
    WHERE harness_run_id = ${runId}
    FOR UPDATE
  `);
  if ((locked.rows as unknown[]).length === 0) {
    throw new HarnessRuntimeError("HARNESS_RUN_NOT_FOUND", "harness run not found");
  }
  const rows = await tx.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, runId));
  return rows[0];
}

// ============================================================
// 工厂
// ============================================================

export function createHarnessRuntimeRepository(dbInstance: Database = db): HarnessRuntimeRepository {
  return {
    async createQueuedRun(input) {
      try {
        return await dbInstance.transaction(async (tx) => {
          const runId = randomUUID();
          const inserted = await tx
            .insert(harnessRuns)
            .values({
              harnessRunId: runId,
              ownerUserId: input.ownerUserId,
              ownerUsername: input.ownerUsername,
              mode: "interactive",
              stage: "uploaded",
              status: "queued",
              title: input.title,
              aiSessionId: input.aiSessionId,
              runKind: "workbench_chat",
              workflowId: input.workflowId,
              workflowVersion: input.workflowVersion,
              submissionKey: input.submissionKey,
              executionConfig: input.executionConfig ?? {},
              metadata: input.metadata ?? {},
              // RP-047 Batch C（additive）：retry 血缘，缺省为 null
              retryOfRunId: input.retryOfRunId ?? null,
            })
            .onConflictDoNothing()
            .returning();

          if (inserted.length > 0) {
            // 首事件与 Run 在同一事务内提交，序号由 Run 行原子分配
            await appendRunEventInTransaction(tx, { runId, eventType: "run_queued" });
            const [persisted] = await tx
              .select()
              .from(harnessRuns)
              .where(eq(harnessRuns.harnessRunId, runId));
            return { run: persisted, created: true };
          }

          // owner + submissionKey 重放：返回原 Run，不追加事件
          const [existing] = await tx
            .select()
            .from(harnessRuns)
            .where(
              and(
                eq(harnessRuns.ownerUserId, input.ownerUserId),
                eq(harnessRuns.submissionKey, input.submissionKey),
              ),
            );
          if (existing) {
            return { run: existing, created: false };
          }

          // insert 被跳过但无 owner/submission 冲突 => 命中同会话活动唯一约束
          throw new HarnessRuntimeError(
            "ACTIVE_WORKBENCH_RUN_EXISTS",
            "active workbench run already exists for this ai session",
          );
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async findRunForOwner(runId, ownerUserId) {
      try {
        const rows = await dbInstance
          .select()
          .from(harnessRuns)
          .where(and(eq(harnessRuns.harnessRunId, runId), eq(harnessRuns.ownerUserId, ownerUserId)));
        return rows[0] ?? null;
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async claimNextQueuedRun(input) {
      assertLeaseMs(input.leaseMs);
      try {
        return await dbInstance.transaction(async (tx) => {
          const now = input.now ?? (await readDbNow(tx));
          // 队列筛选必须用数据库时钟直接比较：available_at 由 PG now()（微秒精度）写入，
          // 经 JS Date 中转会截断到毫秒，同一毫秒内 create → claim 时
          // 「available_at <= now」被误判为 false，导致刚入队的 Run 被漏认领。
          // input.now 仅用于测试注入确定性时钟，生产路径不传。
          const picked = await tx.execute(sql`
            SELECT harness_run_id
            FROM harness_runs
            WHERE status IN ('queued', 'recovering') AND available_at <= ${input.now ? sql`${input.now}` : sql`now()`}
            ORDER BY available_at ASC, created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          `);
          const pickedRows = picked.rows as Array<{ harness_run_id: string }>;
          if (pickedRows.length === 0) return null;
          const runId = pickedRows[0].harness_run_id;

          const attemptNoResult = await tx.execute(sql`
            SELECT COALESCE(MAX(attempt_no), 0) + 1 AS next_attempt_no
            FROM harness_run_attempts
            WHERE harness_run_id = ${runId}
          `);
          const attemptNo = Number(
            (attemptNoResult.rows as Array<{ next_attempt_no: number }>)[0]?.next_attempt_no ?? 1,
          );

          const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
          const [attempt] = await tx
            .insert(harnessRunAttempts)
            .values({
              harnessRunAttemptId: randomUUID(),
              harnessRunId: runId,
              attemptNo,
              workerId: input.workerId,
              status: "claimed",
              leaseExpiresAt,
              heartbeatAt: now,
            })
            .returning();

          const [run] = await tx
            .update(harnessRuns)
            .set({ status: "running", updatedAt: now })
            .where(eq(harnessRuns.harnessRunId, runId))
            .returning();

          await appendRunEventInTransaction(tx, {
            runId,
            eventType: "run_claimed",
            payload: {
              attemptId: attempt.harnessRunAttemptId,
              workerId: input.workerId,
              attemptNo,
            },
          });

          return { run, attempt };
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async heartbeatAttempt(input) {
      assertLeaseMs(input.leaseMs);
      try {
        return await dbInstance.transaction(async (tx) => {
          const now = input.now ?? (await readDbNow(tx));
          const rows = await tx
            .update(harnessRunAttempts)
            .set({
              status: "running",
              heartbeatAt: now,
              leaseExpiresAt: new Date(now.getTime() + input.leaseMs),
              updatedAt: now,
            })
            .where(
              and(
                eq(harnessRunAttempts.harnessRunAttemptId, input.attemptId),
                eq(harnessRunAttempts.workerId, input.workerId),
                inArray(harnessRunAttempts.status, ["claimed", "running"]),
                gt(harnessRunAttempts.leaseExpiresAt, now),
              ),
            )
            .returning();
          return rows[0] ?? null;
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async appendRunEvent(input) {
      try {
        assertNonEmptyText(input.runId, "runId");
        if (!(HARNESS_RUN_EVENT_TYPES as readonly string[]).includes(input.eventType)) {
          throw new HarnessRuntimeError("HARNESS_RUNTIME_INPUT_INVALID", "eventType is not a harness run event type");
        }
        assertSafeJsonObject(input.payload ?? {});
        const payload = normalizeJsonObject(input.payload ?? {});
        return await dbInstance.transaction(async (tx) => appendRunEventInTransaction(tx, { runId: input.runId, eventType: input.eventType, payload }));
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async commitCheckpoint(input) {
      try {
        assertNonEmptyText(input.runId, "runId");
        assertNonEmptyText(input.checkpointKey, "checkpointKey");
        assertNonEmptyText(input.workflowId, "workflowId");
        assertNonEmptyText(input.workflowVersion, "workflowVersion");
        assertNonEmptyText(input.stepKey, "stepKey");
        assertNonEmptyText(input.stateHash, "stateHash");
        assertNonEmptyText(input.resumePolicy, "resumePolicy");
        assertSafeJsonObject(input.state);
        assertRuntimeValidation(input.runtimeValidation);
        const state = normalizeJsonObject(input.state);
        if (input.effectKeys !== undefined) {
          if (!Array.isArray(input.effectKeys) || input.effectKeys.some((key) => typeof key !== "string")) {
            throw new HarnessRuntimeError("HARNESS_RUNTIME_PAYLOAD_INVALID", "effectKeys must be a string array");
          }
        }
        if (input.aiMilestone !== undefined) {
          assertSafeJsonObject(input.aiMilestone);
        }
        const aiMilestone = input.aiMilestone !== undefined ? normalizeJsonObject(input.aiMilestone) : null;

        return await dbInstance.transaction(async (tx) => {
          // 先锁 Run 行：串行化同一 Run 的检查点写入与序号计算
          await lockRunRow(tx, input.runId);

          const existing = await tx
            .select()
            .from(harnessRunCheckpoints)
            .where(
              and(
                eq(harnessRunCheckpoints.harnessRunId, input.runId),
                eq(harnessRunCheckpoints.checkpointKey, input.checkpointKey),
              ),
            );
          if (existing.length > 0) {
            const current = existing[0];
            if (current.stateHash !== input.stateHash) {
              throw new HarnessRuntimeError(
                "CHECKPOINT_KEY_CONFLICT",
                "checkpoint key already committed with a different state hash",
              );
            }
            return { checkpoint: current, created: false };
          }

          const sequenceResult = await tx.execute(sql`
            SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
            FROM harness_run_checkpoints
            WHERE harness_run_id = ${input.runId}
          `);
          const sequence = Number(
            (sequenceResult.rows as Array<{ next_sequence: number }>)[0]?.next_sequence ?? 1,
          );

          const [checkpoint] = await tx
            .insert(harnessRunCheckpoints)
            .values({
              harnessRunCheckpointId: randomUUID(),
              harnessRunId: input.runId,
              harnessRunAttemptId: input.attemptId ?? null,
              sequence,
              checkpointKey: input.checkpointKey,
              checkpointKind: input.checkpointKind,
              workflowId: input.workflowId,
              workflowVersion: input.workflowVersion,
              stepKey: input.stepKey,
              resumePolicy: input.resumePolicy,
              state,
              stateHash: input.stateHash,
              inputHash: input.inputHash ?? null,
              effectKeys: input.effectKeys ?? [],
              aiMilestone,
              runtimeValidation: normalizeJsonObject(input.runtimeValidation) as HarnessRuntimeValidation,
            })
            .returning();

          await tx
            .update(harnessRuns)
            .set({ lastCheckpointId: checkpoint.harnessRunCheckpointId, currentStepKey: input.stepKey })
            .where(eq(harnessRuns.harnessRunId, input.runId));

          await appendRunEventInTransaction(tx, {
            runId: input.runId,
            eventType: "checkpoint_committed",
            payload: {
              checkpointId: checkpoint.harnessRunCheckpointId,
              checkpointKey: input.checkpointKey,
              sequence,
            },
          });

          return { checkpoint, created: true };
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async upsertRunOutput(input) {
      try {
        assertNonEmptyText(input.runId, "runId");
        assertNonEmptyText(input.contentHash, "contentHash");
        assertSafeJsonObject(input.content);
        const content = normalizeJsonObject(input.content);

        return await dbInstance.transaction(async (tx) => {
          await lockRunRow(tx, input.runId);
          const now = await readDbNow(tx);

          const existingRows = await tx
            .select()
            .from(harnessRunOutputs)
            .where(eq(harnessRunOutputs.harnessRunId, input.runId));

          if (existingRows.length === 0) {
            const [row] = await tx
              .insert(harnessRunOutputs)
              .values({
                harnessRunOutputId: randomUUID(),
                harnessRunId: input.runId,
                harnessRunAttemptId: input.attemptId ?? null,
                status: input.status,
                version: 1,
                content,
                contentHash: input.contentHash,
                createdAt: now,
                updatedAt: now,
              })
              .returning();
            await appendRunEventInTransaction(tx, {
              runId: input.runId,
              eventType: "output_updated",
              payload: { outputId: row.harnessRunOutputId, version: row.version, status: row.status },
            });
            return row;
          }

          const existing = existingRows[0];
          if (existing.status === "final" && input.status === "partial") {
            throw new HarnessRuntimeError("FINAL_OUTPUT_IMMUTABLE", "final output cannot be downgraded to partial");
          }
          if (existing.contentHash === input.contentHash) {
            if (existing.status !== input.status) {
              const [promoted] = await tx
                .update(harnessRunOutputs)
                .set({ status: input.status, updatedAt: now })
                .where(eq(harnessRunOutputs.harnessRunOutputId, existing.harnessRunOutputId))
                .returning();
              return promoted;
            }
            return existing;
          }

          const [updated] = await tx
            .update(harnessRunOutputs)
            .set({
              status: input.status,
              version: existing.version + 1,
              content,
              contentHash: input.contentHash,
              harnessRunAttemptId: input.attemptId ?? existing.harnessRunAttemptId,
              updatedAt: now,
            })
            .where(eq(harnessRunOutputs.harnessRunOutputId, existing.harnessRunOutputId))
            .returning();
          await appendRunEventInTransaction(tx, {
            runId: input.runId,
            eventType: "output_updated",
            payload: { outputId: updated.harnessRunOutputId, version: updated.version, status: updated.status },
          });
          return updated;
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    // ========================================================
    // RP-047 Batch B：Worker / Recovery 扩展实现
    // ========================================================

    async findRunsWithExpiredActiveLease(input) {
      try {
        const now = input.now ?? new Date();
        const limit = input.limit ?? 50;
        const attempts = await dbInstance
          .select()
          .from(harnessRunAttempts)
          .where(
            and(
              inArray(harnessRunAttempts.status, ["claimed", "running"]),
              lt(harnessRunAttempts.leaseExpiresAt, now),
            ),
          )
          .orderBy(harnessRunAttempts.leaseExpiresAt)
          .limit(limit);
        if (attempts.length === 0) return [];
        const runIds = attempts.map((attempt) => attempt.harnessRunId);
        const runs = await dbInstance
          .select()
          .from(harnessRuns)
          .where(
            and(
              inArray(harnessRuns.harnessRunId, runIds),
              inArray(harnessRuns.status, ["running", "recovering", "cancelling"]),
            ),
          );
        const runById = new Map(runs.map((run) => [run.harnessRunId, run]));
        return attempts
          .filter((attempt) => runById.has(attempt.harnessRunId))
          .map((attempt) => ({ run: runById.get(attempt.harnessRunId)!, attempt }));
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async orphanAttempt(input) {
      try {
        const now = input.now ?? new Date();
        const rows = await dbInstance
          .update(harnessRunAttempts)
          .set({ status: "orphaned", finishedAt: now, updatedAt: now })
          .where(
            and(
              eq(harnessRunAttempts.harnessRunAttemptId, input.attemptId),
              inArray(harnessRunAttempts.status, ["claimed", "running"]),
            ),
          )
          .returning();
        return rows[0] ?? null;
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async scheduleRunRecovery(input) {
      try {
        return await dbInstance.transaction(async (tx) => {
          const run = await lockRunRow(tx, input.runId);
          const now = input.now ?? (await readDbNow(tx));
          if ((HARNESS_RUN_TERMINAL_STATUSES as readonly string[]).includes(run.status)) {
            return { outcome: "not_active" as const, run };
          }

          const activeAttempts = await tx
            .select()
            .from(harnessRunAttempts)
            .where(
              and(
                eq(harnessRunAttempts.harnessRunId, input.runId),
                inArray(harnessRunAttempts.status, ["claimed", "running"]),
              ),
            );
          for (const attempt of activeAttempts) {
            await tx
              .update(harnessRunAttempts)
              .set({ status: "orphaned", finishedAt: now, updatedAt: now })
              .where(eq(harnessRunAttempts.harnessRunAttemptId, attempt.harnessRunAttemptId));
          }

          if (run.cancelRequestedAt) {
            const [cancelled] = await tx
              .update(harnessRuns)
              .set({ status: "cancelled", completedAt: now, updatedAt: now })
              .where(eq(harnessRuns.harnessRunId, input.runId))
              .returning();
            await appendRunEventInTransaction(tx, {
              runId: input.runId,
              eventType: "run_cancelled",
              payload: { reason: "cancel_requested_during_recovery", recoveryCount: run.recoveryCount },
            });
            return { outcome: "cancelled" as const, run: cancelled };
          }

          if (run.recoveryCount >= input.maxAutoRecoveries) {
            const [failed] = await tx
              .update(harnessRuns)
              .set({
                status: "failed",
                errorCode: HARNESS_RECOVERY_LIMIT_ERROR_CODE,
                errorMessage: "automatic recovery limit exceeded",
                completedAt: now,
                updatedAt: now,
              })
              .where(eq(harnessRuns.harnessRunId, input.runId))
              .returning();
            await appendRunEventInTransaction(tx, {
              runId: input.runId,
              eventType: "run_failed",
              payload: { errorCode: HARNESS_RECOVERY_LIMIT_ERROR_CODE, recoveryCount: run.recoveryCount },
            });
            return { outcome: "limit_exceeded" as const, run: failed };
          }

          const backoffIndex = Math.min(run.recoveryCount, Math.max(input.backoffMs.length - 1, 0));
          const backoffMs = input.backoffMs[backoffIndex] ?? 0;
          const nextRecoveryCount = run.recoveryCount + 1;
          const [recovering] = await tx
            .update(harnessRuns)
            .set({
              status: "recovering",
              recoveryCount: nextRecoveryCount,
              availableAt: new Date(now.getTime() + backoffMs),
              updatedAt: now,
            })
            .where(eq(harnessRuns.harnessRunId, input.runId))
            .returning();
          await appendRunEventInTransaction(tx, {
            runId: input.runId,
            eventType: "recovery_started",
            payload: {
              recoveryCount: nextRecoveryCount,
              backoffMs,
              orphanedAttemptIds: activeAttempts.map((attempt) => attempt.harnessRunAttemptId),
            },
          });
          return { outcome: "scheduled" as const, run: recovering };
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async listCheckpointsForRun(input) {
      try {
        return await dbInstance
          .select()
          .from(harnessRunCheckpoints)
          .where(eq(harnessRunCheckpoints.harnessRunId, input.runId))
          .orderBy(desc(harnessRunCheckpoints.sequence));
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async setAttemptResumeCheckpoint(input) {
      try {
        const rows = await dbInstance
          .update(harnessRunAttempts)
          .set({ resumeCheckpointId: input.checkpointId, updatedAt: new Date() })
          .where(
            and(
              eq(harnessRunAttempts.harnessRunAttemptId, input.attemptId),
              inArray(harnessRunAttempts.status, ["claimed", "running"]),
            ),
          )
          .returning();
        return rows[0] ?? null;
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async recordToolEffectOnce(input) {
      try {
        assertNonEmptyText(input.runId, "runId");
        assertNonEmptyText(input.effectKey, "effectKey");
        assertNonEmptyText(input.toolName, "toolName");
        assertSafeJsonObject(input.input);
        if (input.output !== undefined) assertSafeJsonObject(input.output);
        const effectInput = normalizeJsonObject(input.input);
        const effectOutput = input.output !== undefined ? normalizeJsonObject(input.output) : null;

        return await dbInstance.transaction(async (tx) => {
          await lockRunRow(tx, input.runId);
          const existing = await tx
            .select()
            .from(harnessToolEvents)
            .where(and(eq(harnessToolEvents.harnessRunId, input.runId), eq(harnessToolEvents.effectKey, input.effectKey)));
          if (existing.length > 0) {
            return { toolEvent: existing[0], created: false };
          }
          const now = await readDbNow(tx);
          const inserted = await tx
            .insert(harnessToolEvents)
            .values({
              harnessToolEventId: randomUUID(),
              harnessRunId: input.runId,
              toolName: input.toolName,
              eventType: "tool_effect",
              status: "succeeded",
              input: effectInput,
              output: effectOutput,
              effectKey: input.effectKey,
              createdAt: now,
              resolvedAt: now,
            })
            .onConflictDoNothing()
            .returning();
          if (inserted.length > 0) {
            return { toolEvent: inserted[0], created: true };
          }
          // 并发竞态：其他执行者已登记同一 effectKey，回读其结果复用
          const raced = await tx
            .select()
            .from(harnessToolEvents)
            .where(and(eq(harnessToolEvents.harnessRunId, input.runId), eq(harnessToolEvents.effectKey, input.effectKey)));
          if (raced.length === 0) {
            throw new HarnessRuntimeError("HARNESS_RUNTIME_INTERNAL", "tool effect insert raced without a winner");
          }
          return { toolEvent: raced[0], created: false };
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async findToolEffectByKey(input) {
      try {
        const rows = await dbInstance
          .select()
          .from(harnessToolEvents)
          .where(and(eq(harnessToolEvents.harnessRunId, input.runId), eq(harnessToolEvents.effectKey, input.effectKey)));
        return rows[0] ?? null;
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async completeAttemptAndRun(input) {
      try {
        return await dbInstance.transaction(async (tx) => {
          const run = await lockRunRow(tx, input.runId);
          if ((HARNESS_RUN_TERMINAL_STATUSES as readonly string[]).includes(run.status)) {
            return { changed: false, run };
          }
          const now = input.now ?? (await readDbNow(tx));
          const attemptRows = await tx
            .select()
            .from(harnessRunAttempts)
            .where(eq(harnessRunAttempts.harnessRunAttemptId, input.attemptId));
          const attempt = attemptRows[0];
          if (!attempt || attempt.harnessRunId !== input.runId) {
            throw new HarnessRuntimeError("HARNESS_ATTEMPT_NOT_FOUND", "attempt does not belong to the run");
          }
          if ((["claimed", "running"] as const).includes(attempt.status as "claimed" | "running")) {
            await tx
              .update(harnessRunAttempts)
              .set({
                status: input.outcome,
                finishedAt: now,
                updatedAt: now,
                ...(input.outcome === "failed" ? { errorCode: input.errorCode ?? null, errorMessage: input.errorMessage ?? null } : {}),
              })
              .where(eq(harnessRunAttempts.harnessRunAttemptId, input.attemptId));
          }
          const runStatus = input.outcome === "succeeded" ? "completed" : input.outcome === "failed" ? "failed" : "cancelled";
          const eventType = input.outcome === "succeeded" ? "run_completed" : input.outcome === "failed" ? "run_failed" : "run_cancelled";
          const [updated] = await tx
            .update(harnessRuns)
            .set({
              status: runStatus,
              completedAt: now,
              updatedAt: now,
              ...(input.outcome === "failed"
                ? { errorCode: input.errorCode ?? null, errorMessage: input.errorMessage ?? null }
                : {}),
            })
            .where(eq(harnessRuns.harnessRunId, input.runId))
            .returning();
          await appendRunEventInTransaction(tx, {
            runId: input.runId,
            eventType,
            payload: {
              attemptId: input.attemptId,
              ...(input.outcome === "failed" ? { errorCode: input.errorCode ?? "WORKER_STEP_FAILED" } : {}),
            },
          });
          return { changed: true, run: updated };
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async requestRunCancel(input) {
      try {
        assertNonEmptyText(input.requestedBy, "requestedBy");
        return await dbInstance.transaction(async (tx) => {
          const run = await lockRunRow(tx, input.runId);
          if ((HARNESS_RUN_TERMINAL_STATUSES as readonly string[]).includes(run.status)) {
            return { changed: false, run };
          }
          // 无活跃 attempt 的 Run（waiting / 历史 legacy 行）没有任何 worker 会
          // 观察到 cancelling：claimNextQueuedRun 只认领 queued/recovering，
          // recovery 只收割「attempt 租约过期」的 Run。此前一律置 cancelling
          // 会让这类 Run 永久停在活跃集合里，前端「停止中…」永不落地。
          // 运行锁已由 lockRunRow 持有，claim 侧同样先锁 run 行，故此处判定无竞态。
          const activeAttempts = await tx
            .select({ attemptId: harnessRunAttempts.harnessRunAttemptId })
            .from(harnessRunAttempts)
            .where(
              and(
                eq(harnessRunAttempts.harnessRunId, input.runId),
                inArray(harnessRunAttempts.status, ["claimed", "running"]),
              ),
            )
            .limit(1);
          const hasActiveAttempt = activeAttempts.length > 0;
          // 已有挂起取消：有 worker 在跑时保持幂等（changed=false）；
          // 无 worker 可收尾时必须补落终态，否则重复点击也救不回来。
          if (run.cancelRequestedAt && hasActiveAttempt) {
            return { changed: false, run };
          }
          const now = input.now ?? (await readDbNow(tx));
          const [updated] = await tx
            .update(harnessRuns)
            .set({
              status: hasActiveAttempt ? "cancelling" : "cancelled",
              ...(hasActiveAttempt ? {} : { completedAt: now }),
              cancelRequestedAt: run.cancelRequestedAt ?? now,
              cancelRequestedBy: run.cancelRequestedBy ?? input.requestedBy,
              updatedAt: now,
            })
            .where(eq(harnessRuns.harnessRunId, input.runId))
            .returning();
          if (!run.cancelRequestedAt) {
            await appendRunEventInTransaction(tx, {
              runId: input.runId,
              eventType: "cancel_requested",
              payload: { requestedBy: input.requestedBy },
            });
          }
          if (!hasActiveAttempt) {
            await appendRunEventInTransaction(tx, {
              runId: input.runId,
              eventType: "run_cancelled",
              payload: { requestedBy: input.requestedBy, reason: "no_active_attempt" },
            });
          }
          return { changed: true, run: updated };
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async releaseAttemptForShutdown(input) {
      try {
        return await dbInstance.transaction(async (tx) => {
          const run = await lockRunRow(tx, input.runId);
          if ((HARNESS_RUN_TERMINAL_STATUSES as readonly string[]).includes(run.status)) {
            return { outcome: "noop" as const, run };
          }
          const now = input.now ?? (await readDbNow(tx));
          await tx
            .update(harnessRunAttempts)
            .set({ status: "cancelled", finishedAt: now, updatedAt: now })
            .where(
              and(
                eq(harnessRunAttempts.harnessRunAttemptId, input.attemptId),
                eq(harnessRunAttempts.harnessRunId, input.runId),
                inArray(harnessRunAttempts.status, ["claimed", "running"]),
              ),
            );

          if (run.cancelRequestedAt) {
            const [cancelled] = await tx
              .update(harnessRuns)
              .set({ status: "cancelled", completedAt: now, updatedAt: now })
              .where(eq(harnessRuns.harnessRunId, input.runId))
              .returning();
            await appendRunEventInTransaction(tx, {
              runId: input.runId,
              eventType: "run_cancelled",
              payload: { reason: "worker_shutdown_with_pending_cancel", attemptId: input.attemptId },
            });
            return { outcome: "cancelled" as const, run: cancelled };
          }

          const [requeued] = await tx
            .update(harnessRuns)
            .set({ status: "queued", availableAt: now, updatedAt: now })
            .where(eq(harnessRuns.harnessRunId, input.runId))
            .returning();
          await appendRunEventInTransaction(tx, {
            runId: input.runId,
            eventType: "run_status_changed",
            payload: { to: "queued", reason: "worker_shutdown", attemptId: input.attemptId },
          });
          return { outcome: "requeued" as const, run: requeued };
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    // ============================================================
    // RP-047 Batch C（additive）：AI Runs API 读取与动作方法
    // ============================================================

    async listActiveRunsForOwner(ownerUserId) {
      try {
        assertNonEmptyText(ownerUserId, "ownerUserId");
        return await dbInstance
          .select()
          .from(harnessRuns)
          .where(
            and(
              eq(harnessRuns.ownerUserId, ownerUserId),
              inArray(harnessRuns.status, [...HARNESS_RUN_ACTIVE_STATUSES]),
            ),
          )
          .orderBy(desc(harnessRuns.createdAt));
      } catch (err) {
        throw toSafeError(err);
      }
    },

    // ISS-2026-08-10-001（后台任务角标数据源）：近期已完成 Run——
    // status='completed' 按 updatedAt 倒序，limit  clamp 到 ≤10；
    // 与活跃查询同为 owner 隔离，仅读取不改状态机。
    async listRecentlyCompletedRunsForOwner(ownerUserId, limit = 10) {
      try {
        assertNonEmptyText(ownerUserId, "ownerUserId");
        const safeLimit = Number.isFinite(limit)
          ? Math.min(Math.max(Math.floor(limit), 1), 10)
          : 10;
        return await dbInstance
          .select()
          .from(harnessRuns)
          .where(
            and(
              eq(harnessRuns.ownerUserId, ownerUserId),
              eq(harnessRuns.status, "completed"),
            ),
          )
          .orderBy(desc(harnessRuns.updatedAt))
          .limit(safeLimit);
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async getRunSnapshot(runId) {
      try {
        assertNonEmptyText(runId, "runId");
        const [run] = await dbInstance.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, runId));
        if (!run) return null;
        const [attempt] = await dbInstance
          .select()
          .from(harnessRunAttempts)
          .where(eq(harnessRunAttempts.harnessRunId, runId))
          .orderBy(desc(harnessRunAttempts.attemptNo))
          .limit(1);
        const [checkpoint] = await dbInstance
          .select()
          .from(harnessRunCheckpoints)
          .where(eq(harnessRunCheckpoints.harnessRunId, runId))
          .orderBy(desc(harnessRunCheckpoints.sequence))
          .limit(1);
        const [output] = await dbInstance
          .select()
          .from(harnessRunOutputs)
          .where(eq(harnessRunOutputs.harnessRunId, runId))
          .limit(1);
        return { run, attempt: attempt ?? null, checkpoint: checkpoint ?? null, output: output ?? null };
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async hasActiveRunForSession(aiSessionId) {
      try {
        assertNonEmptyText(aiSessionId, "aiSessionId");
        const rows = await dbInstance
          .select({ harnessRunId: harnessRuns.harnessRunId })
          .from(harnessRuns)
          .where(
            and(
              eq(harnessRuns.aiSessionId, aiSessionId),
              inArray(harnessRuns.status, [...HARNESS_RUN_ACTIVE_STATUSES]),
            ),
          )
          .limit(1);
        return rows.length > 0;
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async listRunEventsAfter(input) {
      try {
        assertNonEmptyText(input.runId, "runId");
        const afterSequence = Number.isFinite(input.afterSequence) && input.afterSequence > 0 ? Math.floor(input.afterSequence) : 0;
        const limit = Number.isFinite(input.limit) ? Math.min(Math.max(Math.floor(input.limit), 1), 1000) : 200;
        return await dbInstance
          .select()
          .from(harnessRunEvents)
          .where(
            and(
              eq(harnessRunEvents.harnessRunId, input.runId),
              gt(harnessRunEvents.sequence, afterSequence),
            ),
          )
          .orderBy(asc(harnessRunEvents.sequence))
          .limit(limit);
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async submitRunInput(input) {
      try {
        assertNonEmptyText(input.requestedBy, "requestedBy");
        assertSafeJsonObject(input.input);
        const payloadInput = normalizeJsonObject(input.input);
        return await dbInstance.transaction(async (tx) => {
          const run = await lockRunRow(tx, input.runId);
          if (run.status !== "waiting") {
            throw new HarnessRuntimeError("HARNESS_RUN_NOT_WAITING", "run inputs are only accepted while waiting");
          }
          const event = await appendRunEventInTransaction(tx, {
            runId: input.runId,
            eventType: "run_inputs_submitted",
            payload: { input: payloadInput, requestedBy: input.requestedBy },
          });
          const now = await readDbNow(tx);
          const [updated] = await tx
            .update(harnessRuns)
            .set({ status: "queued", availableAt: now, updatedAt: now })
            .where(eq(harnessRuns.harnessRunId, input.runId))
            .returning();
          return { run: updated, event };
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async confirmRunAction(input) {
      try {
        assertNonEmptyText(input.actionId, "actionId");
        assertNonEmptyText(input.confirmedBy, "confirmedBy");
        return await dbInstance.transaction(async (tx) => {
          const run = await lockRunRow(tx, input.runId);
          // 幂等：同一 actionId 已确认过则直接回放既有事件，不改状态不追加事件
          const existing = await tx
            .select()
            .from(harnessRunEvents)
            .where(
              and(
                eq(harnessRunEvents.harnessRunId, input.runId),
                eq(harnessRunEvents.eventType, "run_action_confirmed"),
                sql`${harnessRunEvents.payload}->>'actionId' = ${input.actionId}`,
              ),
            )
            .orderBy(asc(harnessRunEvents.sequence))
            .limit(1);
          if (existing.length > 0) {
            return { created: false, run, event: existing[0] };
          }
          if (run.status !== "waiting") {
            throw new HarnessRuntimeError("HARNESS_RUN_NOT_WAITING", "run actions can only be confirmed while waiting");
          }
          const event = await appendRunEventInTransaction(tx, {
            runId: input.runId,
            eventType: "run_action_confirmed",
            payload: { actionId: input.actionId, confirmedBy: input.confirmedBy },
          });
          const now = await readDbNow(tx);
          const [updated] = await tx
            .update(harnessRuns)
            .set({ status: "queued", availableAt: now, updatedAt: now })
            .where(eq(harnessRuns.harnessRunId, input.runId))
            .returning();
          return { created: true, run: updated, event };
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },
  };
}
