// ============================================================
// 综合迁移校验器
// ============================================================
// 提供数量对账、唯一性校验、字段完整性、payload 兼容性、
// 重复源数据识别等深度校验能力。

import fs from "node:fs";
import path from "node:path";
import { db } from "../../db/client";
import { users, versionCodeRules, assessmentVersions } from "../../db/schema";
import { count, sql } from "drizzle-orm";

export interface ComprehensiveValidationResult {
  summary: {
    totalChecks: number;
    passed: number;
    failed: number;
    warnings: number;
  };
  checks: ValidationCheck[];
}

export interface ValidationCheck {
  category: "count" | "uniqueness" | "completeness" | "payload" | "duplicate" | "error";
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
  detail?: Record<string, unknown>;
}

// -----------------------------------------------------------
// helpers
// -----------------------------------------------------------

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
}

// -----------------------------------------------------------
// users 校验
// -----------------------------------------------------------

async function validateUsers(configRoot: string): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];
  const raw = readJson<{ users: Array<Record<string, unknown>> }>(path.join(configRoot, "auth", "users.json"));
  const source = raw.users ?? [];

  // 1. 数量对账
  const [{ count: pgCount }] = await db.select({ count: count() }).from(users);
  checks.push({
    category: "count",
    name: "users 数量对账",
    status: source.length === Number(pgCount) ? "pass" : "fail",
    message: `源=${source.length} / PG=${pgCount}`,
    detail: { sourceCount: source.length, pgCount: Number(pgCount) },
  });

  // 2. 唯一性校验（username）
  const dupUsernames = await db.execute(sql`
    SELECT username, COUNT(*) as cnt
    FROM ${users}
    GROUP BY username
    HAVING COUNT(*) > 1
  `);
  const dupUserRows = dupUsernames.rows as Array<{ username: string; cnt: string }>;
  checks.push({
    category: "uniqueness",
    name: "users.username 唯一性",
    status: dupUserRows.length === 0 ? "pass" : "fail",
    message: dupUserRows.length === 0
      ? "全部唯一"
      : `发现重复: ${dupUserRows.map((r) => `${r.username}(${r.cnt})`).join(", ")}`,
    detail: { duplicates: dupUserRows },
  });

  // 3. 字段完整性
  const nullFields = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE user_id IS NULL) as null_id,
      COUNT(*) FILTER (WHERE username IS NULL) as null_username,
      COUNT(*) FILTER (WHERE password_hash IS NULL) as null_password_hash,
      COUNT(*) FILTER (WHERE role IS NULL) as null_role,
      COUNT(*) FILTER (WHERE status IS NULL) as null_status,
      COUNT(*) FILTER (WHERE created_at IS NULL) as null_created_at
    FROM ${users}
  `);
  const nf = nullFields.rows[0] as Record<string, string>;
  const hasNulls = Object.values(nf).some((v) => Number(v) > 0);
  checks.push({
    category: "completeness",
    name: "users 必填字段完整性",
    status: hasNulls ? "fail" : "pass",
    message: hasNulls
      ? `存在空值: ${Object.entries(nf).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${k}=${v}`).join(", ")}`
      : "全部必填字段非空",
    detail: { nullCounts: nf },
  });

  // 4. 源内重复识别
  const sourceUsernames = source.map((u: any) => u.username);
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const un of sourceUsernames) {
    if (seen.has(un)) dupes.push(un);
    seen.add(un);
  }
  checks.push({
    category: "duplicate",
    name: "users.json 源内重复",
    status: dupes.length === 0 ? "pass" : "warn",
    message: dupes.length === 0 ? "无重复" : `重复 username: ${[...new Set(dupes)].join(", ")}`,
    detail: { duplicates: [...new Set(dupes)] },
  });

  return checks;
}

// -----------------------------------------------------------
// version_code_rules 校验
// -----------------------------------------------------------

