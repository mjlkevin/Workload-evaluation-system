// ============================================================
// version-code-rules.json → PG version_code_rules 表迁移器
// ============================================================
// 映射规则：
//   v1 id           → v2 rule_id
//   v1 moduleKey    → v2 module_key
//   v1 moduleName   → v2 module_name
//   v1 moduleCode   → v2 module_code
//   v1 prefix       → v2 prefix
//   v1 format       → v2 format
//   v1 sample       → v2 sample
//   v1 status       → v2 status
//   v1 effectiveAt  → v2 effective_at
//   v1 updatedAt    → v2 updated_at

import fs from "node:fs";
import path from "node:path";
import { db } from "../../db/client";
import { versionCodeRules } from "../../db/schema";

interface V1Rule {
  id: string;
  moduleKey: string;
  moduleName: string;
  moduleCode: string;
  prefix: string;
  format: string;
  sample: string;
  status: "active" | "disabled";
  effectiveAt: string;
  updatedAt: string;
}

interface V1RulesFile {
  rules: V1Rule[];
}

export interface VersionCodeRuleMigrationResult {
  sourceCount: number;
  inserted: number;
  skipped: number;
  errors: Array<{ ruleId: string; error: string }>;
}

export async function migrateVersionCodeRules(options: {
  dryRun?: boolean;
  configRoot?: string;
}): Promise<VersionCodeRuleMigrationResult> {
  const { dryRun = false, configRoot = path.resolve(process.cwd(), "../../config") } = options;
  const filePath = path.join(configRoot, "versions", "version-code-rules.json");

  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as V1RulesFile;
  const source = raw.rules ?? [];

  const result: VersionCodeRuleMigrationResult = {
    sourceCount: source.length,
    inserted: 0,
    skipped: 0,
    errors: [],
  };

  if (source.length === 0) {
    console.log("[migrate:version-code-rules] 源数据为空，跳过");
    return result;
  }

  const existingRows = await db
    .select({ ruleId: versionCodeRules.ruleId })
    .from(versionCodeRules);
  const existingSet = new Set(existingRows.map((r) => r.ruleId));

  for (const r of source) {
    if (existingSet.has(r.id)) {
      result.skipped++;
      console.log(`[migrate:version-code-rules] 跳过已存在: ${r.id}`);
      continue;
    }

    const row = {
      ruleId: r.id,
      moduleKey: r.moduleKey,
      moduleName: r.moduleName,
      moduleCode: r.moduleCode,
      prefix: r.prefix,
      format: r.format,
      sample: r.sample,
      status: r.status,
      effectiveAt: new Date(r.effectiveAt),
      updatedAt: new Date(r.updatedAt),
    };

    if (dryRun) {
      console.log(`[migrate:version-code-rules] [dry-run] 将插入: ${r.id} (${r.moduleKey})`);
      result.inserted++;
      continue;
    }

    try {
      await db.insert(versionCodeRules).values(row);
      result.inserted++;
      console.log(`[migrate:version-code-rules] 已插入: ${r.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ ruleId: r.id, error: message });
      console.error(`[migrate:version-code-rules] 插入失败: ${r.id} — ${message}`);
    }
  }

  return result;
}
