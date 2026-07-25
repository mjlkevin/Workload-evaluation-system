import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import XLSX from "xlsx";
import bcrypt from "bcryptjs";

import { NextFunction, Request, Response } from "express";

import { AuthUser } from "../types";
import { config } from "../config/env";
import { loadUsersStore, saveUsersStore, signAuthToken, verifyAuthToken } from "../middleware/auth";
import { aiSessionsStorePath, knowledgeBaseConfigStorePath, passwordResetTokensStorePath, usersStorePath, versionCodeRulesStorePath, versionsStorePath } from "../utils";
import { confirmPasswordReset, listUsers, login, me, requestPasswordReset, updateUserBusinessRole, updateUserPassword } from "./auth/auth.usecase";
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
import { homeWorkbenchChat, kimiAssessmentPreview, parseBasicInfo } from "./ai/ai.usecase";
import { testKnowledgeBaseConnectivity } from "./system/system.usecase";
import * as AiSessionsModule from "./ai-sessions/ai-sessions.module";
import * as ProjectEvaluationsModule from "./project-evaluations/project-evaluations.module";
import { createConfirmAiAssessmentDraftHandler } from "./project-evaluations/project-evaluations.controller";
import { buildDerivedWbsItemsForUser } from "../routes/wbs.routes";
import { bootstrapAiProviders, _resetAiBootstrapForTest } from "../ai/bootstrap";

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
  file?: { buffer: Buffer; originalname?: string };
}): Request {
  const headers: Record<string, string> = {};
  if (input.token) {
    headers.authorization = `Bearer ${input.token}`;
  }
  return {
    query: input.query || {},
    params: input.params || {},
    body: input.body || {},
    file: input.file,
    header(name: string) {
      return headers[name.toLowerCase()];
    }
  } as unknown as Request;
}

const noopNext: NextFunction = () => undefined;

