// ============================================================
// Templates 域 PG 仓储测试（阶段 2 批 8 · 第 1–3 步）
// ============================================================
// 口径：按批 1–7 确立的五条硬性范式验证单文档模板的 PG 实现——
// 单行 upsert 幂等、整文档替换语义（活动文档 = 最近写入行）、
// DB 时钟、安全错误边界、缺行抛错；外加 §4.6 测试套件模板的并发
// 用例（同 templateId 并发写收敛无字段混写 / 不同 templateId 并发
// 写读侧确定性取最新）与缓存策略用例（不加缓存层 → 带外 SQL 写入
// 立即可见）。仅读取 TEST_DATABASE_URL；缺失时按 §4.6 规则诚实报
// skip（禁止空跑绿）。
//
// 隔离（批 3/5/6/7 口径，§4.9 C5）：共享测试库下多文件并发执行，
// 全部模板行使用 wes-t-tmpl-* templateId 前缀，清理为条件 DELETE
// （cleanupTemplateRowsByPrefix），不做整表计数与整表清理。
// 「活动文档 = 最近写入行」用例要求测试行 updated_at 最新。S6（2026-08-29）
// 起本域表不再只由本文件触碰——modules.usecase.test.ts 与
// modules.handlers.test.ts 也经 seedSingleDocStoreFixture 写入行（台账 B3
// 处置）；三个文件同在 test:modules:serial-store 串行套件内，由
// --test-concurrency=1 保证时序互斥，且各自用独立行前缀（wes-t-tmpl- /
// wes-t-uc- / wes-t-hdr-）。本文件测试行经仓储写入（readDbNow 当下时刻）
// 必然晚于任何存量行，且串行期内无其他写者，故取最新断言成立。
//
// 缺行/错误边界用例不依赖真实库：以最小 stub executor 注入
// 仓储构造器，验证纯逻辑分支（TEMPLATE_STORE_NOT_FOUND / 收敛不泄
// 连接串），无库环境同样真实执行。

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type { Template } from "../../types";
import {
  TemplateStoreError,
  cleanupTemplateRowsByPrefix,
  countTemplateRowsByPrefix,
  createTemplatesPgRepository,
  type TemplatesPgRepository,
} from "./templates-pg.repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// 数据集隔离前缀：本文件所有模板行 templateId 均以此开头
const TEMPLATE_PREFIX = "wes-t-tmpl-";

let pool: Pool | null = null;
let repo: TemplatesPgRepository | null = null;

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

function makeTemplate(salt: string, opts?: { noSheets?: boolean }): Template {
  const templateId = `${TEMPLATE_PREFIX}${salt}`;
  const template: Template = {
    templateId,
    templateVersion: `v-${salt}`,
    templateName: `UT 模板 ${salt}`,
    groups: [
      { groupId: "grp-1", groupName: `分组A-${salt}` },
      { groupId: "grp-2", groupName: `分组B-${salt}` },
    ],
    items: [
      {
        templateItemId: "item-1",
        groupId: "grp-1",
        itemName: `条目一-${salt}`,
        standardDays: 3.5,
        sheetName: "模块报价",
        cloudProduct: "云产品X",
        defaultIncluded: true,
      },
      {
        templateItemId: "item-2",
        groupId: "grp-2",
        itemName: `条目二-${salt}`,
        standardDays: 1,
      },
    ],
    sheets: [{ sheetId: "sheet-1", sheetName: "模块报价" }],
  };
  if (opts?.noSheets) delete template.sheets;
  return template;
}

async function cleanOwnRows(): Promise<void> {
  if (repo) await cleanupTemplateRowsByPrefix(repo.__dbForTest(), TEMPLATE_PREFIX);
}

before(async () => {
  if (!testDatabaseUrl) return;
  pool = new Pool({ connectionString: testDatabaseUrl, max: 6 });
  repo = createTemplatesPgRepository(drizzle(pool));
  // 清理历史残留（前次运行异常退出时 beforeEach 可能未跑完）
  await cleanOwnRows();
});

beforeEach(cleanOwnRows);

after(async () => {
  await cleanOwnRows();
  if (pool) await pool!.end();
});

// ─── 基础读写与语义（有库套件，缺库诚实 skip）──────────────────

test("全字段往返：标量 + groups + items + sheets 一致", { skip: !testDatabaseUrl }, async () => {
  const input = makeTemplate("roundtrip");
  await repo!.saveTemplate(input);
  const loaded = await repo!.loadTemplate();
  assert.equal(loaded.templateId, input.templateId);
  assert.equal(loaded.templateVersion, input.templateVersion);
  assert.equal(loaded.templateName, input.templateName);
  assert.deepEqual(loaded.groups, input.groups);
  assert.deepEqual(loaded.items, input.items);
  assert.deepEqual(loaded.sheets, input.sheets);
  assert.equal(await countTemplateRowsByPrefix(repo!.__dbForTest(), TEMPLATE_PREFIX), 1);
});

test("sheets 缺省归一化为 []（与 db:seed 口径一致）", { skip: !testDatabaseUrl }, async () => {
  const input = makeTemplate("nosheets", { noSheets: true });
  await repo!.saveTemplate(input);
  const loaded = await repo!.loadTemplate();
  assert.deepEqual(loaded.sheets, []);
});

