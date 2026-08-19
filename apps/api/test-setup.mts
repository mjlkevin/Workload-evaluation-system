// ============================================================
// 测试全局 setup - testcontainers 支持
// ============================================================
// 通过 node:test --test-global-setup 引入。
// 当 USE_TESTCONTAINERS=true 或 CI=true 时，自动拉起 PostgreSQL container，
// 设置 TEST_DATABASE_URL，并执行 drizzle migration。
//
// 清理：通过 process.on('beforeExit') 在测试全部结束后自动 stop container。

import { fileURLToPath } from "node:url";
import { globalAgent } from "node:http";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

// supertest/superagent 默认复用进程级 globalAgent 的 keep-alive 连接；
// server.close() 会半关闭池中连接，下一个测试文件复用即报
// ECONNRESET「socket hang up」（间歇性）。禁用 keep-alive 让每个
// 请求使用全新连接，消除跨文件半死连接复用。
(globalAgent as unknown as { keepAlive?: boolean }).keepAlive = false;


const USE_TC = (process.env.USE_TESTCONTAINERS === "true" || process.env.CI === "true")
  && !process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL;

if (USE_TC) {
  console.log("[test:setup] testcontainers mode enabled");

  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");

  const container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("workload_eval_test")
    .withUsername("test")
    .withPassword("test")
    .start();

  const connectionUri = container.getConnectionUri();
  process.env.TEST_DATABASE_URL = connectionUri;

  console.log("[test:setup] PostgreSQL container started");

  // Run migrations
  const pool = new Pool({ connectionString: connectionUri, max: 1 });
  const db = drizzle(pool);
  const migrationsFolder = fileURLToPath(new URL("./drizzle/", import.meta.url));

  console.log(`[test:setup] Running migrations from ${migrationsFolder}...`);
  await migrate(db, { migrationsFolder });
  console.log("[test:setup] Migrations complete");

  await pool.end();

  // Cleanup
  let stopped = false;
  const stopContainer = async () => {
    if (stopped) return;
    stopped = true;
    console.log("[test:setup] Stopping PostgreSQL container...");
    await container.stop();
    console.log("[test:setup] Container stopped");
  };

  process.on("beforeExit", stopContainer);
  process.on("SIGINT", () => {
    stopContainer().then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    stopContainer().then(() => process.exit(0));
  });
} else {
  // Local dev: do nothing, tests will fall back to local Postgres.app
}

// 阶段 1 批 8 skip 计数守卫：CI 模式且 TEST_DATABASE_URL 缺失时，DB 依赖用例
// （{ skip: !testDatabaseUrl }）会静默跳过造成假绿；直接抛错使套件失败。
// 本地（CI != true）保持既有跳过行为。testcontainers 分支已设置
// TEST_DATABASE_URL，不会误触发。
if (process.env.CI === "true" && !process.env.TEST_DATABASE_URL) {
  throw new Error(
    "[test:setup] CI 模式缺少 TEST_DATABASE_URL：DB 依赖套件将全部 skip（假绿）。" +
      "请在 CI 配置 TEST_DATABASE_URL（或移除 DATABASE_URL 以启用 testcontainers 自动拉起）。",
  );
}
