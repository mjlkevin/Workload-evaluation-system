// ============================================================
// 迁移后校验器
// ============================================================
// 对比源 JSON 资产与 PG 表行数，确保无遗漏。

import fs from "node:fs";
import path from "node:path";
import { db } from "../../db/client";
import { users, versionCodeRules, assessmentVersions } from "../../db/schema";
import { count } from "drizzle-orm";

export interface ValidationResult {
  table: string;
  sourceCount: number;
  pgCount: number;
  ok: boolean;
}

export async function validateMigration(options: {
  configRoot?: string;
} = {}): Promise<ValidationResult[]> {
  const { configRoot = path.resolve(process.cwd(), "../../config") } = options;
  const results: ValidationResult[] = [];

  // users
  {
    const raw = JSON.parse(
      fs.readFileSync(path.join(configRoot, "auth", "users.json"), "utf-8"),
    ) as { users: unknown[] };
    const [{ count: pgCount }] = await db.select({ count: count() }).from(users);
    results.push({
      table: "users",
      sourceCount: raw.users.length,
      pgCount: Number(pgCount),
      ok: raw.users.length === Number(pgCount),
    });
  }

  // version_code_rules
  {
    const raw = JSON.parse(
      fs.readFileSync(path.join(configRoot, "versions", "version-code-rules.json"), "utf-8"),
    ) as { rules: unknown[] };
    const [{ count: pgCount }] = await db.select({ count: count() }).from(versionCodeRules);
    results.push({
      table: "version_code_rules",
      sourceCount: raw.rules.length,
      pgCount: Number(pgCount),
      ok: raw.rules.length === Number(pgCount),
    });
  }

  // records → assessment_versions
  {
    const raw = JSON.parse(
      fs.readFileSync(path.join(configRoot, "versions", "records.json"), "utf-8"),
    ) as { records: Array<{ versionCode: string }> };
    // v1 允许重复 versionCode，v2 有唯一约束，因此按 versionCode 去重后计算期望数
    const uniqueCodes = new Set(raw.records.map((r) => r.versionCode));
    const expectedCount = uniqueCodes.size;
    const [{ count: pgCount }] = await db.select({ count: count() }).from(assessmentVersions);
    results.push({
      table: "assessment_versions (from records)",
      sourceCount: expectedCount,
      pgCount: Number(pgCount),
      ok: expectedCount === Number(pgCount),
    });
  }

  return results;
}
