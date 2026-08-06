// ============================================================
// Harness Session Projector
// ============================================================
// RP-047 Batch B：把 harness_session_outbox 的 pending 行投影到
// AI Session 消息流。恰好一次语义 = outbox 认领锁（SKIP LOCKED +
// 锁过期回收）+ sink 侧来源键幂等（projectionSource.deduplicationKey）
// + 发布确认。崩溃类 C4b（Session 已写入、outbox 未确认）由锁过期
// 重认领 + 来源键去重吸收，不产生重复消息。

import type { HarnessRuntimeRepository } from "./harness-runtime.repository";
import {
  HARNESS_PROJECTOR_TIMING_DEFAULTS,
  type HarnessProjectorTiming,
} from "./harness-runtime.types";
import { HarnessFaultInjectedError } from "./harness-runtime.worker";

export type HarnessProjectionSource = {
  deduplicationKey: string;
  runId: string;
  eventType: string;
};

export type HarnessSessionProjectionMessage = {
  messageId?: string;
  role: string;
  content: string;
  metadata?: Record<string, unknown>;
};

export type HarnessSessionMessageSink = {
  append(input: {
    sessionId: string;
    message: HarnessSessionProjectionMessage;
    source: HarnessProjectionSource;
  }): Promise<{ created: boolean; messageId: string }>;
};

export type HarnessProjectionOutcome = "published" | "retry" | "failed";

export type HarnessProjectionResult = {
  outboxId: string;
  outcome: HarnessProjectionOutcome;
  created?: boolean;
};

export type HarnessSessionProjectorOptions = {
  repository: HarnessRuntimeRepository;
  sink: HarnessSessionMessageSink;
  projectorId: string;
  timing?: Partial<HarnessProjectorTiming>;
  batchSize?: number;
  sleepMs?: (ms: number) => Promise<void>;
  faultInjector?: (phase: "beforeAppend" | "afterAppend") => void;
};

export type HarnessSessionProjector = {
  /** 认领并投影一批 pending outbox 行。 */
  projectOnce(): Promise<HarnessProjectionResult[]>;
  /** 按 pollIntervalMs 持续投影，直到 stop()。 */
  start(): Promise<void>;
  stop(): void;
};

const DEFAULT_BATCH_SIZE = 25;
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createHarnessSessionProjector(options: HarnessSessionProjectorOptions): HarnessSessionProjector {
  const timing: HarnessProjectorTiming = { ...HARNESS_PROJECTOR_TIMING_DEFAULTS, ...options.timing };
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const sleepMs = options.sleepMs ?? defaultSleep;
  let stopping = false;

  async function projectOnce(): Promise<HarnessProjectionResult[]> {
    const rows = await options.repository.claimPendingSessionOutbox({
      lockerId: options.projectorId,
      limit: batchSize,
      lockMs: timing.lockMs,
    });
    const results: HarnessProjectionResult[] = [];
    for (const row of rows) {
      const outboxId = row.harnessSessionOutboxId;
      try {
        options.faultInjector?.("beforeAppend");
        const payload = (row.payload ?? {}) as { message?: HarnessSessionProjectionMessage };
        const appended = await options.sink.append({
          sessionId: row.aiSessionId,
          message: payload.message ?? { role: "assistant", content: "" },
          source: {
            deduplicationKey: row.deduplicationKey,
            runId: row.harnessRunId,
            eventType: row.eventType,
          },
        });
        options.faultInjector?.("afterAppend");
        await options.repository.markSessionOutboxPublished({ outboxId, lockerId: options.projectorId });
        results.push({ outboxId, outcome: "published", created: appended.created });
      } catch (err) {
        // 故障注入 = 模拟投影仪进程崩溃：行保持 processing，等锁过期后被重认领。
        if (err instanceof HarnessFaultInjectedError) throw err;
        const errorCode = (err instanceof Error ? err.message : String(err)).slice(0, 200);
        const updated = await options.repository.markSessionOutboxFailed({
          outboxId,
          lockerId: options.projectorId,
          errorCode,
          retryAfterMs: timing.retryAfterMs,
          maxAttempts: timing.maxAttempts,
        });
        results.push({ outboxId, outcome: updated?.status === "failed" ? "failed" : "retry" });
      }
    }
    return results;
  }

  return {
    projectOnce,
    async start() {
      while (!stopping) {
        await projectOnce();
        if (!stopping) await sleepMs(timing.pollIntervalMs);
      }
    },
    stop() {
      stopping = true;
    },
  };
}
