// ============================================================
// AI Sessions 域 PG 仓储（阶段 2 批 3 · 第 1–3 步）
// ============================================================
// 五条硬性范式落实（批 1/批 2 基准，harness 同源）：
//  1. 错误边界：AiSessionsStoreError（稳定 code），每个公开方法 try/catch 后
//     经 toSafeError 收敛；pg/drizzle 原始错误（可能含 SQL 参数/连接串）不外泄。
//  2. 幂等：createSession 用 onConflictDoNothing().returning() + 空结果按主键
//     重查消歧。
//  3. 并发控制：rename/delete 为条件 UPDATE/DELETE ... RETURNING 行级原子操作；
//     appendSessionEvent 为条件 UPDATE 内 jsonb 数组拼接（行锁串行化，
//     同会话并发追加不丢失）；appendMessageIdempotent 事务内 SELECT FOR UPDATE
//     行锁 + 来源键查重。彻底消除 JSON 整存 RMW 的跨会话丢失更新
//     （并发写不同会话互不覆盖）。
//  4. 时间：一律 readDbNow(tx)（DB 时钟），禁止 Date.now() 落库。
//  5. ISS-2026-08-18-004：读取失败必须抛错，禁止返回空集合。
//
// 缓存策略：不加缓存层（与 users 域写穿缓存不同，架构侧 2026-08-19 指令
// 「不照搬全表填充」）。理由见 ai-sessions.repository.ts 文件头：会话数据宽
// 且变更频繁、读入口非全 API 热路径、聊天内容用户直接可见（陈旧=可见缺陷）、
// 全表填充放大内存与多副本分歧面。读路径直查，owner_idx / owner_updated_idx
// 索引支撑；多副本部署下天然强一致（每次读即最新提交值），无 users 域的
// 副本分歧问题。
//
// ============================================================
// 批次 2b-3 · 「取会话历史」换源
// ============================================================
// 本仓储交出去的每条 AiSessionRecord，其 `messages` 携带的是**解析后的**历史：
// 能被事件流对话事实完整覆盖的会话给重建结果，覆盖不住的整会话回落快照。
// 判定与全部口径在 session-history.ts，本文件只做两件事：
//  ① 把一次**批量**事实读取接在 row→record 之后（一批会话一次查询；架构侧
//     2026-09-11 硬要求：管理员审计是全表逐条 map，逐会话查即 N+1。实测次数由
//     conversation-event-history.test.ts 断言，并由对照脚本每次打印）；
//  ② 不碰写入侧——双写期 ai_sessions.messages 继续写，appendMessageIdempotent 的
//     来源键查重仍建立在裸快照之上（那是「恰好一次落库」的幂等防线，与本批无关）。
// 消费端一律经 deriveSessionMessages，因此它们看不见源在哪——这正是 2a 造缝买的东西。

import { and, eq, sql } from "drizzle-orm";

import { db, type Database } from "../../db/client";
import { readDbNow } from "../../db/now";
import { aiSessions } from "../../db/schema";
import { createConversationEventHistorySource } from "../harness/conversation-event-history";
import { applyEventStreamHistory, type SessionConversationFactSource } from "./session-history";
import type {
  AiAttachment,
  AiArtifact,
  AiMessage,
  AiPendingAction,
  AiSessionRecord,
} from "./ai-sessions.types";
import type {
  AppendAiSessionEventInput,
  AppendAiSessionMessageIdempotentInput,
  AppendAiSessionMessageIdempotentResult,
  AiSessionsStoreRepository,
  CreateAiSessionInput,
} from "./ai-sessions.repository";

// ============================================================
// 安全错误（范式 #1 / #5）
// ============================================================

export class AiSessionsStoreError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "AiSessionsStoreError";
    this.code = code;
  }
}

function toSafeError(err: unknown): AiSessionsStoreError {
  if (err instanceof AiSessionsStoreError) return err;
  return new AiSessionsStoreError("AI_SESSIONS_STORE_INTERNAL", "ai sessions store persistence failed");
}

// ============================================================
// 行 ↔ 记录映射（PG timestamptz → ISO 字符串契约）
// ============================================================

type AiSessionRow = typeof aiSessions.$inferSelect;

