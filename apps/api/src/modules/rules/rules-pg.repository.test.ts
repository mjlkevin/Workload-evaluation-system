// ============================================================
// RuleSets 域 PG 仓储测试（阶段 2 批 8 · 第 1–3 步）
// ============================================================
// 口径：与 templates-pg.repository.test.ts 同构——验证单文档规则集
// 的 PG 实现：单行 upsert 幂等、整文档替换语义（活动规则集 = 最近
// 写入行）、DB 时钟、安全错误边界、缺行抛错；外加 §4.6 并发用例
// （同 ruleSetId 并发写收敛无字段混写 / 不同 ruleSetId 并发写读侧
// 确定性取最新）与缓存策略用例（不加缓存层 → 带外 SQL 写入立即可见）。
// 仅读取 TEST_DATABASE_URL；缺失时按 §4.6 规则诚实报 skip。
//
// 隔离（§4.9 C5）：全部规则集行使用 wes-t-rules-* ruleSetId 前缀，
// 清理为条件 DELETE（cleanupRuleSetRowsByPrefix），不做整表计数与
// 整表清理。本域表仅本文件触碰（已核实无其他套件读写 rule_sets 表）。
//
// 缺行/错误边界用例不依赖真实库：以最小 stub executor 注入
// 仓储构造器，无库环境同样真实执行。

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type { RuleSet } from "../../types";
import {
  RuleSetStoreError,
  cleanupRuleSetRowsByPrefix,
  countRuleSetRowsByPrefix,
  createRuleSetsPgRepository,
  type RuleSetsPgRepository,
} from "./rules-pg.repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// 数据集隔离前缀：本文件所有规则集行 ruleSetId 均以此开头
const RULE_SET_PREFIX = "wes-t-rules-";

let pool: Pool | null = null;
let repo: RuleSetsPgRepository | null = null;

// PG 的 jsonb 不保留对象键序（按键长排序），JSON.stringify 对比会产生
// 假阴；深相等比较（键序无关）才是往返一致性判定的可靠口径。
function deepEquals(a: unknown, b: unknown): boolean {
  try {
    assert.deepEqual(a, b);
    return true;
  } catch {
    return false;
  }
}

function makeRuleSet(salt: string): RuleSet {
  return {
    ruleSetId: `${RULE_SET_PREFIX}${salt}`,
    ruleVersion: `rv-${salt}`,
    pipelineVersion: `pv-${salt}`,
    pipeline: ["base", `user-increment-${salt}`, "difficulty-increment", "org-increment"],
    baseRule: {
      userCountTiers: [
        { min: 1, max: 100, factor: 1 },
        { min: 101, max: 500, factor: 1.2 },
      ],
      difficultyFactorList: [1, 1.1, 1.3],
      userIncrementRounding: "ceil_int",
    },
    orgIncrementRule: { enabled: true, factor: 0.15 },
  };
}

async function cleanOwnRows(): Promise<void> {
  if (repo) await cleanupRuleSetRowsByPrefix(repo.__dbForTest(), RULE_SET_PREFIX);
}

before(async () => {
  if (!testDatabaseUrl) return;
  pool = new Pool({ connectionString: testDatabaseUrl, max: 6 });
  repo = createRuleSetsPgRepository(drizzle(pool));
  // 清理历史残留（前次运行异常退出时 beforeEach 可能未跑完）
  await cleanOwnRows();
});

beforeEach(cleanOwnRows);

after(async () => {
  await cleanOwnRows();
  if (pool) await pool!.end();
});

// ─── 基础读写与语义（有库套件，缺库诚实 skip）──────────────────

test("全字段往返：标量 + pipeline + baseRule + orgIncrementRule 一致", { skip: !testDatabaseUrl }, async () => {
  const input = makeRuleSet("roundtrip");
  await repo!.saveRuleSet(input);
  const loaded = await repo!.loadRuleSet();
  assert.equal(loaded.ruleSetId, input.ruleSetId);
  assert.equal(loaded.ruleVersion, input.ruleVersion);
  assert.equal(loaded.pipelineVersion, input.pipelineVersion);
  assert.deepEqual(loaded.pipeline, input.pipeline);
  assert.deepEqual(loaded.baseRule, input.baseRule);
  assert.deepEqual(loaded.orgIncrementRule, input.orgIncrementRule);
  assert.equal(await countRuleSetRowsByPrefix(repo!.__dbForTest(), RULE_SET_PREFIX), 1);
});

test("幂等：同一输入重复保存结果不变、行数不增", { skip: !testDatabaseUrl }, async () => {
  const input = makeRuleSet("idempotent");
  await repo!.saveRuleSet(input);
  await repo!.saveRuleSet(input);
  assert.equal(await countRuleSetRowsByPrefix(repo!.__dbForTest(), RULE_SET_PREFIX), 1);
  const loaded = await repo!.loadRuleSet();
  assert.deepEqual(loaded.baseRule, input.baseRule);
});

test("整文档替换语义：新 ruleSetId 保存后 load 返回新文档", { skip: !testDatabaseUrl }, async () => {
  await repo!.saveRuleSet(makeRuleSet("replace-a"));
  await repo!.saveRuleSet(makeRuleSet("replace-b"));
  const loaded = await repo!.loadRuleSet();
  assert.equal(loaded.ruleSetId, `${RULE_SET_PREFIX}replace-b`);
  assert.equal(loaded.ruleVersion, "rv-replace-b");
});

// ─── §4.6 并发验证 ────────────────────────────────────────────

