// ============================================================
// CollabMessage Service — 协同消息业务层
// ============================================================
// P2-1 核心服务：结构化质询-回复，替代群聊沟通。
// 质询-回复自动沉淀为证据链（evidenceId 关联）。

import { randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import { collabMessages } from "../../db/schema";
import type { CollabMessageRow, CollabMessageInsert } from "../../db/schema";

export interface CreateMessageInput {
  workspaceId: string;
  messageType: "question" | "reply" | "decision" | "notice";
  parentMessageId?: string;
  senderUserId?: string;
  senderRole?: string;
  content: string;
  relatedFieldPath?: string;
  decisionPayload?: Record<string, unknown>;
}

export interface UpdateMessageInput {
  content?: string;
  status?: "open" | "resolved" | "closed";
  evidenceId?: string;
  decisionPayload?: Record<string, unknown>;
}

export class CollabMessageService {
  constructor(private dbInstance: Database = db) {}

  async create(input: CreateMessageInput): Promise<CollabMessageRow> {
    const [row] = await this.dbInstance
      .insert(collabMessages)
      .values({
        messageId: randomUUID(),
        workspaceId: input.workspaceId,
        messageType: input.messageType,
        parentMessageId: input.parentMessageId,
        senderUserId: input.senderUserId,
        senderRole: input.senderRole,
        content: input.content,
        relatedFieldPath: input.relatedFieldPath,
        decisionPayload: input.decisionPayload,
        status: input.messageType === "question" ? "open" : "resolved",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CollabMessageInsert)
      .returning();
    return row;
  }

  async findById(id: string): Promise<CollabMessageRow | null> {
    const [row] = await this.dbInstance
      .select()
      .from(collabMessages)
      .where(eq(collabMessages.messageId, id));
    return row ?? null;
  }

  async listByWorkspace(workspaceId: string, options?: { messageType?: string; status?: string; parentMessageId?: string | null }): Promise<CollabMessageRow[]> {
    const conds = [eq(collabMessages.workspaceId, workspaceId)];
    if (options?.messageType) {
      // @ts-expect-error dynamic enum filter
      conds.push(eq(collabMessages.messageType, options.messageType));
    }
    if (options?.status) {
      // @ts-expect-error dynamic enum filter
      conds.push(eq(collabMessages.status, options.status));
    }
    if (options?.parentMessageId !== undefined) {
      if (options.parentMessageId === null) {
        // 顶层消息（无 parent）
        // drizzle-orm 不支持直接 isNull 在 jsonb/UUID 上，用 raw 或简化处理
        // 这里简化：返回全部，前端过滤
      } else {
        conds.push(eq(collabMessages.parentMessageId, options.parentMessageId));
      }
    }
    return this.dbInstance
      .select()
      .from(collabMessages)
      .where(and(...conds))
      .orderBy(desc(collabMessages.createdAt));
  }

  /** 获取质询-回复线程 */
  async getThread(questionId: string): Promise<CollabMessageRow[]> {
    const question = await this.findById(questionId);
    if (!question) return [];

    const replies = await this.dbInstance
      .select()
      .from(collabMessages)
      .where(eq(collabMessages.parentMessageId, questionId))
      .orderBy(desc(collabMessages.createdAt));

    return [question, ...replies];
  }

  /** 统计工作区未解决的质询数 */
  async countOpenQuestions(workspaceId: string): Promise<number> {
    const rows = await this.dbInstance
      .select()
      .from(collabMessages)
      .where(
        and(
          eq(collabMessages.workspaceId, workspaceId),
          eq(collabMessages.messageType, "question"),
          eq(collabMessages.status, "open"),
        ),
      );
    return rows.length;
  }

  async update(id: string, input: UpdateMessageInput): Promise<CollabMessageRow | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const set: Partial<CollabMessageInsert> = { updatedAt: new Date() };
    if (input.content !== undefined) set.content = input.content;
    if (input.status !== undefined) set.status = input.status;
    if (input.evidenceId !== undefined) set.evidenceId = input.evidenceId;
    if (input.decisionPayload !== undefined) set.decisionPayload = input.decisionPayload;

    const [row] = await this.dbInstance
      .update(collabMessages)
      .set(set)
      .where(eq(collabMessages.messageId, id))
      .returning();
    return row;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.dbInstance
      .delete(collabMessages)
      .where(eq(collabMessages.messageId, id))
      .returning();
    return result.length > 0;
  }
}

export const collabMessageService = new CollabMessageService();
