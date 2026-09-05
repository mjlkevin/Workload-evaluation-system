// ============================================================
// AI Runs controller（RP-047 Batch C）
// ============================================================
// 将 harness-runtime.usecase 的业务结果映射为 HTTP 状态码矩阵（§2）：
//   202 envelope / 404（含非 owner，不泄露存在性）/ 409 业务码 /
//   422 校验 / 503 ASYNC_RUNS_DISABLED。
// SSE events handler 实现回放语义（D6）：游标 = 事件 sequence，
// Last-Event-ID 头优先于 after 查询参数，终态排空后主动关闭，
// 客户端断线只释放连接，禁止触发 cancel/aborted。

import { Request, Response, RequestHandler } from "express";
import { randomUUID } from "node:crypto";

import { requireCapability } from "../../rbac/middleware";
import { asString } from "../../utils";
import { fail, ok } from "../../utils/response";
import type { HarnessRunEventRow } from "../../db/schema";
import { deleteAiSession } from "../ai-sessions/ai-sessions.usecase";
import {
  AiRunsConflictError,
  AiRunsDisabledError,
  AiRunsNotFoundError,
  AiRunsValidationError,
  type AiRunsUsecase,
} from "./harness-runtime.usecase";

// ============================================================
// 错误映射
// ============================================================

function writeAiRunsError(res: Response, err: unknown): void {
  if (err instanceof AiRunsDisabledError) {
    res.status(503).json({ code: err.code, message: err.message, details: [], requestId: randomUUID() });
    return;
  }
  if (err instanceof AiRunsNotFoundError) {
    fail(res, 40404, err.message);
    return;
  }
  if (err instanceof AiRunsConflictError) {
    res.status(409).json({ code: err.code, message: err.message, details: [], requestId: randomUUID() });
    return;
  }
  if (err instanceof AiRunsValidationError) {
    res.status(422).json({ code: 42200, message: err.message, details: [], requestId: randomUUID() });
    return;
  }
  // 未知错误不泄露内部细节（repository 已做安全映射，这里兜底）
  fail(res, 50000, "服务内部错误");
}

/** 把 requireCapability 与业务 handler 组合为完整中间件（含 401/403 门闸）。 */
function guard(handler: (req: Request, res: Response) => Promise<void> | void): RequestHandler {
  const capability = requireCapability("estimates:read");
  return (req, res) => {
    capability(req, res, async () => {
      try {
        await handler(req, res);
      } catch (err) {
        writeAiRunsError(res, err);
      }
    });
  };
}

// ============================================================
// handler 工厂
// ============================================================

export type AiRunsHandlersDeps = {
  // 鸭子类型：真实为 AiRunsUsecase，测试为 stub；开放类型以兼容 stub 注入
  usecase: any;
};

export function createAiRunsHandlers(deps: AiRunsHandlersDeps) {
  const usecase = deps.usecase as AiRunsUsecase;

  const listActiveRunsHandler = guard(async (req, res) => {
    const items = await usecase.listActiveRuns(req.user!);
    res.json(ok({ items }, randomUUID()));
  });

  const getRunSnapshotHandler = guard(async (req, res) => {
    const snapshot = await usecase.getRunSnapshot(req.user!, asString(req.params.runId));
    res.json(ok(snapshot, randomUUID()));
  });

  const cancelRunHandler = guard(async (req, res) => {
    const result = await usecase.cancelRun(req.user!, asString(req.params.runId));
    res.status(result.status).json(ok(result.data, randomUUID()));
  });

  const submitInputsHandler = guard(async (req, res) => {
    const result = await usecase.submitInputs(req.user!, asString(req.params.runId), req.body || {});
    res.status(result.status).json(ok(result.data, randomUUID()));
  });

  const confirmActionHandler = guard(async (req, res) => {
    const result = await usecase.confirmAction(req.user!, asString(req.params.runId), req.params.actionId);
    res.status(result.status).json(ok(result.data, randomUUID()));
  });

  const rejectActionHandler = guard(async (req, res) => {
    const result = await usecase.rejectAction(req.user!, asString(req.params.runId), req.params.actionId);
    res.status(result.status).json(ok(result.data, randomUUID()));
  });

  const retryRunHandler = guard(async (req, res) => {
    const result = await usecase.retryRun(req.user!, asString(req.params.runId));
    res.status(result.status).json(ok(result.data, randomUUID()));
  });

  /** 挂在 POST /ai-sessions/:sessionId/runs 的提交 handler。 */
  const submitRunHandler = guard(async (req, res) => {
    const result = await usecase.submitRun(req.user!, asString(req.params.sessionId), req.body || {});
    res.status(result.status).json({ code: 0, message: "任务已进入后台执行", data: result.data, requestId: randomUUID() });
  });

  return {
    listActiveRunsHandler,
    getRunSnapshotHandler,
    cancelRunHandler,
    submitInputsHandler,
    confirmActionHandler,
    rejectActionHandler,
    retryRunHandler,
    submitRunHandler,
  };
}

