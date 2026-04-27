#!/usr/bin/env node
// ============================================================
// v1 JSON 资产 → v2 PostgreSQL 迁移脚本
// ============================================================
// 运行方式：
//   npm run db:migrate             # 先确保 schema 迁移已应用
//   npm run migration:v1-to-v2     # 执行数据迁移
//   npm run migration:v1-to-v2 -- --dry-run   # 仅预览，不写入
//   npm run migration:v1-to-v2 -- --validate   # 仅校验
//
// 环境变量：
//   DATABASE_URL=postgres://user@host:5432/dbname

import { migrateUsers, migrateVersionCodeRules, migrateRecords } from "./migrators";
import { validateMigration } from "./validators/post-migration.validator";
import { closeDb } from "../db/client";

function parseArgs(): { dryRun: boolean; validateOnly: boolean; help: boolean } {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes("--dry-run"),
    validateOnly: args.includes("--validate"),
    help: args.includes("--help") || args.includes("-h"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    console.log(`
Usage: npm run migration:v1-to-v2 [-- [options]]

Options:
  --dry-run     仅预览将要插入的数据，不实际写入数据库
  --validate    仅运行校验，对比源 JSON 与 PG 表行数
  --help, -h    显示此帮助

Examples:
  npm run migration:v1-to-v2
  npm run migration:v1-to-v2 -- --dry-run
  npm run migration:v1-to-v2 -- --validate
`);
    process.exit(0);
  }

  console.log("============================================================");
  console.log("Wave4-C · v1 → v2 数据迁移");
  console.log(`模式: ${args.dryRun ? "DRY-RUN（仅预览）" : args.validateOnly ? "VALIDATE-ONLY（仅校验）" : "LIVE（实际写入）"}`);
  console.log("============================================================\n");

  if (args.validateOnly) {
    const validations = await validateMigration();
    console.log("\n--- 校验结果 ---");
    let allOk = true;
    for (const v of validations) {
      const mark = v.ok ? "✅" : "❌";
      console.log(`${mark} ${v.table}: 源=${v.sourceCount} / PG=${v.pgCount}`);
      if (!v.ok) allOk = false;
    }
    console.log(allOk ? "\n全部通过 ✅" : "\n存在差异 ❌");
    process.exit(allOk ? 0 : 1);
  }

  // 1. users
  console.log("\n--- 1/3 迁移 users ---");
  const userResult = await migrateUsers({ dryRun: args.dryRun });
  console.log(`源=${userResult.sourceCount} 插入=${userResult.inserted} 跳过=${userResult.skipped} 错误=${userResult.errors.length}`);

  // 2. version-code-rules
  console.log("\n--- 2/3 迁移 version_code_rules ---");
  const ruleResult = await migrateVersionCodeRules({ dryRun: args.dryRun });
  console.log(`源=${ruleResult.sourceCount} 插入=${ruleResult.inserted} 跳过=${ruleResult.skipped} 错误=${ruleResult.errors.length}`);

  // 3. records → assessment_versions
  console.log("\n--- 3/3 迁移 records → assessment_versions ---");
  const recordResult = await migrateRecords({ dryRun: args.dryRun });
  console.log(`源=${recordResult.sourceCount} 插入=${recordResult.inserted} 跳过=${recordResult.skipped} 错误=${recordResult.errors.length}`);

  // 校验
  if (!args.dryRun) {
    console.log("\n--- 迁移后校验 ---");
    const validations = await validateMigration();
    let allOk = true;
    for (const v of validations) {
      const mark = v.ok ? "✅" : "❌";
      console.log(`${mark} ${v.table}: 源=${v.sourceCount} / PG=${v.pgCount}`);
      if (!v.ok) allOk = false;
    }
    console.log(allOk ? "\n全部通过 ✅" : "\n存在差异 ❌");
  } else {
    console.log("\n[dry-run] 跳过校验阶段");
  }

  console.log("\n============================================================");
  console.log("迁移完成");
  console.log("============================================================");
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("[migrate-v1-to-v2] 未捕获异常:", e);
    await closeDb();
    process.exit(1);
  });