function toSessionRecord(row: AiSessionRow): AiSessionRecord {
  return {
    sessionId: row.sessionId,
    ownerUserId: row.ownerUserId,
    ownerUsername: row.ownerUsername,
    title: row.title,
    domain: row.domain as AiSessionRecord["domain"],
    workflowKey: row.workflowKey,
    businessRole: row.businessRole,
    status: row.status as AiSessionRecord["status"],
    summary: row.summary,
    messages: (row.messages ?? []) as AiMessage[],
    attachments: (row.attachments ?? []) as AiAttachment[],
    artifacts: (row.artifacts ?? []) as AiArtifact[],
    pendingActions: (row.pendingActions ?? []) as AiPendingAction[],
    linkedRecords: (row.linkedRecords ?? {}) as AiSessionRecord["linkedRecords"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.archivedAt ? { archivedAt: row.archivedAt.toISOString() } : {}),
  };
}

// ============================================================
// 工厂
// ============================================================

export interface AiSessionsPgRepository extends AiSessionsStoreRepository {
  /** 测试钩子：暴露注入的 db 实例供用例做行级清理 */
  __dbForTest(): Database;
}

/**
 * @param dbInstance 注入库实例（测试用），默认进程单例
 * @param historySource 对话事实批量读取口。**默认与 dbInstance 同源**——注入测试库时
 *   若仍用默认源（指向生产 db 单例），读回来的就是别的库的事实，逐字节对照当场失真。
 *   传 null 表示「不解析」（仅用于装配测试；生产路径不传）。
 */
