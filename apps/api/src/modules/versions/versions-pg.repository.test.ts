// ============================================================
// Versions 域 PG 仓储测试（阶段 2 批 6 · 第 1–3 步）
// ============================================================
// 口径：按批 1–5 确立的五条硬性范式验证 version_records 表的 PG 实现——
// 幂等插入（onConflictDoNothing + 重查消歧）、条件 UPDATE CAS（检出）、
// 行锁事务（检入版本号递增 / 升版归档+插入）、DB 时钟、安全错误边界；
// 外加 §4.6 测试套件模板的并发用例（不同版本记录并发写互不覆盖 /
// 同记录并发收敛 / 并发检出恰一赢家）与缓存策略用例（不加缓存层 →
// 带外写入立即可见）。仅读取 TEST_DATABASE_URL；缺失时跳过。
//
// 隔离（批 3/批 5 口径）：共享测试库下多文件并发执行，全部行使用
// wes-t-versions-* owner 前缀，断言按 owner 收敛到自身数据集；
// 清理为条件 DELETE，不整表 TRUNCATE、不做全表计数。

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type { VersionRecord } from "../../types";
import {
  VersionsStoreError,
  createVersionsPgRepository,
  type VersionsPgRepository,
} from "./versions-pg.repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// 数据集隔离前缀：本文件所有行的 owner_user_id 均以此开头
const OWNER_A = "wes-t-versions-a";
const OWNER_B = "wes-t-versions-b";
const OWNER_LIKE = "wes-t-versions-%";

let pool: Pool | null = null;
let repo: VersionsPgRepository | null = null;

function makeRecord(overrides?: Partial<VersionRecord>): VersionRecord {
  const now = new Date().toISOString();
  const versionCode = `IA-UT-${randomUUID().slice(0, 8)}`;
  return {
    id: randomUUID(),
    type: "assessment",
    versionCode,
    templateId: "default",
    ownerUserId: OWNER_A,
    status: "draft",
    payload: { note: "seed" },
    createdAt: now,
    updatedAt: now,
    createdByUserId: OWNER_A,
    createdByUsername: "wes-t-alice",
    updatedByUserId: OWNER_A,
    updatedByUsername: "wes-t-alice",
    checkoutStatus: "checked_in",
    versionDocStatus: "drafting",
    majorLetter: "A",
    minorNumber: 0,
    baseCode: versionCode,
    isHistoricalArchive: false,
    lastCheckinPayload: {},
    ...overrides,
  };
}

const actor = { actorUserId: OWNER_A, actorUsername: "wes-t-alice" };
const actorB = { actorUserId: OWNER_B, actorUsername: "wes-t-bob" };

async function cleanOwnRows(): Promise<void> {
  if (pool) await pool!.query("DELETE FROM version_records WHERE owner_user_id LIKE $1", [OWNER_LIKE]);
}

before(async () => {
  if (!testDatabaseUrl) return;
  pool = new Pool({ connectionString: testDatabaseUrl, max: 10 });
  repo = createVersionsPgRepository(drizzle(pool));
  // 清理历史残留（前次运行异常退出时 afterEach 可能未跑完）
  await cleanOwnRows();
});

beforeEach(cleanOwnRows);
afterEach(cleanOwnRows);

after(async () => {
  if (pool) await pool!.end();
});

// ─── 基础读写 ────────────────────────────────────────────────

