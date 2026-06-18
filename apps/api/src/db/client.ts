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
import { Pool, type PoolConfig, type PoolClient } from "pg";
import { config } from "../config/env";
import * as schema from "./schema";
import { dbQueryDurationSeconds } from "../metrics";

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

function wrapPoolForMetrics(rawPool: Pool): Pool {
  const originalQuery = rawPool.query.bind(rawPool);
  (rawPool as any).query = async function (...args: any[]) {
    const end = dbQueryDurationSeconds.startTimer();
    try {
      return await (originalQuery as any)(...args);
    } finally {
      end();
    }
  };

  // 注意：不覆盖 pool.connect，因为 pg Pool.query 内部使用基于回调的 connect，
  // 覆盖为 async function 会破坏 query。事务中的 client.query 暂不计入 metrics。

  return rawPool;
}

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    _pool = wrapPoolForMetrics(new Pool(resolvePoolConfig()));
  }
  return _pool;
}

/** 懒加载 Pool：首次访问时才初始化，避免模块加载时因缺少 DATABASE_URL 直接崩溃 */
export const pool = new Proxy({} as Pool, {
  get(_target, prop) {
    const p = getPool();
    const value = (p as any)[prop];
    return typeof value === "function" ? value.bind(p) : value;
  },
});

/** 懒加载 Drizzle db */
let _db: ReturnType<typeof drizzle> | null = null;
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    if (!_db) {
      _db = drizzle(getPool(), { schema });
    }
    const value = (_db as any)[prop];
    return typeof value === "function" ? value.bind(_db) : value;
  },
});

/** 应用退出前优雅关闭连接池（测试与优雅停机使用） */
export async function closeDb(): Promise<void> {
  await pool.end();
}

export type Database = typeof db;