function createMinimalRequirementWorkbookBuffer(): Buffer {
  const workbook = XLSX.utils.book_new();
  const overview = XLSX.utils.aoa_to_sheet([
    ["项目名称", "UT 模型解析项目"],
    ["客户名称", "UT 客户"],
  ]);
  const needs = XLSX.utils.aoa_to_sheet([
    ["序号", "业务领域", "分类", "业务需求及问题"],
    [1, "供应链", "采购", "采购订单需要联动入库与付款"],
  ]);
  XLSX.utils.book_append_sheet(workbook, overview, "1.项目概况");
  XLSX.utils.book_append_sheet(workbook, needs, "3.业务需求及问题一览表");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
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

test("system.usecase: empty retrieval still proves knowledge base connectivity", { concurrency: false }, async () => {
  const store = loadUsersStore();
  const admin = store.users.find((x) => x.status === "active" && x.role === "admin");
  assert.ok(admin, "active admin required");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new globalThis.Response(
    JSON.stringify({ code: 200, message: "请求成功", data: [] }),
    { status: 200, headers: { "content-type": "application/json" } },
  )) as typeof fetch;

  try {
    const req = createMockReq({
      token: signAuthToken(admin),
      body: {
        apiKey: "zhipu-unit-test-key",
        knowledgeId: "knowledge-unit-test-id",
      },
    });
    const res = createMockRes();

    await testKnowledgeBaseConnectivity(req, res as unknown as Response);

    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const body = res.body as {
      data: {
        ok: boolean;
        warning?: string;
        retrievalTriggered: boolean;
      };
    };
    assert.equal(body.data.ok, true);
    assert.equal(body.data.warning, "retrieval_empty");
    assert.equal(body.data.retrievalTriggered, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function withFileSnapshotRestoreAsync(filePath: string, run: () => Promise<void>): Promise<void> {
  const existed = fs.existsSync(filePath);
  const before = existed ? fs.readFileSync(filePath, "utf-8") : "";
  try {
    await run();
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

test("auth.usecase: login can issue a remembered 7-day token", async () => {
  await withFileSnapshotRestoreAsync(usersStorePath(), async () => {
    const user: AuthUser = {
      id: "ut-remember-login-target",
      username: "ut-remember-login-target",
      passwordHash: await bcrypt.hash("Remember123!", 10),
      role: "user",
      businessRole: "pre_sales",
      status: "active",
      createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      lastLoginAt: "",
    };
    const testStore = loadUsersStore();
    testStore.users = testStore.users.filter((item) => item.id !== user.id);
    testStore.users.push(user);
    saveUsersStore(testStore);

    const issuedAtSeconds = Math.floor(Date.now() / 1000);
    const req = createMockReq({ body: { username: user.username, password: "Remember123!", rememberMe: true } });
    const res = createMockRes();
    await login(req, res as unknown as Response);

    assert.equal(res.statusCode, 200);
    const body = res.body as { code: number; data: { token: string; expiresIn: string; rememberMe: boolean } };
    assert.equal(body.code, 0);
    assert.equal(body.data.expiresIn, "7d");
    assert.equal(body.data.rememberMe, true);

    const decoded = verifyAuthToken(body.data.token);
    assert.ok(decoded);
    const payload = JSON.parse(Buffer.from(body.data.token.split(".")[1], "base64url").toString("utf-8")) as { exp: number; iat: number };
    assert.ok(payload.exp - (payload.iat || issuedAtSeconds) >= 604700);
  });
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

test("auth.usecase: me returns businessRole with valid token", () => {
  const req = createMockReq({ token: getActiveUserToken() });
  const res = createMockRes();
  me(req, res as unknown as Response);

  assert.equal(res.statusCode, 200);
  const body = res.body as { code: number; data: { user: { businessRole?: string } } };
  assert.equal(body.code, 0);
  assert.ok(body.data.user.businessRole);
});

test("auth.usecase: updateUserBusinessRole changes only business role", () => {
  const store = loadUsersStore();
  const admin = store.users.find((x) => x.status === "active" && x.role === "admin");
  const target = store.users.find((x) => x.status === "active" && x.role !== "admin");
  assert.ok(admin, "active admin required");
  assert.ok(target, "active non-admin target required");

  withFileSnapshotRestore(usersStorePath(), () => {
    const req = createMockReq({
      token: signAuthToken(admin),
      params: { userId: target.id },
      body: { businessRole: "sales" },
    });
    const res = createMockRes();
    updateUserBusinessRole(req, res as unknown as Response);

    assert.equal(res.statusCode, 200);
    const body = res.body as { code: number; data: { user: { role: string; businessRole: string } } };
    assert.equal(body.code, 0);
    assert.equal(body.data.user.role, target.role);
    assert.equal(body.data.user.businessRole, "sales");
  });
});

test("auth.usecase: updateUserBusinessRole rejects invalid role", () => {
  const store = loadUsersStore();
  const admin = store.users.find((x) => x.status === "active" && x.role === "admin");
  const target = store.users.find((x) => x.status === "active");
  assert.ok(admin, "active admin required");
  assert.ok(target, "active target required");

  const req = createMockReq({
    token: signAuthToken(admin),
    params: { userId: target.id },
    body: { businessRole: "bad_role" },
  });
  const res = createMockRes();
  updateUserBusinessRole(req, res as unknown as Response);

  assert.equal(res.statusCode, 400);
  assert.equal((res.body as { code?: number }).code, 40001);
});

test("auth.usecase: updateUserPassword lets an admin reset login password", async () => {
  const store = loadUsersStore();
  const admin = store.users.find((x) => x.status === "active" && x.role === "admin");
  assert.ok(admin, "active admin required");

  await withFileSnapshotRestoreAsync(usersStorePath(), async () => {
    const target: AuthUser = {
      id: "ut-reset-target",
      username: "ut-reset-target",
      passwordHash: await bcrypt.hash("OldPass123!", 10),
      role: "user",
      businessRole: "pre_sales",
      status: "active",
      createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      lastLoginAt: "",
    };
    const testStore = loadUsersStore();
    testStore.users = testStore.users.filter((user) => user.id !== target.id);
    testStore.users.push(target);
    saveUsersStore(testStore);

    const req = createMockReq({
      token: signAuthToken(admin),
      params: { userId: target.id },
      body: { password: "NewPass123!" },
    });
    const res = createMockRes();
    await updateUserPassword(req, res as unknown as Response);

    assert.equal(res.statusCode, 200);
    const body = res.body as { code: number; data: { user: { id: string; passwordHash?: string } } };
    assert.equal(body.code, 0);
    assert.equal(body.data.user.id, target.id);
    assert.equal(body.data.user.passwordHash, undefined);

    const oldLoginRes = createMockRes();
    await login(createMockReq({ body: { username: target.username, password: "OldPass123!" } }), oldLoginRes as unknown as Response);
    assert.equal(oldLoginRes.statusCode, 400);
    assert.equal((oldLoginRes.body as { code?: number }).code, 40001);

    const newLoginRes = createMockRes();
    await login(createMockReq({ body: { username: target.username, password: "NewPass123!" } }), newLoginRes as unknown as Response);
    assert.equal(newLoginRes.statusCode, 200);
    assert.equal((newLoginRes.body as { data: { user: { id: string } } }).data.user.id, target.id);
  });
});

test("auth.usecase: password reset request and confirm update password once", async () => {
  await withFileSnapshotRestoreAsync(usersStorePath(), async () => {
    await withFileSnapshotRestoreAsync(passwordResetTokensStorePath(), async () => {
      const target: AuthUser = {
        id: "ut-password-reset-target",
        username: "ut-password-reset-target",
        passwordHash: await bcrypt.hash("OldPass123!", 10),
        role: "user",
        businessRole: "pre_sales",
        status: "active",
        createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
        lastLoginAt: "",
      };
      const testStore = loadUsersStore();
      testStore.users = testStore.users.filter((user) => user.id !== target.id);
      testStore.users.push(target);
      saveUsersStore(testStore);

      const requestRes = createMockRes();
      await requestPasswordReset(
        createMockReq({ body: { username: target.username } }),
        requestRes as unknown as Response
      );

      assert.equal(requestRes.statusCode, 200);
      const requestBody = requestRes.body as {
        code: number;
        data: { accepted: boolean; resetToken?: string; resetUrl?: string; expiresInMinutes: number };
      };
      assert.equal(requestBody.code, 0);
      assert.equal(requestBody.data.accepted, true);
      assert.equal(requestBody.data.expiresInMinutes, 30);
      assert.ok(requestBody.data.resetToken);
      assert.ok(requestBody.data.resetUrl?.includes("/reset-password?token="));

      const confirmRes = createMockRes();
      await confirmPasswordReset(
        createMockReq({ body: { token: requestBody.data.resetToken, password: "NewPass123!" } }),
        confirmRes as unknown as Response
      );
      assert.equal(confirmRes.statusCode, 200);
      assert.equal((confirmRes.body as { code: number; data: { success: boolean } }).data.success, true);

      const oldLoginRes = createMockRes();
      await login(createMockReq({ body: { username: target.username, password: "OldPass123!" } }), oldLoginRes as unknown as Response);
      assert.equal(oldLoginRes.statusCode, 400);

      const newLoginRes = createMockRes();
      await login(createMockReq({ body: { username: target.username, password: "NewPass123!" } }), newLoginRes as unknown as Response);
      assert.equal(newLoginRes.statusCode, 200);

      const reuseRes = createMockRes();
      await confirmPasswordReset(
        createMockReq({ body: { token: requestBody.data.resetToken, password: "AnotherPass123!" } }),
        reuseRes as unknown as Response
      );
      assert.equal(reuseRes.statusCode, 400);
      assert.equal((reuseRes.body as { code?: number }).code, 40001);
    });
  });
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

test("ai-sessions: creates and lists a persistent session", () => {
  withFileSnapshotRestore(aiSessionsStorePath(), () => {
    const token = getActiveUserToken();
    const createReq = createMockReq({
      token,
      body: {
        title: "XX制造 WMS 粗评",
        domain: "business_evaluation",
        workflowKey: "rough_estimate",
        status: "rough_estimate",
      },
    });
    const createRes = createMockRes();
    AiSessionsModule.createSession(createReq, createRes as unknown as Response);

    assert.equal(createRes.statusCode, 200);
    const created = createRes.body as { code: number; data: { session: { sessionId: string; title: string; status: string } } };
    assert.equal(created.code, 0);
    assert.equal(created.data.session.title, "XX制造 WMS 粗评");
    assert.equal(created.data.session.status, "rough_estimate");

    const listReq = createMockReq({ token, query: { domain: "business_evaluation" } });
    const listRes = createMockRes();
    AiSessionsModule.listSessions(listReq, listRes as unknown as Response);

    assert.equal(listRes.statusCode, 200);
    const listed = listRes.body as { code: number; data: { items: Array<{ sessionId: string }> } };
    assert.ok(listed.data.items.some((item) => item.sessionId === created.data.session.sessionId));
  });
});

test("ai-sessions: appends messages and creates pending action", () => {
  withFileSnapshotRestore(aiSessionsStorePath(), () => {
    const token = getActiveUserToken();
    const createReq = createMockReq({
      token,
      body: { title: "创建项目确认", domain: "business_evaluation", workflowKey: "project_discovery" },
    });
    const createRes = createMockRes();
    AiSessionsModule.createSession(createReq, createRes as unknown as Response);
    const sessionId = (createRes.body as { data: { session: { sessionId: string } } }).data.session.sessionId;

    const appendReq = createMockReq({
      token,
      params: { sessionId },
      body: {
        message: { role: "user", content: "请把它转成正式项目评估" },
        artifact: { type: "rough_report", title: "粗评报告", content: "预计 120 人天" },
        pendingAction: {
          actionType: "create_project_evaluation",
          title: "创建项目评估方案",
          riskLevel: "high",
          payload: { projectName: "XX制造 WMS 项目", customerName: "XX制造" },
        },
      },
    });
    const appendRes = createMockRes();
    AiSessionsModule.appendSessionEvent(appendReq, appendRes as unknown as Response);

    assert.equal(appendRes.statusCode, 200);
    const body = appendRes.body as { code: number; data: { session: { messages: unknown[]; artifacts: unknown[]; pendingActions: Array<{ status: string }> } } };
    assert.equal(body.code, 0);
    assert.equal(body.data.session.messages.length, 1);
    assert.equal(body.data.session.artifacts.length, 1);
    assert.equal(body.data.session.pendingActions[0].status, "pending");
  });
});

test("ai-sessions: deletes an owned session permanently", () => {
  withFileSnapshotRestore(aiSessionsStorePath(), () => {
    const token = getActiveUserToken();
    const createReq = createMockReq({
      token,
      body: { title: "待删除会话", domain: "business_evaluation", workflowKey: "free_chat" },
    });
    const createRes = createMockRes();
    AiSessionsModule.createSession(createReq, createRes as unknown as Response);
    const sessionId = (createRes.body as { data: { session: { sessionId: string } } }).data.session.sessionId;

    const deleteReq = createMockReq({ token, params: { sessionId } });
    const deleteRes = createMockRes();
    AiSessionsModule.deleteSession(deleteReq, deleteRes as unknown as Response);

    assert.equal(deleteRes.statusCode, 200);
    const body = deleteRes.body as { code: number; data: { deletedSessionId: string } };
    assert.equal(body.code, 0);
    assert.equal(body.data.deletedSessionId, sessionId);

    const getReq = createMockReq({ token, params: { sessionId } });
    const getRes = createMockRes();
    AiSessionsModule.getSession(getReq, getRes as unknown as Response);
    assert.equal(getRes.statusCode, 404);
  });
});

test("ai-sessions: normalizes invalid event fields and ignores blank events", () => {
  withFileSnapshotRestore(aiSessionsStorePath(), () => {
    const token = getActiveUserToken();
    const createReq = createMockReq({
      token,
      body: { title: "事件规范化", domain: "business_evaluation", workflowKey: "free_chat" },
    });
    const createRes = createMockRes();
    AiSessionsModule.createSession(createReq, createRes as unknown as Response);
    const sessionId = (createRes.body as { data: { session: { sessionId: string } } }).data.session.sessionId;

    const appendReq = createMockReq({
      token,
      params: { sessionId },
      body: {
        message: { role: "bad_role", content: "  有效消息  ", attachmentIds: ["att-1", "", null], artifactIds: "bad" },
        artifact: { type: "note", title: "  产物  ", status: "bad_status" },
        pendingAction: { actionType: "create_project_evaluation", title: "  动作  ", riskLevel: "bad_risk", payload: [] },
      },
    });
    const appendRes = createMockRes();
    AiSessionsModule.appendSessionEvent(appendReq, appendRes as unknown as Response);

    const body = appendRes.body as {
      data: {
        session: {
          messages: Array<{ role: string; content: string; attachmentIds: string[]; artifactIds: string[] }>;
          artifacts: Array<{ title: string; status: string }>;
          pendingActions: Array<{ title: string; riskLevel: string; payload: Record<string, unknown> }>;
          updatedAt: string;
        };
      };
    };
    assert.equal(body.data.session.messages[0].role, "user");
    assert.equal(body.data.session.messages[0].content, "有效消息");
    assert.deepEqual(body.data.session.messages[0].attachmentIds, ["att-1"]);
    assert.deepEqual(body.data.session.messages[0].artifactIds, []);
    assert.equal(body.data.session.artifacts[0].title, "产物");
    assert.equal(body.data.session.artifacts[0].status, "generated");
    assert.equal(body.data.session.pendingActions[0].title, "动作");
    assert.equal(body.data.session.pendingActions[0].riskLevel, "high");
    assert.deepEqual(body.data.session.pendingActions[0].payload, {});
    const updatedAt = body.data.session.updatedAt;

    const blankReq = createMockReq({
      token,
      params: { sessionId },
      body: {
        message: { role: "assistant", content: "   " },
        artifact: { title: "   " },
        pendingAction: { title: "   " },
      },
    });
    const blankRes = createMockRes();
    AiSessionsModule.appendSessionEvent(blankReq, blankRes as unknown as Response);
    const blankBody = blankRes.body as { data: { session: { messages: unknown[]; artifacts: unknown[]; pendingActions: unknown[]; updatedAt: string } } };

    assert.equal(blankBody.data.session.messages.length, 1);
    assert.equal(blankBody.data.session.artifacts.length, 1);
    assert.equal(blankBody.data.session.pendingActions.length, 1);
    assert.equal(blankBody.data.session.updatedAt, updatedAt);
  });
});

test("project-evaluations: creates project plan from ai session", () => {
  withFileSnapshotRestore(versionsStorePath(), () => {
    const token = getActiveUserToken();
    const req = createMockReq({
      token,
      body: {
        projectName: "XX制造 WMS 项目",
        customerName: "XX制造",
        industry: "制造业",
        createdFromSessionId: "session-001",
      },
    });
    const res = createMockRes();
    ProjectEvaluationsModule.createProjectEvaluation(req, res as unknown as Response);

    assert.equal(res.statusCode, 200);
    const body = res.body as { code: number; data: { project: { projectId: string; projectName: string; customerName: string; createdFromSessionId: string } } };
    assert.equal(body.code, 0);
    assert.equal(body.data.project.projectName, "XX制造 WMS 项目");
    assert.equal(body.data.project.customerName, "XX制造");
    assert.equal(body.data.project.createdFromSessionId, "session-001");

    const store = fs.readFileSync(versionsStorePath(), "utf-8");
    const parsed = JSON.parse(store) as { records: Array<{ id: string; type: string; ownerUserId: string; payload?: Record<string, unknown> }> };
    const backing = parsed.records.find((record) => record.id === body.data.project.projectId);
    assert.equal(backing?.type, "global");
    assert.equal(backing?.payload?.recordKind, "project_evaluation");
    assert.equal(backing?.payload?.projectStatus, "draft");
  });
});

test("project-evaluations: lists project plans", () => {
  withFileSnapshotRestore(versionsStorePath(), () => {
    const token = getActiveUserToken();
    ProjectEvaluationsModule.createProjectEvaluation(createMockReq({
      token,
      body: { projectName: "XX制造 WMS 项目", customerName: "XX制造", industry: "制造业" },
    }), createMockRes() as unknown as Response);

    const req = createMockReq({ token, query: { q: "XX制造" } });
    const res = createMockRes();
    ProjectEvaluationsModule.listProjectEvaluations(req, res as unknown as Response);

    assert.equal(res.statusCode, 200);
    const body = res.body as { code: number; data: { items: Array<{ projectName: string }> } };
    assert.equal(body.code, 0);
    assert.ok(body.data.items.some((item) => item.projectName === "XX制造 WMS 项目"));
  });
});

test("project-evaluations: project containers do not replace latest formal global plan for WBS", async () => {
  withFileSnapshotRestore(versionsStorePath(), () => {
    const user = getActiveUser();
    const token = signAuthToken(user);
    fs.writeFileSync(versionsStorePath(), JSON.stringify({
      records: [
        {
          id: "formal-global",
          type: "global",
          versionCode: "GL-FORMAL",
          templateId: "default",
          ownerUserId: user.id,
          status: "draft",
          payload: { projectName: "正式总方案", requirementImportVersionCode: "RI-FORMAL" },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          createdByUserId: user.id,
          createdByUsername: user.username,
          updatedByUserId: user.id,
          updatedByUsername: user.username,
          checkoutStatus: "checked_in",
          versionDocStatus: "drafting",
          majorLetter: "A",
          minorNumber: 0,
          baseCode: "GL-FORMAL",
          isHistoricalArchive: false,
          lastCheckinPayload: {},
        },
        {
          id: "legacy-project-container",
          type: "global",
          versionCode: "PROJECT-LEGACY",
          templateId: "project-evaluation",
          ownerUserId: user.id,
          status: "draft",
          payload: { projectName: "遗留项目容器" },
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          createdByUserId: user.id,
          createdByUsername: user.username,
          updatedByUserId: user.id,
          updatedByUsername: user.username,
          checkoutStatus: "checked_in",
          versionDocStatus: "drafting",
          majorLetter: "A",
          minorNumber: 0,
          baseCode: "PROJECT-LEGACY",
          isHistoricalArchive: false,
          lastCheckinPayload: {},
        },
      ],
    }, null, 2), "utf-8");

    ProjectEvaluationsModule.createProjectEvaluation(createMockReq({
      token,
      body: { projectName: "最新项目容器", customerName: "XX制造" },
    }), createMockRes() as unknown as Response);

    const items = buildDerivedWbsItemsForUser(user);
    assert.equal(items[0].sourceGlobalVersionCode, "GL-FORMAL");
    assert.match(items[0].taskName, /正式总方案/);

    const listRes = createMockRes();
    ProjectEvaluationsModule.listProjectEvaluations(createMockReq({ token, query: { q: "遗留" } }), listRes as unknown as Response);
    const listBody = listRes.body as { data: { items: Array<{ projectName: string }> } };
    assert.ok(listBody.data.items.some((item) => item.projectName === "遗留项目容器"));
  });
});

test("project-evaluations.controller: confirm AI assessment draft returns success response", async () => {
  const token = getActiveUserToken();
  const handler = createConfirmAiAssessmentDraftHandler({
    async confirmAiAssessmentDraftForUser(user, assessmentRecordId, input, _repo) {
      assert.equal(user.id, getActiveUser().id);
      assert.equal(assessmentRecordId, "assessment-ai-1");
      assert.deepEqual(input, { note: "人工确认可进入评估" });
      return {
        project: {
          projectId: "project-ai-1",
          projectName: "AI 草稿项目",
          customerName: "测试客户",
          industry: "制造业",
          currentStage: "manual_confirmed",
          status: "reviewing",
          ownerUserId: user.id,
          ownerUsername: user.username,
          participantUserIds: [],
          createdFromSessionId: "",
          createdFromHarnessRunId: "run-ai-1",
          createdFromHarnessActionId: "create_requirement_draft",
          assessmentVersionCode: "IA-DRAFT-1",
          aiDraftReviewStatus: "confirmed",
          aiDraftConfirmedAt: "2026-06-22T00:00:00.000Z",
          aiDraftConfirmedByUsername: user.username,
          createdAt: "2026-06-22T00:00:00.000Z",
          updatedAt: "2026-06-22T00:00:00.000Z",
        },
        assessmentDraft: {
          recordId: "assessment-ai-1",
          versionCode: "IA-DRAFT-1",
          status: "draft_from_ai",
          manualConfirmation: {
            status: "confirmed",
            confirmedAt: "2026-06-22T00:00:00.000Z",
            confirmedByUserId: user.id,
            confirmedByUsername: user.username,
            note: "人工确认可进入评估",
            harnessToolEventId: "tool-ai-1",
          },
        },
        harness: {
          runId: "run-ai-1",
          actionId: "create_requirement_draft",
          toolEventId: "tool-ai-1",
          status: "confirmed",
        },
      };
    },
  });

  const req = createMockReq({
    token,
    params: { assessmentId: "assessment-ai-1" },
    body: { note: "人工确认可进入评估" },
  });
  const res = createMockRes();
  await handler(req, res as unknown as Response, noopNext);

  assert.equal(res.statusCode, 200);
  const body = res.body as { code: number; data: { project: { projectId: string }; assessmentDraft: { manualConfirmation: { harnessToolEventId: string } }; harness: { toolEventId: string } } };
  assert.equal(body.code, 0);
  assert.equal(body.data.project.projectId, "project-ai-1");
  assert.equal(body.data.assessmentDraft.manualConfirmation.harnessToolEventId, "tool-ai-1");
  assert.equal(body.data.harness.toolEventId, "tool-ai-1");
});

test("project-evaluations.controller: confirm AI assessment draft returns 404 when draft is not owned or missing", async () => {
  const handler = createConfirmAiAssessmentDraftHandler({
    async confirmAiAssessmentDraftForUser(_user, _assessmentRecordId, _input, _repo) {
      return null;
    },
  });

  const res = createMockRes();
  await handler(createMockReq({ token: getActiveUserToken(), params: { assessmentId: "missing-assessment" } }), res as unknown as Response, noopNext);

  assert.equal(res.statusCode, 404);
  assert.equal((res.body as { code?: number }).code, 40404);
});

test("project-evaluations.controller: confirm AI assessment draft maps non-harness draft to 409", async () => {
  const handler = createConfirmAiAssessmentDraftHandler({
    async confirmAiAssessmentDraftForUser(_user, _assessmentRecordId, _input, _repo) {
      throw new Error("not_ai_harness_draft");
    },
  });

  const res = createMockRes();
  await handler(createMockReq({ token: getActiveUserToken(), params: { assessmentId: "formal-assessment" } }), res as unknown as Response, noopNext);

  assert.equal(res.statusCode, 409);
  assert.equal((res.body as { code?: number }).code, 40902);
});

test("project-evaluations.controller: confirm AI assessment draft maps inaccessible harness run to 404", async () => {
  const handler = createConfirmAiAssessmentDraftHandler({
    async confirmAiAssessmentDraftForUser(_user, _assessmentRecordId, _input, _repo) {
      throw new Error("harness_run_not_found");
    },
  });

  const res = createMockRes();
  await handler(createMockReq({ token: getActiveUserToken(), params: { assessmentId: "broken-harness-run" } }), res as unknown as Response, noopNext);

  assert.equal(res.statusCode, 404);
  assert.equal((res.body as { code?: number }).code, 40404);
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
    bootstrapAiProviders();
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
    _resetAiBootstrapForTest();
  }
});

test("ai.usecase: homeWorkbenchChat injects role context and persists messages into an AI session", async () => {
  await withFileSnapshotRestoreAsync(aiSessionsStorePath(), async () => {
    const req = createMockReq({
      token: getNonAdminUserToken(),
      body: {
        messages: [{ role: "user", content: "请帮我解析客户需求材料" }],
        workflowKey: "parse_requirement_file",
      },
    });
    const res = createMockRes();
    const originalFetch = (globalThis as { fetch?: unknown }).fetch;
    const originalApiKey = config.kimi.apiKey;
    let capturedBody: { messages?: Array<{ role: string; content: string }> } = {};
    try {
      config.kimi.apiKey = "unit-test-key";
      bootstrapAiProviders();
      (globalThis as { fetch?: unknown }).fetch = async (_url: unknown, init?: { body?: string }) => {
        capturedBody = JSON.parse(String(init?.body || "{}")) as { messages?: Array<{ role: string; content: string }> };
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "已识别为售前需求解析任务。" } }],
          }),
        } as unknown;
      };

      await homeWorkbenchChat(req, res as unknown as Response);

      assert.equal(res.statusCode, 200);
      const body = res.body as {
        code: number;
        data: {
          answer: string;
          businessRole: string;
          model: string;
          session: { sessionId: string; workflowKey: string; status: string; messages: Array<{ role: string; content: string }> };
        };
      };
      assert.equal(body.code, 0);
      assert.equal(body.data.businessRole, "pre_sales");
      assert.equal(body.data.answer, "已识别为售前需求解析任务。");
      assert.equal(body.data.session.workflowKey, "parse_requirement_file");
      assert.equal(body.data.session.status, "rough_estimate");
      assert.equal(body.data.session.messages.length, 2);
      assert.deepEqual(body.data.session.messages.map((message) => message.role), ["user", "assistant"]);
      assert.equal(body.data.session.messages[0].content, "请帮我解析客户需求材料");
      assert.equal(body.data.session.messages[1].content, "已识别为售前需求解析任务。");
      const systemPrompt = capturedBody.messages?.find((item) => item.role === "system")?.content || "";
      assert.match(systemPrompt, /售前顾问/);
      assert.match(systemPrompt, /parse_requirement_file/);
      assert.doesNotMatch(systemPrompt, /当前阶段仅支持文本对话/);

      const followUpReq = createMockReq({
        token: getNonAdminUserToken(),
        body: {
          sessionId: body.data.session.sessionId,
          messages: [
            { role: "user", content: "请帮我解析客户需求材料" },
            { role: "assistant", content: "已识别为售前需求解析任务。" },
            { role: "user", content: "继续补充风险" },
          ],
          workflowKey: "parse_requirement_file",
        },
      });
      const followUpRes = createMockRes();
      await homeWorkbenchChat(followUpReq, followUpRes as unknown as Response);
      const followUpBody = followUpRes.body as { data: { session: { sessionId: string; messages: Array<{ role: string; content: string }> } } };
      assert.equal(followUpBody.data.session.sessionId, body.data.session.sessionId);
      assert.equal(followUpBody.data.session.messages.length, 4);
      assert.equal(followUpBody.data.session.messages[2].content, "继续补充风险");

      const invalidSessionReq = createMockReq({
        token: getNonAdminUserToken(),
        body: {
          sessionId: "missing-session",
          messages: [{ role: "user", content: "新会话粗评" }],
          workflowKey: "parse_requirement_file",
        },
      });
      const invalidSessionRes = createMockRes();
      await homeWorkbenchChat(invalidSessionReq, invalidSessionRes as unknown as Response);
      const invalidSessionBody = invalidSessionRes.body as { data: { session: { sessionId: string; domain: string; messages: unknown[] } } };
      assert.notEqual(invalidSessionBody.data.session.sessionId, "missing-session");
      assert.equal(invalidSessionBody.data.session.domain, "business_evaluation");
      assert.equal(invalidSessionBody.data.session.messages.length, 2);
    } finally {
      (globalThis as { fetch?: unknown }).fetch = originalFetch;
      config.kimi.apiKey = originalApiKey;
      _resetAiBootstrapForTest();
    }
  });
});

test("ai.usecase: homeWorkbenchChat returns formBlock and persists it in assistant message metadata", async () => {
  await withFileSnapshotRestoreAsync(aiSessionsStorePath(), async () => {
    const req = createMockReq({
      token: getNonAdminUserToken(),
      body: {
        messages: [{ role: "user", content: "请帮我补齐项目信息" }],
        workflowKey: "parse_requirement_file",
      },
    });
    const res = createMockRes();
    const originalFetch = (globalThis as { fetch?: unknown }).fetch;
    const originalApiKey = config.kimi.apiKey;
    try {
      config.kimi.apiKey = "unit-test-key";
      bootstrapAiProviders();
      (globalThis as { fetch?: unknown }).fetch = async () => ({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: [
                "还需要补充金额和周期。",
                "",
                "```json",
                JSON.stringify({
                  formBlock: {
                    blockId: "clarify-project",
                    title: "补充项目关键字段",
                    submitLabel: "提交补充",
                    fields: [
                      { id: "amountRange", label: "预计金额范围", type: "single_select", required: true, options: [{ label: "50万以下", value: "under_500k" }] },
                      { id: "deliveryMonths", label: "目标交付周期（月）", type: "number" },
                    ],
                  },
                }),
                "```",
              ].join("\n"),
            },
          }],
        }),
      }) as unknown;

      await homeWorkbenchChat(req, res as unknown as Response);

      assert.equal(res.statusCode, 200);
      const body = res.body as {
        code: number;
        data: {
          answer: string;
          formBlock?: { blockId: string; fields: Array<{ id: string; type: string }> };
          session: { messages: Array<{ role: string; content: string; metadata?: { formBlock?: { blockId: string } } }> };
        };
      };
      assert.equal(body.code, 0);
      assert.equal(body.data.answer.trim(), "还需要补充金额和周期。");
      assert.equal(body.data.formBlock?.blockId, "clarify-project");
      assert.equal(body.data.formBlock?.fields[0]?.type, "single_select");
      assert.equal(body.data.session.messages[1]?.metadata?.formBlock?.blockId, "clarify-project");
    } finally {
      (globalThis as { fetch?: unknown }).fetch = originalFetch;
      config.kimi.apiKey = originalApiKey;
      _resetAiBootstrapForTest();
    }
  });
});

