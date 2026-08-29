// ============================================================
// db:seed 守卫测试 —— 生产保护与输入校验（不触碰数据库）
// ============================================================
// 覆盖：ensureAdminSeed 生产缺密码拒绝 / 密码长度校验；
// seedBaseConfig --force 生产环境拒绝（记录 1 的 --force 评估实现后的守卫）；
// buildKnowledgeSeedRows 语料映射（seed 清单漏 knowledge_entries 的防复发守卫，
// 见 2026-08-28 「AI 检索恒空」事故：seed 播种清单不含知识词条，
// 新库重建后语料不会被带回，同一 bug 必复现）。

import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { buildKnowledgeSeedRows, ensureAdminSeed, seedBaseConfig } from "./seed";
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