test("create + findRecordById 全字段往返（含可选字段）", { skip: !testDatabaseUrl }, async () => {
  const now = new Date().toISOString();
  const record = makeRecord({
    status: "reviewed",
    reviewedAt: now,
    reviewedByUserId: OWNER_A,
    checkoutStatus: "checked_out",
    checkedOutByUserId: OWNER_A,
    checkedOutByUsername: "wes-t-alice",
    checkoutAt: now,
    lastCheckinPayload: { note: "snapshot" },
  });
  const { created } = await repo!.createVersionRecord(record);
  assert.equal(created, true);

  const found = await repo!.findRecordById(record.id);
  assert.ok(found, "insert 后必须能读回");
  assert.equal(found.versionCode, record.versionCode);
  assert.equal(found.type, "assessment");
  assert.equal(found.status, "reviewed");
  assert.equal(found.reviewedAt, now);
  assert.equal(found.reviewedByUserId, OWNER_A);
  assert.equal(found.checkoutStatus, "checked_out");
  assert.equal(found.checkedOutByUserId, OWNER_A);
  assert.equal(found.checkoutAt, now);
  assert.deepEqual(found.payload, { note: "seed" });
  assert.deepEqual(found.lastCheckinPayload, { note: "snapshot" });
  assert.equal(found.majorLetter, "A");
  assert.equal(found.minorNumber, 0);
  assert.equal(found.baseCode, record.baseCode);
  assert.equal(found.isHistoricalArchive, false);
});

test("create 可选字段缺省时读回不带该 key（与 JSON 形状一致）", { skip: !testDatabaseUrl }, async () => {
  const record = makeRecord();
  await repo!.createVersionRecord(record);
  const found = await repo!.findRecordById(record.id);
  assert.ok(found);
  assert.ok(!("reviewedAt" in found), "null 可选字段不应出现在记录上");
  assert.ok(!("checkedOutByUserId" in found));
  assert.ok(!("checkoutAt" in found));
  assert.ok(!("archivedAt" in found));
});

test("create 幂等：同 recordId 重放返回原记录且表内恰好一行（范式 #2）", { skip: !testDatabaseUrl }, async () => {
  const original = makeRecord({ payload: { note: "original" } });
  await repo!.createVersionRecord(original);
  const replay = makeRecord({ id: original.id, payload: { note: "replay" } });
  const result = await repo!.createVersionRecord(replay);
  assert.equal(result.created, false, "冲突重放不得二次插入");
  assert.deepEqual(result.record.payload, { note: "original" }, "冲突重放必须返回原记录");
  const { rows } = await pool!.query("SELECT count(*)::int AS n FROM version_records WHERE record_id = $1", [original.id]);
  assert.equal(rows[0].n, 1);
});

test("findRecordById 未命中返回 null（缺行 ≠ 失败，范式 #5）", { skip: !testDatabaseUrl }, async () => {
  const found = await repo!.findRecordById("nonexistent-version-id");
  assert.equal(found, null);
});

// ─── 查询 ───────────────────────────────────────────────────

test("listRecords：owner/type/template 过滤与 updatedAt desc 排序", { skip: !testDatabaseUrl }, async () => {
  const t1 = "2026-08-01T00:00:00.000Z";
  const t2 = "2026-08-10T00:00:00.000Z";
  const t3 = "2026-08-20T00:00:00.000Z";
  const r1 = makeRecord({ updatedAt: t1, createdAt: t1 });
  const r2 = makeRecord({ updatedAt: t3, createdAt: t1 });
  const r3 = makeRecord({ updatedAt: t2, createdAt: t1, type: "global", templateId: "other" });
  const rOther = makeRecord({ ownerUserId: OWNER_B });
  for (const r of [r1, r2, r3, rOther]) await repo!.createVersionRecord(r);

  const mine = await repo!.listRecords({ ownerUserId: OWNER_A });
  assert.equal(mine.length, 3, "只返回本 owner 的行");
  assert.deepEqual(
    mine.map((r) => r.id),
    [r2.id, r3.id, r1.id],
    "updatedAt desc（recordId 兜底确定性）",
  );

  const assessments = await repo!.listRecords({ ownerUserId: OWNER_A, type: "assessment" });
  assert.deepEqual(assessments.map((r) => r.id), [r2.id, r1.id]);

  const byTemplate = await repo!.listRecords({ ownerUserId: OWNER_A, templateId: "other" });
  assert.deepEqual(byTemplate.map((r) => r.id), [r3.id]);
});

