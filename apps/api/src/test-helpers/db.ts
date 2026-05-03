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

export async function truncateTestTables(): Promise<void> {
  await testDb.execute(
    sql`TRUNCATE TABLE change_logs, evidences, extraction_results, requirement_packs, sow_documents, initial_estimates, assessment_handoffs, assessment_narratives, deliverables, quality_gate_reviews, sealed_baselines, opportunity_briefs, collab_workspaces, collab_messages, dev_assessments, change_submissions, history_projects, users, version_code_rules RESTART IDENTITY CASCADE`,
  );
}