test("ai.usecase: homeWorkbenchChat persists knowledge tool trace in assistant message metadata", async () => {
  await withFileSnapshotRestoreAsync(aiSessionsStorePath(), async () => {
    await withFileSnapshotRestoreAsync(knowledgeBaseConfigStorePath(), async () => {
      const req = createMockReq({
        token: getNonAdminUserToken(),
        body: {
          messages: [{ role: "user", content: "购买存货核算模块必须购买哪些相关模块？" }],
          workflowKey: "free_chat",
        },
      });
      const res = createMockRes();
      const originalFetch = (globalThis as { fetch?: unknown }).fetch;
      const originalZhipu = { ...(config as any).zhipu };
      try {
        (config as any).zhipu = {
          apiKey: "zhipu-unit-test-key",
          model: "glm-4.6",
          knowledgeId: "kb-sales",
          apiBaseUrl: "https://example.test/api/paas/v4",
        };
        fs.writeFileSync(knowledgeBaseConfigStorePath(), JSON.stringify({
          version: 1,
          draft: {
            model: "glm-4.6",
            apiBaseUrl: "https://example.test/api/paas/v4",
            credentials: { apiKey: "zhipu-unit-test-key", knowledgeId: "kb-sales" },
          },
          active: {
            model: "glm-4.6",
            apiBaseUrl: "https://example.test/api/paas/v4",
            credentials: { apiKey: "zhipu-unit-test-key", knowledgeId: "kb-sales" },
          },
          updatedAt: "2026-06-28T00:00:00.000Z",
          effectiveAt: "2026-06-28T00:00:00.000Z",
        }, null, 2), "utf-8");
        const zhipuCalls: Array<{ url: string; payload: Record<string, unknown> }> = [];
        (globalThis as { fetch?: unknown }).fetch = async (url: unknown, init?: { body?: string }) => {
          const urlText = String(url);
          const payload = JSON.parse(String(init?.body || "{}")) as { tools?: unknown };
          zhipuCalls.push({ url: urlText, payload: payload as Record<string, unknown> });
          if (urlText.includes("/knowledge/retrieve")) {
            assert.deepEqual((payload as Record<string, unknown>).knowledge_ids, ["kb-sales"]);
            return {
              ok: true,
              status: 200,
              json: async () => ({
                code: 200,
                data: [
                  {
                    text: "存货核算通常需要结合库存管理、采购管理、应付和总账等模块确认边界。",
                    score: 0.92,
                    metadata: { doc_name: "产品知识文档", doc_id: "doc-1", knowledge_id: "kb-sales" },
                  },
                ],
              }),
            } as unknown;
          }
          assert.ok(urlText.includes("/chat/completions"));
          assert.equal((payload as Record<string, unknown>).model, "glm-4.6");
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [{ message: { content: "存货核算通常需要结合库存管理、采购管理、应付和总账等模块确认边界。" } }],
              usage: { prompt_tokens: 1420, completion_tokens: 48, total_tokens: 1468 },
            }),
          } as unknown;
        };

        await homeWorkbenchChat(req, res as unknown as Response);

        assert.equal(res.statusCode, 200);
        const body = res.body as {
          code: number;
          data: {
            intent: string;
            answer: string;
            trace: { knowledgeTool?: { toolId: string; retrievalTriggered: boolean; confidence: string; contextRef: string } };
            session: { messages: Array<{ role: string; content: string; metadata?: { knowledgeTool?: { toolId: string; contextRef: string } } }> };
          };
        };
        assert.equal(body.code, 0);
        assert.equal(body.data.intent, "knowledge_query");
        assert.match(body.data.answer, /知识库参考/);
        assert.equal(body.data.trace.knowledgeTool?.toolId, "knowledge_base.query_product_knowledge");
        assert.equal(body.data.trace.knowledgeTool?.retrievalTriggered, true);
        assert.equal(body.data.trace.knowledgeTool?.confidence, "high");
        assert.equal(body.data.session.messages.length, 2);
        assert.equal(body.data.session.messages[1]?.metadata?.knowledgeTool?.toolId, "knowledge_base.query_product_knowledge");
        assert.equal(body.data.session.messages[1]?.metadata?.knowledgeTool?.contextRef, body.data.trace.knowledgeTool?.contextRef);
        assert.equal(zhipuCalls.length, 2);
        assert.ok(zhipuCalls[0]?.url.includes("/knowledge/retrieve"));
        assert.ok(zhipuCalls[1]?.url.includes("/chat/completions"));
      } finally {
        (globalThis as { fetch?: unknown }).fetch = originalFetch;
        (config as any).zhipu = originalZhipu;
      }
    });
  });
});

