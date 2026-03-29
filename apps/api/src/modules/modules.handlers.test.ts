import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { Request, Response } from "express";

import { AuthUser } from "../types";
import { loadUsersStore, signAuthToken } from "../middleware/auth";
import { versionsStorePath } from "../utils";
import { listUsers, login, me } from "./auth/auth.usecase";
import { getRuleSetMeta } from "./rules/rules.usecase";
import { getTemplate } from "./templates/templates.usecase";
import { createVersion, deleteVersion, listVersions, updateVersionStatus } from "./versions/versions.usecase";

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

  if (getActiveUserRole() === "admin") {
    assert.equal(res.statusCode, 200);
    const body = res.body as { code: number; data: { users: unknown[] } };
    assert.equal(body.code, 0);
    assert.ok(Array.isArray(body.data.users));
  } else {
    assert.equal(res.statusCode, 400);
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
  assert.equal(res.statusCode, 400);
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

test("versions.usecase: create -> update -> delete lifecycle works", () => {
  const versionsPath = versionsStorePath();
  withFileSnapshotRestore(versionsPath, () => {
    const versionCode = `UT-LC-${Date.now()}`;

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
