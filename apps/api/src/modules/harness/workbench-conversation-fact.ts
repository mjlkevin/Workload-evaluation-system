// ============================================================
// 批次 2b-2 · 对话事件的「完整消息信封」单一约定持有者
// ============================================================
// 2b-1 让事件流里有了 `user/message` / `assistant/message`，但载荷只有 `{ content }`。
// 而会话侧那条消息是一个信封：实取开发库 48 条消息里 messageId 48 条、createdAt 48 条、
// metadata 44 条、attachmentIds 27 条（见总看板 risks 页 BE-2026-09-11 登记）。
// 换读取源（2b-3）时若从 `{content}` 重建历史，messageId 与 createdAt 无处可取，
// metadata 里的 toolCalls（进行中工具交互判据）与 attachmentIds（附件解析上下文）会整块丢失
// ——那正是本条线最怕的「历史静默少几条」，只是它少的是字段而不是条数。
//
// 所以本模块把「一封对话消息由哪些字段构成、在哪一刻生成」收在一处，使
// **事件载荷 ≡ ai_sessions.messages 里那条消息**由构造成立，而不是靠两处各自抄一遍。
//
// 关键取舍（架构侧 2026-09-11 裁决 ②，三条都不要动）：
//  ① **信封在提交时刻 mint，随 executionConfig 持久化**，workflow 执行时复用而不自造。
//     这样 `user/message` 仍留在入队事务内（保住 2b-1 的「正文与 Run 同轨、超限整体回滚
//     并映射 422」——那是唯一能保证「会话有这条消息而事件没有」不发生的位置）。
//     代价：用户消息的 createdAt 语义由「worker 执行时刻」变成「提交时刻」。已登记为风险。
//  ② **projectionSource 进载荷**。它不是纯簿记：`ai-sessions-pg.repository.ts:252` 靠它
//     识别重放，是「恰好一次落库」的幂等防线。2b-3 之后事件流就是事实源，一份即将成为
//     权威记录的载荷必须自带全部字段，不留「除某键之外」的例外口子。
//  ③ **仓储不知道投影约定**：createQueuedRun 收到的是一个 `runId => 载荷` 的构造函数，
//     它只负责序列化。runId 在入队事务内才 mint，约定却属于 workbench 层——构造参数是
//     让约定留在它 belong 的地方的最小办法，不是把形状复制进仓储。
// ============================================================

import { randomUUID } from "node:crypto";
import type { AiAttachment, AiMessage } from "../ai-sessions/ai-sessions.types";
import type { AiSessionProjectionSource } from "../ai-sessions/ai-sessions.repository";

/** `executionConfig` 里承载本轮信封的键（workflow 与提交侧唯一的握手点）。 */
export const WORKBENCH_CONVERSATION_FACT_KEY = "conversationFact";

/** 本轮用户消息的身份字段。content 刻意不在这里——它已有唯一来源 `executionConfig.content`。 */
export type WorkbenchUserMessageIdentity = {
  messageId: string;
  createdAt: string;
};

export type WorkbenchConversationFact = {
  userMessage: WorkbenchUserMessageIdentity;
  /** 本轮要落进会话 `attachments` 的那批，身份（attachmentId / createdAt）同在提交时刻 mint。 */
  attachments: AiAttachment[];
};

/**
 * 与 workbench-shared 的 HomeAttachmentInput 同形，但不 import 它：本模块只认**已归一化**
 * 的输入（提交侧的 normalizeRunAttachments 才是校验点）。导出它供调用方标注，
 * 免得各自用 `Parameters<typeof mint…>[0]["attachments"]` 反推。
 */
export type WorkbenchConversationAttachment = { name: string; size?: number; type?: string; parsedSummary?: string };

/**
 * 提交时刻一次 mint 出本轮的身份字段。
 * `content` 刻意不在参数里——它的唯一来源是 `executionConfig.content`，信封再带一份
 * 就会出现「两个正文」，两边不一致时没人知道该信谁。
 */
export function mintWorkbenchConversationFact(params: {
  attachments: readonly WorkbenchConversationAttachment[];
}): WorkbenchConversationFact {
  const createdAt = new Date().toISOString();
  return {
    userMessage: { messageId: `msg-${randomUUID()}`, createdAt },
    attachments: params.attachments.map((attachment) => ({
      attachmentId: `att-${randomUUID()}`,
      ...attachment,
      createdAt,
    })),
  };
}

export type AttachedWorkbenchConversationFact = {
  executionConfig: Record<string, unknown>;
  fact: WorkbenchConversationFact;
};

/**
 * 提交侧一步到位：mint 本轮信封并写进 executionConfig。
 *
 * 生产入口（submitRun / retryRun）与测试夹具**共用本函数**——夹具若自己拼一份
 * `{ conversationFact: {...} }`，就有机会拼出生产不会产生的形状，那正是
 * 「测过了但线上不对」的老形态。
 */
