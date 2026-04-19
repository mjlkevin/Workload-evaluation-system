import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { Request, Response } from "express";

import { AuthUser } from "../types";
import { config } from "../config/env";
import { loadUsersStore, signAuthToken } from "../middleware/auth";
import { versionCodeRulesStorePath, versionsStorePath } from "../utils";
import { listUsers, login, me } from "./auth/auth.usecase";
import { getRuleSetMeta } from "./rules/rules.usecase";
import { getTemplate } from "./templates/templates.usecase";
import {
  checkinVersion,
  checkoutVersion,
  createVersion,
  deleteVersion,
  forceUnlockVersion,
  listVersions,
  promoteVersion,
  saveCheckedOutDraft,
  undoCheckout,
  updateVersionStatus
} from "./versions/versions.usecase";
import { patchReviewStatus, postTeam } from "./team/team.controller";
import { kimiAssessmentPreview } from "./ai/ai.usecase";

type MockRes = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockRes;
  json: (payload: unknown) => MockRes;
};

function createMockRes(): MockRes {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    }
  };
}

function createMockReq(input: {
  token?: string;
  query?: Record<string, unknown>;
  params?: Record<string, string>;
  body?: unknown;
}): Request {
  const headers: Record<string, string> = {};
  if (input.token) {
    headers.authorization = `Bearer ${input.token}`;
  }
  return {
    query: input.query || {},
    params: input.params || {},
    body: input.body || {},
    header(name: string) {
      return headers[name.toLowerCase()];
    }
  } as unknown as Request;
}

function getActiveUser(): AuthUser {
  const store = loadUsersStore();
  const user = store.users.find((x) => x.status === "active");
  assert.ok(user, "active user required for handler tests");
  return user;
}

function getActiveUserToken(): string {
  return signAuthToken(getActiveUser());
}

function getActiveUserRole(): AuthUser["role"] {
  return getActiveUser().role;
}

function getNonAdminUserToken(): string {
  const store = loadUsersStore();
  const user = store.users.find((x) => x.status === "active" && x.role !== "admin");
  assert.ok(user, "non-admin active user required for handler tests");
  return signAuthToken(user);
}

