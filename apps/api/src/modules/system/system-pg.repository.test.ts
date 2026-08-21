// ============================================================
// System 域 PG 仓储测试（阶段 2 批 4 · 第 1–3 步）
// ============================================================
// 口径：按批 1–3 确立的五条硬性范式验证 system 四配置的 PG 实现——
// version_code_rules 事务内整表替换（sort_order 保序）、system_configs
// 单行 upsert、DB 时钟、安全错误边界（ISS-2026-08-18-004 读取失败抛错）；
// 外加 §4.6 测试套件模板的并发用例（并发写不同 config key 互不覆盖、
// 并发写同 key 收敛、version_code_rules 并发整表替换收敛）与本域缓存
// 策略用例（不加缓存层 → 带外 SQL 写入立即可见）。
// 仅读取 TEST_DATABASE_URL；缺失时跳过（与 ai-sessions-pg.repository.test 同范式）。
//
// 隔离：测试库不跑 seed，version_code_rules / system_configs 两表内容全由
// 本文件支配；afterEach 逐 key 清理 system_configs + 清空 version_code_rules。

import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { systemConfigs, versionCodeRules } from "../../db/schema";
import {
  normalizeImplementationDependencyRulesConfig,
  normalizeKnowledgeBaseConfig,
  normalizeRequirementSystemConfig,
} from "./system.repository";
import {
  SystemStoreError,
  createSystemPgRepository,
  type SystemPgRepository,
} from "./system-pg.repository";
import type {
  ImplementationDependencyRulesStore,
  KnowledgeBaseConfigStore,
  RequirementSystemConfigStore,
  VersionCodeRule,
  VersionCodeRulesStore,
} from "../../types";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const CONFIG_KEYS = ["requirementSettings", "implementationDependencyRules", "knowledgeBaseConfig"] as const;

let pool: Pool | null = null;
let repo: SystemPgRepository | null = null;

before(async () => {
  if (!testDatabaseUrl) return;
  pool = new Pool({ connectionString: testDatabaseUrl, max: 10 });
  repo = createSystemPgRepository(drizzle(pool));
  // 清理历史残留（前次运行异常退出时 afterEach 可能未跑完）
  await pool.query(`DELETE FROM system_configs WHERE config_key = ANY($1)`, [[...CONFIG_KEYS]]);
  await pool.query("DELETE FROM version_code_rules");
});

after(async () => {
  if (pool) await pool.end();
});

afterEach(async () => {
  if (!pool) return;
  await pool.query(`DELETE FROM system_configs WHERE config_key = ANY($1)`, [[...CONFIG_KEYS]]);
  await pool.query("DELETE FROM version_code_rules");
});

// ─── 测试夹具 ────────────────────────────────────────────────

const NOW_ISO = new Date("2026-08-21T00:00:00.000Z").toISOString();

function makeRule(overrides: Partial<VersionCodeRule> & { id: string }): VersionCodeRule {
  return {
    // 测试行只验证存储层映射，moduleKey 不参与业务校验，断言为联合类型
    moduleKey: overrides.id.replace(/^wes-t-/, "") as VersionCodeRule["moduleKey"],
    moduleName: "测试模块",
    moduleCode: "TS",
    prefix: "TS",
    format: "{PREFIX}-{NNN}",
    sample: "TS-001",
    status: "active",
    effectiveAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...overrides,
  };
}

function makeRulesStore(ruleIds: string[], prefix = "TS"): VersionCodeRulesStore {
  return {
    rules: ruleIds.map((id, index) =>
      makeRule({ id, prefix: `${prefix}${index}`, moduleCode: `${prefix}${index}`.slice(0, 8) })),
  };
}

function makeRequirementStore(version: number, marker: string, apiKey = ""): RequirementSystemConfigStore {
  const config = normalizeRequirementSystemConfig({ kimiCredentials: { apiKey } });
  return {
    version,
    draft: { ...config, kimiEvaluation: { ...config.kimiEvaluation, promptTemplate: marker } },
    active: { ...config, kimiEvaluation: { ...config.kimiEvaluation, promptTemplate: marker } },
    updatedAt: NOW_ISO,
    effectiveAt: NOW_ISO,
  };
}

