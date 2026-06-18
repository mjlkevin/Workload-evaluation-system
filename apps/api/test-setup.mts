// ============================================================
// 测试全局 setup - testcontainers 支持
// ============================================================
// 通过 node:test --test-global-setup 引入。
// 当 USE_TESTCONTAINERS=true 或 CI=true 时，自动拉起 PostgreSQL container，
// 设置 TEST_DATABASE_URL，并执行 drizzle migration。
//
// 清理：通过 process.on('beforeExit') 在测试全部结束后自动 stop container。

import path from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";


const USE_TC = process.env.USE_TESTCONTAINERS === "true" || process.env.CI === "true";

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
  const migrationsFolder = path.resolve(__dirname, "drizzle");

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
