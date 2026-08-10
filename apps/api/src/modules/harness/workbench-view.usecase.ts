// ============================================================
// Workbench 统一视图 Usecase（O5 Sprint 3A）
// ============================================================
// 一个接口返回会话 + Run + 待办任务 + 产物 + 失败原因，
// 消除前端多套状态拼装；为 RP-035（工作台页面数据一次取齐）建数据底座。
//
// 数据源复用既有 repository（sessions / runs / artifacts），
// 不得新建重复存储。数据隔离：仅返回本人数据。

import type { AuthUser } from "../../types";
import { listAiSessions, getAiSession } from "../ai-sessions/ai-sessions.usecase";
import type { AiSessionRecord, AiArtifact, AiPendingAction } from "../ai-sessions/ai-sessions.types";
import { HarnessRuntimeError } from "./harness-runtime.repository";

// ============================================================
// 错误类型
// ============================================================

export class WorkbenchViewError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "WorkbenchViewError";
    this.code = code;
  }
}

// ============================================================
// 输出类型
// ============================================================

export type WorkbenchRunViewItem = {
  runId: string;
  sessionId: string | null;
  title: string;
  status: string;
  latestEventKind: string;
  failedReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkbenchFailedRunItem = {
  runId: string;
  sessionId: string | null;
  error: string;
  retriable: boolean;
};

export type WorkbenchTaskViewItem = {
  actionId: string;
  actionType: string;
  title: string;
  riskLevel: string;
  status: string;
  sessionId: string;
  createdAt: string;
};

export type WorkbenchArtifactViewItem = {
  artifactId: string;
  type: string;
  title: string;
  status: string;
  sessionId: string;
  createdAt: string;
};

export type WorkbenchSessionViewItem = {
  sessionId: string;
  title: string;
  domain: string;
  status: string;
  workflowKey: string;
  messageCount: number;
  attachmentCount: number;
  artifactCount: number;
  pendingActionCount: number;
  updatedAt: string;
  createdAt: string;
};

export type WorkbenchUnifiedView = {
  sessions: WorkbenchSessionViewItem[];
  runs: WorkbenchRunViewItem[];
  tasks: WorkbenchTaskViewItem[];
  artifacts: WorkbenchArtifactViewItem[];
  failedRuns: WorkbenchFailedRunItem[];
};

// ============================================================
// Repository 鸭子端口
// ============================================================

export type WorkbenchViewRepoPort = {
  listActiveRunsForOwner(ownerUserId: string): Promise<Array<Record<string, unknown>>>;
  // ISS-2026-08-10-001（后台任务角标数据源）：近期已完成 Run 查询。
  listRecentlyCompletedRunsForOwner(ownerUserId: string, limit?: number): Promise<Array<Record<string, unknown>>>;
  getRunSnapshot(runId: string): Promise<{
    run: Record<string, unknown>;
    attempt: Record<string, unknown> | null;
    checkpoint: unknown;
    output: unknown;
  } | null>;
};

export type WorkbenchViewUsecaseDeps = {
  repo: WorkbenchViewRepoPort;
};

export type WorkbenchViewUsecase = ReturnType<typeof createWorkbenchViewUsecase>;

// ============================================================
// 内部工具
// ============================================================

const TERMINAL_STATUSES: readonly string[] = ["completed", "failed", "cancelled"];
const FAILED_STATUS = "failed";
// ISS-2026-08-10-001：统一视图携带的近期已完成 Run 上限（角标计数窗口）。
const RECENTLY_COMPLETED_RUNS_LIMIT = 10;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

function safeRunString(run: Record<string, unknown>, key: string): string {
  const value = run[key];
  if (value === null || value === undefined) return "";
  return String(value);
}

function extractFailedReason(run: Record<string, unknown>): string | undefined {
  const errorCode = safeRunString(run, "errorCode");
  const errorMessage = safeRunString(run, "errorMessage");
  if (!errorCode && !errorMessage) return undefined;
  return errorMessage ? `${errorCode}: ${errorMessage}` : errorCode;
}

function isRetriableFailedRun(run: Record<string, unknown>): boolean {
  const status = safeRunString(run, "status");
  if (status !== FAILED_STATUS) return false;
  // 恢复次数超限的 Run 不可重试（由业务规则决定）
  const errorCode = safeRunString(run, "errorCode");
  if (errorCode === "RECOVERY_LIMIT_EXCEEDED") return false;
  return true;
}

// ============================================================
// 工厂
// ============================================================

export function createWorkbenchViewUsecase(deps: WorkbenchViewUsecaseDeps) {
  const repo = deps.repo;

  /**
   * 获取当前用户工作台的统一视图。
   * 聚合会话、Run、任务、产物、失败 Run 到一个接口返回。
   */
  async function getUnifiedView(user: AuthUser): Promise<WorkbenchUnifiedView> {
    // 1. 拉取本人所有会话（JSON 文件存储，已做 owner 隔离）
    const sessions = listAiSessions(user);

    // 2. 拉取本人活跃 Run（PostgreSQL，已做 owner 隔离）
    const activeRuns = await repo.listActiveRunsForOwner(user.id);

    // 2b. ISS-2026-08-10-001（后台任务角标不显示）：增补本人近期已完成 Run——
    // Run 进入 completed 终态后立即从活跃查询消失，曾导致角标「已完成」永远计 0；
    // 合并进同一 runs 视图（按 runId 去重），前端按 status 计数即可。
    const recentlyCompletedRuns = await repo.listRecentlyCompletedRunsForOwner(
      user.id,
      RECENTLY_COMPLETED_RUNS_LIMIT,
    );
    const seenRunIds = new Set<string>();
    const viewRuns: Array<Record<string, unknown>> = [];
    for (const run of [...activeRuns, ...recentlyCompletedRuns]) {
      const runId = safeRunString(run, "harnessRunId");
      if (runId && seenRunIds.has(runId)) continue;
      if (runId) seenRunIds.add(runId);
      viewRuns.push(run);
    }

    // 3. 构建 Run 视图项
    const runViewItems: WorkbenchRunViewItem[] = [];
    const failedRunItems: WorkbenchFailedRunItem[] = [];

    for (const run of viewRuns) {
      const status = safeRunString(run, "status");
      const runId = safeRunString(run, "harnessRunId");
      const sessionId = run.aiSessionId === null || run.aiSessionId === undefined
        ? null
        : String(run.aiSessionId);

      // 获取最新事件类型：从 run 的 eventSequence 推断，
      // 实际场景下前端通过 SSE 消费事件，这里用 status 映射一个代表性事件类型
      const latestEventKind = mapStatusToLatestEventKind(status);

      const runItem: WorkbenchRunViewItem = {
        runId,
        sessionId,
        title: safeRunString(run, "title"),
        status,
        latestEventKind,
        createdAt: asIsoDate(run.createdAt),
        updatedAt: asIsoDate(run.updatedAt),
      };

      // failed Run 携带失败原因
      if (status === FAILED_STATUS) {
        const failedReason = extractFailedReason(run);
        if (failedReason) {
          runItem.failedReason = failedReason;
        }
        failedRunItems.push({
          runId,
          sessionId,
          error: failedReason || "未知错误",
          retriable: isRetriableFailedRun(run),
        });
      }

      runViewItems.push(runItem);
    }

    // 4. 从会话中提取待办任务和产物
    const taskItems: WorkbenchTaskViewItem[] = [];
    const artifactItems: WorkbenchArtifactViewItem[] = [];
    const sessionViewItems: WorkbenchSessionViewItem[] = [];

    for (const session of sessions) {
      sessionViewItems.push({
        sessionId: session.sessionId,
        title: session.title,
        domain: session.domain,
        status: session.status,
        workflowKey: session.workflowKey,
        messageCount: session.messages?.length ?? 0,
        attachmentCount: session.attachments?.length ?? 0,
        artifactCount: session.artifacts?.length ?? 0,
        pendingActionCount: session.pendingActions?.length ?? 0,
        updatedAt: session.updatedAt,
        createdAt: session.createdAt,
      });

      // 提取待办任务（pendingActions）
      for (const action of session.pendingActions ?? []) {
        taskItems.push({
          actionId: action.actionId,
          actionType: action.actionType,
          title: action.title,
          riskLevel: action.riskLevel,
          status: action.status,
          sessionId: session.sessionId,
          createdAt: action.createdAt,
        });
      }

      // 提取产物（artifacts）
      for (const artifact of session.artifacts ?? []) {
        artifactItems.push({
          artifactId: artifact.artifactId,
          type: artifact.type,
          title: artifact.title,
          status: artifact.status,
          sessionId: session.sessionId,
          createdAt: artifact.createdAt,
        });
      }
    }

    return {
      sessions: sessionViewItems,
      runs: runViewItems,
      tasks: taskItems,
      artifacts: artifactItems,
      failedRuns: failedRunItems,
    };
  }

  return {
    getUnifiedView,
  };
}

// ============================================================
// 状态 → 最新事件类型映射
// ============================================================

function mapStatusToLatestEventKind(status: string): string {
  switch (status) {
    case "queued":
      return "run_queued";
    case "running":
      return "run_claimed";
    case "waiting":
      return "run_inputs_submitted";
    case "recovering":
      return "recovery_started";
    case "cancelling":
      return "cancel_requested";
    case "completed":
      return "run_completed";
    case "failed":
      return "run_failed";
    case "cancelled":
      return "run_cancelled";
    default:
      return "run_status_changed";
  }
}
