// ============================================================
// DB 时钟读取（阶段 2 跨域共享原语）
// ============================================================
// 口径（阶段 2 硬性范式 #4）：全部 PG 仓储的时间戳一律取自数据库时钟，
// 禁止 Date.now()/new Date() 落库——避免主机与数据库时钟偏差。
// 实现自 harness-runtime.repository.ts 的 readDbNow（批 1 提取为跨域共享，
// 供后续 8 个域的 PG 仓储复用；语义与原实现完全一致）。

import { sql } from "drizzle-orm";

/** 具备 execute 能力的 drizzle 实例（根 db 或事务 tx）。 */
export type DbExecutor = {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }>;
};

/** 读取数据库时钟，避免主机与 DB 时钟偏差导致时间比较漂移。 */
export async function readDbNow(executor: DbExecutor): Promise<Date> {
  const result = await executor.execute(sql`SELECT now() AS db_now`);
  const value = (result.rows as Array<{ db_now: Date | string }>)[0]?.db_now;
  return value instanceof Date ? value : new Date(value);
}