test("findRecordByCode：四元组精确匹配与未命中", { skip: !testDatabaseUrl }, async () => {
  const record = makeRecord({ templateId: "tpl-x", versionCode: "IA-CODE-001" });
  await repo!.createVersionRecord(record);

  const hit = await repo!.findRecordByCode(OWNER_A, "assessment", "tpl-x", "IA-CODE-001");
  assert.equal(hit?.id, record.id);

  assert.equal(await repo!.findRecordByCode(OWNER_B, "assessment", "tpl-x", "IA-CODE-001"), null, "owner 隔离");
  assert.equal(await repo!.findRecordByCode(OWNER_A, "global", "tpl-x", "IA-CODE-001"), null);
  assert.equal(await repo!.findRecordByCode(OWNER_A, "assessment", "tpl-x", "IA-CODE-999"), null);
});

// ─── upsert / update ────────────────────────────────────────

test("upsertVersionRecord：不存在则插入，存在则整行覆写", { skip: !testDatabaseUrl }, async () => {
  const record = makeRecord({ payload: { v: 1 } });
  await repo!.upsertVersionRecord(record);
  const first = await repo!.findRecordById(record.id);
  assert.deepEqual(first?.payload, { v: 1 });

  const next = makeRecord({
    id: record.id,
    versionCode: `${record.baseCode}-VA1`,
    minorNumber: 1,
    payload: { v: 2 },
  });
  await repo!.upsertVersionRecord(next);
  const second = await repo!.findRecordById(record.id);
  assert.equal(second?.versionCode, `${record.baseCode}-VA1`, "整行覆写：版本号更新");
  assert.deepEqual(second?.payload, { v: 2 });
  assert.equal(second?.minorNumber, 1);
});

test("upsertVersionRecords：批量一次提交（新增+覆写混合，空数组无操作）", { skip: !testDatabaseUrl }, async () => {
  const fresh = makeRecord({ payload: { v: 1 } });
  const existing = makeRecord({ payload: { v: 1 } });
  await repo!.createVersionRecord(existing);

  await repo!.upsertVersionRecords([
    fresh,
    makeRecord({ id: existing.id, versionCode: `${existing.baseCode}-VA1`, minorNumber: 1, payload: { v: 2 } }),
  ]);
  const freshRead = await repo!.findRecordById(fresh.id);
  const existingRead = await repo!.findRecordById(existing.id);
  assert.deepEqual(freshRead?.payload, { v: 1 }, "批量内新记录必须插入");
  assert.equal(existingRead?.versionCode, `${existing.baseCode}-VA1`, "批量内存量记录必须整行覆写");
  assert.deepEqual(existingRead?.payload, { v: 2 });

  await repo!.upsertVersionRecords([]);
  assert.equal((await repo!.listRecords({ ownerUserId: OWNER_A })).length, 2, "空数组不得产生写入");
});

test("updateVersionRecord：patch 合并、null 清除字段、缺行返回 null", { skip: !testDatabaseUrl }, async () => {
  const now = new Date().toISOString();
  const record = makeRecord({
    checkoutStatus: "checked_out",
    checkedOutByUserId: OWNER_A,
    checkedOutByUsername: "wes-t-alice",
    checkoutAt: now,
  });
  await repo!.createVersionRecord(record);

  const unlocked = await repo!.updateVersionRecord(record.id, {
    checkoutStatus: "checked_in",
    checkedOutByUserId: null,
    checkedOutByUsername: null,
    checkoutAt: null,
    updatedAt: now,
  });
  assert.ok(unlocked);
  assert.equal(unlocked.checkoutStatus, "checked_in");
  assert.ok(!("checkedOutByUserId" in unlocked), "null patch 必须清除字段（对齐 JSON 删除键）");
  assert.ok(!("checkoutAt" in unlocked));
  assert.equal(unlocked.versionCode, record.versionCode, "未 patch 字段保持不变");

  const missing = await repo!.updateVersionRecord("nonexistent-version-id", { status: "reviewed" });
  assert.equal(missing, null);
});