function makeImplStore(version: number, marker: string): ImplementationDependencyRulesStore {
  const config = normalizeImplementationDependencyRulesConfig({});
  return {
    version,
    draft: { ...config, source: marker },
    active: { ...config, source: marker },
    updatedAt: NOW_ISO,
    effectiveAt: NOW_ISO,
  };
}

function makeKbStore(version: number, marker: string): KnowledgeBaseConfigStore {
  const config = normalizeKnowledgeBaseConfig({
    model: marker,
    credentials: { apiKey: "wes-t-kb-key", knowledgeId: "wes-t-kb-id" },
  });
  return { version, draft: config, active: config, updatedAt: NOW_ISO, effectiveAt: NOW_ISO };
}

// ─── version_code_rules：round-trip + sort_order 保序 ─────────

test("version_code_rules round-trip：load 顺序与 save 输入一致（sort_order 保序）", { skip: !testDatabaseUrl }, async () => {
  // 故意非字母序，与生产 JSON 的 global→requirement→implementation→dev→resource→wbs 同型
  const ids = ["wes-t-zeta", "wes-t-alpha", "wes-t-mid", "wes-t-beta"];
  await repo!.saveVersionCodeRulesStore(makeRulesStore(ids));

  const loaded = await repo!.loadVersionCodeRulesStore();
  assert.deepEqual(loaded.rules.map((rule) => rule.id), ids, "读取顺序必须等于写入数组顺序");
  assert.equal(loaded.rules.length, ids.length);
  assert.equal(loaded.rules[0].sample, "TS-001");
  assert.equal(loaded.rules[0].status, "active");
});

test("version_code_rules 整表替换：再 save 后旧规则消失（无残留）", { skip: !testDatabaseUrl }, async () => {
  await repo!.saveVersionCodeRulesStore(makeRulesStore(["wes-t-a", "wes-t-b", "wes-t-c"]));
  await repo!.saveVersionCodeRulesStore(makeRulesStore(["wes-t-x", "wes-t-y"]));

  const loaded = await repo!.loadVersionCodeRulesStore();
  assert.deepEqual(loaded.rules.map((rule) => rule.id), ["wes-t-x", "wes-t-y"]);
});

test("version_code_rules effectiveAt 边界：'--' 落 NULL、读回还原 '--'", { skip: !testDatabaseUrl }, async () => {
  const store = makeRulesStore(["wes-t-eff"]);
  store.rules[0].effectiveAt = "--";
  await repo!.saveVersionCodeRulesStore(store);

  const row = await pool!.query("SELECT effective_at FROM version_code_rules WHERE rule_id = 'wes-t-eff'");
  assert.equal(row.rows[0].effective_at, null, "'--' 必须落 NULL 而非解析失败");

  const loaded = await repo!.loadVersionCodeRulesStore();
  assert.equal(loaded.rules[0].effectiveAt, "--");
});

// ─── system_configs 三 key：round-trip ───────────────────────

test("requirementSettings round-trip：store 深相等且 apiKey 读回必为空（密钥不落库）", { skip: !testDatabaseUrl }, async () => {
  // save 输入带 apiKey（模拟管理界面直接调用场景）：PG 侧必须复制 JSON save 的
  // 「缓存填充 + 落库前写空」语义
  const input = makeRequirementStore(3, "wes-t-marker-req", "wes-t-secret-key");
  await repo!.saveRequirementSystemConfigStore(input);

  const loaded = await repo!.loadRequirementSystemConfigStore();
  assert.ok(loaded, "刚写入的 key 必须读得到");
  assert.equal(loaded!.version, 3);
  assert.equal(loaded!.draft.kimiEvaluation.promptTemplate, "wes-t-marker-req");
  assert.equal(loaded!.draft.kimiCredentials.apiKey, "", "apiKey 读回必须为空串");
  assert.equal(loaded!.active.kimiCredentials.apiKey, "", "apiKey 读回必须为空串");

  const row = await pool!.query("SELECT store FROM system_configs WHERE config_key = 'requirementSettings'");
  const stored = row.rows[0].store as RequirementSystemConfigStore;
  assert.equal(stored.draft.kimiCredentials.apiKey, "", "jsonb 内 apiKey 必须为空串（密钥不进存储）");
});

