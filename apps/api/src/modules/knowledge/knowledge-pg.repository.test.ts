// ============================================================
// Knowledge 域 PG 仓储测试（阶段 2 批 9 · 第 1–3 步）
// ============================================================
// 口径：按批 1–8 确立的五条硬性范式验证行级条目仓储的 PG 实现——
// create 幂等与冲突语义、update 行锁串行化与归档守卫、DB 时钟、
// 安全错误边界（消息与 JSON 逐字一致）、空表合法降级；外加
// §4.6 测试套件模板的并发用例（同 id 并发 create 收敛 / 同行并发
// update 无字段混写）与缓存策略用例（不加缓存层 → 带外 SQL 写入
// 立即可见）。仅读取 TEST_DATABASE_URL；缺失时按 §4.6 规则诚实报
// skip（禁止空跑绿）。
//
// 隔离（批 3/5/6/7/8 口径，§4.9 C5）：共享测试库下多文件并发执行，
// 全部条目使用 wes-t-kn-* id 前缀，清理为条件 DELETE
// （cleanupKnowledgeRowsByPrefix），不做整表计数与整表清理。
//
// 空库降级实测（批 9 指令）：beforeEach 清理后表对本文件呈空态，
// searchKnowledge 走真实 PG repo.list() → buildBm25Index
// docCount===0 返回空数组路径，证明切换后检索不崩溃、走既有兜底。
//
// 无库套件（错误边界收敛）以最小 stub executor 注入，验证纯逻辑
// 分支（收敛不泄连接串），无库环境同样真实执行。

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { searchKnowledge } from "./knowledge.usecase";
import {
  KnowledgePgRepository,
  KnowledgeStoreError,
  cleanupKnowledgeRowsByPrefix,
  countKnowledgeRowsByPrefix,
} from "./knowledge-pg.repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// 数据集隔离前缀：本文件所有条目 id 均以此开头
const ENTRY_PREFIX = "wes-t-kn-";

let pool: Pool | null = null;
let repo: KnowledgePgRepository | null = null;

function makeInput(salt: string, opts?: { id?: string; category?: string; tags?: string[] }) {
  return {
    id: opts?.id ?? `${ENTRY_PREFIX}${salt}`,
    title: `知识条目 ${salt}`,
    content: `售前估算口径说明 ${salt}`,
    category: opts?.category,
    tags: opts?.tags,
  };
}

async function cleanOwnRows(): Promise<void> {
  if (repo) await cleanupKnowledgeRowsByPrefix(repo.__dbForTest(), ENTRY_PREFIX);
}

before(async () => {
  if (!testDatabaseUrl) return;
  pool = new Pool({ connectionString: testDatabaseUrl, max: 6 });
  repo = new KnowledgePgRepository(drizzle(pool));
  // 清理历史残留（前次运行异常退出时 beforeEach 可能未跑完）
  await cleanOwnRows();
});

beforeEach(cleanOwnRows);

after(async () => {
  await cleanOwnRows();
  if (pool) await pool!.end();
});

// ─── 基础读写与语义（有库套件，缺库诚实 skip）──────────────────

test("全字段往返：标量 + tags（jsonb）一致", { skip: !testDatabaseUrl }, async () => {
  const input = makeInput("roundtrip", { category: "presales", tags: ["估算", "SOW"] });
  const created = await repo!.create(input);
  assert.equal(created.id, input.id);
  assert.equal(created.status, "active");
  const loaded = await repo!.get(input.id);
  assert.ok(loaded);
  assert.equal(loaded.title, input.title);
  assert.equal(loaded.content, input.content);
  assert.equal(loaded.category, "presales");
  assert.deepEqual(loaded.tags, ["估算", "SOW"]);
  assert.equal(await countKnowledgeRowsByPrefix(repo!.__dbForTest(), ENTRY_PREFIX), 1);
});

test("归一化：category/tags 缺省补齐，与 JSON 实现一致", { skip: !testDatabaseUrl }, async () => {
  const created = await repo!.create(makeInput("defaults"));
  assert.equal(created.category, "general");
  assert.deepEqual(created.tags, []);
  const list = await repo!.list();
  assert.ok(list.some((entry) => entry.id === created.id && entry.category === "general"));
});

test("list 确定性排序 + get 缺行返回 null（空表合法状态）", { skip: !testDatabaseUrl }, async () => {
  assert.deepEqual(await repo!.list(), []);
  assert.equal(await repo!.get(`${ENTRY_PREFIX}nope`), null);
  await repo!.create(makeInput("order-b"));
  await repo!.create(makeInput("order-a"));
  const first = await repo!.list();
  const second = await repo!.list();
  assert.deepEqual(first.map((e) => e.id), second.map((e) => e.id));
  assert.equal(first.length, 2);
});

