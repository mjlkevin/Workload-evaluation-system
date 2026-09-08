// ============================================================
// db:seed 守卫测试 —— 生产保护与输入校验（不触碰数据库）
// ============================================================
// 覆盖：ensureAdminSeed 生产缺密码拒绝 / 密码长度校验；
// seedBaseConfig --force 生产环境拒绝（记录 1 的 --force 评估实现后的守卫）；
// buildKnowledgeSeedRows 语料映射（seed 清单漏 knowledge_entries 的防复发守卫，
// 见 2026-08-28 「AI 检索恒空」事故：seed 播种清单不含知识词条，
// 新库重建后语料不会被带回，同一 bug 必复现）；
// buildIndustrySeedRows 行业主数据映射（批次 10a：一级种子逐字钉死为库中
// 真实值 制造业 / 其他、首批二级必须留空——防「凭空造一套分类」把本批
// 要解决的根因以「种子看起来更完整了」的形态再犯一次）。

import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { buildIndustrySeedRows, buildKnowledgeSeedRows, ensureAdminSeed, seedBaseConfig } from "./seed";
import { resolveRootDir } from "../utils/file";

test("ensureAdminSeed 生产环境缺少显式密码时拒绝执行", async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevPassword = process.env.WES_ADMIN_PASSWORD;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.WES_ADMIN_PASSWORD;
    await assert.rejects(
      () => ensureAdminSeed(),
      /生产环境必须通过 WES_ADMIN_PASSWORD/,
      "生产环境无显式密码必须拒绝执行",
    );
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    if (prevPassword === undefined) delete process.env.WES_ADMIN_PASSWORD;
    else process.env.WES_ADMIN_PASSWORD = prevPassword;
  }
});

test("ensureAdminSeed 初始密码不足 8 位时拒绝执行", async () => {
  await assert.rejects(
    () => ensureAdminSeed({ adminPassword: "short" }),
    /管理员初始密码至少 8 位/,
    "密码长度不足必须拒绝执行",
  );
});

test("seedBaseConfig --force 在生产环境被拒绝（强制覆盖仅限非生产）", async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    await assert.rejects(
      () => seedBaseConfig({ force: true }),
      /--force 仅限非生产环境/,
      "--force 在生产环境必须被拒绝",
    );
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
  }
});

// ---------------------------------------------------------------
// buildKnowledgeSeedRows：知识词条播种映射守卫（无 DB）
// ---------------------------------------------------------------

// 路径解析口径必须与 seedBaseConfig 内部一致（它用 resolveRootDir 定位 seed 源），
// 否则守卫会测一份、生产读另一份。
const KNOWLEDGE_STORE_FILE = path.resolve(resolveRootDir(), "config", "knowledge", "store.json");

function readKnowledgeStoreRaw(): unknown {
  return JSON.parse(fs.readFileSync(KNOWLEDGE_STORE_FILE, "utf-8")) as unknown;
}

test("仓库知识语料全量映射为可插入行（seed 漏播 knowledge_entries 即红）", () => {
  assert.ok(fs.existsSync(KNOWLEDGE_STORE_FILE), "config/knowledge/store.json 必须仍在仓内作为 seed 源");
  const sourceEntries = (readKnowledgeStoreRaw() as { entries?: unknown[] }).entries ?? [];
  assert.ok(sourceEntries.length > 0, "seed 源语料不得为空，否则本守卫失效");

  const rows = buildKnowledgeSeedRows(readKnowledgeStoreRaw());
  assert.equal(rows.length, sourceEntries.length, "每条语料都必须被播种，条数不得减少");

  // 新库重建后 AI 检索直接依赖这些字段，逐一钉定
  for (const row of rows) {
    assert.ok(row.id.length > 0, "id 不得为空");
    assert.ok(row.title.trim().length > 0, "title 不得为空白");
    assert.ok(row.content.trim().length > 0, "content 不得为空白");
    assert.ok(row.category.length > 0, "category 缺省必须补 general");
    assert.ok(Array.isArray(row.tags), "tags 必须是数组");
    assert.equal(row.status, "active", "播种词条必须直接可检（active）");
    assert.ok(row.createdAt instanceof Date && row.updatedAt instanceof Date, "时间列必须是 Date");
  }
});

test("buildKnowledgeSeedRows 跳过缺必填字段的条目，不产生脏行", () => {
  const rows = buildKnowledgeSeedRows({
    entries: [
      { id: "k-ok", title: " 可用词条 ", content: " 正文 ", tags: ["a"] },
      { id: "", title: "无 id", content: "正文" },
      { id: "k-no-title", content: "正文" },
      { id: "k-no-content", title: "无正文" },
      null,
    ],
  });
  assert.equal(rows.length, 1, "仅完全合法的条目进 seed");
  assert.deepEqual(
    rows[0],
    {
      id: "k-ok",
      title: "可用词条",
      content: "正文",
      category: "general",
      tags: ["a"],
      status: "active",
      createdAt: rows[0].createdAt,
      updatedAt: rows[0].updatedAt,
    },
    "字段口径必须与 knowledge-pg.repository.create 一致（trim + category/tags 缺省）",
  );
});

test("buildKnowledgeSeedRows 对缺失/非预期结构返回空集（seed 不因语料文件异常中断）", () => {
  for (const raw of [null, undefined, {}, { entries: null }, { entries: [] }, []]) {
    assert.deepEqual(buildKnowledgeSeedRows(raw), [], `${JSON.stringify(raw) ?? "undefined"} 应映射为空集`);
  }
});

