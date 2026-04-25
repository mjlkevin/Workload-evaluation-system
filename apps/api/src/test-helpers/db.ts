// ============================================================
// 测试辅助 - 共享数据库连接
// ============================================================
// 所有需要连接 workload_eval_test 的测试文件，统一从这里导入 testDb。
// 避免多个测试文件各自创建独立 Pool 导致并发死锁。

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import * as schema from "../db/schema";

const TEST_DATABASE_URL = "postgres://kevin@localhost:5432/workload_eval_test";

export const testPool = new Pool({
  connectionString: TEST_DATABASE_URL,
  max: 5,
});

export const testDb = drizzle(testPool, { schema });

export async function truncateTestTables(): Promise<void> {
  await testDb.execute(
    sql`TRUNCATE TABLE change_logs, evidences, extraction_results, requirement_packs, sow_documents, initial_estimates, assessment_handoffs, assessment_narratives, deliverables, quality_gate_reviews, sealed_baselines RESTART IDENTITY CASCADE`,
  );
}
