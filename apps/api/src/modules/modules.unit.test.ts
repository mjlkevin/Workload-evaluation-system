import test from "node:test";
import assert from "node:assert/strict";

import {
  deleteIdempotencyRecord,
  getIdempotencyRecord,
  parseOwnedExportFileName,
  setIdempotencyRecord
} from "./estimates/estimates.repository";
import { cleanupExpiredSessions, getSession, saveSession } from "./sessions/sessions.repository";

// S4（2026-08-30）：本文件原两条 versions JSON 侧用例已随实现退役。
//  1) 「versions.repository: saveVersionsStore writes through a temp file before
//     rename」（含其专用的 withFileSnapshotRestore 夹具）：断的是「临时文件 +
//     rename 原子替换」这一文件落盘形态，PG 侧无对应物。同一条不变量（一次批量
//     写不得留下部分落库的中间态）改由 versions-pg.repository.test.ts
//     「upsertVersionRecords：批量一次提交（新增+覆写混合，空数组无操作）」在 S4
//     补上的全有或全无断言承担。
//  2) 「versions.repository: isVersionReferencedByGlobal returns true when
//     referenced」（含其 VersionsStore 入参构造）：isVersionReferencedByGlobal 是
//     JSON 仓储 deleteVersionRecord 的口径实现，随该仓储一并删除。它守护的业务
//     不变量（同 owner+template 的总方案在 payload 引用了版本号时不可删该版本）
//     在 PG 侧由 versions-pg.repository.ts 的 VERSION_REFERENCE_PAYLOAD_FIELDS +
//     global 行扫描承担，回归防线为 versions-pg.repository.test.ts
//     「deleteVersionRecord：被总方案引用时拒删且行保留」（含「行保留」断言，
//     比原纯函数用例覆盖更完整）。

test("estimates.repository: parseOwnedExportFileName parses owned filename", () => {
  const parsed = parseOwnedExportFileName("user-1__项目A+V01+01.xlsx");
  assert.deepEqual(parsed, {
    ownerUserId: "user-1",
    rawFileName: "项目A+V01+01.xlsx"
  });
});

test("estimates.repository: parseOwnedExportFileName rejects invalid filename", () => {
  assert.equal(parseOwnedExportFileName("no-delimiter.xlsx"), null);
});

test("estimates.repository: idempotency map set/get/delete works", () => {
  const key = `ut-${Date.now()}`;
  const record = {
    ownerUserId: "u1",
    payloadHash: "abc",
    data: { totalDays: 1, downloadUrl: "/downloads/u1__a.xlsx", expireAt: new Date().toISOString() },
    requestId: "rid-1",
    createdAt: Date.now()
  };
  setIdempotencyRecord(key, record);
  assert.deepEqual(getIdempotencyRecord(key), record);
  deleteIdempotencyRecord(key);
  assert.equal(getIdempotencyRecord(key), undefined);
});

test("sessions.repository: save/get and cleanupExpiredSessions", async () => {
  const now = Date.now();
  const expiredId = `expired-${now}`;
  const activeId = `active-${now}`;

  await saveSession({
    sessionId: expiredId,
    templateId: "t1",
    ruleSetId: "r1",
    ownerUserId: "u1",
    createdAt: now - 1000,
    expiresAt: now - 1
  });
  await saveSession({
    sessionId: activeId,
    templateId: "t1",
    ruleSetId: "r1",
    ownerUserId: "u1",
    createdAt: now,
    expiresAt: now + 60_000
  });

  await cleanupExpiredSessions(now);
  assert.equal(await getSession(expiredId), undefined);
  assert.ok(await getSession(activeId));
});