test("并发更新同一记录：最终收敛、行完整无撕裂（范式 #3）", { skip: !testDatabaseUrl }, async () => {
  const record = makeRecord();
  await repo!.createVersionRecord(record);

  // 4 路并发行级 patch（各自基于读到的快照），行锁串行化后最终态
  // 必须是某一路的完整 patch（不允许字段混合撕裂）
  const writers = [0, 1, 2, 3].map((i) =>
    repo!.updateVersionRecord(record.id, {
      status: "draft",
      payload: { writer: i },
      updatedByUsername: `writer-${i}`,
    }),
  );
  const results = await Promise.all(writers);
  assert.ok(results.every((r) => r !== null));

  const final = await repo!.findRecordById(record.id);
  assert.ok(final);
  const writer = (final.payload as { writer: number }).writer;
  assert.equal(final.updatedByUsername, `writer-${writer}`, "最终态必须是某一次完整写入（无撕裂）");
});

// ─── 检出 / 检入 / 撤销 / 升版 ──────────────────────────────

test("checkout：CAS 成功、DB 时钟、落 lastCheckinPayload 快照", { skip: !testDatabaseUrl }, async () => {
  const record = makeRecord({ payload: { note: "checkin-state" } });
  await repo!.createVersionRecord(record);

  const result = await repo!.checkoutVersionRecord({ recordId: record.id, ...actor });
  assert.equal(result.outcome, "ok");
  if (result.outcome !== "ok") return;
  assert.equal(result.record.checkoutStatus, "checked_out");
  assert.equal(result.record.checkedOutByUserId, OWNER_A);
  assert.ok(result.record.checkoutAt, "检出时刻必须落库");
  const checkoutAtMs = new Date(result.record.checkoutAt).getTime();
  assert.ok(Math.abs(Date.now() - checkoutAtMs) < 10_000, "checkoutAt 应为 DB 时钟附近（范式 #4）");
  assert.deepEqual(result.record.lastCheckinPayload, { note: "checkin-state" }, "检出时落当前 payload 快照");
});

test("并发检出同一记录：恰一赢家（条件 UPDATE CAS，范式 #3）", { skip: !testDatabaseUrl }, async () => {
  const record = makeRecord();
  await repo!.createVersionRecord(record);

  const results = await Promise.all([
    repo!.checkoutVersionRecord({ recordId: record.id, ...actor }),
    repo!.checkoutVersionRecord({ recordId: record.id, ...actor }),
    repo!.checkoutVersionRecord({ recordId: record.id, ...actor }),
    repo!.checkoutVersionRecord({ recordId: record.id, ...actor }),
  ]);
  const winners = results.filter((r) => r.outcome === "ok");
  const losers = results.filter((r) => r.outcome === "already_checked_out");
  assert.equal(winners.length, 1, "并发检出必须恰一赢家");
  assert.equal(losers.length, 3, "其余必须报已被检出");
});

test("checkout 分支：历史归档 / 已审核文档 / 不存在", { skip: !testDatabaseUrl }, async () => {
  const archived = makeRecord({ isHistoricalArchive: true, archivedAt: new Date().toISOString() });
  const reviewed = makeRecord({ versionDocStatus: "reviewed" });
  await repo!.createVersionRecord(archived);
  await repo!.createVersionRecord(reviewed);

  assert.equal((await repo!.checkoutVersionRecord({ recordId: archived.id, ...actor })).outcome, "historical_archive");
  assert.equal((await repo!.checkoutVersionRecord({ recordId: reviewed.id, ...actor })).outcome, "reviewed_readonly");
  assert.equal((await repo!.checkoutVersionRecord({ recordId: "nonexistent-version-id", ...actor })).outcome, "not_found");
});