// ============================================================
// Session 删除 409 保护 handler（D5，规格 §11.3）
// ============================================================

export type AiSessionDeleteHandlerDeps = {
  // 鸭子类型：真实为 HarnessRuntimeRepository.hasActiveRunForSession
  repo: any;
};

/** flag 开启时替代旧同步 deleteSession：存在活跃 Run 的会话删除返回 409。 */
export function createDeleteSessionHandler(deps: AiSessionDeleteHandlerDeps): RequestHandler {
  const repo = deps.repo as { hasActiveRunForSession(sessionId: string): Promise<boolean> };
  return guard(async (req, res) => {
    const sessionId = asString(req.params.sessionId);
    const deleted = await deleteAiSession(req.user!, sessionId, {
      activeRunChecker: (id) => repo.hasActiveRunForSession(id),
    });
    if (!deleted) {
      fail(res, 40404, "会话不存在", [{ field: "sessionId", reason: "not_found" }]);
      return;
    }
    res.json(ok({ deletedSessionId: sessionId }, randomUUID()));
  });
}

// ============================================================
// SSE events handler 工厂（G3）
// ============================================================

const SSE_TERMINAL_STATUSES: readonly string[] = ["completed", "failed", "cancelled"];
const SSE_DEFAULT_HEARTBEAT_MS = 15_000;
const SSE_DEFAULT_POLL_MS = 1_000;
const SSE_DEFAULT_BATCH_LIMIT = 200;

export type AiRunsEventsDeps = {
  enabled: boolean;
  // 鸭子类型：真实为 HarnessRuntimeRepository（findRunForOwner / listRunEventsAfter）
  repo: any;
  heartbeatMs?: number;
  pollMs?: number;
  batchLimit?: number;
};

type SseRepoPort = {
  findRunForOwner(runId: string, ownerUserId: string): Promise<Record<string, unknown> | null>;
  listRunEventsAfter(input: {
    runId: string;
    afterSequence: number;
    limit: number;
  }): Promise<HarnessRunEventRow[]>;
};

function parseCursor(value: unknown): number {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return 0;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export function createRunEventsHandler(deps: AiRunsEventsDeps): RequestHandler {
  const repo = deps.repo as SseRepoPort;
  const heartbeatMs = deps.heartbeatMs ?? SSE_DEFAULT_HEARTBEAT_MS;
  const pollMs = deps.pollMs ?? SSE_DEFAULT_POLL_MS;
  const batchLimit = deps.batchLimit ?? SSE_DEFAULT_BATCH_LIMIT;

  return guard(async (req, res) => {
    if (!deps.enabled) throw new AiRunsDisabledError();
    const runId = asString(req.params.runId);
    // 握手前完成 owner 校验：非 owner 得到普通 404 JSON，不开放事件流（G2/G3）
    const run = await repo.findRunForOwner(runId, req.user!.id);
    if (!run) throw new AiRunsNotFoundError("任务不存在");

    // Last-Event-ID 头优先于 after 查询参数（D6）
    const lastEventId = req.headers["last-event-id"];
    const cursor = typeof lastEventId === "string" && lastEventId.trim() !== ""
      ? parseCursor(lastEventId)
      : parseCursor(req.query.after);

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write(": heartbeat\n\n");

    let sequence = cursor;
    let lastWriteAt = Date.now();
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    try {
      // 事件循环：只读回放。客户端断线时 res.writableEnded 置位即退出，
      // 禁止在此路径调用 cancel 或写入 aborted/cancelled 语义（G3）。
      for (;;) {
        if (res.writableEnded) return;
        const batch = await repo.listRunEventsAfter({ runId, afterSequence: sequence, limit: batchLimit });
        for (const event of batch) {
          if (res.writableEnded) return;
          res.write(`id: ${event.sequence}\nevent: ${event.eventType}\ndata: ${JSON.stringify({
            sequence: event.sequence,
            eventType: event.eventType,
            payload: event.payload,
            createdAt: event.createdAt instanceof Date ? event.createdAt.toISOString() : event.createdAt,
          })}\n\n`);
          sequence = event.sequence;
          lastWriteAt = Date.now();
        }
        const current = await repo.findRunForOwner(runId, req.user!.id);
        const terminal = !current || SSE_TERMINAL_STATUSES.includes(String(current.status ?? ""));
        if (terminal && batch.length === 0) {
          // 终态且事件已排空：主动关闭，客户端得到完整回放（D6）
          res.end();
          return;
        }
        if (batch.length === 0 && Date.now() - lastWriteAt >= heartbeatMs && !res.writableEnded) {
          res.write(": heartbeat\n\n");
          lastWriteAt = Date.now();
        }
        await sleep(pollMs);
      }
    } catch {
      // 回放期间内部错误：若流仍可写则直接结束，不泄露错误细节
      if (!res.writableEnded) res.end();
    }
  });
}
