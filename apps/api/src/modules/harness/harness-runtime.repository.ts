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
import { and, eq, gt, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import {
  harnessRunAttempts,
  harnessRunCheckpoints,
  harnessRunEvents,
  harnessRunOutputs,
  harnessRuns,
  harnessSessionOutbox,
  type HarnessRunAttemptRow,
  type HarnessRunCheckpointRow,
  type HarnessRunEventRow,
  type HarnessRunOutputRow,
  type HarnessRunRow,
  type HarnessSessionOutboxRow,
} from "../../db/schema";
import {
  HARNESS_RUN_EVENT_TYPES,
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

export type EnqueueHarnessSessionOutboxInput = {
  runId: string;
  aiSessionId: string;
  eventType: string;
  deduplicationKey: string;
  payload: Record<string, unknown>;
  availableAt?: Date;
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
  enqueueSessionOutbox(
    input: EnqueueHarnessSessionOutboxInput,
  ): Promise<{ outbox: HarnessSessionOutboxRow; created: boolean }>;
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
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
          const picked = await tx.execute(sql`
            SELECT harness_run_id
            FROM harness_runs
            WHERE status = 'queued' AND available_at <= ${now}
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
        return await dbInstance.transaction(async (tx) => appendRunEventInTransaction(tx, input));
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
        if (input.effectKeys !== undefined) {
          if (!Array.isArray(input.effectKeys) || input.effectKeys.some((key) => typeof key !== "string")) {
            throw new HarnessRuntimeError("HARNESS_RUNTIME_PAYLOAD_INVALID", "effectKeys must be a string array");
          }
        }
        if (input.aiMilestone !== undefined) {
          assertSafeJsonObject(input.aiMilestone);
        }

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
              state: input.state,
              stateHash: input.stateHash,
              inputHash: input.inputHash ?? null,
              effectKeys: input.effectKeys ?? [],
              aiMilestone: input.aiMilestone ?? null,
              runtimeValidation: input.runtimeValidation,
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
                content: input.content,
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
              content: input.content,
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

    async enqueueSessionOutbox(input) {
      try {
        assertNonEmptyText(input.runId, "runId");
        assertNonEmptyText(input.aiSessionId, "aiSessionId");
        assertNonEmptyText(input.eventType, "eventType");
        assertNonEmptyText(input.deduplicationKey, "deduplicationKey");
        assertSafeJsonObject(input.payload);

        return await dbInstance.transaction(async (tx) => {
          const run = await lockRunRow(tx, input.runId);
          if (run.aiSessionId !== input.aiSessionId) {
            throw new HarnessRuntimeError("RUN_SESSION_MISMATCH", "run is bound to a different ai session");
          }

          const existing = await tx
            .select()
            .from(harnessSessionOutbox)
            .where(
              and(
                eq(harnessSessionOutbox.aiSessionId, input.aiSessionId),
                eq(harnessSessionOutbox.deduplicationKey, input.deduplicationKey),
              ),
            );
          if (existing.length > 0) {
            return { outbox: existing[0], created: false };
          }

          const now = await readDbNow(tx);
          const [outbox] = await tx
            .insert(harnessSessionOutbox)
            .values({
              harnessSessionOutboxId: randomUUID(),
              harnessRunId: input.runId,
              aiSessionId: input.aiSessionId,
              eventType: input.eventType,
              deduplicationKey: input.deduplicationKey,
              payload: input.payload,
              status: "pending",
              attempts: 0,
              availableAt: input.availableAt ?? now,
              createdAt: now,
              updatedAt: now,
            })
            .returning();

          await appendRunEventInTransaction(tx, {
            runId: input.runId,
            eventType: "outbox_enqueued",
            payload: { outboxId: outbox.harnessSessionOutboxId, deduplicationKey: input.deduplicationKey },
          });

          return { outbox, created: true };
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },
  };
}