test("ai.usecase: homeWorkbenchChat persists lightweight model run trace for attachment qa", async () => {
  await withFileSnapshotRestoreAsync(aiSessionsStorePath(), async () => {
    const req = createMockReq({
      token: getNonAdminUserToken(),
      body: {
        messages: [{
          role: "user",
          content: "这个附件里有哪些实施风险？",
          attachments: [{
            name: "蓝海需求.xlsx",
            size: 2048,
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            parsedSummary: "项目：蓝海 WMS\n客户：蓝海制造\n业务需求：多组织库存协同\n风险：交付周期紧",
          }],
        }],
        workflowKey: "parse_requirement_file",
      },
    });
    const res = createMockRes();
    const originalFetch = (globalThis as { fetch?: unknown }).fetch;
    const originalApiKey = config.kimi.apiKey;
    try {
      config.kimi.apiKey = "unit-test-key";
      bootstrapAiProviders();
      (globalThis as { fetch?: unknown }).fetch = async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "主要风险是多组织库存协同边界和交付周期。" }, finish_reason: "stop" }],
        }),
      }) as unknown;

      await homeWorkbenchChat(req, res as unknown as Response);

      assert.equal(res.statusCode, 200);
      const body = res.body as {
        code: number;
        data: {
          intent: string;
          trace: {
            modelRun?: {
              runKind: string;
              provider: string;
              model: string;
              contextRefs: string[];
              rawContentLength: number;
            };
          };
          session: {
            messages: Array<{
              role: string;
              content: string;
              metadata?: {
                modelRun?: {
                  runKind: string;
                  contextRefs: string[];
                };
              };
            }>;
          };
        };
      };
      assert.equal(body.code, 0);
      assert.equal(body.data.intent, "attachment_qa");
      assert.equal(body.data.trace.modelRun?.runKind, "attachment_qa");
      assert.equal(body.data.trace.modelRun?.provider, "kimi");
      assert.match(body.data.trace.modelRun?.model || "", /kimi/);
      assert.ok(body.data.trace.modelRun?.rawContentLength);
      assert.ok(body.data.trace.modelRun?.contextRefs.includes("attachment:蓝海需求.xlsx"));
      assert.equal(body.data.session.messages[1]?.metadata?.modelRun?.runKind, "attachment_qa");
      assert.ok(body.data.session.messages[1]?.metadata?.modelRun?.contextRefs.includes("attachment:蓝海需求.xlsx"));
    } finally {
      (globalThis as { fetch?: unknown }).fetch = originalFetch;
      config.kimi.apiKey = originalApiKey;
      _resetAiBootstrapForTest();
    }
  });
});

