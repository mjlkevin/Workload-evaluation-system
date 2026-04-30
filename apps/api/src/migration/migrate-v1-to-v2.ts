#!/usr/bin/env node
// ============================================================
// v1 JSON 资产 → v2 PostgreSQL 迁移脚本
// ============================================================
// 运行方式：
//   npm run db:migrate                          # 先确保 schema 迁移已应用
//   npm run migration:v1-to-v2                  # 执行数据迁移
//   npm run migration:v1-to-v2 -- --dry-run     # 仅预览，不写入
//   npm run migration:v1-to-v2 -- --validate    # 仅基础校验
//   npm run migration:v1-to-v2 -- --comprehensive-validate   # 深度校验
//   npm run migration:v1-to-v2 -- --report ./report.json     # 导出 JSON 报告
//
// 环境变量：
//   DATABASE_URL=postgres://user@host:5432/dbname

import { migrateUsers, migrateVersionCodeRules, migrateRecords } from "./migrators";
import { validateMigration } from "./validators/post-migration.validator";
import { validateComprehensive } from "./validators/comprehensive.validator";
import { closeDb } from "../db/client";
import fs from "node:fs";

function parseArgs(): {
  dryRun: boolean;
  validateOnly: boolean;
  comprehensiveValidate: boolean;
  reportPath?: string;
  help: boolean;
} {
  const args = process.argv.slice(2);
  const reportIdx = args.indexOf("--report");
  return {
    dryRun: args.includes("--dry-run"),
    validateOnly: args.includes("--validate"),
    comprehensiveValidate: args.includes("--comprehensive-validate"),
    reportPath: reportIdx >= 0 && reportIdx + 1 < args.length ? args[reportIdx + 1] : undefined,
    help: args.includes("--help") || args.includes("-h"),
  };
}

