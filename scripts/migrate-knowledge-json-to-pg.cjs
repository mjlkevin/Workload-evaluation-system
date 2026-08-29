#!/usr/bin/env node
// ============================================================
// 【定性：一次性补救脚本，最终应转为 seed.ts 正式条目后删除】
// ------------------------------------------------------------
// 判断：本脚本只解决「当前这套已运行的 PG 缺存量词条」，不是长期方案。
// 理由：apps/api/src/db/seed.ts 才是切换 PG 后 JSON 的官方只读 seed 通道，
//       其播种清单含 version_code_rules / templates / rule_sets /
//       system_configs 四类，唯独漏了 knowledge_entries —— 这正是本次
//       「AI 检索恒空」事故的根因结构：新库一旦重建（测试环境重置、
//       新开发者初始化、灾难恢复），种子语料不会被带回，同一 bug 必复现。
// 后续动作（需架构侧批准后单独排期，本次不改 seed.ts）：
//   1. 在 seed.ts 的 seedBaseConfig() 增加第 5 项 knowledge_entries 播种，
//      保持同款幂等口径（onConflictDoNothing，不 TRUNCATE、不覆盖运行时写入）；
//   2. 迁移完成后删除本脚本，避免两条路径写同一张表产生口径漂移。
// ============================================================
// 用法：cd apps/api && node ../scripts/migrate-knowledge-json-to-pg.cjs
const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.join(__dirname, "..", "apps", "api", ".env") });
const { Client } = require("pg");

const STORE_PATH = path.join(__dirname, "..", "config", "knowledge", "store.json");

async function main() {
  const raw = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  const entries = Array.isArray(raw.entries) ? raw.entries : [];
  if (entries.length === 0) {
    console.log("store.json 无词条，跳过");
    return;
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let inserted = 0;
  let skipped = 0;
  for (const e of entries) {
    if (!e || !e.id || !e.title || !e.content) {
      console.warn(`跳过缺字段词条: ${JSON.stringify(e && e.id)}`);
      skipped += 1;
      continue;
    }
    const res = await client.query(
      `INSERT INTO knowledge_entries (id, title, content, category, tags, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'active', now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [e.id, e.title, e.content, e.category || "general", JSON.stringify(e.tags || [])],
    );
    if (res.rowCount > 0) inserted += 1;
    else skipped += 1;
  }
  const total = await client.query("SELECT COUNT(*)::int n FROM knowledge_entries WHERE status = 'active'");
  console.log(`迁移完成：新增 ${inserted} 条，跳过（已存在/无效） ${skipped} 条，当前有效词条总数 ${total.rows[0].n}`);
  await client.end();
}

main().catch((err) => {
  console.error("迁移失败:", err.message);
  process.exit(1);
});
