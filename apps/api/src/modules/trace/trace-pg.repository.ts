// ============================================================
// Trace 域 PG 仓储（阶段 2 批 5 · 第 1–3 步）
// ============================================================
// 五条硬性范式落实（批 1/2/3/4 基准）：
//  1. 错误边界：TraceStoreError（稳定 code TRACE_STORE_INTERNAL），每个公开
//     方法 try/catch 后经 toSafeError 收敛；pg/drizzle 原始错误（可能含
//     SQL 参数/连接串）不外泄。
//  2. 幂等：insertTrace 用 onConflictDoNothing().returning() + 空结果按主键
//     重查消歧（同 traceId 重放返回原记录）。
//  3. 并发控制：insert/update/purge 均为单语句行级原子写；updateTraceRecord
//     事务内 SELECT FOR UPDATE 行锁串行化，同 trace 并发 patch 不撕裂
//     （JSON 侧整存 RMW 的跨 trace 丢失更新在此彻底消除——并发写不同
//     trace 互不覆盖）。
//  4. 时间：一律 readDbNow(tx)（DB 时钟），禁止 Date.now() 落库。
//  5. ISS-2026-08-18-004：读取失败必须抛错；缺行返回 null ≠ 失败。
//
// 缓存策略：不加缓存层。理由：①traces 是观测数据，写多读少（仅工作台
// 链路页按需查询，非全 API 热路径）；②单条体积大（spans jsonb 随链路
// 增长），全表填充内存代价高；③无「每请求必查」压力，亚毫秒直查成本
// 可忽略（owner/source/created 三索引支撑）；④多副本部署下天然强一致。
// 带外 SQL 写入立即可见由测试用例证明（无 TTL 滞后窗口）。

import { and, asc, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { db, type Database } from "../../db/client";
import { readDbNow } from "../../db/now";
import { traces } from "../../db/schema";
import type { TraceQueryFilter, TraceQueryResult, TraceRecord } from "./trace.types";

// ============================================================
// 安全错误（范式 #1 / #5）
// ============================================================

export class TraceStoreError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "TraceStoreError";
    this.code = code;
  }
}

function toSafeError(err: unknown): TraceStoreError {
  if (err instanceof TraceStoreError) return err;
  return new TraceStoreError("TRACE_STORE_INTERNAL", "trace store persistence failed");
}

// ============================================================
// 行 ↔ 记录映射（PG timestamptz → ISO 字符串契约）
// ============================================================

type TraceRow = typeof traces.$inferSelect;

