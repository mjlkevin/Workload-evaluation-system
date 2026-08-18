import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { VersionsStore } from "../types";
import { versionsStorePath } from "../utils";
import {
  deleteIdempotencyRecord,
  getIdempotencyRecord,
  parseOwnedExportFileName,
  setIdempotencyRecord
} from "./estimates/estimates.repository";
import { cleanupExpiredSessions, getSession, saveSession } from "./sessions/sessions.repository";
import { isVersionReferencedByGlobal, saveVersionsStore } from "./versions/versions.repository";

// 阶段 1 批 4：支持 async 回调（versions accessor 异步化级联）
async function withFileSnapshotRestore(filePath: string, run: () => Promise<void>): Promise<void> {
  const existed = fs.existsSync(filePath);
  const snapshot = existed ? fs.readFileSync(filePath, "utf-8") : "";
  try {
    await run();
  } finally {
    if (existed) fs.writeFileSync(filePath, snapshot, "utf-8");
    else if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

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

test("versions.repository: saveVersionsStore writes through a temp file before rename", async () => {
  const filePath = versionsStorePath();
  await withFileSnapshotRestore(filePath, async () => {
    const originalWriteFileSync = fs.writeFileSync;
    const originalRenameSync = fs.renameSync;
    const writes: string[] = [];
    const renames: Array<[string, string]> = [];
    try {
      (fs as any).writeFileSync = function patchedWriteFileSync(file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) {
        writes.push(String(file));
        return originalWriteFileSync.call(fs, file, data as any, options as any);
      };
      (fs as any).renameSync = function patchedRenameSync(oldPath: fs.PathLike, newPath: fs.PathLike) {
        renames.push([String(oldPath), String(newPath)]);
        return originalRenameSync.call(fs, oldPath, newPath);
      };

      await saveVersionsStore({ records: [] });

      assert.equal(renames.length, 1);
      assert.equal(renames[0][1], filePath);
      assert.match(renames[0][0], /\.tmp-/);
      assert.equal(writes[0], renames[0][0]);
      assert.equal(writes.includes(filePath), false);
    } finally {
      (fs as any).writeFileSync = originalWriteFileSync;
      (fs as any).renameSync = originalRenameSync;
    }
  });
});