// ---------------------------------------------------------------
// buildIndustrySeedRows：行业主数据播种守卫（批次 10a，无 DB）
// ---------------------------------------------------------------

const INDUSTRY_SEED_FILE = path.resolve(resolveRootDir(), "config", "master-data", "industries.json");

/**
 * 首批一级种子的**唯一合法取值**，逐字钉死。
 *
 * 实取依据（2026-09-08，workload_eval 库）：
 *   select payload->>'industry', count(*) from version_records group by 1
 *   → 制造业=20、其他=1、空串=68、NULL=7
 *   history_projects 0 行；requirement_packs.industry 10 行全 NULL
 *
 * 这条常量是「不许凭空造种子」判据的机械形态：往
 * config/master-data/industries.json 里多塞一条「像样的行业分类」，
 * 现存记录立刻在权威清单里对不上号——本批要解决的正是这个根因，
 * 不能让它以「种子看起来更完整了」的形态复发。
 * 用户日后在【基础管理 → 行业】新增的分类不进本文件（那是运行时数据）。
 */
const INDUSTRY_SEED_LEVEL1_NAMES = ["制造业", "其他"];

function readIndustrySeedRaw(): unknown {
  return JSON.parse(fs.readFileSync(INDUSTRY_SEED_FILE, "utf-8")) as unknown;
}

test("行业主数据 seed 源必须仍在仓内（新库重建后种子要能被带回）", () => {
  assert.ok(fs.existsSync(INDUSTRY_SEED_FILE), "config/master-data/industries.json 必须仍在仓内作为 seed 源");
});

test("行业一级种子与库中真实值逐字相同，不得凭空补分类", () => {
  const { categories } = buildIndustrySeedRows(readIndustrySeedRaw());
  assert.ok(categories.length > 0, "一级种子不得为空，否则本守卫失效");
  assert.deepEqual(
    categories.map((c) => c.name),
    INDUSTRY_SEED_LEVEL1_NAMES,
    `一级种子必须恰为 ${INDUSTRY_SEED_LEVEL1_NAMES.join(" / ")}（逐字，含顺序）——` +
      "多出来的任何一条都会让现存记录在权威清单里对不上号，见本文件常量定义处的实取命令",
  );
  for (const name of categories.map((c) => c.name)) {
    assert.equal(name, name.trim(), "种子名称不得带首尾空白（历史记录存的是无空白文本）");
  }
});

test("首批二级种子留空：细分由用户自行维护，不替用户编造", () => {
  const { subcategories } = buildIndustrySeedRows(readIndustrySeedRaw());
  assert.deepEqual(subcategories, [], "二级种子必须为空——库里没有任何真实存过的细分值");
});

test("行业 seed 行字段口径：status active、两时间同源、主键稳定可重播", () => {
  const now = new Date("2026-09-08T00:00:00.000Z");
  const rows = buildIndustrySeedRows(readIndustrySeedRaw(), now);
  assert.equal(rows.categories.length, INDUSTRY_SEED_LEVEL1_NAMES.length, "每条一级源行都必须被播种，条数不得减少");
  for (const row of rows.categories) {
    assert.ok(row.id.length > 0, "id 不得为空");
    assert.equal(row.status, "active", "播种即启用，否则新库起来就是一片选不到的清单");
    assert.equal(row.createdAt, now);
    assert.equal(row.updatedAt, now);
    assert.ok(Number.isInteger(row.sortOrder) && row.sortOrder >= 0, "sortOrder 必须是非负整数");
  }
  // 幂等：同一份源文件两次构造必须得到同一批主键（onConflictDoNothing 依赖它）
  assert.deepEqual(
    buildIndustrySeedRows(readIndustrySeedRaw(), now).categories.map((c) => c.id),
    rows.categories.map((c) => c.id),
  );
});

test("buildIndustrySeedRows：缺 id 时按名称派生主键，不按数组下标（防源文件中间插入致整体错位）", () => {
  const rows = buildIndustrySeedRows({ categories: [{ name: "制造业" }, { name: "其他" }, { name: "  " }] });
  assert.deepEqual(
    rows.categories.map((c) => c.id),
    ["industry-cat-制造业", "industry-cat-其他"],
  );
});

test("buildIndustrySeedRows：跳过缺必填字段的条目，二级父不在一级集合里也跳过", () => {
  const rows = buildIndustrySeedRows({
    categories: [
      { id: "c1", name: "制造业" },
      { id: "c-no-name", name: "  " },
      null,
    ],
    subcategories: [
      { id: "s-ok", categoryId: "c1", name: "离散制造" },
      { id: "s-no-parent-field", name: "无父键" },
      { id: "s-ghost-parent", categoryId: "c-不存在", name: "野生的" },
      { id: "s-empty", categoryId: "c1", name: "" },
    ],
  });
  assert.equal(rows.categories.length, 1, "仅合法一级进 seed");
  assert.deepEqual(
    rows.subcategories.map((s) => s.id),
    ["s-ok"],
    "二级必须能在本次一级集合里找到父，否则插入被外键拒绝、整次 seed 失败",
  );
});

test("buildIndustrySeedRows 对缺失/非预期结构返回空集（seed 不因源文件异常中断）", () => {
  for (const raw of [null, undefined, {}, { categories: null }, { categories: [] }, []]) {
    const rows = buildIndustrySeedRows(raw);
    assert.deepEqual(rows.categories, []);
    assert.deepEqual(rows.subcategories, []);
  }
});