test("ai.usecase: homeWorkbenchChat keeps user turn in session when model fails", async () => {
  await withFileSnapshotRestoreAsync(aiSessionsStorePath(), async () => {
    const originalFetch = (globalThis as { fetch?: unknown }).fetch;
    const originalApiKey = config.kimi.apiKey;
    try {
      config.kimi.apiKey = "unit-test-key";
      bootstrapAiProviders();
      (globalThis as { fetch?: unknown }).fetch = async () => {
        throw new Error("model timeout");
      };

      const req = createMockReq({
        token: getNonAdminUserToken(),
        body: {
          messages: [{ role: "user", content: "模型失败也要保留这句话" }],
          workflowKey: "parse_requirement_file",
        },
      });
      const res = createMockRes();
      await homeWorkbenchChat(req, res as unknown as Response);

      assert.equal(res.statusCode, 400);
      const store = JSON.parse(fs.readFileSync(aiSessionsStorePath(), "utf-8")) as {
        sessions: Array<{ workflowKey: string; messages: Array<{ role: string; content: string }> }>;
      };
      const session = store.sessions.find((item) => item.workflowKey === "parse_requirement_file");
      assert.ok(session);
      assert.deepEqual(session.messages.map((message) => message.content), ["模型失败也要保留这句话"]);
    } finally {
      (globalThis as { fetch?: unknown }).fetch = originalFetch;
      config.kimi.apiKey = originalApiKey;
      _resetAiBootstrapForTest();
    }
  });
});