export function attachWorkbenchConversationFact(
  executionConfig: Record<string, unknown>,
  attachments: readonly WorkbenchConversationAttachment[] = [],
): AttachedWorkbenchConversationFact {
  const fact = mintWorkbenchConversationFact({ attachments });
  return {
    executionConfig: { ...executionConfig, [WORKBENCH_CONVERSATION_FACT_KEY]: fact },
    fact,
  };
}

/**
 * 读回提交侧 mint 的信封。缺失或形状不对**当场抛**，不回落「自己 mint 一份」：
 * 两条生成路径等于把同一个字段放回两处各写一遍，本模块的存在理由就是消灭它。
 * 实取开发库非终态 Run 为 0 条，故显式失败不会打断任何在途对话。
 */
export function readWorkbenchConversationFact(executionConfig: Record<string, unknown>): WorkbenchConversationFact {
  const raw = executionConfig?.[WORKBENCH_CONVERSATION_FACT_KEY];
  if (!isPlainObject(raw)) {
    throw new Error(`executionConfig.${WORKBENCH_CONVERSATION_FACT_KEY} is required for workbench chat`);
  }
  const userMessage = isPlainObject(raw.userMessage) ? raw.userMessage : {};
  const messageId = typeof userMessage.messageId === "string" ? userMessage.messageId : "";
  const createdAt = typeof userMessage.createdAt === "string" ? userMessage.createdAt : "";
  if (!messageId || !createdAt) {
    throw new Error(`executionConfig.${WORKBENCH_CONVERSATION_FACT_KEY}.userMessage requires messageId and createdAt`);
  }
  if (!Array.isArray(raw.attachments)) {
    throw new Error(`executionConfig.${WORKBENCH_CONVERSATION_FACT_KEY}.attachments must be an array`);
  }
  return {
    userMessage: { messageId, createdAt },
    attachments: raw.attachments as AiAttachment[],
  };
}

/** 用户轮次的来源键：`${runId}:user:1`，与会话侧查重键同一构造（workflow 落库时也用它）。 */
export function workbenchUserProjectionSource(runId: string): AiSessionProjectionSource {
  return { deduplicationKey: `${runId}:user:1`, runId, eventType: "user_message" };
}

/** 助手轮次的来源键：`${runId}:assistant:1`。 */
export function workbenchAssistantProjectionSource(runId: string): AiSessionProjectionSource {
  return { deduplicationKey: `${runId}:assistant:1`, runId, eventType: "assistant_message" };
}

/**
 * 会话仓储落库时补 projectionSource 的同一表达式（`ai-sessions-pg.repository.ts:258-261`：
 * `{...input.message, metadata: {...(input.message.metadata ?? {}), projectionSource: input.source}}`）。
 * 事件载荷经此函数得到与会话侧**同一形状**的那一份——两侧共用一个表达式，才谈得上逐字节。
 */
export function withWorkbenchProjectionSource(
  message: Partial<AiMessage>,
  source: AiSessionProjectionSource,
): AiMessage {
  return {
    ...message,
    metadata: { ...(message.metadata ?? {}), projectionSource: source },
  } as AiMessage;
}

/**
 * 本轮用户消息「落到会话前」的那一份（不含 projectionSource）——交给 appendSessionMessage，
 * 由会话仓储补上来源键；同一份加同一来源键即等于事件载荷。
 * `attachmentIds` 恒在（无附件时为空数组），沿用 workflow 既有口径，不因附件有无改变形状。
 */
export function composeWorkbenchUserMessage(params: {
  fact: WorkbenchConversationFact;
  content: string;
}): Pick<AiMessage, "messageId" | "role" | "content" | "createdAt" | "attachmentIds"> {
  return {
    messageId: params.fact.userMessage.messageId,
    role: "user",
    content: params.content,
    createdAt: params.fact.userMessage.createdAt,
    attachmentIds: params.fact.attachments.map((attachment) => attachment.attachmentId),
  };
}

/** 本轮用户消息的事件载荷：与会话里那条逐字段相同的完整信封。 */
export function buildWorkbenchUserMessageFact(params: {
  runId: string;
  fact: WorkbenchConversationFact;
  content: string;
}): Record<string, unknown> {
  return withWorkbenchProjectionSource(
    composeWorkbenchUserMessage(params),
    workbenchUserProjectionSource(params.runId),
  );
}

/**
 * 本轮助手消息的信封。`messageId` / `createdAt` 在**答复定稿时刻** mint（与用户侧
 * 在提交时刻 mint 不同——那时还没有答复可承载），metadata 由调用方按既有落库口径组装，
 * 本函数只保证「一条 AiMessage 长什么样」。
 *
 * mint 出的这份必须随 execute 返回值进入 effect output：恢复重放跳过 execute，
 * 只有从持久化 output 读回同一份，会话侧那条消息才与事件载荷同 id。
 */
export function mintWorkbenchAssistantMessage(params: {
  content: string;
  metadata: Record<string, unknown>;
}): AiMessage {
  return {
    messageId: `msg-${randomUUID()}`,
    role: "assistant",
    content: params.content,
    createdAt: new Date().toISOString(),
    metadata: params.metadata,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
