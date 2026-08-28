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
  // harness 域（14，S2b-2 删 harness_session_outbox）
  "harness_runs",
  "harness_run_attempts",
  "harness_run_checkpoints",
  "harness_run_events",
  "harness_run_outputs",
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
  // store 级乐观并发版本计数器（阶段 2 批 7，元数据表；truncate 后
  // 由首次写的行缺失分支自愈重建，测试用例不依赖 seed 行）
  "store_versions",
  // 会话与配置（7）
  "ai_sessions",
  "invite_codes",
  "password_reset_tokens",
  "rule_sets",
  "system_configs",
  "templates",
  "traces",
  // 知识域（1，阶段 2 批 9）
  "knowledge_entries",
];

/**
 * 整表清理跨进程守卫（阶段 2 批 6 显式化架构侧约束）：
 * 调用 truncateTestTables() 的测试文件必须串行执行（当前全部位于
 * test:ai，该套件保持 --test-concurrency=1）。若未来有人去掉串行
 * 参数，多文件并发整表清理会互相清库，表现为随机跨文件失败且极难
 * 归因。此处用 PG 会话级 advisory lock 把隐式约束变成显式报错：
 * 同一时刻只有一个进程能进入 truncate，拿不到锁立即抛错（不阻塞等待，
 * 避免把问题隐藏成慢测试）。锁随连接归还/进程退出自动释放。
 */
const TRUNCATE_GUARD_LOCK_KEY = 770219006;

export async function truncateTestTables(): Promise<void> {
  const client = await testPool.connect();
  try {
    const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS acquired", [TRUNCATE_GUARD_LOCK_KEY]);
    if (!rows[0].acquired) {
      throw new Error(
        "truncateTestTables 并发冲突：另一测试进程正在整表清理。" +
          "含本调用的套件必须保持 --test-concurrency=1（见 apps/api/package.json test:ai.note）；" +
          "如需并发，先改为数据集隔离（阶段2-存储切换-实施计划 §4.6 模板）。",
      );
    }
    // 表名为本文件常量清单，直接拼接（无外部输入，无注入面）
    await client.query(`TRUNCATE TABLE ${TRUNCATE_TEST_TABLE_NAMES.join(", ")} RESTART IDENTITY CASCADE`);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [TRUNCATE_GUARD_LOCK_KEY]).catch(() => {});
    client.release();
  }
}