test("ai.usecase: homeWorkbenchChat asks the model to analyze parsed attachments into a report artifact", async () => {
  await withFileSnapshotRestoreAsync(aiSessionsStorePath(), async () => {
    const req = createMockReq({
      token: getNonAdminUserToken(),
      body: {
        messages: [{
          role: "user",
          content: "请解析这个文件并生成需求解析报告",
          attachments: [{
            name: "实施工作量评估申请240616-V1.0.xlsx",
            size: 58000,
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            parsedSummary: [
              "AI 已完成文件解析摘要：",
              "文件：实施工作量评估申请240616-V1.0.xlsx",
              "项目：哈希温控项目评估",
              "客户：哈希温控",
              "行业：制造业",
              "业务需求：",
              "1. 智能核算：凭证处理 + 自动生成凭证",
              "2. 报表体系：法定报表 + 自定义报表",
            ].join("\n"),
          }],
        }],
        workflowKey: "parse_requirement_file",
      },
    });
    const res = createMockRes();
    const originalFetch = (globalThis as { fetch?: unknown }).fetch;
    const originalApiKey = config.kimi.apiKey;
    let capturedBody: { messages?: Array<{ role: string; content: string }> } = {};
    try {
      config.kimi.apiKey = "unit-test-key";
      bootstrapAiProviders();
      (globalThis as { fetch?: unknown }).fetch = async (_url: unknown, init?: { body?: string }) => {
        capturedBody = JSON.parse(String(init?.body || "{}")) as { messages?: Array<{ role: string; content: string }> };
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  answer: "已完成 AI 深度需求分析，并生成《需求解析报告 v1》。",
                  projectName: "哈希温控项目评估",
                  customerName: "哈希温控",
                  industry: "制造业",
                  productLines: ["金蝶云星空"],
                  sourceSheets: ["1.项目概况", "3.业务需求及问题一览表"],
                  needs: ["智能核算：凭证处理 + 自动生成凭证", "报表体系：法定报表 + 自定义报表"],
                  modules: ["财务云 / 总账", "财务云 / 报表"],
                  missingItems: ["自定义报表数量", "自动凭证规则复杂度"],
                  risks: ["自定义报表范围可能扩大", "凭证规则依赖前端业务数据质量"],
                  nextActions: ["补充项目信息", "生成待确认问题", "进入正式评估"],
                }),
              },
            }],
          }),
        } as unknown;
      };

      await homeWorkbenchChat(req, res as unknown as Response);

      assert.equal(res.statusCode, 200);
      const body = res.body as {
        code: number;
        data: {
          answer: string;
          session: {
            artifacts: Array<{ type: string; title: string; content: { sourceFile?: string; summary?: string; needs?: string[]; modules?: string[]; missingItems?: string[] } }>;
            messages: Array<{ role: string; content: string; artifactIds?: string[] }>;
            pendingActions: Array<{ actionType: string; title: string }>;
          };
        };
      };
      assert.equal(body.code, 0);
      const systemPrompt = capturedBody.messages?.find((item) => item.role === "system")?.content || "";
      const userPrompt = capturedBody.messages?.find((item) => item.role === "user")?.content || "";
      assert.match(systemPrompt, /完整业务理解/);
      assert.match(systemPrompt, /只输出 JSON/);
      assert.match(userPrompt, /实施工作量评估申请240616-V1.0.xlsx/);
      assert.match(userPrompt, /智能核算/);
      assert.match(body.data.answer, /AI 深度需求分析/);
      assert.equal(body.data.session.artifacts.length, 1);
      assert.equal(body.data.session.artifacts[0].type, "requirement_analysis_report");
      assert.equal(body.data.session.artifacts[0].title, "需求解析报告 v1");
      assert.equal(body.data.session.artifacts[0].content.sourceFile, "实施工作量评估申请240616-V1.0.xlsx");
      assert.match(body.data.session.artifacts[0].content.summary || "", /哈希温控/);
      assert.deepEqual(body.data.session.artifacts[0].content.needs, [
        "智能核算：凭证处理 + 自动生成凭证",
        "报表体系：法定报表 + 自定义报表",
      ]);
      assert.deepEqual(body.data.session.artifacts[0].content.modules, ["财务云 / 总账", "财务云 / 报表"]);
      assert.equal(body.data.session.pendingActions[0].actionType, "supplement_requirement_report");
      assert.equal(body.data.session.messages[1].role, "assistant");
      assert.equal(body.data.session.messages[1].artifactIds?.length, 1);
    } finally {
      (globalThis as { fetch?: unknown }).fetch = originalFetch;
      config.kimi.apiKey = originalApiKey;
      _resetAiBootstrapForTest();
    }
  });
});

