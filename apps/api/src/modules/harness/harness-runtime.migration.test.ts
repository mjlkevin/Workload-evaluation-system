// ============================================================
// Harness 持久运行历史迁移演练
// ============================================================
// RP-047 Batch A2：在同一 Testcontainer 内创建随机临时数据库，
// 按文件顺序重放 0000..0013，插入 legacy Run/tool event/artifact，
// 再执行唯一 0014，验证 additive 迁移对历史行的补齐与结构完整性。
// 只读取 TEST_DATABASE_URL；不连接 DATABASE_URL 或长期数据库。

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

/** 兼容 workspace（apps/api）与仓库根两种 cwd 的迁移目录解析。 */
function resolveMigrationsFolder(): string {
  const candidates = [path.join(process.cwd(), "drizzle"), path.join(process.cwd(), "apps/api/drizzle")];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("drizzle migrations folder not found");
}
const migrationsFolder = resolveMigrationsFolder();

const HISTORICAL_MIGRATIONS = [
  "0000_spooky_vulcan.sql",
  "0001_furry_gambit.sql",
  "0002_shocking_inertia.sql",
  "0003_steep_red_skull.sql",
  "0004_pink_spirit.sql",
  "0005_eminent_serpent_society.sql",
  "0006_rich_morg.sql",
  "0007_parallel_earthquake.sql",
  "0008_furry_ben_grimm.sql",
  "0009_add_fks.sql",
  "0010_dark_miek.sql",
  "0011_fearless_brother_voodoo.sql",
  "0012_ambitious_enchantress.sql",
  "0013_lucky_captain_cross.sql",
];
const TARGET_MIGRATION = "0014_talented_deathstrike.sql";

const NEW_TABLES = [
  "harness_run_attempts",
  "harness_run_checkpoints",
  "harness_run_events",
  "harness_run_outputs",
  "harness_session_outbox",
];

const NEW_RUN_COLUMNS = [
  "run_kind",
  "workflow_id",
  "workflow_version",
  "current_step_key",
  "submission_key",
  "event_sequence",
  "available_at",
  "recovery_count",
  "cancel_requested_at",
  "cancel_requested_by",
  "last_checkpoint_id",
  "execution_config",
  "retry_of_run_id",
];

const NEW_INDEXES = [
  "harness_run_attempts_run_attempt_unique",
  "harness_run_attempts_active_run_unique",
  "harness_run_attempts_lease_idx",
  "harness_run_checkpoints_run_sequence_unique",
  "harness_run_checkpoints_run_key_unique",
  "harness_run_checkpoints_run_created_idx",
  "harness_run_events_run_sequence_unique",
  "harness_run_events_run_created_idx",
  "harness_run_outputs_run_unique",
  "harness_session_outbox_session_dedupe_unique",
  "harness_session_outbox_pending_idx",
  "harness_session_outbox_run_idx",
  "harness_artifacts_run_artifact_unique",
  "harness_runs_queue_idx",
  "harness_runs_owner_submission_unique",
  "harness_runs_active_workbench_session_unique",
  "harness_tool_events_run_effect_unique",
];

function randomDatabaseName(): string {
  const charset = "abcdefghijklmnopqrstuvwxyz0123456789_";
  let suffix = "";
  for (let i = 0; i < 12; i += 1) {
    suffix += charset[Math.floor(Math.random() * charset.length)];
  }
  return `rp047_a2_${suffix}`;
}

async function runMigrationFile(pool: Pool, fileName: string): Promise<void> {
  const raw = await readFile(path.join(migrationsFolder, fileName), "utf-8");
  const statements = raw.split("--> statement-breakpoint").map((part) => part.trim());
  for (const statement of statements) {
    if (statement.length > 0) {
      await pool.query(statement);
    }
  }
}

let adminPool: Pool | null = null;
let randomPool: Pool | null = null;
let databaseName = "";

before(async () => {
  if (!testDatabaseUrl) return;
  const parsed = new URL(testDatabaseUrl);
  const adminUri = `${parsed.protocol}//${parsed.username}:${parsed.password}@${parsed.host}/postgres`;
  adminPool = new Pool({ connectionString: adminUri, max: 2 });
  databaseName = randomDatabaseName();
  await adminPool.query(`CREATE DATABASE ${databaseName}`);
  const targetUri = `${parsed.protocol}//${parsed.username}:${parsed.password}@${parsed.host}/${databaseName}`;
  randomPool = new Pool({ connectionString: targetUri, max: 2 });
});