test("幂等：同一输入重复保存结果不变、行数不增", { skip: !testDatabaseUrl }, async () => {
  const input = makeTemplate("idempotent");
  await repo!.saveTemplate(input);
  await repo!.saveTemplate(input);
  assert.equal(await countTemplateRowsByPrefix(repo!.__dbForTest(), TEMPLATE_PREFIX), 1);
  const loaded = await repo!.loadTemplate();
  assert.deepEqual(loaded.items, input.items);
});

test("整文档替换语义：新 templateId 保存后 load 返回新文档", { skip: !testDatabaseUrl }, async () => {
  await repo!.saveTemplate(makeTemplate("replace-a"));
  await repo!.saveTemplate(makeTemplate("replace-b"));
  const loaded = await repo!.loadTemplate();
  assert.equal(loaded.templateId, `${TEMPLATE_PREFIX}replace-b`);
  assert.equal(loaded.templateName, "UT 模板 replace-b");
});

// ─── §4.6 并发验证 ────────────────────────────────────────────

test("并发写同一 templateId（不同内容）：收敛为完整输入，无字段混写", { skip: !testDatabaseUrl }, async () => {
  const templateId = `${TEMPLATE_PREFIX}same-id`;
  const variants = ["c1", "c2", "c3", "c4"].map((salt) => ({ ...makeTemplate(salt), templateId }));
  await Promise.all(variants.map((variant) => repo!.saveTemplate(variant)));
  assert.equal(await countTemplateRowsByPrefix(repo!.__dbForTest(), TEMPLATE_PREFIX), 1);
  const loaded = await repo!.loadTemplate();
  // 收敛结果必须整体等于某个完整输入（不允许字段混写；
  // jsonb 不保留键序，用深相等而非 JSON.stringify 对比）
  const matched = variants.some(
    (variant) =>
      loaded.templateVersion === variant.templateVersion &&
      loaded.templateName === variant.templateName &&
      deepEquals(loaded.groups, variant.groups) &&
      deepEquals(loaded.items, variant.items),
  );
  assert.ok(matched, "并发写同 templateId 应收敛为某一完整输入");
});

test("并发写不同 templateId：全部生效、读侧确定性取最新", { skip: !testDatabaseUrl }, async () => {
  const variants = ["x1", "x2", "x3", "x4"].map((salt) => makeTemplate(salt));
  await Promise.all(variants.map((variant) => repo!.saveTemplate(variant)));
  assert.equal(await countTemplateRowsByPrefix(repo!.__dbForTest(), TEMPLATE_PREFIX), 4);
  const first = await repo!.loadTemplate();
  const second = await repo!.loadTemplate();
  // 确定性排序：重复读取结果一致
  assert.equal(first.templateId, second.templateId);
  // 活动文档必为某个完整输入
  assert.ok(
    variants.some((variant) => variant.templateId === first.templateId),
    "活动文档应为本批写入的某个完整输入",
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
  await repo!.saveTemplate(makeTemplate("dbclock"));
  const afterEpoch = await epochOf(sql`SELECT EXTRACT(EPOCH FROM now()) AS epoch`);
  const updatedEpoch = await epochOf(
    sql`SELECT EXTRACT(EPOCH FROM updated_at) AS epoch FROM templates WHERE template_id LIKE ${TEMPLATE_PREFIX + "%"}`,
  );
  assert.ok(
    updatedEpoch >= beforeEpoch - 0.001 && updatedEpoch <= afterEpoch,
    `updated_at 应为 DB 时钟（before=${beforeEpoch} updated=${updatedEpoch} after=${afterEpoch}）`,
  );
});

test("带外 SQL 写入立即可见（不加缓存层的证明）", { skip: !testDatabaseUrl }, async () => {
  const dbInstance = repo!.__dbForTest();
  await repo!.saveTemplate(makeTemplate("oob-base"));
  await dbInstance.execute(
    sql`UPDATE templates SET template_name = ${"带外改名"} WHERE template_id LIKE ${TEMPLATE_PREFIX + "%"}`,
  );
  const loaded = await repo!.loadTemplate();
  assert.equal(loaded.templateName, "带外改名");
});

// ─── 无库套件：缺行/错误边界（stub executor，真实执行不 skip）──

test("缺行读取抛 TEMPLATE_STORE_NOT_FOUND（对齐 JSON 缺文件抛错）", async () => {
  const stub = {
    select: () => ({
      from: () => ({
        orderBy: () => ({
          limit: async () => [],
        }),
      }),
    }),
  };
  const stubRepo = createTemplatesPgRepository(stub as never);
  await assert.rejects(
    () => stubRepo.loadTemplate(),
    (err: unknown) => err instanceof TemplateStoreError && err.code === "TEMPLATE_STORE_NOT_FOUND",
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
  const stubRepo = createTemplatesPgRepository(stub as never);
  await assert.rejects(
    () => stubRepo.loadTemplate(),
    (err: unknown) =>
      err instanceof TemplateStoreError &&
      err.code === "TEMPLATE_STORE_INTERNAL" &&
      !err.message.includes(secret) &&
      !err.message.includes("hunter2"),
  );
  await assert.rejects(
    () => stubRepo.saveTemplate(makeTemplate("errcase")),
    (err: unknown) =>
      err instanceof TemplateStoreError &&
      err.code === "TEMPLATE_STORE_INTERNAL" &&
      !err.message.includes(secret),
  );
});