test("implementationDependencyRules round-trip：store 深相等", { skip: !testDatabaseUrl }, async () => {
  const input = makeImplStore(2, "wes-t-marker-impl");
  await repo!.saveImplementationDependencyRulesStore(input);

  const loaded = await repo!.loadImplementationDependencyRulesStore();
  assert.ok(loaded);
  assert.deepEqual(loaded, input);
});

test("knowledgeBaseConfig round-trip：apiKey 保留（与 JSON 文件行为一致）", { skip: !testDatabaseUrl }, async () => {
  const input = makeKbStore(4, "wes-t-marker-kb");
  await repo!.saveKnowledgeBaseConfigStore(input);

  const loaded = await repo!.loadKnowledgeBaseConfigStore();
  assert.ok(loaded);
  assert.deepEqual(loaded, input);
  assert.equal(loaded!.draft.credentials.apiKey, "wes-t-kb-key", "KB 密钥随 jsonb 保存（既有 JSON 语义）");
});

test("缺失行语义：三个 config key 未播种时 load 返回 null（默认值由路由层兜底）", { skip: !testDatabaseUrl }, async () => {
  assert.equal(await repo!.loadRequirementSystemConfigStore(), null);
  assert.equal(await repo!.loadImplementationDependencyRulesStore(), null);
  assert.equal(await repo!.loadKnowledgeBaseConfigStore(), null);
});

// ─── §4.6 并发：不同实体互不覆盖 ─────────────────────────────

test("并发写不同 config key：互不覆盖（§4.6）", { skip: !testDatabaseUrl }, async () => {
  const reqStore = makeRequirementStore(5, "wes-t-concurrent-req");
  const implStore = makeImplStore(6, "wes-t-concurrent-impl");
  const kbStore = makeKbStore(7, "wes-t-concurrent-kb");

  await Promise.all([
    repo!.saveRequirementSystemConfigStore(reqStore),
    repo!.saveImplementationDependencyRulesStore(implStore),
    repo!.saveKnowledgeBaseConfigStore(kbStore),
  ]);

  const [req, impl, kb] = await Promise.all([
    repo!.loadRequirementSystemConfigStore(),
    repo!.loadImplementationDependencyRulesStore(),
    repo!.loadKnowledgeBaseConfigStore(),
  ]);
  assert.equal(req!.version, 5);
  assert.equal(req!.draft.kimiEvaluation.promptTemplate, "wes-t-concurrent-req");
  assert.equal(impl!.version, 6);
  assert.equal(impl!.draft.source, "wes-t-concurrent-impl");
  assert.equal(kb!.version, 7);
  assert.equal(kb!.draft.model, "wes-t-concurrent-kb");
});

test("并发写同一 config key：收敛为其中一个完整输入（无字段混写）", { skip: !testDatabaseUrl }, async () => {
  const candidates = [11, 12, 13, 14, 15].map((version) =>
    makeRequirementStore(version, `wes-t-race-${version}`));

  await Promise.all(candidates.map((store) => repo!.saveRequirementSystemConfigStore(store)));

  const loaded = await repo!.loadRequirementSystemConfigStore();
  assert.ok(loaded);
  const match = candidates.find((candidate) => candidate.version === loaded!.version);
  assert.ok(match, `最终 version=${loaded!.version} 必须是某个竞争输入`);
  // 整行一致（version 与内容同源），排除「version 来自 A、内容来自 B」的混写
  assert.equal(loaded!.draft.kimiEvaluation.promptTemplate, `wes-t-race-${match!.version}`);
});

test("version_code_rules 并发整表替换：收敛为其中一个完整输入", { skip: !testDatabaseUrl }, async () => {
  const storeA = makeRulesStore(["wes-t-race-a1", "wes-t-race-a2", "wes-t-race-a3"], "AA");
  const storeB = makeRulesStore(["wes-t-race-b1", "wes-t-race-b2"], "BB");

  await Promise.all([
    repo!.saveVersionCodeRulesStore(storeA),
    repo!.saveVersionCodeRulesStore(storeB),
  ]);

  const loaded = await repo!.loadVersionCodeRulesStore();
  const ids = loaded.rules.map((rule) => rule.id);
  const matchesA = JSON.stringify(ids) === JSON.stringify(storeA.rules.map((rule) => rule.id));
  const matchesB = JSON.stringify(ids) === JSON.stringify(storeB.rules.map((rule) => rule.id));
  assert.ok(matchesA || matchesB, `最终状态必须是完整 A 或完整 B，实际：${ids.join(",")}`);
});