test("checkin：版本号递增、释放锁、更新 payload 与快照", { skip: !testDatabaseUrl }, async () => {
  const record = makeRecord({ payload: { v: 1 } });
  await repo!.createVersionRecord(record);
  await repo!.checkoutVersionRecord({ recordId: record.id, ...actor });

  const result = await repo!.checkinVersionRecord({ recordId: record.id, payload: { v: 2 }, ...actor });
  assert.equal(result.outcome, "ok");
  if (result.outcome !== "ok") return;
  assert.equal(result.record.versionCode, `${record.baseCode}-VA1`, "检入递增：-V{majorLetter}{minor+1}");
  assert.equal(result.record.minorNumber, 1);
  assert.equal(result.record.baseCode, record.baseCode, "baseCode 固定为首次检入前编码");
  assert.equal(result.record.checkoutStatus, "checked_in");
  assert.ok(!("checkedOutByUserId" in result.record), "检入后释放检出人");
  assert.ok(!("checkoutAt" in result.record));
  assert.deepEqual(result.record.payload, { v: 2 });
  assert.deepEqual(result.record.lastCheckinPayload, { v: 2 });
});

test("checkin 分支：未检出 / 非检出人 / 并发检入串行化", { skip: !testDatabaseUrl }, async () => {
  const record = makeRecord();
  await repo!.createVersionRecord(record);

  assert.equal(
    (await repo!.checkinVersionRecord({ recordId: record.id, ...actor })).outcome,
    "not_checked_out",
  );

  await repo!.checkoutVersionRecord({ recordId: record.id, ...actor });
  assert.equal(
    (await repo!.checkinVersionRecord({ recordId: record.id, ...actorB })).outcome,
    "not_checkout_owner",
  );

  // 并发双检入：行锁串行化，恰一次成功，第二次报未检出
  const [r1, r2] = await Promise.all([
    repo!.checkinVersionRecord({ recordId: record.id, ...actor }),
    repo!.checkinVersionRecord({ recordId: record.id, ...actor }),
  ]);
  const outcomes = [r1.outcome, r2.outcome].sort();
  assert.deepEqual(outcomes, ["not_checked_out", "ok"], "并发检入恰一次成功（版本号不得双递增）");
  const final = await repo!.findRecordById(record.id);
  assert.equal(final?.minorNumber, 1, "minorNumber 只递增一次");
});

test("撤销检出链路：检出→存草稿→按快照恢复原 payload", { skip: !testDatabaseUrl }, async () => {
  const record = makeRecord({ payload: { doc: "original" } });
  await repo!.createVersionRecord(record);

  const checkout = await repo!.checkoutVersionRecord({ recordId: record.id, ...actor });
  assert.equal(checkout.outcome, "ok");

  // 检出态保存草稿（usecase 的 saveCheckedOutDraft 即行级 payload patch）
  await repo!.updateVersionRecord(record.id, { payload: { doc: "draft-edited" } });
  const mid = await repo!.findRecordById(record.id);
  assert.deepEqual(mid?.payload, { doc: "draft-edited" });
  assert.deepEqual(mid?.lastCheckinPayload, { doc: "original" }, "快照不得被草稿污染");

  // 撤销检出：按 lastCheckinPayload 恢复 + 释放锁（usecase undoCheckout 的 patch 形态）
  const restored = await repo!.updateVersionRecord(record.id, {
    payload: { ...(mid?.lastCheckinPayload ?? {}) },
    checkoutStatus: "checked_in",
    checkedOutByUserId: null,
    checkedOutByUsername: null,
    checkoutAt: null,
  });
  assert.deepEqual(restored?.payload, { doc: "original" }, "撤销检出必须恢复检出前内容");
  assert.equal(restored?.checkoutStatus, "checked_in");
});

