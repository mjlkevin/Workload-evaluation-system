// ============================================================
// 数据库迁移执行器
// ============================================================
// 运行方式：
//   npm run db:migrate -w apps/api          # 对 DATABASE_URL 执行
//   DATABASE_URL=... npm run db:migrate ... # 覆盖目标库（测试库）
//
// 本脚本只做一件事：对目标库应用 drizzle/ 目录下的全部 pending migration。
// 不做任何业务校验，保持幂等（drizzle 自带 `__drizzle_migrations` 表追踪）。

import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, db } from "./client";

async function main(): Promise<void> {
  const migrationsFolder = path.resolve(__dirname, "../../drizzle");
  console.log(`[db:migrate] applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log(`[db:migrate] done`);
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("[db:migrate] failed:", e);
    await closeDb();
    process.exit(1);
  });