test("ai.usecase: parseBasicInfo fails instead of returning rule fallback when model parsing fails", async () => {
  const req = createMockReq({
    token: getActiveUserToken(),
    file: {
      buffer: createMinimalRequirementWorkbookBuffer(),
      originalname: "ut-requirement.xlsx",
    },
  });
  const res = createMockRes();
  const originalFetch = (globalThis as { fetch?: unknown }).fetch;
  const originalApiKey = config.kimi.apiKey;
  try {
    config.kimi.apiKey = "unit-test-key";
    bootstrapAiProviders();
    (globalThis as { fetch?: unknown }).fetch = async () => {
      throw new Error("parse timeout");
    };
    await parseBasicInfo(req, res as unknown as Response);
    assert.equal(res.statusCode, 400);
    const body = res.body as {
      code: number;
      details?: Array<{ field: string; reason: string }>;
    };
    assert.equal(body.code, 40001);
    assert.equal(body.details?.[0]?.field, "model");
    assert.match(body.details?.[0]?.reason || "", /parse timeout|timeout|kimi_request_timeout/i);
  } finally {
    (globalThis as { fetch?: unknown }).fetch = originalFetch;
    config.kimi.apiKey = originalApiKey;
    _resetAiBootstrapForTest();
  }
});

test("ai.usecase: parseBasicInfo can return local workbook fallback when explicitly allowed", async () => {
  const req = createMockReq({
    token: getActiveUserToken(),
    body: { allowLocalFallback: "true" },
    file: {
      buffer: createMinimalRequirementWorkbookBuffer(),
      originalname: "ut-requirement.xlsx",
    },
  });
  const res = createMockRes();
  const originalFetch = (globalThis as { fetch?: unknown }).fetch;
  const originalApiKey = config.kimi.apiKey;
  try {
    config.kimi.apiKey = "unit-test-key";
    bootstrapAiProviders();
    (globalThis as { fetch?: unknown }).fetch = async () => {
      throw new Error("parse timeout");
    };
    await parseBasicInfo(req, res as unknown as Response);
    assert.equal(res.statusCode, 200);
    const body = res.body as {
      code: number;
      data: {
        basicInfo: { projectName?: string; customerName?: string };
        requirementImportData: { businessNeedRows?: Array<{ category?: string; businessNeed?: string }> };
        mode?: string;
        fallbackReason?: string;
      };
    };
    assert.equal(body.code, 0);
    assert.equal(body.data.mode, "local_fallback");
    assert.match(body.data.fallbackReason || "", /parse timeout|timeout|kimi_request_timeout/i);
    assert.equal(body.data.basicInfo.projectName, "UT 模型解析项目");
    assert.equal(body.data.basicInfo.customerName, "UT 客户");
    assert.equal(body.data.requirementImportData.businessNeedRows?.[0]?.category, "采购");
    assert.match(body.data.requirementImportData.businessNeedRows?.[0]?.businessNeed || "", /采购订单/);
  } finally {
    (globalThis as { fetch?: unknown }).fetch = originalFetch;
    config.kimi.apiKey = originalApiKey;
    _resetAiBootstrapForTest();
  }
});