test("并发写同一 ruleSetId（不同内容）：收敛为完整输入，无字段混写", { skip: !testDatabaseUrl }, async () => {
  const ruleSetId = `${RULE_SET_PREFIX}same-id`;
  const variants = ["c1", "c2", "c3", "c4"].map((salt) => ({ ...makeRuleSet(salt), ruleSetId }));
  await Promise.all(variants.map((variant) => repo!.saveRuleSet(variant)));
  assert.equal(await countRuleSetRowsByPrefix(repo!.__dbForTest(), RULE_SET_PREFIX), 1);
  const loaded = await repo!.loadRuleSet();
  // 收敛结果必须整体等于某个完整输入（不允许字段混写；
  // jsonb 不保留键序，用深相等而非 JSON.stringify 对比）
  const matched = variants.some(
    (variant) =>
      loaded.ruleVersion === variant.ruleVersion &&
      loaded.pipelineVersion === variant.pipelineVersion &&
      deepEquals(loaded.pipeline, variant.pipeline) &&
      deepEquals(loaded.baseRule, variant.baseRule) &&
      deepEquals(loaded.orgIncrementRule, variant.orgIncrementRule),
  );
  assert.ok(matched, "并发写同 ruleSetId 应收敛为某一完整输入");
});

test("并发写不同 ruleSetId：全部生效、读侧确定性取最新", { skip: !testDatabaseUrl }, async () => {
  const variants = ["x1", "x2", "x3", "x4"].map((salt) => makeRuleSet(salt));
  await Promise.all(variants.map((variant) => repo!.saveRuleSet(variant)));
  assert.equal(await countRuleSetRowsByPrefix(repo!.__dbForTest(), RULE_SET_PREFIX), 4);
  const first = await repo!.loadRuleSet();
  const second = await repo!.loadRuleSet();
  // 确定性排序：重复读取结果一致
  assert.equal(first.ruleSetId, second.ruleSetId);
  // 活动文档必为某个完整输入
  assert.ok(
    variants.some((variant) => variant.ruleSetId === first.ruleSetId),
    "活动规则集应为本批写入的某个完整输入",
  );
});

// ─── 时钟与缓存策略 ───────────────────────────────────────────

test("DB 时钟：updated_at 落在保存前后两次 SELECT now() 之间（毫秒截断容差）", { skip: !testDatabaseUrl }, async () => {
  // 用 EXTRACT(EPOCH) 取数值比较：pg 驱动对 timestamptz 的类型解析在
  // 不同查询形态下可能是 Date 也可能是字符串，数值比较无歧义。
  // 容差说明：readDbNow 经 JS Date 回写，updated_at 被截断到毫秒；
  // before 的微秒部分（如 .642069）可能大于截断后的值（.642），
  // 故下界按毫秒下取整（-0.001 余量），上界不变（截断只会更早）。
  const dbInstance = repo!.__dbForTest();
  const epochOf = async (query: ReturnType<typeof sql>): Promise<number> =>
    Number((await dbInstance.execute(query)).rows[0].epoch);
  const beforeEpoch = await epochOf(sql`SELECT EXTRACT(EPOCH FROM now()) AS epoch`);
  await repo!.saveRuleSet(makeRuleSet("dbclock"));
  const afterEpoch = await epochOf(sql`SELECT EXTRACT(EPOCH FROM now()) AS epoch`);
  const updatedEpoch = await epochOf(
    sql`SELECT EXTRACT(EPOCH FROM updated_at) AS epoch FROM rule_sets WHERE rule_set_id LIKE ${RULE_SET_PREFIX + "%"}`,
  );
  assert.ok(
    updatedEpoch >= beforeEpoch - 0.001 && updatedEpoch <= afterEpoch,
    `updated_at 应为 DB 时钟（before=${beforeEpoch} updated=${updatedEpoch} after=${afterEpoch}）`,
  );
});

test("带外 SQL 写入立即可见（不加缓存层的证明）", { skip: !testDatabaseUrl }, async () => {
  const dbInstance = repo!.__dbForTest();
  await repo!.saveRuleSet(makeRuleSet("oob-base"));
  await dbInstance.execute(
    sql`UPDATE rule_sets SET rule_version = ${"带外改版本"} WHERE rule_set_id LIKE ${RULE_SET_PREFIX + "%"}`,
  );
  const loaded = await repo!.loadRuleSet();
  assert.equal(loaded.ruleVersion, "带外改版本");
});

// ─── 无库套件：缺行/错误边界（stub executor，真实执行不 skip）──

test("缺行读取抛 RULE_SET_STORE_NOT_FOUND（对齐 JSON 缺文件抛错）", async () => {
  const stub = {
    select: () => ({
      from: () => ({
        orderBy: () => ({
          limit: async () => [],
        }),
      }),
    }),
  };
  const stubRepo = createRuleSetsPgRepository(stub as never);
  await assert.rejects(
    () => stubRepo.loadRuleSet(),
    (err: unknown) => err instanceof RuleSetStoreError && err.code === "RULE_SET_STORE_NOT_FOUND",
  );
});

test("错误边界收敛：基础设施错误不外泄连接串", async () => {
  const secret = "postgres://user:hunter2@db.internal:5432/prod";
  const stub = {
    select: () => {
      throw new Error(`connection refused: ${secret}`);
    },
    transaction: async () => {
      throw new Error(`connection refused: ${secret}`);
    },
  };
  const stubRepo = createRuleSetsPgRepository(stub as never);
  await assert.rejects(
    () => stubRepo.loadRuleSet(),
    (err: unknown) =>
      err instanceof RuleSetStoreError &&
      err.code === "RULE_SET_STORE_INTERNAL" &&
      !err.message.includes(secret) &&
      !err.message.includes("hunter2"),
  );
  await assert.rejects(
    () => stubRepo.saveRuleSet(makeRuleSet("errcase")),
    (err: unknown) =>
      err instanceof RuleSetStoreError &&
      err.code === "RULE_SET_STORE_INTERNAL" &&
      !err.message.includes(secret),
  );
});