async function validateVersionCodeRules(configRoot: string): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];
  const raw = readJson<{ rules: Array<Record<string, unknown>> }>(path.join(configRoot, "versions", "version-code-rules.json"));
  const source = raw.rules ?? [];

  // 1. 数量对账
  const [{ count: pgCount }] = await db.select({ count: count() }).from(versionCodeRules);
  checks.push({
    category: "count",
    name: "version_code_rules 数量对账",
    status: source.length === Number(pgCount) ? "pass" : "fail",
    message: `源=${source.length} / PG=${pgCount}`,
    detail: { sourceCount: source.length, pgCount: Number(pgCount) },
  });

  // 2. 唯一性校验（ruleId）
  const dupIds = await db.execute(sql`
    SELECT rule_id, COUNT(*) as cnt
    FROM ${versionCodeRules}
    GROUP BY rule_id
    HAVING COUNT(*) > 1
  `);
  const dupIdRows = dupIds.rows as Array<{ rule_id: string; cnt: string }>;
  checks.push({
    category: "uniqueness",
    name: "version_code_rules.rule_id 唯一性",
    status: dupIdRows.length === 0 ? "pass" : "fail",
    message: dupIdRows.length === 0
      ? "全部唯一"
      : `发现重复: ${dupIdRows.map((r) => `${r.rule_id}(${r.cnt})`).join(", ")}`,
    detail: { duplicates: dupIdRows },
  });

  // 3. 字段完整性
  const nullFields = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE rule_id IS NULL) as null_rule_id,
      COUNT(*) FILTER (WHERE module_key IS NULL) as null_module_key,
      COUNT(*) FILTER (WHERE module_name IS NULL) as null_module_name,
      COUNT(*) FILTER (WHERE module_code IS NULL) as null_module_code,
      COUNT(*) FILTER (WHERE prefix IS NULL) as null_prefix,
      COUNT(*) FILTER (WHERE format IS NULL) as null_format
    FROM ${versionCodeRules}
  `);
  const nf = nullFields.rows[0] as Record<string, string>;
  const hasNulls = Object.values(nf).some((v) => Number(v) > 0);
  checks.push({
    category: "completeness",
    name: "version_code_rules 必填字段完整性",
    status: hasNulls ? "fail" : "pass",
    message: hasNulls
      ? `存在空值: ${Object.entries(nf).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${k}=${v}`).join(", ")}`
      : "全部必填字段非空",
    detail: { nullCounts: nf },
  });

  // 4. 源内重复
  const sourceIds = source.map((r: any) => r.id);
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const id of sourceIds) {
    if (seen.has(id)) dupes.push(id);
    seen.add(id);
  }
  checks.push({
    category: "duplicate",
    name: "version-code-rules.json 源内重复",
    status: dupes.length === 0 ? "pass" : "warn",
    message: dupes.length === 0 ? "无重复" : `重复 ruleId: ${[...new Set(dupes)].join(", ")}`,
    detail: { duplicates: [...new Set(dupes)] },
  });

  return checks;
}

// -----------------------------------------------------------
// assessment_versions 校验
// -----------------------------------------------------------