function toTraceRecord(row: TraceRow): TraceRecord {
  return {
    traceId: row.traceId,
    ...(row.requestId ? { requestId: row.requestId } : {}),
    sourceDomain: row.sourceDomain as TraceRecord["sourceDomain"],
    ...(row.sourceId ? { sourceId: row.sourceId } : {}),
    ownerUserId: row.ownerUserId,
    ownerUsername: row.ownerUsername,
    ...(row.userInputSummary ? { userInputSummary: row.userInputSummary } : {}),
    ...(row.intentResult ? { intentResult: row.intentResult as TraceRecord["intentResult"] } : {}),
    spans: (row.spans ?? []) as TraceRecord["spans"],
    summary: row.summary as TraceRecord["summary"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ============================================================
// 仓储接口（JSON / PG 双实现共用）
// ============================================================

export interface TraceStoreRepository {
  /** 幂等插入：同 traceId 冲突重放返回原记录（范式 #2） */
  insertTrace(record: TraceRecord): Promise<TraceRecord>;
  /** 行级 patch 更新：存在返回更新后记录；不存在返回 null */
  updateTraceRecord(traceId: string, patch: Partial<TraceRecord>): Promise<TraceRecord | null>;
  findTraceById(traceId: string): Promise<TraceRecord | null>;
  queryTraces(filter: TraceQueryFilter): Promise<TraceQueryResult>;
  listTracesForOwner(ownerUserId: string, opts?: { limit?: number; offset?: number }): Promise<TraceRecord[]>;
  /** retention 清理：删除 createdAt < cutoff 的行，返回删除数 */
  purgeOlderThan(isoDate: string): Promise<number>;
}

// ============================================================
// 工厂
// ============================================================

export interface TracePgRepository extends TraceStoreRepository {
  /** 测试钩子：暴露注入的 db 实例供用例做行级清理/确定性插入 */
  __dbForTest(): Database;
}

export function createTracePgRepository(dbInstance: Database = db): TracePgRepository {
  return {
    __dbForTest() {
      return dbInstance;
    },

    async insertTrace(record: TraceRecord) {
      try {
        return await dbInstance.transaction(async (tx) => {
          const now = await readDbNow(tx);
          const inserted = await tx
            .insert(traces)
            .values({
              traceId: record.traceId,
              requestId: record.requestId ?? null,
              sourceDomain: record.sourceDomain,
              sourceId: record.sourceId ?? null,
              ownerUserId: record.ownerUserId,
              ownerUsername: record.ownerUsername,
              userInputSummary: record.userInputSummary ?? null,
              intentResult: record.intentResult ?? null,
              spans: record.spans ?? [],
              summary: record.summary,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing()
            .returning();
          if (inserted.length > 0) {
            return toTraceRecord(inserted[0]);
          }
          // 幂等消歧：插入被跳过（traceId 冲突）→ 重查返回原记录（范式 #2）
          const [byId] = await tx.select().from(traces).where(eq(traces.traceId, record.traceId));
          if (byId) {
            return toTraceRecord(byId);
          }
          throw new TraceStoreError("TRACE_STORE_INTERNAL", "trace insert conflict unresolved");
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async updateTraceRecord(traceId: string, patch: Partial<TraceRecord>) {
      try {
        return await dbInstance.transaction(async (tx) => {
          const now = await readDbNow(tx);
          // 行锁串行化：同 trace 并发 patch 不撕裂（范式 #3）
          const rows = await tx.select().from(traces).where(eq(traces.traceId, traceId)).for("update");
          const row = rows[0];
          if (!row) return null;
          const current = toTraceRecord(row);
          const merged: TraceRecord = { ...current, ...patch, updatedAt: now.toISOString() };
          const [updated] = await tx
            .update(traces)
            .set({
              requestId: merged.requestId ?? null,
              sourceDomain: merged.sourceDomain,
              sourceId: merged.sourceId ?? null,
              ownerUserId: merged.ownerUserId,
              ownerUsername: merged.ownerUsername,
              userInputSummary: merged.userInputSummary ?? null,
              intentResult: merged.intentResult ?? null,
              spans: merged.spans,
              summary: merged.summary,
              updatedAt: now,
            })
            .where(eq(traces.traceId, traceId))
            .returning();
          return updated ? toTraceRecord(updated) : null;
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async findTraceById(traceId: string) {
      try {
        const [row] = await dbInstance.select().from(traces).where(eq(traces.traceId, traceId));
        return row ? toTraceRecord(row) : null;
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async queryTraces(filter: TraceQueryFilter) {
      try {
        const limit = filter.limit ?? 20;
        const offset = filter.offset ?? 0;
        const conditions: SQL[] = [];
        // ownerUserId 为空字符串时跳过 owner 过滤（admin 查全量场景）
        if (filter.ownerUserId) conditions.push(eq(traces.ownerUserId, filter.ownerUserId));
        if (filter.sourceDomain) conditions.push(eq(traces.sourceDomain, filter.sourceDomain));
        if (filter.sourceId) conditions.push(eq(traces.sourceId, filter.sourceId));
        if (filter.traceId) conditions.push(eq(traces.traceId, filter.traceId));
        if (filter.hasError === true) conditions.push(sql`(${traces.summary} ->> 'hasError') = 'true'`);
        if (filter.hasDegradation === true) conditions.push(sql`(${traces.summary} ->> 'hasDegradation') = 'true'`);
        if (filter.fromIso) conditions.push(gte(traces.createdAt, new Date(filter.fromIso)));
        if (filter.toIso) conditions.push(lte(traces.createdAt, new Date(filter.toIso)));
        if (filter.spanType) {
          // jsonb 包含语义：spans 数组中存在元素含该 spanType
          conditions.push(sql`${traces.spans} @> ${JSON.stringify([{ spanType: filter.spanType }])}::jsonb`);
        }
        const where = conditions.length > 0 ? and(...conditions) : undefined;

        const [totalRow] = await dbInstance.select({ value: count() }).from(traces).where(where);
        const total = Number(totalRow?.value ?? 0);

        const rows = await dbInstance
          .select()
          .from(traces)
          .where(where)
          .orderBy(desc(traces.createdAt), asc(traces.traceId))
          .limit(limit)
          .offset(offset);

        return { traces: rows.map(toTraceRecord), total, limit, offset };
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async listTracesForOwner(ownerUserId: string, opts?: { limit?: number; offset?: number }) {
      const result = await this.queryTraces({ ownerUserId, ...opts });
      return result.traces;
    },

    async purgeOlderThan(isoDate: string) {
      try {
        const cutoff = new Date(isoDate);
        const removed = await dbInstance
          .delete(traces)
          .where(ltCreatedAt(cutoff))
          .returning({ traceId: traces.traceId });
        return removed.length;
      } catch (err) {
        throw toSafeError(err);
      }
    },
  };
}

/** createdAt < cutoff（保留 >= cutoff 的行，与 JSON filter 语义一致） */
function ltCreatedAt(cutoff: Date): SQL {
  return sql`${traces.createdAt} < ${cutoff}`;
}