function withFileSnapshotRestore(filePath: string, run: () => void): void {
  const existed = fs.existsSync(filePath);
  const before = existed ? fs.readFileSync(filePath, "utf-8") : "";
  try {
    run();
  } finally {
    if (existed) {
      fs.writeFileSync(filePath, before, "utf-8");
    } else if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

function withFilesSnapshotRestore(filePaths: string[], run: () => void): void {
  const snapshots = filePaths.map((filePath) => ({
    filePath,
    existed: fs.existsSync(filePath),
    content: fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "",
  }));
  try {
    run();
  } finally {
    for (const item of snapshots) {
      if (item.existed) {
        fs.writeFileSync(item.filePath, item.content, "utf-8");
      } else if (fs.existsSync(item.filePath)) {
        fs.unlinkSync(item.filePath);
      }
    }
  }
}

test("auth.usecase: login returns required error when username/password missing", async () => {
  const req = createMockReq({ body: {} });
  const res = createMockRes();
  await login(req, res as unknown as Response);
  assert.equal(res.statusCode, 400);
  assert.equal((res.body as { code?: number }).code, 40001);
});

test("auth.usecase: me returns 401 without token", () => {
  const req = createMockReq({});
  const res = createMockRes();
  me(req, res as unknown as Response);
  assert.equal(res.statusCode, 401);
  assert.equal((res.body as { code?: number }).code, 40101);
});

test("auth.usecase: me returns user with valid token", () => {
  const req = createMockReq({ token: getActiveUserToken() });
  const res = createMockRes();
  me(req, res as unknown as Response);
  assert.equal(res.statusCode, 200);
  const body = res.body as { code: number; data: { user: { id: string } } };
  assert.equal(body.code, 0);
  assert.ok(body.data.user.id);
});

test("auth.usecase: listUsers follows role branch", () => {
  const req = createMockReq({ token: getActiveUserToken() });
  const res = createMockRes();
  listUsers(req, res as unknown as Response);

  const role = getActiveUserRole();
  if (role === "admin" || role === "sub_admin") {
    assert.equal(res.statusCode, 200);
    const body = res.body as { code: number; data: { users: unknown[] } };
    assert.equal(body.code, 0);
    assert.ok(Array.isArray(body.data.users));
  } else {
    assert.equal(res.statusCode, 403);
    assert.equal((res.body as { code?: number }).code, 40301);
  }
});

test("rules.usecase: getRuleSetMeta returns 401 without token", () => {
  const req = createMockReq({});
  const res = createMockRes();
  getRuleSetMeta(req, res as unknown as Response);
  assert.equal(res.statusCode, 401);
  assert.equal((res.body as { code?: number }).code, 40101);
});

test("rules.usecase: getRuleSetMeta returns metadata with valid token", () => {
  const req = createMockReq({ token: getActiveUserToken() });
  const res = createMockRes();
  getRuleSetMeta(req, res as unknown as Response);
  assert.equal(res.statusCode, 200);
  const body = res.body as { code: number; data: { pipeline: string[] } };
  assert.equal(body.code, 0);
  assert.ok(Array.isArray(body.data.pipeline));
});

test("templates.usecase: getTemplate returns not_found code for wrong templateId", () => {
  const req = createMockReq({
    token: getActiveUserToken(),
    params: { templateId: "non-existent-template-id" }
  });
  const res = createMockRes();
  getTemplate(req, res as unknown as Response);
  assert.equal(res.statusCode, 404);
  assert.equal((res.body as { code?: number }).code, 40401);
});

test("versions.usecase: listVersions returns invalid type error", () => {
  const req = createMockReq({
    token: getActiveUserToken(),
    query: { type: "invalid-type" }
  });
  const res = createMockRes();
  listVersions(req, res as unknown as Response);
  assert.equal(res.statusCode, 400);
  assert.equal((res.body as { code?: number }).code, 40001);
});

test("versions.usecase: createVersion returns invalid status error", () => {
  const req = createMockReq({
    token: getActiveUserToken(),
    body: {
      type: "assessment",
      versionCode: "UT-V-INVALID-STATUS",
      status: "bad-status"
    }
  });
  const res = createMockRes();
  createVersion(req, res as unknown as Response);
  assert.equal(res.statusCode, 400);
  assert.equal((res.body as { code?: number }).code, 40001);
});

test("versions.usecase: updateVersionStatus returns recordId required", () => {
  const req = createMockReq({
    token: getActiveUserToken(),
    params: { recordId: "" },
    body: { status: "draft" }
  });
  const res = createMockRes();
  updateVersionStatus(req, res as unknown as Response);
  assert.equal(res.statusCode, 400);
  assert.equal((res.body as { code?: number }).code, 40001);
});

test("versions.usecase: deleteVersion returns type invalid", () => {
  const req = createMockReq({
    token: getActiveUserToken(),
    params: { type: "bad-type", versionCode: "V00" }
  });
  const res = createMockRes();
  deleteVersion(req, res as unknown as Response);
  assert.equal(res.statusCode, 400);
  assert.equal((res.body as { code?: number }).code, 40001);
});

test("versions.usecase: create -> update -> delete lifecycle works", { concurrency: false }, () => {
  const versionsPath = versionsStorePath();
  withFileSnapshotRestore(versionsPath, () => {
    const versionCode = `UT-LC-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const createReq = createMockReq({
      token: getActiveUserToken(),
      body: {
        type: "assessment",
        versionCode,
        templateId: "default",
        status: "draft",
        payload: {}
      }
    });
    const createRes = createMockRes();
    createVersion(createReq, createRes as unknown as Response);
    assert.equal(createRes.statusCode, 200);
    const created = createRes.body as { code: number; data: { record: { id: string; versionCode: string } } };
    assert.equal(created.code, 0);
    assert.equal(created.data.record.versionCode, versionCode);

    const updateReq = createMockReq({
      token: getActiveUserToken(),
      params: { recordId: created.data.record.id },
      body: { status: "reviewed" }
    });
    const updateRes = createMockRes();
    updateVersionStatus(updateReq, updateRes as unknown as Response);
    assert.equal(updateRes.statusCode, 200);
    const updated = updateRes.body as { code: number; data: { record: { status: string } } };
    assert.equal(updated.code, 0);
    assert.equal(updated.data.record.status, "reviewed");

    const deleteReq = createMockReq({
      token: getActiveUserToken(),
      params: { type: "assessment", versionCode },
      query: { templateId: "default" }
    });
    const deleteRes = createMockRes();
    deleteVersion(deleteReq, deleteRes as unknown as Response);
    assert.equal(deleteRes.statusCode, 200);
    const deleted = deleteRes.body as { code: number; data: { deleted: boolean } };
    assert.equal(deleted.code, 0);
    assert.equal(deleted.data.deleted, true);
  });
});

test("versions.usecase: createVersion generates versionCode by active rule when omitted", { concurrency: false }, () => {
  const versionsPath = versionsStorePath();
  const rulesPath = versionCodeRulesStorePath();
  withFilesSnapshotRestore([versionsPath, rulesPath], () => {
    fs.writeFileSync(versionsPath, JSON.stringify({ records: [] }, null, 2), "utf-8");
    fs.writeFileSync(
      rulesPath,
      JSON.stringify(
        {
          rules: [
            {
              id: "rule-implementation",
              moduleKey: "implementation",
              moduleName: "实施评估",
              moduleCode: "IA",
              prefix: "IA",
              format: "{PREFIX}-{GL}-{NN}",
              sample: "IA-GL-UT-01",
              status: "active",
              effectiveAt: "2026-04-06T00:00:00.000Z",
              updatedAt: "2026-04-06T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const req = createMockReq({
      token: getActiveUserToken(),
      body: {
        type: "assessment",
        templateId: "default",
        status: "draft",
        payload: { globalVersionCode: "GL-UT-BASE" },
      },
    });
    const res = createMockRes();
    createVersion(req, res as unknown as Response);
    assert.equal(res.statusCode, 200);
    const body = res.body as { code: number; data: { record: { versionCode: string } } };
    assert.equal(body.code, 0);
    assert.equal(body.data.record.versionCode, "IA-GL-UT-BASE-01");
  });
});

test("versions.usecase: createVersion increments sequence on conflict under active rule", { concurrency: false }, () => {
  const versionsPath = versionsStorePath();
  const rulesPath = versionCodeRulesStorePath();
  withFilesSnapshotRestore([versionsPath, rulesPath], () => {
    fs.writeFileSync(versionsPath, JSON.stringify({ records: [] }, null, 2), "utf-8");
    fs.writeFileSync(
      rulesPath,
      JSON.stringify(
        {
          rules: [
            {
              id: "rule-implementation",
              moduleKey: "implementation",
              moduleName: "实施评估",
              moduleCode: "IA",
              prefix: "IA",
              format: "{PREFIX}-{NN}",
              sample: "IA-01",
              status: "active",
              effectiveAt: "2026-04-06T00:00:00.000Z",
              updatedAt: "2026-04-06T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const req1 = createMockReq({
      token: getActiveUserToken(),
      body: { type: "assessment", templateId: "default", status: "draft", payload: {} },
    });
    const res1 = createMockRes();
    createVersion(req1, res1 as unknown as Response);
    assert.equal(res1.statusCode, 200);
    const versionCode1 = (res1.body as { data: { record: { versionCode: string } } }).data.record.versionCode;
    assert.equal(versionCode1, "IA-01");

    const req2 = createMockReq({
      token: getActiveUserToken(),
      body: { type: "assessment", templateId: "default", status: "draft", payload: {} },
    });
    const res2 = createMockRes();
    createVersion(req2, res2 as unknown as Response);
    assert.equal(res2.statusCode, 200);
    const versionCode2 = (res2.body as { data: { record: { versionCode: string } } }).data.record.versionCode;
    assert.equal(versionCode2, "IA-02");
  });
});

test("versions.usecase: createVersion fails when rule is not active", { concurrency: false }, () => {
  const versionsPath = versionsStorePath();
  const rulesPath = versionCodeRulesStorePath();
  withFilesSnapshotRestore([versionsPath, rulesPath], () => {
    fs.writeFileSync(versionsPath, JSON.stringify({ records: [] }, null, 2), "utf-8");
    fs.writeFileSync(
      rulesPath,
      JSON.stringify(
        {
          rules: [
            {
              id: "rule-implementation",
              moduleKey: "implementation",
              moduleName: "实施评估",
              moduleCode: "IA",
              prefix: "IA",
              format: "{PREFIX}-{NN}",
              sample: "IA-01",
              status: "draft",
              effectiveAt: "--",
              updatedAt: "2026-04-06T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const req = createMockReq({
      token: getActiveUserToken(),
      body: { type: "assessment", templateId: "default", status: "draft", payload: {} },
    });
    const res = createMockRes();
    createVersion(req, res as unknown as Response);
    assert.equal(res.statusCode, 409);
    assert.equal((res.body as { code?: number }).code, 40902);
  });
});

test("versions.usecase: createVersion fails when active rule lacks sequence placeholder and conflicts", { concurrency: false }, () => {
  const versionsPath = versionsStorePath();
  const rulesPath = versionCodeRulesStorePath();
  withFilesSnapshotRestore([versionsPath, rulesPath], () => {
    const owner = getActiveUser();
    const now = new Date().toISOString();
    fs.writeFileSync(
      versionsPath,
      JSON.stringify(
        {
          records: [
            {
              id: "ut-fixed-existing",
              type: "assessment",
              versionCode: "IA-FIXED",
              templateId: "default",
              ownerUserId: owner.id,
              status: "draft",
              payload: {},
              createdAt: now,
              updatedAt: now,
              createdByUserId: owner.id,
              createdByUsername: owner.username,
              updatedByUserId: owner.id,
              updatedByUsername: owner.username,
              checkoutStatus: "checked_in",
              versionDocStatus: "drafting",
              majorLetter: "A",
              minorNumber: 0,
              baseCode: "IA-FIXED",
              isHistoricalArchive: false,
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );
    fs.writeFileSync(
      rulesPath,
      JSON.stringify(
        {
          rules: [
            {
              id: "rule-implementation",
              moduleKey: "implementation",
              moduleName: "实施评估",
              moduleCode: "IA",
              prefix: "IA",
              format: "{PREFIX}-FIXED",
              sample: "IA-FIXED",
              status: "active",
              effectiveAt: now,
              updatedAt: now,
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const req = createMockReq({
      token: getActiveUserToken(),
      body: { type: "assessment", templateId: "default", status: "draft", payload: {} },
    });
    const res = createMockRes();
    createVersion(req, res as unknown as Response);
    assert.equal(res.statusCode, 409);
    assert.equal((res.body as { code?: number }).code, 40901);
  });
});

test("versions.usecase: checkout -> checkin updates lock and version code", { concurrency: false }, () => {
  const versionsPath = versionsStorePath();
  withFileSnapshotRestore(versionsPath, () => {
    const versionCode = `UT-VCS-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const createReq = createMockReq({
      token: getActiveUserToken(),
      body: {
        type: "assessment",
        versionCode,
        templateId: "default",
        status: "draft",
        payload: { a: 1 }
      }
    });
    const createRes = createMockRes();
    createVersion(createReq, createRes as unknown as Response);
    assert.equal(createRes.statusCode, 200);
    const created = createRes.body as { data: { record: { id: string } } };
    const recordId = created.data.record.id;

    const checkoutReq = createMockReq({ token: getActiveUserToken(), params: { id: recordId } });
    const checkoutRes = createMockRes();
    checkoutVersion(checkoutReq, checkoutRes as unknown as Response);
    assert.equal(checkoutRes.statusCode, 200);
    const checkedOut = checkoutRes.body as { data: { record: { checkoutStatus: string; checkedOutByUserId?: string } } };
    assert.equal(checkedOut.data.record.checkoutStatus, "checked_out");
    assert.ok(checkedOut.data.record.checkedOutByUserId);

    const checkinReq = createMockReq({
      token: getActiveUserToken(),
      params: { id: recordId },
      body: { payload: { a: 2 } }
    });
    const checkinRes = createMockRes();
    checkinVersion(checkinReq, checkinRes as unknown as Response);
    assert.equal(checkinRes.statusCode, 200);
    const checkedIn = checkinRes.body as { data: { record: { checkoutStatus: string; versionCode: string; payload: { a: number } } } };
    assert.equal(checkedIn.data.record.checkoutStatus, "checked_in");
    assert.equal(checkedIn.data.record.payload.a, 2);
    assert.ok(checkedIn.data.record.versionCode.includes("-VA1"));
  });
});

test("versions.usecase: save-draft updates payload while staying checked out", { concurrency: false }, () => {
  const versionsPath = versionsStorePath();
  withFileSnapshotRestore(versionsPath, () => {
    const versionCode = `UT-DRAFT-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const createReq = createMockReq({
      token: getActiveUserToken(),
      body: {
        type: "assessment",
        versionCode,
        templateId: "default",
        status: "draft",
        payload: { a: 1 },
      },
    });
    const createRes = createMockRes();
    createVersion(createReq, createRes as unknown as Response);
    assert.equal(createRes.statusCode, 200);
    const recordId = (createRes.body as { data: { record: { id: string } } }).data.record.id;

    const checkoutReq = createMockReq({ token: getActiveUserToken(), params: { id: recordId } });
    const checkoutRes = createMockRes();
    checkoutVersion(checkoutReq, checkoutRes as unknown as Response);
    assert.equal(checkoutRes.statusCode, 200);

    const draftReq = createMockReq({
      token: getActiveUserToken(),
      params: { id: recordId },
      body: { payload: { a: 99 } },
    });
    const draftRes = createMockRes();
    saveCheckedOutDraft(draftReq, draftRes as unknown as Response);
    assert.equal(draftRes.statusCode, 200);
    const body = draftRes.body as {
      data: { record: { checkoutStatus: string; versionCode: string; payload: { a: number } } };
    };
    assert.equal(body.data.record.checkoutStatus, "checked_out");
    assert.equal(body.data.record.versionCode, versionCode);
    assert.equal(body.data.record.payload.a, 99);
  });
});

test("versions.usecase: undo-checkout restores last checkin payload", { concurrency: false }, () => {
  const versionsPath = versionsStorePath();
  withFileSnapshotRestore(versionsPath, () => {
    const versionCode = `UT-UNDO-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const createReq = createMockReq({
      token: getActiveUserToken(),
      body: {
        type: "assessment",
        versionCode,
        templateId: "default",
        status: "draft",
        payload: { name: "before" }
      }
    });
    const createRes = createMockRes();
    createVersion(createReq, createRes as unknown as Response);
    const recordId = (createRes.body as { data: { record: { id: string } } }).data.record.id;

    const checkoutReq = createMockReq({ token: getActiveUserToken(), params: { id: recordId } });
    const checkoutRes = createMockRes();
    checkoutVersion(checkoutReq, checkoutRes as unknown as Response);
    assert.equal(checkoutRes.statusCode, 200);

    const store = JSON.parse(fs.readFileSync(versionsPath, "utf-8")) as {
      records: Array<{ id: string; payload: Record<string, unknown> }>;
    };
    const target = store.records.find((x) => x.id === recordId);
    assert.ok(target);
    target.payload = { name: "changed" };
    fs.writeFileSync(versionsPath, JSON.stringify(store, null, 2), "utf-8");

    const undoReq = createMockReq({ token: getActiveUserToken(), params: { id: recordId } });
    const undoRes = createMockRes();
    undoCheckout(undoReq, undoRes as unknown as Response);
    assert.equal(undoRes.statusCode, 200);
    const body = undoRes.body as { data: { record: { checkoutStatus: string; payload: { name: string } } } };
    assert.equal(body.data.record.checkoutStatus, "checked_in");
    assert.equal(body.data.record.payload.name, "before");
  });
});

test("versions.usecase: promote archives current record and creates checked_out record", { concurrency: false }, () => {
  const versionsPath = versionsStorePath();
  withFileSnapshotRestore(versionsPath, () => {
    const versionCode = `UT-PM-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const createReq = createMockReq({
      token: getActiveUserToken(),
      body: {
        type: "assessment",
        versionCode,
        templateId: "default",
        status: "draft",
        payload: { p: 1 }
      }
    });
    const createRes = createMockRes();
    createVersion(createReq, createRes as unknown as Response);
    const recordId = (createRes.body as { data: { record: { id: string } } }).data.record.id;

    const promoteReq = createMockReq({ token: getActiveUserToken(), params: { id: recordId } });
    const promoteRes = createMockRes();
    promoteVersion(promoteReq, promoteRes as unknown as Response);
    assert.equal(promoteRes.statusCode, 200);
    const body = promoteRes.body as {
      data: {
        archived: { isHistoricalArchive: boolean };
        newRecord: { checkoutStatus: string; versionCode: string };
      };
    };
    assert.equal(body.data.archived.isHistoricalArchive, true);
    assert.equal(body.data.newRecord.checkoutStatus, "checked_out");
    assert.ok(body.data.newRecord.versionCode.includes("-VB1"));
  });
});

test("versions.usecase: force-unlock requires admin and unlocks checked out record", { concurrency: false }, () => {
  const versionsPath = versionsStorePath();
  withFileSnapshotRestore(versionsPath, () => {
    const versionCode = `UT-FU-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const createReq = createMockReq({
      token: getActiveUserToken(),
      body: {
        type: "assessment",
        versionCode,
        templateId: "default",
        status: "draft",
        payload: {}
      }
    });
    const createRes = createMockRes();
    createVersion(createReq, createRes as unknown as Response);
    const recordId = (createRes.body as { data: { record: { id: string } } }).data.record.id;

    const checkoutReq = createMockReq({ token: getActiveUserToken(), params: { id: recordId } });
    const checkoutRes = createMockRes();
    checkoutVersion(checkoutReq, checkoutRes as unknown as Response);
    assert.equal(checkoutRes.statusCode, 200);

    const nonAdminReq = createMockReq({ token: getNonAdminUserToken(), params: { id: recordId } });
    const nonAdminRes = createMockRes();
    forceUnlockVersion(nonAdminReq, nonAdminRes as unknown as Response);
    assert.equal(nonAdminRes.statusCode, 403);
    assert.equal((nonAdminRes.body as { code?: number }).code, 40301);

    const adminReq = createMockReq({ token: getActiveUserToken(), params: { id: recordId } });
    const adminRes = createMockRes();
    forceUnlockVersion(adminReq, adminRes as unknown as Response);
    assert.equal(adminRes.statusCode, 200);
    const unlocked = adminRes.body as { data: { record: { checkoutStatus: string } } };
    assert.equal(unlocked.data.record.checkoutStatus, "checked_in");
  });
});

test("team.controller: postTeam returns 401 without token", () => {
  const req = createMockReq({ body: { name: "UT Team" } });
  const res = createMockRes();
  postTeam(req, res as unknown as Response);
  assert.equal(res.statusCode, 401);
  assert.equal((res.body as { code?: number }).code, 40101);
});

test("team.controller: patchReviewStatus returns 401 without token", () => {
  const req = createMockReq({
    params: { teamId: "t1", reviewId: "r1" },
    body: { status: "closed" }
  });
  const res = createMockRes();
  patchReviewStatus(req, res as unknown as Response);
  assert.equal(res.statusCode, 401);
  assert.equal((res.body as { code?: number }).code, 40101);
});

test("ai.usecase: kimiAssessmentPreview returns model result on valid response", async () => {
  const req = createMockReq({
    token: getActiveUserToken(),
    body: {
      source: { globalVersionCode: "GL-UT-01", requirementVersionCode: "RI-UT-01" },
      requirementSnapshot: {
        basicInfo: { projectName: "UT 项目", productLines: ["金蝶AI星空"] },
        valuePropositionRows: [],
        businessNeedRows: [{ businessNeed: "订单到收款流程打通" }],
        devOverviewRows: [],
        productModuleRows: [{ moduleName: "总账", userCount: "120" }],
        implementationScopeRows: [{ companyName: "A公司" }],
        meetingNotes: "范围一期，先财务后供应链",
        keyPointRows: [{ detail: "主数据统一" }],
      },
      ruleContext: { promptProfile: "assessment_default_v1" },
    },
  });
  const res = createMockRes();
  const originalFetch = (globalThis as { fetch?: unknown }).fetch;
  const originalApiKey = config.kimi.apiKey;
  try {
    config.kimi.apiKey = "unit-test-key";
    (globalThis as { fetch?: unknown }).fetch = async () =>
      ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  assessmentDraft: {
                    quoteMode: "模块报价",
                    productLines: ["金蝶AI星空"],
                    userCount: 120,
                    orgCount: 1,
                    orgSimilarity: 0,
                    difficultyFactor: 0.4,
                    moduleItems: [
                      { moduleName: "总账", standardDays: 2, suggestedDays: 3, reason: "基础财务域复杂度中等" },
                    ],
                    risks: ["主数据口径需先统一"],
                    assumptions: ["按一期范围估算"],
                  },
                }),
              },
            },
          ],
        }),
      }) as unknown;
    await kimiAssessmentPreview(req, res as unknown as Response);
    assert.equal(res.statusCode, 200);
    const body = res.body as {
      code: number;
      data: {
        meta: { mode: string };
        assessmentDraft: { moduleItems: Array<{ moduleName: string }> };
      };
    };
    assert.equal(body.code, 0);
    assert.equal(body.data.meta.mode, "model");
    assert.equal(body.data.assessmentDraft.moduleItems[0]?.moduleName, "总账");
  } finally {
    (globalThis as { fetch?: unknown }).fetch = originalFetch;
    config.kimi.apiKey = originalApiKey;
  }
});

