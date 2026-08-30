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

const UNPARSEABLE_TARGET = "<无法解析的连接串>";

function describeDbTarget(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  } catch {
    return UNPARSEABLE_TARGET;
  }
}

function targetsDiffer(a: string, b: string): boolean {
  const ta = describeDbTarget(a);
  const tb = describeDbTarget(b);
  // 两边都解析不了时退化为全文比较，避免占位值相等造成假通过
  if (ta === UNPARSEABLE_TARGET && tb === UNPARSEABLE_TARGET) return a !== b;
  return ta !== tb;
}

/**
 * 测试进程防误配守卫（DEF-2026-08-27-004）。
 *
 * 背景：经依赖注入（createXxxPgRepository(drizzle(testPool))）的用例天然指向测试库，
 * test-helpers/db.ts 也有硬编码回落；但走本模块默认 db 单例的写路径（getSystemRepository()
 * / getTraceRepository() 等无参装配）落的是 config.database.url。本地直接
 * `npm run test:xxx`（不显式指库）时它是 dotenv 从 .env 读到的开发库 workload_eval，
 * 测试夹具于是真实写进开发库（2026-08-30 S3 手工验证实录：system_configs
 * .knowledgeBaseConfig 被夹具覆写）。
 *
 * 口径：只在测试子进程生效（node:test 会给子进程注入 NODE_TEST_CONTEXT），生产启动
 * 路径零影响；CI 里 DATABASE_URL 与 TEST_DATABASE_URL 恒等且同指 workload_eval_test
 * （见 .github/workflows/ci.yml），守卫不触发，也不增加 CI 时长。
 *
 * 放在本模块而不是 test-setup.mts：config/env.ts 的 dotenv 在任何测试文件 import 时才
 * 执行，global setup 跑在其之前，那时 .env 里的 DATABASE_URL 还没进 process.env，
 * 在 setup 里检查会漏掉正是本次踩到的那种形态。
 */
function assertTestDatabaseConsistency(url: string): void {
  if (!process.env.NODE_TEST_CONTEXT) return;
  const testUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL_TEST;
  if (!testUrl) {
    throw new Error(
      `[db] 测试进程缺少 TEST_DATABASE_URL，但 DATABASE_URL 指${describeDbTarget(url)}：` +
        "默认 db 单例会把测试数据写进该库。正确做法：把 DATABASE_URL 与 TEST_DATABASE_URL " +
        "都指向同一个测试库（postgres://<user>@localhost:5432/workload_eval_test），" +
        "或设 USE_TESTCONTAINERS=true 由 test-setup.mts 自动拉起。",
    );
  }
  if (targetsDiffer(url, testUrl)) {
    throw new Error(
      `[db] 测试进程 DATABASE_URL（${describeDbTarget(url)}）与 TEST_DATABASE_URL` +
        `（${describeDbTarget(testUrl)}）指不同库：走默认 db 单例的用例会污染前者。` +
        "正确做法：两个变量都指同一个测试库（workload_eval_test）。",
    );
  }
}

function resolvePoolConfig(): PoolConfig {
  const url = config.database.url;
  if (!url) {
    throw new Error(
      "DATABASE_URL 未配置：请在 .env.local 设置 DATABASE_URL=postgres://user@host:5432/dbname",
    );
  }
  assertTestDatabaseConsistency(url);
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