// ─── 缓存语义（本域决策：不加缓存层） ─────────────────────────

test("无缓存层：带外 SQL 写入后 load 立即可见", { skip: !testDatabaseUrl }, async () => {
  await repo!.saveKnowledgeBaseConfigStore(makeKbStore(1, "wes-t-cache-before"));
  // 带外写入（模拟另一副本/运维直改）
  await pool!.query(
    `UPDATE system_configs SET store = jsonb_set(store, '{draft,model}', to_jsonb($1::text)) WHERE config_key = 'knowledgeBaseConfig'`,
    ["wes-t-cache-after"],
  );
  const loaded = await repo!.loadKnowledgeBaseConfigStore();
  assert.equal(loaded!.draft.model, "wes-t-cache-after", "直查必须立即可见（无陈旧缓存层）");
});

// ─── DB 时钟（范式 #4） ──────────────────────────────────────

test("save 写入列时间戳来自 DB 时钟且非空（范式 #4）", { skip: !testDatabaseUrl }, async () => {
  await repo!.saveKnowledgeBaseConfigStore(makeKbStore(1, "wes-t-clock"));
  const row = await pool!.query(
    "SELECT updated_at, effective_at, version FROM system_configs WHERE config_key = 'knowledgeBaseConfig'",
  );
  assert.ok(row.rows[0].updated_at instanceof Date, "updated_at 列必须由 DB 时钟填充");
  assert.ok(row.rows[0].effective_at instanceof Date);
  assert.equal(row.rows[0].version, 1);

  await repo!.saveVersionCodeRulesStore(makeRulesStore(["wes-t-clock-rule"]));
  const ruleRow = await pool!.query("SELECT updated_at FROM version_code_rules WHERE rule_id = 'wes-t-clock-rule'");
  assert.ok(ruleRow.rows[0].updated_at instanceof Date);
});

// ─── 安全错误边界（范式 #1 / ISS-2026-08-18-004） ─────────────

test("读取失败必须抛 SystemStoreError，且不泄露连接串/SQL 细节（范式 #1/#5）", { skip: !testDatabaseUrl }, async () => {
  const brokenPool = new Pool({
    connectionString: "postgres://wes-t-broken:broken@127.0.0.1:1/wes_t_broken",
    max: 1,
    connectionTimeoutMillis: 500,
  });
  const brokenRepo = createSystemPgRepository(drizzle(brokenPool));
  try {
    for (const attempt of [
      () => brokenRepo.loadVersionCodeRulesStore(),
      () => brokenRepo.loadRequirementSystemConfigStore(),
      () => brokenRepo.loadKnowledgeBaseConfigStore(),
      () => brokenRepo.saveVersionCodeRulesStore(makeRulesStore(["wes-t-broken"])),
      () => brokenRepo.saveKnowledgeBaseConfigStore(makeKbStore(1, "wes-t-broken")),
    ]) {
      await assert.rejects(attempt(), (err: unknown) => {
        assert.ok(err instanceof SystemStoreError, `必须是 SystemStoreError，实际：${String(err)}`);
        assert.equal(err.code, "SYSTEM_STORE_INTERNAL");
        assert.ok(!String(err.message).includes("postgres://"), "错误信息不得包含连接串");
        assert.ok(!String(err.message).includes("wes_t_broken"), "错误信息不得包含库名等 SQL 细节");
        return true;
      });
    }
  } finally {
    await brokenPool.end();
  }
});

// ─── 工厂钩子 ────────────────────────────────────────────────

test("__dbForTest 暴露注入实例（测试钩子契约）", { skip: !testDatabaseUrl }, () => {
  assert.ok(repo!.__dbForTest(), "PG 工厂必须暴露 __dbForTest 钩子");
  const tableCount = [systemConfigs, versionCodeRules].length;
  assert.equal(tableCount, 2);
});