test("ai.usecase: kimiAssessmentPreview falls back on model timeout", async () => {
  const req = createMockReq({
    token: getActiveUserToken(),
    body: {
      source: { globalVersionCode: "GL-UT-02", requirementVersionCode: "RI-UT-02" },
      requirementSnapshot: {
        basicInfo: { projectName: "UT 项目2", productLines: ["云之家"] },
        valuePropositionRows: [],
        businessNeedRows: [{ businessNeed: "供应链到财务协同" }],
        devOverviewRows: [],
        productModuleRows: [{ moduleName: "供应链", userCount: "80" }],
        implementationScopeRows: [],
        meetingNotes: "",
        keyPointRows: [],
      },
      ruleContext: { promptProfile: "assessment_default_v1" },
    },
  });
  const res = createMockRes();
  const originalFetch = (globalThis as { fetch?: unknown }).fetch;
  const originalApiKey = config.kimi.apiKey;
  try {
    config.kimi.apiKey = "unit-test-key";
    (globalThis as { fetch?: unknown }).fetch = async () => {
      throw new Error("timeout");
    };
    await kimiAssessmentPreview(req, res as unknown as Response);
    assert.equal(res.statusCode, 200);
    const body = res.body as {
      code: number;
      data: { meta: { mode: string; fallbackReason: string } };
    };
    assert.equal(body.code, 0);
    assert.equal(body.data.meta.mode, "rule_fallback");
    assert.match(body.data.meta.fallbackReason, /timeout/i);
  } finally {
    (globalThis as { fetch?: unknown }).fetch = originalFetch;
    config.kimi.apiKey = originalApiKey;
  }
});

