// ============================================================
// db:seed CLI —— 首次部署播种（admin + 基础配置）
// ============================================================
// 运行方式：
//   npm run db:seed -w apps/api                # 缺失才插（幂等）
//   npm run db:seed -w apps/api -- --force     # 强制覆盖源文件派生行（仅限非生产）
//   DATABASE_URL=... npm run db:seed ...      # 覆盖目标库（空库验收）
//
// 语义：
//   - 默认口径：缺失才插（onConflictDoNothing），不 TRUNCATE、不覆盖运行时写入；
//     连续执行两次，各类配置行数不变。
//   - --force：先删除源文件对应的既有行再插入（评估结论见计划文档记录 1 回填），
//     生产环境（NODE_ENV=production）直接拒绝。

import { closeDb } from "./client";
import { ensureAdminSeed, seedBaseConfig } from "./seed";

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const admin = await ensureAdminSeed();
  const base = await seedBaseConfig({ force });
  console.log(
    `[db:seed] admin={username:${admin.username}, created:${admin.created}} ` +
      `versionCodeRules=${base.versionCodeRules} templates=${base.templates} ` +
      `ruleSets=${base.ruleSets} systemConfigs=${base.systemConfigs} ` +
      `knowledgeEntries=${base.knowledgeEntries} force=${force}`,
  );
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("[db:seed] failed:", e instanceof Error ? e.message : e);
    await closeDb();
    process.exit(1);
  });
