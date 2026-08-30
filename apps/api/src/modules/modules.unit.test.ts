import test from "node:test";
import assert from "node:assert/strict";

import { VersionsStore } from "../types";
import {
  deleteIdempotencyRecord,
  getIdempotencyRecord,
  parseOwnedExportFileName,
  setIdempotencyRecord
} from "./estimates/estimates.repository";
import { cleanupExpiredSessions, getSession, saveSession } from "./sessions/sessions.repository";
import { isVersionReferencedByGlobal } from "./versions/versions.repository";

// S4（2026-08-30）：本文件原「versions.repository: saveVersionsStore writes through
// a temp file before rename」用例（含其专用的 withFileSnapshotRestore 夹具）已随
// versions JSON 写路径退役——它断的是「临时文件 + rename 原子替换」这一文件落盘
// 形态，PG 侧无对应物。同一条不变量（一次批量写不得留下部分落库的中间态）改由
// versions-pg.repository.test.ts「upsertVersionRecords：批量一次提交（新增+覆写
// 混合，空数组无操作）」在 S4 补上的全有或全无断言承担。

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

test("versions.repository: isVersionReferencedByGlobal returns true when referenced", () => {
  const store: VersionsStore = {
    records: [
      {
        id: "1",
        type: "global",
        versionCode: "G01",
        templateId: "default",
        ownerUserId: "u1",
        status: "draft",
        payload: { assessmentVersionCode: "A01" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdByUserId: "u1",
        createdByUsername: "tester",
        updatedByUserId: "u1",
        updatedByUsername: "tester",
        checkoutStatus: "checked_in",
        versionDocStatus: "drafting",
        majorLetter: "A",
        minorNumber: 0,
        baseCode: "G01",
        isHistoricalArchive: false
      }
    ]
  };

  assert.equal(isVersionReferencedByGlobal(store, "u1", "default", "assessment", "A01"), true);
  assert.equal(isVersionReferencedByGlobal(store, "u1", "default", "assessment", "A02"), false);
});
