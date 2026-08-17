// ============================================================
// 数据库迁移执行器
// ============================================================
// 运行方式：
//   npm run db:migrate -w apps/api          # 对 DATABASE_URL 执行（CLI 在 migrate.cli.ts）
//   DATABASE_URL=... npm run db:migrate ... # 覆盖目标库（测试库）
//
// 本脚本只做一件事：对目标库应用 drizzle/ 目录下的全部 pending migration。
// 不做任何业务校验，保持幂等（drizzle 自带 `__drizzle_migrations` 表追踪）。
//
// 多副本并发保护（D13 决策，2026-08-17）：
//   drizzle 的 migrate() 无迁移锁——pg-core/dialect.js 的 migrate 实现只读
//   `__drizzle_migrations` 表决定待执行清单，并发副本会同时读到相同基线并重复
//   执行 DDL（重复 CREATE TABLE 竞争）。因此本模块在应用迁移前先获取
//   PG advisory lock（session 级，连接断开自动释放，无死锁残留风险），
//   串行化全部副本；后续副本获得锁时清单已更新，自然 no-op。
//   选择理由与备选方案对比见计划文档 §5 D13。

import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client";

/** 固定 lock key：'WESMIGR' 的任意固定值，与业务 advisory lock 空间隔离 */
const MIGRATION_LOCK_KEY = "1464226561";

/**
 * 应用 drizzle 迁移（带 advisory lock 串行化）。
 * main.ts 启动路径与 db:migrate CLI 共用同一入口，保证任何执行方都先取锁。
 */
export async function runMigrations(migrationsFolder?: string): Promise<void> {
  const folder = migrationsFolder ?? path.resolve(__dirname, "../../drizzle");
  console.log(`[db:migrate] applying migrations from ${folder}`);
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [MIGRATION_LOCK_KEY]);
    await migrate(db, { migrationsFolder: folder });
  } finally {
    await client.query("SELECT pg_advisory_unlock($1::bigint)", [MIGRATION_LOCK_KEY]);
    client.release();
  }
  console.log(`[db:migrate] done`);
}
