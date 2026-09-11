// ============================================================
// AI Runs 异步 Run usecase（RP-047 Batch C）
// ============================================================
// 规格 §11：POST /ai-sessions/:sessionId/runs 202 幂等提交、active Runs
// 列表、Run snapshot、cancel/inputs/confirm/retry 动作与 Session 删除
// 409 保护的业务规则层。
//
// 安全边界：
//   - 非 owner / 不存在的 Run 与 Session 一律 404，不泄露存在性（G2）。
//   - feature flag 关闭时所有新端点 503 ASYNC_RUNS_DISABLED（G4，D2）。
//   - repository 错误只消费固定 code，不穿透 Drizzle/pg 原始错误。
//   - 单向依赖：ai-sessions.usecase 引入本文件的 AiRunsConflictError，
//     本文件仅 type-import ai-sessions.types，避免循环导入。

import { randomUUID } from "node:crypto";

import type { AuthUser } from "../../types";
import type { AiSessionRecord } from "../ai-sessions/ai-sessions.types";
import { HarnessRuntimeError } from "./harness-runtime.repository";
import {
  attachWorkbenchConversationFact,
  buildWorkbenchUserMessageFact,
  type WorkbenchConversationAttachment,
} from "./workbench-conversation-fact";

// ============================================================
// 错误类型（状态码矩阵 §2 冻结）
// ============================================================

export class AiRunsDisabledError extends Error {
  readonly status = 503;
  readonly code = "ASYNC_RUNS_DISABLED";

  constructor(message = "异步 Run 能力未启用") {
    super(message);
    this.name = "AiRunsDisabledError";
  }
}

export class AiRunsNotFoundError extends Error {
  readonly status = 404;

  constructor(message = "资源不存在") {
    super(message);
    this.name = "AiRunsNotFoundError";
  }
}

export class AiRunsConflictError extends Error {
  readonly status = 409;
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AiRunsConflictError";
    this.code = code;
  }
}

export class AiRunsValidationError extends Error {
  readonly status = 422;

  constructor(message: string) {
    super(message);
    this.name = "AiRunsValidationError";
  }
}

// ============================================================
// feature flag（D2：读取点收敛，只认字符串 "true"）
// ============================================================

export function isDurableRunsEnabledFromEnv(): boolean {
  return process.env.WES_AI_DURABLE_RUNS_ENABLED === "true";
}

// ============================================================
// repository 鸭子端口（真实实现为 HarnessRuntimeRepository；
// 测试以内存 fake 注入。deps.repo 类型保持开放以兼容 fake 注入，
// 内部按本端口消费。）
// ============================================================

export type AiRunsRepoPort = {
  createQueuedRun(input: {
    ownerUserId: string;
    ownerUsername: string;
    aiSessionId: string;
    submissionKey: string;
    title: string;
    workflowId: string;
    workflowVersion: string;
    executionConfig?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    retryOfRunId?: string;
    /**
     * 批次 2b-1（additive）→ 2b-2：本轮用户消息的完整信封载荷，按 runId 构造，
     * 随入队事务落一条 user/message（约定所有权在 workbench 层，仓储只序列化）。
     */
    userMessageFact?: (runId: string) => Record<string, unknown>;
  }): Promise<{ run: Record<string, unknown>; created: boolean }>;
  findRunForOwner(runId: string, ownerUserId: string): Promise<Record<string, unknown> | null>;
  listActiveRunsForOwner(ownerUserId: string): Promise<Array<Record<string, unknown>>>;
  getRunSnapshot(
    runId: string,
  ): Promise<{ run: Record<string, unknown>; attempt: unknown; checkpoint: unknown; output: unknown } | null>;
  requestRunCancel(input: {
    runId: string;
    requestedBy: string;
  }): Promise<{ changed: boolean; run: Record<string, unknown> }>;
  submitRunInput(input: {
    runId: string;
    input: Record<string, unknown>;
    requestedBy: string;
  }): Promise<{ run: Record<string, unknown>; event: Record<string, unknown> }>;
  confirmRunAction(input: {
    runId: string;
    actionId: string;
    confirmedBy: string;
  }): Promise<{ created: boolean; run: Record<string, unknown>; event: Record<string, unknown> | null }>;
  /** 批次 1a · skip 档：用户拒绝，工具永不执行，Run 回 queued 续跑 */
  rejectRunAction(input: {
    runId: string;
    actionId: string;
    rejectedBy: string;
  }): Promise<{ created: boolean; run: Record<string, unknown>; event: Record<string, unknown> | null }>;
  /** 批次 1b · 只读：按 run 取回工具痕迹事件（界面重建 chip 用），不写任何状态 */
  listRunToolEvents(input: { runId: string; limit?: number }): Promise<Array<Record<string, unknown>>>;
};