async function validateAssessmentVersions(configRoot: string): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];
  const raw = readJson<{ records: Array<{ versionCode: string; id: string }> }>(
    path.join(configRoot, "versions", "records.json"),
  );
  const source = raw.records ?? [];
  const uniqueCodes = new Set(source.map((r) => r.versionCode));
  const expectedCount = uniqueCodes.size;

  // 1. 数量对账（按 versionCode 去重后）
  const [{ count: pgCount }] = await db.select({ count: count() }).from(assessmentVersions);
  checks.push({
    category: "count",
    name: "assessment_versions 数量对账",
    status: expectedCount === Number(pgCount) ? "pass" : "fail",
    message: `源(去重后)=${expectedCount} / PG=${pgCount}`,
    detail: { sourceCount: source.length, uniqueCount: expectedCount, pgCount: Number(pgCount) },
  });

  // 2. 唯一性校验（versionCode）
  const dupCodes = await db.execute(sql`
    SELECT version_code, COUNT(*) as cnt
    FROM ${assessmentVersions}
    GROUP BY version_code
    HAVING COUNT(*) > 1
  `);
  const dupCodeRows = dupCodes.rows as Array<{ version_code: string; cnt: string }>;
  checks.push({
    category: "uniqueness",
    name: "assessment_versions.version_code 唯一性",
    status: dupCodeRows.length === 0 ? "pass" : "fail",
    message: dupCodeRows.length === 0
      ? "全部唯一"
      : `发现重复: ${dupCodeRows.map((r) => `${r.version_code}(${r.cnt})`).join(", ")}`,
    detail: { duplicates: dupCodeRows },
  });

  // 3. 字段完整性
  const nullFields = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE assessment_version_id IS NULL) as null_id,
      COUNT(*) FILTER (WHERE version_code IS NULL) as null_version_code,
      COUNT(*) FILTER (WHERE status IS NULL) as null_status,
      COUNT(*) FILTER (WHERE payload IS NULL) as null_payload,
      COUNT(*) FILTER (WHERE created_at IS NULL) as null_created_at,
      COUNT(*) FILTER (WHERE updated_at IS NULL) as null_updated_at
    FROM ${assessmentVersions}
  `);
  const nf = nullFields.rows[0] as Record<string, string>;
  const hasNulls = Object.values(nf).some((v) => Number(v) > 0);
  checks.push({
    category: "completeness",
    name: "assessment_versions 必填字段完整性",
    status: hasNulls ? "fail" : "pass",
    message: hasNulls
      ? `存在空值: ${Object.entries(nf).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${k}=${v}`).join(", ")}`
      : "全部必填字段非空",
    detail: { nullCounts: nf },
  });

  // 4. payload 兼容性字段抽样检查
  const payloadCheck = await db.execute(sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE payload->>'projectName' IS NOT NULL) as has_project_name,
      COUNT(*) FILTER (WHERE payload->>'checkoutStatus' IS NOT NULL) as has_checkout_status,
      COUNT(*) FILTER (WHERE payload->>'versionDocStatus' IS NOT NULL) as has_version_doc_status,
      COUNT(*) FILTER (WHERE payload->>'isHistoricalArchive' IS NOT NULL) as has_is_historical_archive,
      COUNT(*) FILTER (WHERE payload->>'_v1Type' IS NOT NULL) as has_v1_type
    FROM ${assessmentVersions}
  `);
  const pc = payloadCheck.rows[0] as Record<string, string>;
  const total = Number(pc.total);
  const allHaveCompat = total > 0 &&
    Number(pc.has_project_name) === total &&
    Number(pc.has_checkout_status) === total &&
    Number(pc.has_version_doc_status) === total &&
    Number(pc.has_is_historical_archive) === total &&
    Number(pc.has_v1_type) === total;

  checks.push({
    category: "payload",
    name: "assessment_versions payload 兼容性字段覆盖",
    status: allHaveCompat ? "pass" : total === 0 ? "warn" : "warn",
    message: total === 0
      ? "表为空，无法检查"
      : allHaveCompat
        ? "全部记录包含兼容字段"
        : `projectName=${pc.has_project_name}/${total}, checkoutStatus=${pc.has_checkout_status}/${total}, versionDocStatus=${pc.has_version_doc_status}/${total}, isHistoricalArchive=${pc.has_is_historical_archive}/${total}, _v1Type=${pc.has_v1_type}/${total}`,
    detail: { total, ...pc },
  });

  // 5. 源内重复识别
  const codeSeen = new Map<string, number>();
  for (const r of source) {
    codeSeen.set(r.versionCode, (codeSeen.get(r.versionCode) ?? 0) + 1);
  }
  const dupEntries = [...codeSeen.entries()].filter(([, c]) => c > 1);
  checks.push({
    category: "duplicate",
    name: "records.json 源内 versionCode 重复",
    status: dupEntries.length === 0 ? "pass" : "warn",
    message: dupEntries.length === 0
      ? "无重复"
      : `重复项: ${dupEntries.map(([code, c]) => `${code}(${c}次)`).join(", ")}`,
    detail: { duplicates: dupEntries.map(([code, count]) => ({ versionCode: code, count })) },
  });

  // 6. status 枚举合法性
  const invalidStatus = await db.execute(sql`
    SELECT version_code, status
    FROM ${assessmentVersions}
    WHERE status NOT IN ('draft', 'checked_out', 'checked_in', 'promoted', 'sealed')
  `);
  const invalidStatusRows = invalidStatus.rows as Array<{ version_code: string; status: string }>;
  checks.push({
    category: "completeness",
    name: "assessment_versions status 枚举合法性",
    status: invalidStatusRows.length === 0 ? "pass" : "fail",
    message: invalidStatusRows.length === 0
      ? "全部合法"
      : `非法记录: ${invalidStatusRows.map((r) => `${r.version_code}=${r.status}`).join(", ")}`,
    detail: { invalidRecords: invalidStatusRows },
  });

  return checks;
}

// -----------------------------------------------------------
// 入口
// -----------------------------------------------------------

export async function validateComprehensive(options: {
  configRoot?: string;
} = {}): Promise<ComprehensiveValidationResult> {
  const { configRoot = path.resolve(process.cwd(), "../../config") } = options;

  const allChecks: ValidationCheck[] = [];
  allChecks.push(...await validateUsers(configRoot));
  allChecks.push(...await validateVersionCodeRules(configRoot));
  allChecks.push(...await validateAssessmentVersions(configRoot));

  const passed = allChecks.filter((c) => c.status === "pass").length;
  const failed = allChecks.filter((c) => c.status === "fail").length;
  const warnings = allChecks.filter((c) => c.status === "warn").length;

  return {
    summary: {
      totalChecks: allChecks.length,
      passed,
      failed,
      warnings,
    },
    checks: allChecks,
  };
}