test("ai.usecase: kimiAssessmentPreview falls back on invalid model json", async () => {
  const req = createMockReq({
    token: getActiveUserToken(),
    body: {
      source: { globalVersionCode: "GL-UT-03", requirementVersionCode: "RI-UT-03" },
      requirementSnapshot: {
        basicInfo: { projectName: "UT 项目3" },
        valuePropositionRows: [],
        businessNeedRows: [{ businessNeed: "预算管控" }],
        devOverviewRows: [],
        productModuleRows: [{ moduleName: "预算", userCount: "60" }],
        implementationScopeRows: [],
        meetingNotes: "有部分约束",
        keyPointRows: [],
      },
      ruleContext: { promptProfile: "assessment_default_v1" },
    },
  });
  const res = createMockRes();
  const originalFetch = (globalThis as { fetch?: unknown }).fetch;
  const originalApiKey = config.kimi.apiKey;
  try {
    config.kimi.apiKey = "unit-test-key";
    (globalThis as { fetch?: unknown }).fetch = async () =>
      ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "{}" } }],
        }),
      }) as unknown;
    await kimiAssessmentPreview(req, res as unknown as Response);
    assert.equal(res.statusCode, 200);
    const body = res.body as {
      code: number;
      data: { meta: { mode: string; fallbackReason: string } };
    };
    assert.equal(body.code, 0);
    assert.equal(body.data.meta.mode, "rule_fallback");
    assert.match(body.data.meta.fallbackReason, /model_invalid_assessment_json/i);
  } finally {
    (globalThis as { fetch?: unknown }).fetch = originalFetch;
    config.kimi.apiKey = originalApiKey;
  }
});