type MigrationReport = {
  mode: "dry-run" | "live";
  timestamp: string;
  users?: Awaited<ReturnType<typeof migrateUsers>>;
  versionCodeRules?: Awaited<ReturnType<typeof migrateVersionCodeRules>>;
  records?: Awaited<ReturnType<typeof migrateRecords>>;
  validation?: Awaited<ReturnType<typeof validateMigration>>;
  comprehensive?: Awaited<ReturnType<typeof validateComprehensive>>;
};

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    console.log(`
Usage: npm run migration:v1-to-v2 [-- [options]]

Options:
  --dry-run                    仅预览将要插入的数据，不实际写入数据库
  --validate                   仅运行基础校验（数量对账）
  --comprehensive-validate     运行深度校验（唯一性、完整性、payload、重复数据）
  --report <path>              将结果导出为 JSON 报告
  --help, -h                   显示此帮助

Examples:
  npm run migration:v1-to-v2
  npm run migration:v1-to-v2 -- --dry-run
  npm run migration:v1-to-v2 -- --validate
  npm run migration:v1-to-v2 -- --comprehensive-validate
  npm run migration:v1-to-v2 -- --dry-run --report ./dry-run-report.json
`);
    process.exit(0);
  }

  const modeLabel = args.dryRun
    ? "DRY-RUN（仅预览）"
    : args.validateOnly
      ? "VALIDATE-ONLY（基础校验）"
      : args.comprehensiveValidate
        ? "COMPREHENSIVE-VALIDATE（深度校验）"
        : "LIVE（实际写入）";

  console.log("============================================================");
  console.log("Wave4-C2 · v1 → v2 数据迁移");
  console.log(`模式: ${modeLabel}`);
  console.log("============================================================\n");

  // 基础校验模式
  if (args.validateOnly) {
    const validations = await validateMigration();
    console.log("\n--- 基础校验结果 ---");
    let allOk = true;
    for (const v of validations) {
      const mark = v.ok ? "✅" : "❌";
      console.log(`${mark} ${v.table}: 源=${v.sourceCount} / PG=${v.pgCount}`);
      if (!v.ok) allOk = false;
    }
    console.log(allOk ? "\n全部通过 ✅" : "\n存在差异 ❌");

    if (args.reportPath) {
      fs.writeFileSync(args.reportPath, JSON.stringify({ mode: "validate", timestamp: new Date().toISOString(), validation: validations }, null, 2));
      console.log(`\n报告已导出: ${args.reportPath}`);
    }
    process.exit(allOk ? 0 : 1);
  }

  // 深度校验模式
  if (args.comprehensiveValidate) {
    const result = await validateComprehensive();
    console.log("\n--- 深度校验结果 ---");
    console.log(`总计: ${result.summary.totalChecks} 项 | ✅ 通过=${result.summary.passed} | ❌ 失败=${result.summary.failed} | ⚠️ 警告=${result.summary.warnings}\n`);

    const byCategory: Record<string, typeof result.checks> = {};
    for (const c of result.checks) {
      byCategory[c.category] = byCategory[c.category] ?? [];
      byCategory[c.category].push(c);
    }

    for (const [cat, checks] of Object.entries(byCategory)) {
      console.log(`[${cat.toUpperCase()}]`);
      for (const c of checks) {
        const icon = c.status === "pass" ? "✅" : c.status === "fail" ? "❌" : "⚠️";
        console.log(`  ${icon} ${c.name}: ${c.message}`);
      }
      console.log("");
    }

    const allOk = result.summary.failed === 0;
    console.log(allOk ? "全部通过 ✅" : `存在 ${result.summary.failed} 项失败 ❌`);

    if (args.reportPath) {
      fs.writeFileSync(args.reportPath, JSON.stringify({ mode: "comprehensive-validate", timestamp: new Date().toISOString(), comprehensive: result }, null, 2));
      console.log(`\n报告已导出: ${args.reportPath}`);
    }
    process.exit(allOk ? 0 : 1);
  }

  // 迁移模式（含 dry-run）
  const report: MigrationReport = {
    mode: args.dryRun ? "dry-run" : "live",
    timestamp: new Date().toISOString(),
  };

  // 1. users
  console.log("\n--- 1/3 迁移 users ---");
  const userResult = await migrateUsers({ dryRun: args.dryRun });
  report.users = userResult;
  console.log(`源=${userResult.sourceCount} 插入=${userResult.inserted} 跳过=${userResult.skipped} 错误=${userResult.errors.length}`);

  // 2. version-code-rules
  console.log("\n--- 2/3 迁移 version_code_rules ---");
  const ruleResult = await migrateVersionCodeRules({ dryRun: args.dryRun });
  report.versionCodeRules = ruleResult;
  console.log(`源=${ruleResult.sourceCount} 插入=${ruleResult.inserted} 跳过=${ruleResult.skipped} 错误=${ruleResult.errors.length}`);

  // 3. records → assessment_versions
  console.log("\n--- 3/3 迁移 records → assessment_versions ---");
  const recordResult = await migrateRecords({ dryRun: args.dryRun });
  report.records = recordResult;
  console.log(`源=${recordResult.sourceCount} 插入=${recordResult.inserted} 跳过=${recordResult.skipped} 错误=${recordResult.errors.length}`);

  // 基础校验
  if (!args.dryRun) {
    console.log("\n--- 迁移后基础校验 ---");
    const validations = await validateMigration();
    report.validation = validations;
    let allOk = true;
    for (const v of validations) {
      const mark = v.ok ? "✅" : "❌";
      console.log(`${mark} ${v.table}: 源=${v.sourceCount} / PG=${v.pgCount}`);
      if (!v.ok) allOk = false;
    }
    console.log(allOk ? "\n基础校验全部通过 ✅" : "\n基础校验存在差异 ❌");

    // 深度校验
    console.log("\n--- 迁移后深度校验 ---");
    const comprehensive = await validateComprehensive();
    report.comprehensive = comprehensive;
    console.log(`总计: ${comprehensive.summary.totalChecks} 项 | ✅ 通过=${comprehensive.summary.passed} | ❌ 失败=${comprehensive.summary.failed} | ⚠️ 警告=${comprehensive.summary.warnings}`);
    if (comprehensive.summary.failed > 0) {
      for (const c of comprehensive.checks.filter((x) => x.status === "fail")) {
        console.log(`  ❌ ${c.name}: ${c.message}`);
      }
    }
  } else {
    console.log("\n[dry-run] 跳过校验阶段");
  }

  // 导出报告
  if (args.reportPath) {
    fs.writeFileSync(args.reportPath, JSON.stringify(report, null, 2));
    console.log(`\n报告已导出: ${args.reportPath}`);
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
