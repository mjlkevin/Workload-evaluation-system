// ============================================================
// db:migrate CLI —— 对 DATABASE_URL 执行 drizzle 迁移
// ============================================================
// 运行方式：
//   npm run db:migrate -w apps/api          # 对 DATABASE_URL 执行
//   DATABASE_URL=... npm run db:migrate ... # 覆盖目标库（测试库）
//
// 迁移逻辑在 migrate.ts（runMigrations，含 D13 advisory lock 串行化）；
// CLI 独立成文件，避免「import 即执行」与 main.ts 启动路径并发抢跑。

import { closeDb } from "./client";
import { runMigrations } from "./migrate";

async function main(): Promise<void> {
  await runMigrations();
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