export type AiRunsUsecaseDeps = {
  // 鸭子类型端口：生产接 createHarnessRuntimeRepository(db)，测试接内存 fake
  repo: any;
  enabled: boolean;
  findSession: (user: AuthUser, sessionId: string) => Promise<AiSessionRecord | null>;
};

export type AiRunsSubmitInput = {
  submissionKey?: unknown;
  clientMessageId?: unknown;
  content?: unknown;
  attachments?: unknown;
};

export type AiRunsSubmitResult = {
  status: 202;
  data: { runId: string; sessionId: string; status: string; eventCursor: number };
};

export type AiRunsUsecase = ReturnType<typeof createAiRunsUsecase>;

// ============================================================
// 内部工具
// ============================================================

const TERMINAL_STATUSES: readonly string[] = ["completed", "failed", "cancelled"];
const WORKBENCH_WORKFLOW_ID = "workbench_chat_v1";
const WORKBENCH_WORKFLOW_VERSION = "1.0.0";
const MAX_RUN_ATTACHMENTS = 5;
const MAX_ATTACHMENT_NAME_LENGTH = 255;
const MAX_ATTACHMENT_TYPE_LENGTH = 255;
const MAX_PARSED_SUMMARY_LENGTH = 8_000;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const ATTACHMENT_TRUNCATION_SUFFIX = "…[truncated]";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRunAttachments(value: unknown): Array<{
  name: string;
  size?: number;
  type?: string;
  parsedSummary?: string;
}> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_RUN_ATTACHMENTS).flatMap((item) => {
    if (!isPlainObject(item)) return [];
    const name = asText(item.name).slice(0, MAX_ATTACHMENT_NAME_LENGTH);
    if (!name) return [];
    const size = typeof item.size === "number" && Number.isFinite(item.size)
      && item.size >= 0 && item.size <= MAX_ATTACHMENT_SIZE
      ? item.size
      : undefined;
    const type = asText(item.type).slice(0, MAX_ATTACHMENT_TYPE_LENGTH) || undefined;
    const summary = asText(item.parsedSummary);
    const parsedSummary = summary
      ? summary.length > MAX_PARSED_SUMMARY_LENGTH
        ? `${summary.slice(0, MAX_PARSED_SUMMARY_LENGTH - ATTACHMENT_TRUNCATION_SUFFIX.length)}${ATTACHMENT_TRUNCATION_SUFFIX}`
        : summary
      : undefined;
    return [{ name, ...(size !== undefined ? { size } : {}), ...(type ? { type } : {}), ...(parsedSummary ? { parsedSummary } : {}) }];
  });
}

function toRepo(deps: AiRunsUsecaseDeps): AiRunsRepoPort {
  return deps.repo as AiRunsRepoPort;
}

function assertEnabled(deps: AiRunsUsecaseDeps): void {
  if (!deps.enabled) throw new AiRunsDisabledError();
}

/** repository 固定 code → API 冲突码映射（其余原样上抛由 controller 兜底）。 */
function mapRepoConflict(err: unknown): never {
  if (err instanceof HarnessRuntimeError) {
    if (err.code === "ACTIVE_WORKBENCH_RUN_EXISTS") {
      throw new AiRunsConflictError("SESSION_HAS_ACTIVE_RUN", "该会话存在进行中的异步任务");
    }
    if (err.code === "HARNESS_RUN_NOT_WAITING") {
      throw new AiRunsConflictError("RUN_NOT_WAITING", "仅 waiting 状态的任务可执行该动作");
    }
    // 批次 2b-1：正文要随 Run 一起落进事件表，而事件表对单条载荷有硬上限（仓储在事务内
    // 校验）。超限即整笔回滚——此时必须给用户一个说得通的原因，而不是兜底的「服务内部错误」：
    // 「提交失败，原因未知」比「提交被拒，因为太长」糟糕得多。
    if (err.code === "HARNESS_RUNTIME_PAYLOAD_TOO_LARGE") {
      throw new AiRunsValidationError("消息正文超出单事件载荷上限，本次提交已整体回滚");
    }
  }
  throw err;
}