export function createAiSessionsPgRepository(
  dbInstance: Database = db,
  historySource: SessionConversationFactSource | null = createConversationEventHistorySource(dbInstance),
): AiSessionsPgRepository {
  // 一批记录一次取事实（架构侧硬要求）。调用点全在各方法的 try 内，故读取失败同样
  // 收敛成 AiSessionsStoreError，不会静默退回快照（范式 #5：读取失败必须抛）。
  const resolve = (records: AiSessionRecord[]) => applyEventStreamHistory(records, historySource);
  return {
    __dbForTest() {
      return dbInstance;
    },

    async createSession(input: CreateAiSessionInput) {
      try {
        // 解析放在事务**之外**：入会话锁的时间不该被一次额外查询拉长
        const result = await dbInstance.transaction(async (tx) => {
          const now = input.now ?? (await readDbNow(tx));
          const session = input.session;
          const inserted = await tx
            .insert(aiSessions)
            .values({
              sessionId: session.sessionId,
              ownerUserId: session.ownerUserId,
              ownerUsername: session.ownerUsername,
              title: session.title,
              domain: session.domain,
              workflowKey: session.workflowKey,
              businessRole: session.businessRole,
              status: session.status,
              summary: session.summary,
              messages: session.messages ?? [],
              attachments: session.attachments ?? [],
              artifacts: session.artifacts ?? [],
              pendingActions: session.pendingActions ?? [],
              linkedRecords: session.linkedRecords ?? {},
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing()
            .returning();
          if (inserted.length > 0) {
            return { created: true, session: toSessionRecord(inserted[0]) };
          }
          // 幂等消歧：插入被跳过（sessionId 冲突）→ 重查返回原记录（范式 #2）
          const [byId] = await tx.select().from(aiSessions).where(eq(aiSessions.sessionId, session.sessionId));
          if (byId) {
            return { created: false, session: toSessionRecord(byId) };
          }
          throw new AiSessionsStoreError("AI_SESSIONS_STORE_INTERNAL", "ai session insert conflict unresolved");
        });
        return { created: result.created, session: (await resolve([result.session]))[0] };
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async listSessionsByOwner(ownerUserId) {
      try {
        const rows = await dbInstance.select().from(aiSessions).where(eq(aiSessions.ownerUserId, ownerUserId));
        // 整页一次解析 = 一次事实查询（工作台会话列表）
        return await resolve(rows.map(toSessionRecord));
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async listAllSessions() {
      try {
        const rows = await dbInstance.select().from(aiSessions);
        // 管理员审计走这条全表路：整表一次取事实，不得逐会话查（架构侧 2b-3 硬要求）
        return await resolve(rows.map(toSessionRecord));
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async findSession(input) {
      try {
        const [row] = await dbInstance
          .select()
          .from(aiSessions)
          .where(and(eq(aiSessions.sessionId, input.sessionId), eq(aiSessions.ownerUserId, input.ownerUserId)));
        if (!row) return null;
        const [resolved] = await resolve([toSessionRecord(row)]);
        return resolved;
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async renameSession(input) {
      try {
        const renamed = await dbInstance.transaction(async (tx) => {
          const now = await readDbNow(tx);
          const rows = await tx
            .update(aiSessions)
            .set({ title: input.title, updatedAt: now })
            .where(and(eq(aiSessions.sessionId, input.sessionId), eq(aiSessions.ownerUserId, input.ownerUserId)))
            .returning();
          return rows.length > 0 ? toSessionRecord(rows[0]) : null;
        });
        if (!renamed) return null;
        const [resolved] = await resolve([renamed]);
        return resolved;
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async deleteSession(input) {
      try {
        const rows = await dbInstance
          .delete(aiSessions)
          .where(and(eq(aiSessions.sessionId, input.sessionId), eq(aiSessions.ownerUserId, input.ownerUserId)))
          .returning({ sessionId: aiSessions.sessionId });
        return rows.length > 0;
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async appendSessionEvent(input: AppendAiSessionEventInput) {
      try {
        const appended = await dbInstance.transaction(async (tx) => {
          const now = await readDbNow(tx);
          // 单语句条件 UPDATE：jsonb 数组拼接在行锁内串行化，
          // 同会话并发追加互不覆盖（范式 #3，消灭整存 RMW 窗口）
          const rows = await tx
            .update(aiSessions)
            .set({
              messages: sql`${aiSessions.messages} || ${JSON.stringify(input.messages ?? [])}::jsonb`,
              attachments: sql`${aiSessions.attachments} || ${JSON.stringify(input.attachments ?? [])}::jsonb`,
              artifacts: sql`${aiSessions.artifacts} || ${JSON.stringify(input.artifacts ?? [])}::jsonb`,
              pendingActions: sql`${aiSessions.pendingActions} || ${JSON.stringify(input.pendingActions ?? [])}::jsonb`,
              updatedAt: now,
            })
            .where(and(eq(aiSessions.sessionId, input.sessionId), eq(aiSessions.ownerUserId, input.ownerUserId)))
            .returning();
          return rows.length > 0 ? toSessionRecord(rows[0]) : null;
        });
        // 这条回读记录既是同步通道算「进行中工具交互」判据的入参，又直接进 HTTP 响应
        // 给前端渲染。同步通道不产对话事件（无 runId 可写），所以刚追加的这一轮在事件流里
        // 结构性不存在——覆盖判定会因此整会话回落快照，把这一轮原样带回去。
        // 若这里不解析（或改用「有没有事件」的存在性判据），用户就会在响应里看不见自己
        // 刚说过的话：见 session-history.ts 口径 ② 与看板 BE-2026-09-08…:risks-1。
        if (!appended) return null;
        const [resolved] = await resolve([appended]);
        return resolved;
      } catch (err) {
        throw toSafeError(err);
      }
    },

    /**
     * RP-047 Batch B 幂等投影追加（PG 版）：事务内行锁 + 来源键查重。
     * 并发重放同一 deduplicationKey 时行锁串行化，恰好一条 created=true。
     *
     * 批次 2b-3 换源**刻意不接进本方法**：这是写入与幂等查重路径，它读的是裸快照
     * （`row.messages`）并按 `metadata.projectionSource.deduplicationKey` 查重。
     * 让「恰好一次落库」的防线去依赖读取源，等于把写入正确性挂在另一条线的解析结果上。
     */
    async appendMessageIdempotent(
      input: AppendAiSessionMessageIdempotentInput,
    ): Promise<AppendAiSessionMessageIdempotentResult> {
      try {
        return await dbInstance.transaction(async (tx) => {
          const now = await readDbNow(tx);
          const rows = await tx
            .select()
            .from(aiSessions)
            .where(eq(aiSessions.sessionId, input.sessionId))
            .for("update");
          const row = rows[0];
          if (!row) {
            return { found: false, created: false, message: input.message };
          }
          const messages = (row.messages ?? []) as AiMessage[];
          const existing = messages.find(
            (item) =>
              (item.metadata as { projectionSource?: { deduplicationKey?: string } } | undefined)?.projectionSource
                ?.deduplicationKey === input.source.deduplicationKey,
          );
          if (existing) {
            return { found: true, created: false, message: existing };
          }
          const stored: AiMessage = {
            ...input.message,
            metadata: { ...(input.message.metadata ?? {}), projectionSource: input.source },
          };
          const attachments = [...((row.attachments ?? []) as AiAttachment[])];
          for (const attachment of input.attachments ?? []) {
            if (!attachments.some((item) => item.attachmentId === attachment.attachmentId)) {
              attachments.push(attachment);
            }
          }
          await tx
            .update(aiSessions)
            .set({ messages: [...messages, stored], attachments, updatedAt: now })
            .where(eq(aiSessions.sessionId, input.sessionId));
          return { found: true, created: true, message: stored };
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },
  };
}