test("promote：归档 + 新行原子完成；分支校验", { skip: !testDatabaseUrl }, async () => {
  const record = makeRecord();
  await repo!.createVersionRecord(record);
  const newRecord = makeRecord({
    type: record.type,
    templateId: record.templateId,
    versionCode: `${record.baseCode}-VB1`,
    majorLetter: "B",
    checkoutStatus: "checked_out",
    checkedOutByUserId: OWNER_A,
    checkedOutByUsername: "wes-t-alice",
    checkoutAt: new Date().toISOString(),
  });

  const result = await repo!.promoteVersionRecord({ archiveRecordId: record.id, newRecord, ...actor });
  assert.equal(result.outcome, "ok");
  if (result.outcome !== "ok") return;
  assert.equal(result.archived.isHistoricalArchive, true);
  assert.ok(result.archived.archivedAt, "归档时刻必须落库");
  assert.equal(result.newRecord.id, newRecord.id);
  const archivedInDb = await repo!.findRecordById(record.id);
  assert.equal(archivedInDb?.isHistoricalArchive, true);
  assert.ok(await repo!.findRecordById(newRecord.id), "新行必须已插入（事务原子）");
  // 归档后的记录再升版被拒
  assert.equal(
    (await repo!.promoteVersionRecord({ archiveRecordId: record.id, newRecord: makeRecord(), ...actor })).outcome,
    "historical_archive",
  );
});

test("promote 分支：检出中 / 非 drafting / 不存在", { skip: !testDatabaseUrl }, async () => {
  const checkedOut = makeRecord({ checkoutStatus: "checked_out", checkedOutByUserId: OWNER_A });
  const reviewed = makeRecord({ versionDocStatus: "reviewed" });
  await repo!.createVersionRecord(checkedOut);
  await repo!.createVersionRecord(reviewed);

  assert.equal(
    (await repo!.promoteVersionRecord({ archiveRecordId: checkedOut.id, newRecord: makeRecord(), ...actor })).outcome,
    "must_be_checked_in",
  );
  assert.equal(
    (await repo!.promoteVersionRecord({ archiveRecordId: reviewed.id, newRecord: makeRecord(), ...actor })).outcome,
    "must_be_drafting",
  );
  assert.equal(
    (await repo!.promoteVersionRecord({ archiveRecordId: "nonexistent-version-id", newRecord: makeRecord(), ...actor })).outcome,
    "not_found",
  );
});

// ─── 删除与引用检查 ─────────────────────────────────────────

test("deleteVersionRecord：普通删除与不存在", { skip: !testDatabaseUrl }, async () => {
  const record = makeRecord({ type: "assessment" });
  await repo!.createVersionRecord(record);

  const result = await repo!.deleteVersionRecord({ recordId: record.id, checkReferenced: true, targetType: "assessment" });
  assert.deepEqual(result, { existed: true, referenced: false });
  assert.equal(await repo!.findRecordById(record.id), null);

  const again = await repo!.deleteVersionRecord({ recordId: record.id, checkReferenced: true, targetType: "assessment" });
  assert.deepEqual(again, { existed: false, referenced: false });
});

test("deleteVersionRecord：被总方案引用时拒删且行保留", { skip: !testDatabaseUrl }, async () => {
  const target = makeRecord({ type: "assessment", versionCode: "IA-REF-001" });
  const globalRef = makeRecord({
    type: "global",
    versionCode: "GL-REF-001",
    payload: { assessmentVersionCode: "IA-REF-001" },
  });
  const globalUnrelated = makeRecord({
    type: "global",
    versionCode: "GL-REF-002",
    payload: { assessmentVersionCode: "IA-OTHER" },
  });
  for (const r of [target, globalRef, globalUnrelated]) await repo!.createVersionRecord(r);

  const blocked = await repo!.deleteVersionRecord({ recordId: target.id, checkReferenced: true, targetType: "assessment" });
  assert.deepEqual(blocked, { existed: true, referenced: true });
  assert.ok(await repo!.findRecordById(target.id), "拒删后行必须保留");

  // global 自身删除不检查引用（checkReferenced=false）
  const removed = await repo!.deleteVersionRecord({ recordId: globalRef.id, checkReferenced: false });
  assert.deepEqual(removed, { existed: true, referenced: false });
});

