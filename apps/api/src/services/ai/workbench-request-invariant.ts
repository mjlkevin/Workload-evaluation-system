// ============================================================
// 批次 0 · ⑤ 弱请求重构不变量（workbench 异步 Run 通道）
// ============================================================
// 断言「本轮实际组装给模型的 messages」===「从当前 ai_sessions 存储可推导的 messages」。
//
// 为什么需要：DEF-2026-08-27-001 的根因不在模型侧，而在中间管道——历史在
// workflow → dispatch → modelChatStream 的透传中被丢掉/取早，模型于是答非所问，
// 而全链路没有任何一处会报错。类型系统查不出来（字段全是 optional），
// 单元测试查不出来（各层只断自己收到的参数）。本模块把「发送侧」与
// 「存储侧」两份推导在请求构造点当场对账，不一致即抛。
//
// 为什么是「弱」不变量：WES 暂无 Run 级事件日志，推导源是当前会话存储快照，
// 因此它只能保证「首问轮」的历史窗口一致；工具循环回填的 [工具结果] 消息
// 是发送侧合法的新增中间态，不在对账范围内（对账发生在循环之前）。
// 批次 2 的事件日志落地后，同一断言把推导源从 jsonb 换成事件流即可自动升级，
// 覆盖面扩到每一次模型调用。
//
// 口径为什么在本模块重写一遍而不是复用 buildWorkbenchChatModelInput：
// 复用会让断言与被断言对象同源、永真，失去发现缺陷的能力。这里是刻意保留的
// 第二实现（double implementation）——两处口径若漂移，断言当场红。
// ============================================================

import {
  WORKBENCH_MODEL_HISTORY_WINDOW,
  buildHomeMessageContentForModel,
  sessionRecordToHomeMessages,
} from "./handlers/workbench-shared";
import type { AiSessionRecord } from "../../modules/ai-sessions/ai-sessions.types";
import type { HomeMessageInput, WorkbenchModelMessage } from "./handlers/workbench-shared";

export class WorkbenchModelRequestInvariantError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`workbench model request invariant violated: ${reason}`);
    this.name = "WorkbenchModelRequestInvariantError";
    this.reason = reason;
  }
}

/**
 * 存储侧推导：已落库会话历史 + 本轮用户正文 → 本应发给模型的历史窗口（不含 system）。
 * 入参是原始会话记录，推导链与异步通道取历史时用的是同一个函数，
 * 但读取时机由调用方当场重取——不经 dispatch/modelChatStream 管道。
 */
export function deriveWorkbenchModelHistoryFromSession(params: {
  session: AiSessionRecord | null | undefined;
  userContent: string;
}): WorkbenchModelMessage[] {
  return shapeStoredHistory(sessionRecordToHomeMessages(params.session), params.userContent);
}

/** 同上，但入参已是整形前的会话历史（供测试与调用方自行取数）。 */
export function deriveWorkbenchModelHistoryFromStoredHistory(params: {
  storedHistory: HomeMessageInput[];
  userContent: string;
}): WorkbenchModelMessage[] {
  return shapeStoredHistory(params.storedHistory, params.userContent);
}

function shapeStoredHistory(storedHistory: HomeMessageInput[], userContent: string): WorkbenchModelMessage[] {
  const shaped: WorkbenchModelMessage[] = storedHistory
    .slice(-WORKBENCH_MODEL_HISTORY_WINDOW)
    .map((message) => ({ role: message.role, content: buildHomeMessageContentForModel(message) }));
  // 末条覆盖为本轮用户正文（非追加）；无历史时补推一条，避免模型只看到 system prompt。
  if (shaped.length > 0) shaped[shaped.length - 1] = { role: "user", content: userContent };
  else shaped.push({ role: "user", content: userContent });
  return shaped;
}

/**
 * 对账断言：`sent` 除 system 头之外的部分必须与存储侧推导逐条相等。
 *
 * 只暴露结构差异（长度/下标/角色/正文是否相同），不回传正文——工作台历史里
 * 是客户端需求原文，不得进错误消息、Run 失败原因或日志。
 */
export function assertWorkbenchModelRequestMatchesStorage(params: {
  sent: WorkbenchModelMessage[];
  session: AiSessionRecord | null | undefined;
  userContent: string;
}): void {
  const { sent } = params;
  if (sent.length === 0) {
    throw new WorkbenchModelRequestInvariantError("sent_messages_empty");
  }
  if (sent[0].role !== "system") {
    throw new WorkbenchModelRequestInvariantError("system_prompt_not_first");
  }
  const misplaced = sent.findIndex((message, index) => index > 0 && message.role === "system");
  if (misplaced !== -1) {
    throw new WorkbenchModelRequestInvariantError(`system_prompt_not_only_head: index=${misplaced}`);
  }

  const sentHistory = sent.slice(1);
  const expectedHistory = deriveWorkbenchModelHistoryFromSession(params);
  if (sentHistory.length !== expectedHistory.length) {
    throw new WorkbenchModelRequestInvariantError(
      `history_length_mismatch: sent=${sentHistory.length} expected=${expectedHistory.length}`,
    );
  }
  for (let index = 0; index < expectedHistory.length; index += 1) {
    const actual = sentHistory[index];
    const expected = expectedHistory[index];
    if (!actual) {
      throw new WorkbenchModelRequestInvariantError(`history_entry_missing: index=${index}`);
    }
    if (actual.role !== expected.role) {
      throw new WorkbenchModelRequestInvariantError(
        `history_role_mismatch: index=${index} sent=${actual.role} expected=${expected.role}`,
      );
    }
    if (actual.content !== expected.content) {
      throw new WorkbenchModelRequestInvariantError(`history_content_mismatch: index=${index}`);
    }
  }
}
