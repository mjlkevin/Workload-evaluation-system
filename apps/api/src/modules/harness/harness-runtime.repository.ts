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
  harnessRunEvents,
  harnessRuns,
  type HarnessRunAttemptRow,
  type HarnessRunEventRow,
  type HarnessRunRow,
} from "../../db/schema";
import type { HarnessRunEventType } from "./harness-runtime.types";

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

export interface HarnessRuntimeRepository {
  createQueuedRun(input: CreateQueuedHarnessRunInput): Promise<{ run: HarnessRunRow; created: boolean }>;
  findRunForOwner(runId: string, ownerUserId: string): Promise<HarnessRunRow | null>;
  claimNextQueuedRun(
    input: ClaimNextHarnessRunInput,
  ): Promise<{ run: HarnessRunRow; attempt: HarnessRunAttemptRow } | null>;
  heartbeatAttempt(input: HeartbeatHarnessAttemptInput): Promise<HarnessRunAttemptRow | null>;
  appendRunEvent(input: AppendHarnessRunEventInput): Promise<HarnessRunEventRow>;
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
        return await dbInstance.transaction(async (tx) => appendRunEventInTransaction(tx, input));
      } catch (err) {
        throw toSafeError(err);
      }
    },
  };
}