// ─── §4.6 并发模板 ──────────────────────────────────────────

test("并发写不同版本记录：全部生效、互不覆盖", { skip: !testDatabaseUrl }, async () => {
  // 8 路并发创建不同记录（JSON 整存 RMW 会丢插入；PG 行级写必须全数生效）
  const records = Array.from({ length: 8 }, () => makeRecord());
  await Promise.all(records.map((r) => repo!.createVersionRecord(r)));
  const all = await repo!.listRecords({ ownerUserId: OWNER_A });
  assert.equal(all.length, 8);
  const ids = new Set(all.map((r) => r.id));
  for (const r of records) assert.ok(ids.has(r.id), `记录 ${r.id} 不得丢失`);

  // 不同记录并发状态写（检出 A 的同时检入 B、更新 C）互不干涉
  const a = makeRecord();
  const b = makeRecord();
  const c = makeRecord();
  for (const r of [a, b, c]) await repo!.createVersionRecord(r);
  await repo!.checkoutVersionRecord({ recordId: b.id, ...actor });

  await Promise.all([
    repo!.checkoutVersionRecord({ recordId: a.id, ...actor }),
    repo!.checkinVersionRecord({ recordId: b.id, payload: { done: true }, ...actor }),
    repo!.updateVersionRecord(c.id, { payload: { edited: true } }),
  ]);

  const ra = await repo!.findRecordById(a.id);
  const rb = await repo!.findRecordById(b.id);
  const rc = await repo!.findRecordById(c.id);
  assert.equal(ra?.checkoutStatus, "checked_out", "A 的检出不得被 B/C 覆盖");
  assert.equal(rb?.checkoutStatus, "checked_in", "B 的检入不得被 A/C 覆盖");
  assert.equal(rb?.minorNumber, 1);
  assert.deepEqual(rc?.payload, { edited: true }, "C 的更新不得被 A/B 覆盖");
});

// ─── 缓存语义：不加缓存层，带外写入立即可见 ─────────────────

test("无缓存证明：带外 SQL 直写后 repo 读取立即可见", { skip: !testDatabaseUrl }, async () => {
  const id = `version-oob-${randomUUID()}`;
  await pool!.query(
    `INSERT INTO version_records
       (record_id, type, version_code, template_id, owner_user_id, status, payload,
        created_at, updated_at, created_by_user_id, created_by_username,
        updated_by_user_id, updated_by_username, base_code)
     VALUES ($1, 'assessment', 'IA-OOB-1', 'default', $2, 'draft', '{}'::jsonb,
             now(), now(), $2, 'wes-t-alice', $2, 'wes-t-alice', 'IA-OOB-1')`,
    [id, OWNER_A],
  );
  const found = await repo!.findRecordById(id);
  assert.ok(found, "无缓存层：带外写入必须立即可见（无 TTL 滞后窗口）");
});

// ─── 错误边界（范式 #1） ────────────────────────────────────

test("DB 不可达时抛 VersionsStoreError 且不泄露连接串", async () => {
  const brokenPool = new Pool({ connectionString: "postgres://invalid@127.0.0.1:1/none", max: 1, connectionTimeoutMillis: 500 });
  const brokenRepo = createVersionsPgRepository(drizzle(brokenPool));
  await assert.rejects(
    () => brokenRepo.findRecordById("any"),
    (err: unknown) => {
      assert.ok(err instanceof VersionsStoreError, "必须收敛为 VersionsStoreError");
      assert.equal(err.code, "VERSIONS_STORE_INTERNAL");
      assert.ok(!String(err.message).includes("postgres://"), "错误消息不得含连接串");
      return true;
    },
  );
  await assert.rejects(
    () => brokenRepo.listRecords({ ownerUserId: OWNER_A }),
    (err: unknown) => err instanceof VersionsStoreError,
  );
  await brokenPool.end().catch(() => {});
});