test("create 幂等语义：重复同 id 抛「已存在」（消息与 JSON 逐字一致），行数不增", { skip: !testDatabaseUrl }, async () => {
  const input = makeInput("dup");
  await repo!.create(input);
  await assert.rejects(
    () => repo!.create(input),
    (err: unknown) =>
      err instanceof KnowledgeStoreError &&
      err.code === "KNOWLEDGE_ENTRY_ID_EXISTS" &&
      err.message === `Knowledge entry id 已存在: ${input.id}`,
  );
  assert.equal(await countKnowledgeRowsByPrefix(repo!.__dbForTest(), ENTRY_PREFIX), 1);
});

test("校验：空 title / 空 content 抛错（消息与 JSON 逐字一致）", { skip: !testDatabaseUrl }, async () => {
  await assert.rejects(
    () => repo!.create({ id: `${ENTRY_PREFIX}bad1`, title: "  ", content: "x" }),
    (err: unknown) => err instanceof KnowledgeStoreError && err.message === "Knowledge entry title is required",
  );
  await assert.rejects(
    () => repo!.create({ id: `${ENTRY_PREFIX}bad2`, title: "x", content: "" }),
    (err: unknown) => err instanceof KnowledgeStoreError && err.message === "Knowledge entry content is required",
  );
});

test("update 部分补丁：仅覆盖补丁字段，其余保持", { skip: !testDatabaseUrl }, async () => {
  const created = await repo!.create(makeInput("patch", { category: "engine", tags: ["a"] }));
  const updated = await repo!.update(created.id, { title: "新标题" });
  assert.equal(updated.title, "新标题");
  assert.equal(updated.content, created.content);
  assert.equal(updated.category, "engine");
  assert.deepEqual(updated.tags, ["a"]);
  assert.equal(updated.status, "active");
});

test("update / archive 缺行抛「不存在」（消息与 JSON 逐字一致）", { skip: !testDatabaseUrl }, async () => {
  await assert.rejects(
    () => repo!.update(`${ENTRY_PREFIX}ghost`, { title: "x" }),
    (err: unknown) =>
      err instanceof KnowledgeStoreError &&
      err.code === "KNOWLEDGE_ENTRY_NOT_FOUND" &&
      err.message === `Knowledge entry 不存在: ${ENTRY_PREFIX}ghost`,
  );
  await assert.rejects(
    () => repo!.archive(`${ENTRY_PREFIX}ghost`),
    (err: unknown) => err instanceof KnowledgeStoreError && err.code === "KNOWLEDGE_ENTRY_NOT_FOUND",
  );
});

test("归档守卫：archived 后 update 抛错（消息与 JSON 逐字一致），重复 archive 幂等", { skip: !testDatabaseUrl }, async () => {
  const created = await repo!.create(makeInput("guard"));
  const archived = await repo!.archive(created.id);
  assert.equal(archived.status, "archived");
  await assert.rejects(
    () => repo!.update(created.id, { title: "x" }),
    (err: unknown) =>
      err instanceof KnowledgeStoreError &&
      err.code === "KNOWLEDGE_ENTRY_ARCHIVED" &&
      err.message === `Knowledge entry 已归档，不可修改: ${created.id}`,
  );
  // 与 JSON 一致：已归档条目可重复归档（无守卫），仅刷新 updatedAt
  const again = await repo!.archive(created.id);
  assert.equal(again.status, "archived");
});

// ─── §4.6 并发验证 ────────────────────────────────────────────

test("并发 create 同 id（不同内容）：恰一成功，败者抛「已存在」", { skip: !testDatabaseUrl }, async () => {
  const id = `${ENTRY_PREFIX}race-create`;
  const variants = ["c1", "c2", "c3", "c4"].map((salt) => ({ ...makeInput(salt), id }));
  const settled = await Promise.allSettled(variants.map((variant) => repo!.create(variant)));
  const succeeded = settled.filter((r) => r.status === "fulfilled");
  const rejected = settled.filter((r) => r.status === "rejected");
  assert.equal(succeeded.length, 1, "同 id 并发 create 应恰一成功");
  assert.equal(rejected.length, 3);
  for (const r of rejected) {
    const err = (r as PromiseRejectedResult).reason;
    assert.ok(err instanceof KnowledgeStoreError && err.code === "KNOWLEDGE_ENTRY_ID_EXISTS");
  }
  assert.equal(await countKnowledgeRowsByPrefix(repo!.__dbForTest(), ENTRY_PREFIX), 1);
  const loaded = await repo!.get(id);
  assert.ok(loaded);
  // 成行必须整体等于某个完整输入（不允许字段混写）
  const matched = variants.some(
    (variant) =>
      loaded.title === variant.title && loaded.content === variant.content,
  );
  assert.ok(matched, "成行应整体等于某一完整输入");
});

