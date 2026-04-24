// ============================================================
// 数据库客户端 - PG + Drizzle
// ============================================================
// 本模块导出全局单例 `db` 供 repository 层使用，以及底层 Pool
// 供需要自定义查询或显式事务的场景。
//
// 设计要点：
//  1. 连接字符串来自 config.database.url，单一真理来源
//  2. Pool 是进程级单例，避免在每个请求里新建连接
//  3. Drizzle 层不做任何业务逻辑，仅提供类型安全的查询入口

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import { config } from "../config/env";
import * as schema from "./schema";

function resolvePoolConfig(): PoolConfig {
  const url = config.database.url;
  if (!url) {
    throw new Error(
      "DATABASE_URL 未配置：请在 .env.local 设置 DATABASE_URL=postgres://user@host:5432/dbname",
    );
  }
  return {
    connectionString: url,
    max: config.database.poolMax,
    // PG 18 默认关闭 idle 连接即可，这里保持默认
  };
}

export const pool = new Pool(resolvePoolConfig());

export const db = drizzle(pool, { schema });

/** 应用退出前优雅关闭连接池（测试与优雅停机使用） */
export async function closeDb(): Promise<void> {
  await pool.end();
}

export type Database = typeof db;
