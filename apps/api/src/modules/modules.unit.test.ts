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

test("sessions.repository: save/get and cleanupExpiredSessions", () => {
  const now = Date.now();
  const expiredId = `expired-${now}`;
  const activeId = `active-${now}`;

  saveSession({
    sessionId: expiredId,
    templateId: "t1",
    ruleSetId: "r1",
    ownerUserId: "u1",
    createdAt: now - 1000,
    expiresAt: now - 1
  });
  saveSession({
    sessionId: activeId,
    templateId: "t1",
    ruleSetId: "r1",
    ownerUserId: "u1",
    createdAt: now,
    expiresAt: now + 60_000
  });

  cleanupExpiredSessions(now);
  assert.equal(getSession(expiredId), undefined);
  assert.ok(getSession(activeId));
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