test("ai.usecase: kimiAssessmentPreview fails instead of returning rule fallback on model timeout", async () => {
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
    bootstrapAiProviders();
    (globalThis as { fetch?: unknown }).fetch = async () => {
      throw new Error("timeout");
    };
    await kimiAssessmentPreview(req, res as unknown as Response);
    assert.equal(res.statusCode, 400);
    const body = res.body as {
      code: number;
      details?: Array<{ field: string; reason: string }>;
    };
    assert.equal(body.code, 40001);
    assert.equal(body.details?.[0]?.field, "model");
    assert.match(body.details?.[0]?.reason || "", /超时|kimi_request_timeout|timeout/i);
  } finally {
    (globalThis as { fetch?: unknown }).fetch = originalFetch;
    config.kimi.apiKey = originalApiKey;
    _resetAiBootstrapForTest();
  }
});

test("ai.usecase: kimiAssessmentPreview fails instead of returning rule fallback on invalid model json", async () => {
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
    bootstrapAiProviders();
    (globalThis as { fetch?: unknown }).fetch = async () =>
      ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "{}" } }],
        }),
      }) as unknown;
    await kimiAssessmentPreview(req, res as unknown as Response);
    assert.equal(res.statusCode, 400);
    const body = res.body as {
      code: number;
      details?: Array<{ field: string; reason: string }>;
    };
    assert.equal(body.code, 40001);
    assert.equal(body.details?.[0]?.field, "model");
    assert.match(body.details?.[0]?.reason || "", /model_invalid_assessment_json/i);
  } finally {
    (globalThis as { fetch?: unknown }).fetch = originalFetch;
    config.kimi.apiKey = originalApiKey;
    _resetAiBootstrapForTest();
  }
});