test("并发 update 同一行（不同补丁）：行锁串行化，收敛为完整输入无字段混写", { skip: !testDatabaseUrl }, async () => {
  const created = await repo!.create(makeInput("race-update"));
  const patches = [1, 2, 3, 4].map((n) => ({
    title: `并发标题-${n}`,
    content: `并发内容-${n}`,
  }));
  await Promise.all(patches.map((patch) => repo!.update(created.id, patch)));
  const loaded = await repo!.get(created.id);
  assert.ok(loaded);
  const matched = patches.some(
    (patch) => loaded.title === patch.title && loaded.content === patch.content,
  );
  assert.ok(matched, "并发 update 应收敛为某一完整补丁（无字段混写）");
});

// ─── 时钟与缓存策略 ───────────────────────────────────────────

test("DB 时钟：created_at/updated_at 落在创建前后两次 SELECT now() 之间（毫秒截断容差）", { skip: !testDatabaseUrl }, async () => {
  // 容差说明（批 8 固化口径）：readDbNow 经 JS Date 回写，时间戳被截断
  // 到毫秒；before 的微秒部分可能大于截断后的值，故下界按 -0.001 余量
  // （误差有确定上界 1ms，容差是精确值而非估计），上界不变（截断只会更早）。
  const dbInstance = repo!.__dbForTest();
  const epochOf = async (query: ReturnType<typeof sql>): Promise<number> =>
    Number((await dbInstance.execute(query)).rows[0].epoch);
  const beforeEpoch = await epochOf(sql`SELECT EXTRACT(EPOCH FROM now()) AS epoch`);
  const created = await repo!.create(makeInput("dbclock"));
  const afterEpoch = await epochOf(sql`SELECT EXTRACT(EPOCH FROM now()) AS epoch`);
  const row = await epochOf(
    sql`SELECT EXTRACT(EPOCH FROM created_at) AS epoch FROM knowledge_entries WHERE id = ${created.id}`,
  );
  assert.ok(
    row >= beforeEpoch - 0.001 && row <= afterEpoch,
    `created_at 应为 DB 时钟（before=${beforeEpoch} row=${row} after=${afterEpoch}）`,
  );
});

test("带外 SQL 写入立即可见（不加缓存层的证明）", { skip: !testDatabaseUrl }, async () => {
  const created = await repo!.create(makeInput("oob"));
  await repo!.__dbForTest().execute(
    sql`UPDATE knowledge_entries SET title = ${"带外改名"} WHERE id = ${created.id}`,
  );
  const loaded = await repo!.get(created.id);
  assert.equal(loaded?.title, "带外改名");
});

// ─── 空库降级实测（批 9 指令）─────────────────────────────────

test("空库降级：空表经真实检索链返回空结果（docCount===0 路径）", { skip: !testDatabaseUrl }, async () => {
  // beforeEach 已清理：此刻表对本文件呈空态。searchKnowledge 走真实
  // PG repo.list() → buildBm25Index docCount===0 → search 返回 []，
  // 证明切换后 AI 知识检索不崩溃、走既有兜底。
  const result = await searchKnowledge(repo!, "售前估算");
  assert.deepEqual(result.items, []);
  assert.ok(result.tokens.length > 0, "查询应正常分词（降级发生在检索层而非分词层）");
  assert.equal(result.guard.droppedCount, 0);
});

// ─── 无库套件：错误边界收敛（stub executor，真实执行不 skip）──

test("错误边界收敛：基础设施错误不外泄连接串", async () => {
  const secret = "postgres://user:hunter2@db.internal:5432/prod";
  const failingSelect = () => {
    throw new Error(`connection refused: ${secret}`);
  };
  const stub = {
    select: failingSelect,
    transaction: async () => {
      throw new Error(`connection refused: ${secret}`);
    },
  };
  const stubRepo = new KnowledgePgRepository(stub as never);
  await assert.rejects(
    () => stubRepo.list(),
    (err: unknown) =>
      err instanceof KnowledgeStoreError &&
      err.code === "KNOWLEDGE_STORE_INTERNAL" &&
      !err.message.includes(secret) &&
      !err.message.includes("hunter2"),
  );
  await assert.rejects(
    () => stubRepo.create({ title: "t", content: "c" }),
    (err: unknown) =>
      err instanceof KnowledgeStoreError &&
      err.code === "KNOWLEDGE_STORE_INTERNAL" &&
      !err.message.includes(secret),
  );
});