/** 包装 createQueuedRun 调用：冲突码映射，其余错误上抛。 */
async function createRunOrThrow(
  call: () => Promise<{ run: Record<string, unknown>; created: boolean }>,
): Promise<{ run: Record<string, unknown>; created: boolean }> {
  try {
    return await call();
  } catch (err) {
    mapRepoConflict(err);
  }
}

// ============================================================
// 工厂
// ============================================================

export function createAiRunsUsecase(deps: AiRunsUsecaseDeps) {
  const repo = toRepo(deps);

  /** C1 提交契约：202 + submissionKey 幂等；flag/校验/归属顺序冻结。 */
  async function submitRun(user: AuthUser, sessionId: string, input: AiRunsSubmitInput): Promise<AiRunsSubmitResult> {
    assertEnabled(deps);
    const submissionKey = asText(input.submissionKey);
    if (!submissionKey) throw new AiRunsValidationError("submissionKey 必填");
    const content = asText(input.content);
    if (!content) throw new AiRunsValidationError("content 不能为空");
    const attachments = normalizeRunAttachments(input.attachments);

    const session = await deps.findSession(user, sessionId);
    if (!session) throw new AiRunsNotFoundError("会话不存在");

    const clientMessageId = asText(input.clientMessageId);
    const metadata: Record<string, unknown> = {};
    if (clientMessageId) metadata.clientMessageId = clientMessageId;

    // 批次 2b-2：本轮消息的身份字段（messageId / createdAt / 附件 attachmentId）在**提交时刻**
    // 一次 mint，随 executionConfig 持久化。workflow 执行时复用而不再自造，于是
    // 「事件载荷」与「会话里那条消息」是同一份字段的两次写出——2b-3 换读取源时历史才会
    // 逐字段还原，而不是只剩正文。附件身份一并前移：它是 attachmentIds 的来源，
    // 留在执行期生成就等于让事件少知道一部分自己该承载的事实。
    const { executionConfig, fact } = attachWorkbenchConversationFact(
      { content, ...(attachments.length ? { attachments } : {}) },
      attachments,
    );

    const created = await createRunOrThrow(() =>
      repo.createQueuedRun({
        ownerUserId: user.id,
        ownerUsername: user.username,
        aiSessionId: sessionId,
        submissionKey,
        title: content.slice(0, 80),
        workflowId: WORKBENCH_WORKFLOW_ID,
        workflowVersion: WORKBENCH_WORKFLOW_VERSION,
        executionConfig,
        metadata,
        // 批次 2b-1：用户正文随入队落一条 user/message。正文取自**提交原始入参** content
        // （与 executionConfig.content 同一份，也正是 workflow 落会话用户消息的那一份），
        // 刻意不读上面那行 title：title 是 80 字标题，今天恰好等于正文是巧合，
        // 依赖它就等于把「历史对不对」押在「没人给长消息加摘要」上。
        // 批次 2b-2：同一份 content 连同刚 mint 的信封构成完整载荷，runId 由仓储在本事务内给出。
        userMessageFact: (runId) => buildWorkbenchUserMessageFact({ runId, fact, content }),
      }),
    );

    return {
      status: 202,
      data: {
        runId: String(created.run.harnessRunId),
        sessionId,
        status: String(created.run.status ?? "queued"),
        eventCursor: Number(created.run.eventSequence ?? 1),
      },
    };
  }

  /** C1 读取：当前用户活跃任务列表（供 Shell 恢复）。 */
  async function listActiveRuns(user: AuthUser) {
    assertEnabled(deps);
    const runs = await repo.listActiveRunsForOwner(user.id);
    return runs.map((run) => ({
      runId: String(run.harnessRunId),
      sessionId: run.aiSessionId === null || run.aiSessionId === undefined ? null : String(run.aiSessionId),
      title: String(run.title ?? ""),
      status: String(run.status ?? ""),
      eventCursor: Number(run.eventSequence ?? 0),
      createdAt: run.createdAt instanceof Date ? run.createdAt.toISOString() : String(run.createdAt ?? ""),
      updatedAt: run.updatedAt instanceof Date ? run.updatedAt.toISOString() : String(run.updatedAt ?? ""),
    }));
  }

  /** C1 读取：Run snapshot（run + 当前 attempt + 最近检查点 + output）。 */
  async function getRunSnapshot(user: AuthUser, runId: string) {
    assertEnabled(deps);
    const snapshot = await repo.getRunSnapshot(runId);
    if (!snapshot || snapshot.run.ownerUserId !== user.id) throw new AiRunsNotFoundError("任务不存在");
    return snapshot;
  }

  /** C3 动作：cancel。active 返回 202，终态 409，非 owner 404。 */
  async function cancelRun(user: AuthUser, runId: string) {
    assertEnabled(deps);
    const run = await repo.findRunForOwner(runId, user.id);
    if (!run) throw new AiRunsNotFoundError("任务不存在");
    if (TERMINAL_STATUSES.includes(String(run.status))) {
      throw new AiRunsConflictError("RUN_ALREADY_TERMINAL", "任务已进入终态，无法取消");
    }
    const result = await repo.requestRunCancel({ runId, requestedBy: user.id });
    if (!result.changed) {
      throw new AiRunsConflictError("RUN_ALREADY_TERMINAL", "任务已进入终态，无法取消");
    }
    return { status: 202 as const, data: { runId, status: String(result.run.status ?? "cancelling") } };
  }

  /** C3 动作：inputs。waiting Run 收到补充信息后回到 queued 续跑。 */
  async function submitInputs(user: AuthUser, runId: string, body: { input?: unknown }) {
    assertEnabled(deps);
    const run = await repo.findRunForOwner(runId, user.id);
    if (!run) throw new AiRunsNotFoundError("任务不存在");
    if (!isPlainObject(body.input) || Object.keys(body.input).length === 0) {
      throw new AiRunsValidationError("input 必须是非空对象");
    }
    let result: { run: Record<string, unknown>; event: Record<string, unknown> };
    try {
      result = await repo.submitRunInput({ runId, input: body.input, requestedBy: user.id });
    } catch (err) {
      return mapRepoConflict(err);
    }
    return { status: 202 as const, data: { runId, status: String(result.run.status ?? "queued") } };
  }

  /** C3 动作：confirm 幂等确认闸门。首次 202，重放 200 且不重复事件。 */
  async function confirmAction(user: AuthUser, runId: string, actionId: unknown) {
    assertEnabled(deps);
    const run = await repo.findRunForOwner(runId, user.id);
    if (!run) throw new AiRunsNotFoundError("任务不存在");
    const actionKey = asText(actionId);
    if (!actionKey) throw new AiRunsValidationError("actionId 必填");
    let result: { created: boolean; run: Record<string, unknown>; event: Record<string, unknown> | null };
    try {
      result = await repo.confirmRunAction({ runId, actionId: actionKey, confirmedBy: user.id });
    } catch (err) {
      return mapRepoConflict(err);
    }
    return {
      status: result.created ? (202 as const) : (200 as const),
      data: { runId, actionId: actionKey, status: String(result.run.status ?? "") },
    };
  }

  /**
   * 批次 1a · C3 动作：reject（skip 档）。与 confirm 同为**幂等**且同样只认 waiting：
   * 决策一旦落库即随 Run 持久存在，worker 重启后仍有效（判据④）。
   * 请求体不接收工具参数——被拒的那一次调用以 tool.call.started 为唯一事实。
   */
  async function rejectAction(user: AuthUser, runId: string, actionId: unknown) {
    assertEnabled(deps);
    const run = await repo.findRunForOwner(runId, user.id);
    if (!run) throw new AiRunsNotFoundError("任务不存在");
    const actionKey = asText(actionId);
    if (!actionKey) throw new AiRunsValidationError("actionId 必填");
    let result: { created: boolean; run: Record<string, unknown>; event: Record<string, unknown> | null };
    try {
      result = await repo.rejectRunAction({ runId, actionId: actionKey, rejectedBy: user.id });
    } catch (err) {
      return mapRepoConflict(err);
    }
    return {
      status: result.created ? (202 as const) : (200 as const),
      data: { runId, actionId: actionKey, status: String(result.run.status ?? "") },
    };
  }

  /** C3 动作：retry。仅 failed 终态可重试；新 Run 带 retryOfRunId，原 Run 行零变更。 */
  async function retryRun(user: AuthUser, runId: string) {
    assertEnabled(deps);
    const run = await repo.findRunForOwner(runId, user.id);
    if (!run) throw new AiRunsNotFoundError("任务不存在");
    if (String(run.status) !== "failed") {
      throw new AiRunsConflictError("RUN_NOT_FAILED", "仅失败终态的任务可重试");
    }

    const metadata = isPlainObject(run.metadata)
      ? JSON.parse(JSON.stringify(run.metadata))
      : {};
    // clientMessageId 属于原次提交，重试是新提交，不继承乐观 UI 对齐键
    delete metadata.clientMessageId;

    const sessionId = run.aiSessionId === null || run.aiSessionId === undefined ? "" : String(run.aiSessionId);
    if (!sessionId) {
      // 无 Session 绑定的 Run（非 workbench 提交路径）不在本 API 重试范围
      throw new AiRunsConflictError("RUN_NOT_RETRYABLE", "任务未绑定会话，无法重试");
    }

    const retryExecutionConfig = isPlainObject(run.executionConfig)
      ? (JSON.parse(JSON.stringify(run.executionConfig)) as Record<string, unknown>)
      : {};

    // 批次 2b-2：重试是**新一轮会话消息**（新 Run、新来源键），信封必须重新 mint。
    // 原样复用克隆来的 conversationFact 会让两条用户消息共享同一个 messageId——
    // 那比今天「同正文重复两轮」（看板 BE-2026-09-08…:risks-5）更糟，重复会从
    // 「看得出来」变成「按 messageId 分不清」。附件身份同理：今天每次执行本就新造
    // att- id，重 mint 保持原行为不变。
    const retryAttachments = Array.isArray(retryExecutionConfig.attachments)
      ? (retryExecutionConfig.attachments as WorkbenchConversationAttachment[])
      : [];
    const { executionConfig: retryConfig, fact: retryFact } = attachWorkbenchConversationFact(
      retryExecutionConfig,
      retryAttachments,
    );
    const retryContent = asText(retryConfig.content);

    const created = await createRunOrThrow(() =>
      repo.createQueuedRun({
        ownerUserId: user.id,
        ownerUsername: user.username,
        aiSessionId: sessionId,
        submissionKey: randomUUID(),
        title: String(run.title ?? ""),
        workflowId: String(run.workflowId ?? WORKBENCH_WORKFLOW_ID),
        workflowVersion: String(run.workflowVersion ?? WORKBENCH_WORKFLOW_VERSION),
        executionConfig: retryConfig,
        metadata,
        retryOfRunId: runId,
        // 批次 2b-1：retry 提交的是**同一轮**用户正文，只可能在原 Run 的
        // executionConfig.content 里（与 submitRun 那份同源）。这里同样不读 title。
        userMessageFact: (runIdForFact) =>
          buildWorkbenchUserMessageFact({ runId: runIdForFact, fact: retryFact, content: retryContent }),
      }),
    );

    return {
      status: 202 as const,
      data: {
        runId: String(created.run.harnessRunId),
        sessionId: run.aiSessionId === null || run.aiSessionId === undefined ? null : String(run.aiSessionId),
        status: String(created.run.status ?? "queued"),
        retryOfRunId: runId,
      },
    };
  }

  /**
   * 批次 1b · 只读：按 run 取回工具痕迹事件，供界面在刷新后重建工具 chip。
   *
   * 架构裁决：痕迹的事实源是 harness_run_events，不往会话消息里复制第二份 ——
   * 副本会漂，且批次 2 要把历史表示整体换成事件序列，届时这份副本还得删。
   * owner 语义与其余 ai-runs 读端点逐字一致：非 owner 与不存在同为 404，不泄露存在性。
   */
  async function listRunToolEvents(user: AuthUser, runId: string) {
    assertEnabled(deps);
    const run = await repo.findRunForOwner(runId, user.id);
    if (!run) throw new AiRunsNotFoundError("任务不存在");
    const rows = await repo.listRunToolEvents({ runId });
    return {
      runId,
      items: (Array.isArray(rows) ? rows : []).map((row: Record<string, unknown>) => ({
        sequence: Number(row.sequence ?? 0),
        eventType: String(row.eventType ?? ""),
        payload: isPlainObject(row.payload) ? row.payload : {},
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? ""),
      })),
    };
  }

  return {
    submitRun,
    listActiveRuns,
    getRunSnapshot,
    listRunToolEvents,
    cancelRun,
    submitInputs,
    confirmAction,
    rejectAction,
    retryRun,
  };
}
