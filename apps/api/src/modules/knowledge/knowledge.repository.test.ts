// ============================================================
// SP-2026-007 · MS1（M1 中文混合检索基线）
// knowledge.repository — JSON 文件存储（config/knowledge/store.json）
// 默认值补齐，存量数据零人工迁移（AGENTS.md §2）
// ============================================================

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { KnowledgeRepository } from "./knowledge.repository";

let storePath: string;
let repo: KnowledgeRepository;

beforeEach(() => {
  storePath = path.join(os.tmpdir(), `wes-knowledge-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  repo = new KnowledgeRepository(storePath);
});

test("存储不存在时 list 返回空数组（默认值兼容）", () => {
  assert.deepEqual(repo.list(), []);
});

test("create：落盘并可读回，默认字段补齐", () => {
  const entry = repo.create({ title: "售前估算口径", content: "售前估算按人天折算。" });
  assert.ok(entry.id, "应生成 id");
  assert.equal(entry.status, "active", "默认状态 active");
  assert.ok(entry.createdAt, "默认 createdAt");
  assert.ok(entry.updatedAt, "默认 updatedAt");

  const reloaded = new KnowledgeRepository(storePath);
  assert.equal(reloaded.list().length, 1, "应持久化到文件");
  assert.equal(reloaded.get(entry.id)?.title, "售前估算口径");
});

test("create：缺 title 或 content 拒绝", () => {
  assert.throws(() => repo.create({ title: "", content: "x" }), /title/i);
  assert.throws(() => repo.create({ title: "x", content: "" }), /content/i);
});

test("create：重复 id 拒绝", () => {
  repo.create({ id: "dup-001", title: "A", content: "a" });
  assert.throws(() => repo.create({ id: "dup-001", title: "B", content: "b" }), /已存在|exists/i);
});

test("update：更新内容并刷新 updatedAt", () => {
  const entry = repo.create({ title: "A", content: "a" });
  const updated = repo.update(entry.id, { content: "新内容" });
  assert.equal(updated.content, "新内容");
  assert.ok(repo.get(entry.id)?.content === "新内容");
});

test("update：不存在的 id 抛错", () => {
  assert.throws(() => repo.update("nope", { content: "x" }), /不存在|not found/i);
});

test("archive：状态流转 active → archived，archived 不可再改回", () => {
  const entry = repo.create({ title: "A", content: "a" });
  const archived = repo.archive(entry.id);
  assert.equal(archived.status, "archived");
  assert.throws(() => repo.update(entry.id, { status: "active" }), /归档|archived/i);
});

test("存量数据默认值补齐：缺 status/category 字段的旧记录可读且默认 active", () => {
  fs.writeFileSync(
    storePath,
    JSON.stringify({ entries: [{ id: "legacy-1", title: "旧条目", content: "旧内容" }] }),
    "utf-8",
  );
  const legacyRepo = new KnowledgeRepository(storePath);
  const items = legacyRepo.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].status, "active", "缺 status 应默认 active");
  assert.ok(items[0].createdAt, "缺 createdAt 应补齐");
});
