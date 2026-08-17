// ============================================================
// 测试辅助 - 共享数据库连接
// ============================================================
// 所有需要连接 workload_eval_test 的测试文件，统一从这里导入 testDb。
// 避免多个测试文件各自创建独立 Pool 导致并发死锁。
//
// 双模式支持：
// - 当 process.env.DATABASE_URL_TEST 存在时（testcontainers 模式），使用该 URL
// - 否则回退到本地 Postgres.app 的硬连接串

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import * as schema from "../db/schema";

// 兼容两种命名：W5-A docker-compose 用 TEST_DATABASE_URL；W5-C testcontainers 用 DATABASE_URL_TEST
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL_TEST || "postgres://kevin@localhost:5432/workload_eval_test";

export const testPool = new Pool({
  connectionString: TEST_DATABASE_URL,
  max: 5,
});

export const testDb = drizzle(testPool, { schema });

// ============================================================
// TRUNCATE 覆盖集（阶段 0 事项 6）
// ============================================================
// 口径：与 apps/api/src/db/schema/ 下的全部 pgTable 一一对应，
// 由 db.drift.test.ts 做防漂移断言（集合包含，差集为空）。
// 新增表必须同步加入本列表，否则防漂移测试会直接指出缺失表名。
// 顺序无关（RESTART IDENTITY CASCADE 自行处理外键依赖）。

export const TRUNCATE_TEST_TABLE_NAMES: string[] = [
  // ── 既有 19 张（事项 6 前已覆盖） ──
  "change_logs",
  "evidences",
  "extraction_results",
  "requirement_packs",
  "sow_documents",
  "initial_estimates",
  "assessment_handoffs",
  "assessment_narratives",
  "deliverables",
  "quality_gate_reviews",
  "sealed_baselines",
  "opportunity_briefs",
  "collab_workspaces",
  "collab_messages",
  "dev_assessments",
  "change_submissions",
  "history_projects",
  "users",
  "version_code_rules",

  // ── 补全 34 张（阶段 0 事项 6） ──
  // harness 域（15）
  "harness_runs",
  "harness_run_attempts",
  "harness_run_checkpoints",
  "harness_run_events",
  "harness_run_outputs",
  "harness_session_outbox",
  "harness_files",
  "harness_evidences",
  "harness_tool_events",
  "harness_model_runs",
  "harness_artifacts",
  "harness_scores",
  "harness_cases",
  "harness_expected_answers",
  "harness_manual_test_results",
  // 凭据域（2）
  "credentials",
  "credential_audit",
  // 团队域（6）
  "teams",
  "team_members",
  "team_plan_bindings",
  "team_reviews",
  "team_review_comments",
  "team_audit_logs",
  // 版本域（2）
  "assessment_versions",
  "version_records",
  // 记忆域（2）
  "memory_atoms",
  "memory_scenes",
  // 会话与配置（7）
  "ai_sessions",
  "invite_codes",
  "password_reset_tokens",
  "rule_sets",
  "system_configs",
  "templates",
  "traces",
];

export async function truncateTestTables(): Promise<void> {
  await testDb.execute(
    sql`TRUNCATE TABLE ${sql.raw(TRUNCATE_TEST_TABLE_NAMES.join(", "))} RESTART IDENTITY CASCADE`,
  );
}
