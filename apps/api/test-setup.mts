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
import path from "node:path";
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
  // 默认 db 单例（src/db/client.ts）读的是 DATABASE_URL。container 拉起后必须
  // 同步指到同一个库，否则各测试文件 import config/env.ts 时 dotenv 会把 .env 里的
  // 开发库填进 DATABASE_URL（dotenv 不覆盖已存在的键，但此模式下它并不存在），
  // 形成 testPool 指容器、默认单例指开发库的分裂。先置此变量也让 dotenv 跳过覆盖；
  // src/db/client.ts 的测试守卫（DEF-2026-08-27-004）会对此类不一致直接报错。
  process.env.DATABASE_URL = connectionUri;

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

// S3B1（2026-09-01，阶段 3 批 1 B1）：本地测试库误配无条件守卫。
// 背景（B0 实取）：apps/api/.env 与 .env.local 均含 DATABASE_URL 指开发库
// workload_eval；本地直接 npm run test:* 时（npm workspace 脚本 cwd=apps/api），
// dotenv 把开发库填进 DATABASE_URL，DB 依赖用例的夹具即写入开发库
// （08-30 已发生真实污染：system_configs.knowledgeBaseConfig 被夹具覆写）。
// 上方 CI 守卫只防 CI 假绿，防不了本地误配；verify-local-db-tests.sh 是
// 包装器不是守卫，只在有人主动用它时生效。
//
// 本守卫无条件生效（不受 CI 取值影响）：
//   - 解析生效连接串：TEST_DATABASE_URL 优先、否则 DATABASE_URL；
//   - 库名不以 _test 结尾即抛错退出，报出实际库名与两条正确做法；
//   - testcontainers 分支（上方 USE_TC）已把双 URL 指到容器库
//     （withDatabase("workload_eval_test")），库名以 _test 结尾，不误触发；
//   - 双 URL 均缺（如 worktree 无 .env）时测试进程不连库，放行。
//
// dotenv 在测试文件 import 时才执行（src/config/env.ts），global setup 阶段
// 进程环境尚无 .env 内容——这里显式加载（.env.local 优先 + .env 兜底，
// 与 src/config/env.ts:9-10 同口径），否则守卫永远解析不到本地误配。
const { config: dotenvConfig } = await import("dotenv");
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });
dotenvConfig();

const effectiveTestDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (effectiveTestDbUrl) {
  let dbName: string;
  try {
    dbName = new URL(effectiveTestDbUrl).pathname.replace(/^\/+/, "").split(/[?/#]/)[0];
  } catch {
    throw new Error(
      "[test:setup] 无法解析生效数据库连接串（TEST_DATABASE_URL 或 DATABASE_URL）的库名，" +
        "请检查配置后重试。",
    );
  }
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `[test:setup] 生效连接串指向非测试库 "${dbName}"：本地直接跑 test:* 会把测试夹具` +
        "写进开发库（08-30 已发生真实污染：system_configs.knowledgeBaseConfig 被夹具覆写）。\n" +
        "正确做法（二选一）：\n" +
        "  1) 走分支 CI：push 分支触发 test-with-db job，其服务容器库恒为 workload_eval_test；\n" +
        "  2) 本地带库测试用包装器：bash scripts/verify-local-db-tests.sh test:modules\n" +
        "     （脚本把 DATABASE_URL 与 TEST_DATABASE_URL 同时注入 *_test 库，不改任何 .env）。",
    );
  }
}