after(async () => {
  if (randomPool) {
    await randomPool.end();
    randomPool = null;
  }
  if (adminPool && databaseName) {
    await adminPool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`,
    );
    await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName}`);
  }
  if (adminPool) await adminPool.end();
});

test("historical migrations replay then 0014 backfills legacy rows additively", { skip: !testDatabaseUrl }, async () => {
  // 1. 按文件顺序重放 0000..0013
  for (const fileName of HISTORICAL_MIGRATIONS) {
    await runMigrationFile(randomPool!, fileName);
  }

  // 2. 插入 legacy Run、tool event、artifact（0014 前的结构）
  const runId = randomUUID();
  await randomPool!.query(
    `INSERT INTO harness_runs (harness_run_id, owner_user_id, owner_username, mode, stage, status, title)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [runId, "legacy-owner", "legacy-user", "interactive", "completed", "completed", "历史评估"],
  );
  await randomPool!.query(
    `INSERT INTO harness_tool_events (harness_tool_event_id, harness_run_id, tool_name, event_type, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), runId, "legacy_tool", "tool_call", "succeeded"],
  );
  await randomPool!.query(
    `INSERT INTO harness_artifacts (harness_artifact_id, harness_run_id, artifact_type, title, version, status, content)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), runId, "report", "历史报告", "1", "final", JSON.stringify({ legacy: true })],
  );

  // 3. 执行唯一 0014
  await runMigrationFile(randomPool!, TARGET_MIGRATION);

  // 4. legacy Run 自动补齐默认值
  const runRows = await randomPool!.query(
    `SELECT run_kind, workflow_id, workflow_version, event_sequence, recovery_count
     FROM harness_runs WHERE harness_run_id = $1`,
    [runId],
  );
  assert.equal(runRows.rowCount, 1);
  assert.equal(runRows.rows[0].run_kind, "file_analysis");
  assert.equal(runRows.rows[0].workflow_id, "legacy_file_analysis");
  assert.equal(runRows.rows[0].workflow_version, "v1");
  assert.equal(Number(runRows.rows[0].event_sequence), 0);
  assert.equal(Number(runRows.rows[0].recovery_count), 0);

  // 5. legacy 新键均为 null
  const effectRows = await randomPool!.query(
    `SELECT effect_key FROM harness_tool_events WHERE harness_run_id = $1`,
    [runId],
  );
  assert.equal(effectRows.rowCount, 1);
  assert.equal(effectRows.rows[0].effect_key, null);
  const artifactRows = await randomPool!.query(
    `SELECT artifact_key FROM harness_artifacts WHERE harness_run_id = $1`,
    [runId],
  );
  assert.equal(artifactRows.rowCount, 1);
  assert.equal(artifactRows.rows[0].artifact_key, null);

  // 6. 5 张新表存在
  const tableRows = await randomPool!.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [NEW_TABLES],
  );
  const existingTables = new Set(tableRows.rows.map((row) => row.table_name));
  for (const tableName of NEW_TABLES) {
    assert.ok(existingTables.has(tableName), `missing table ${tableName}`);
  }

  // 7. harness_runs 的 13 个新列存在
  const columnRows = await randomPool!.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'harness_runs' AND column_name = ANY($1::text[])`,
    [NEW_RUN_COLUMNS],
  );
  const existingColumns = new Set(columnRows.rows.map((row) => row.column_name));
  for (const columnName of NEW_RUN_COLUMNS) {
    assert.ok(existingColumns.has(columnName), `missing column harness_runs.${columnName}`);
  }

  // 8. 全部新索引存在
  const indexRows = await randomPool!.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
    [NEW_INDEXES],
  );
  const existingIndexes = new Set(indexRows.rows.map((row) => row.indexname));
  for (const indexName of NEW_INDEXES) {
    assert.ok(existingIndexes.has(indexName), `missing index ${indexName}`);
  }
});
