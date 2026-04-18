import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

import { AuthUser, InviteCodeRecord } from "../../types";
import { asString, generateInviteCode } from "../../utils";
import { ok, fail } from "../../utils/response";
import {
  loadUsersStore,
  saveUsersStore,
  signAuthToken,
  toPublicUser,
  isAdminUser,
  canManageUsers,
  requireAuth,
} from "../../middleware/auth";
import { loadInviteCodesStore, saveInviteCodesStore } from "./auth.repository";

export async function register(req: Request, res: Response) {
  const requestId = randomUUID();
  const username = asString(req.body?.username);
  const password = asString(req.body?.password);
  const inviteCode = asString(req.body?.inviteCode).toUpperCase();

  if (!inviteCode) {
    return fail(res, 40001, "参数错误", [{ field: "inviteCode", reason: "required" }]);
  }

  const inviteStore = loadInviteCodesStore();
  const inviteRecord = inviteStore.codes.find((item) => item.code.toUpperCase() === inviteCode);
  if (!inviteRecord || inviteRecord.status !== "active") {
    return fail(res, 40001, "参数错误", [{ field: "inviteCode", reason: "invalid_invite_code" }]);
  }

  if (!username || username.length < 3) {
    return fail(res, 40001, "参数错误", [{ field: "username", reason: "min_length_3" }]);
  }
  if (!password || password.length < 8) {
    return fail(res, 40001, "参数错误", [{ field: "password", reason: "min_length_8" }]);
  }

  const normalizedUsername = username.toLowerCase();
  const store = loadUsersStore();
  const exists = store.users.some((user) => user.username.toLowerCase() === normalizedUsername);
  if (exists) {
    return fail(res, 40001, "参数错误", [{ field: "username", reason: "already_exists" }]);
  }

  const nowIso = new Date().toISOString();
  const role: AuthUser["role"] = store.users.length === 0 ? "admin" : "user";
  const user: AuthUser = {
    id: randomUUID(),
    username,
    passwordHash: await bcrypt.hash(password, 10),
    role,
    status: "active",
    createdAt: nowIso,
    lastLoginAt: nowIso,
  };

  store.users.push(user);
  saveUsersStore(store);

  inviteRecord.status = "used";
  inviteRecord.usedAt = nowIso;
  inviteRecord.usedByUserId = user.id;
  inviteRecord.usedByUsername = user.username;
  saveInviteCodesStore(inviteStore);

  const token = signAuthToken(user);
  res.json(ok({ token, user: toPublicUser(user) }, requestId));
}

export async function login(req: Request, res: Response) {
  const requestId = randomUUID();
  const username = asString(req.body?.username);
  const password = asString(req.body?.password);

  if (!username || !password) {
    return fail(res, 40001, "参数错误", [{ field: "username/password", reason: "required" }]);
  }

  const store = loadUsersStore();
  const user = store.users.find((x) => x.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    return fail(res, 40001, "参数错误", [{ field: "username/password", reason: "invalid_credentials" }]);
  }
  if (user.status !== "active") {
    return fail(res, 40001, "参数错误", [{ field: "user", reason: "disabled" }]);
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return fail(res, 40001, "参数错误", [{ field: "username/password", reason: "invalid_credentials" }]);
  }

  user.lastLoginAt = new Date().toISOString();
  saveUsersStore(store);

  const token = signAuthToken(user);
  res.json(ok({ token, user: toPublicUser(user) }, requestId));
}

export function me(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  res.json(ok({ user: toPublicUser(auth.user) }, randomUUID()));
}

export function logout(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  res.json(ok({ success: true }, randomUUID()));
}

export function listUsers(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!canManageUsers(auth.user)) {
    return fail(res, 40301, "权限不足", [{ field: "role", reason: "user_mgmt_required" }]);
  }

  const store = loadUsersStore();
  const users = [...store.users]
    .sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt)))
    .map((user) => toPublicUser(user));
  res.json(ok({ users }, randomUUID()));
}

export function updateUserStatus(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!canManageUsers(auth.user)) {
    return fail(res, 40301, "权限不足", [{ field: "role", reason: "user_mgmt_required" }]);
  }

  const userId = asString(req.params.userId);
  const nextStatus = asString(req.body?.status) === "disabled" ? "disabled" : "active";

  if (!userId) {
    return fail(res, 40001, "参数错误", [{ field: "userId", reason: "required" }]);
  }
  if (auth.user.id === userId && nextStatus === "disabled") {
    return fail(res, 40001, "参数错误", [{ field: "status", reason: "cannot_disable_self" }]);
  }

  const store = loadUsersStore();
  const target = store.users.find((user) => user.id === userId);
  if (!target) {
    return fail(res, 40401, "资源不存在", [{ field: "userId", reason: "not_found" }]);
  }

  if (auth.user.role === "sub_admin" && target.role === "admin" && nextStatus === "disabled") {
    return fail(res, 40301, "权限不足", [{ field: "user", reason: "sub_admin_cannot_disable_admin" }]);
  }

  target.status = nextStatus;
  saveUsersStore(store);
  res.json(ok({ user: toPublicUser(target) }, randomUUID()));
}

export function updateUserRole(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!canManageUsers(auth.user)) {
    return fail(res, 40301, "权限不足", [{ field: "role", reason: "user_mgmt_required" }]);
  }

  const userId = asString(req.params.userId);
  const rawRole = asString(req.body?.role);
  if (!userId) {
    return fail(res, 40001, "参数错误", [{ field: "userId", reason: "required" }]);
  }

  const nextRole = rawRole as AuthUser["role"];
  if (nextRole !== "admin" && nextRole !== "sub_admin" && nextRole !== "user") {
    return fail(res, 40001, "参数错误", [{ field: "role", reason: "invalid" }]);
  }

  const store = loadUsersStore();
  const target = store.users.find((u) => u.id === userId);
  if (!target) {
    return fail(res, 40401, "资源不存在", [{ field: "userId", reason: "not_found" }]);
  }

  if (auth.user.role === "sub_admin") {
    if (target.role === "admin") {
      return fail(res, 40301, "权限不足", [{ field: "role", reason: "cannot_modify_super_admin" }]);
    }
    if (nextRole === "admin") {
      return fail(res, 40301, "权限不足", [{ field: "role", reason: "sub_admin_cannot_grant_admin" }]);
    }
  }

  if (target.role === "admin" && nextRole !== "admin") {
    const adminCount = store.users.filter((u) => u.role === "admin").length;
    if (adminCount <= 1) {
      return fail(res, 40001, "参数错误", [{ field: "role", reason: "last_admin_demote_forbidden" }]);
    }
  }

  target.role = nextRole;
  saveUsersStore(store);
  res.json(ok({ user: toPublicUser(target) }, randomUUID()));
}

export function listInviteCodes(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!isAdminUser(auth.user)) {
    return fail(res, 40301, "权限不足", [{ field: "role", reason: "admin_required" }]);
  }

  const store = loadInviteCodesStore();
  const codes = [...store.codes].sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt)));
  res.json(ok({ codes }, randomUUID()));
}

export function generateInviteCodeHandler(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!isAdminUser(auth.user)) {
    return fail(res, 40301, "权限不足", [{ field: "role", reason: "admin_required" }]);
  }

  const store = loadInviteCodesStore();
  const existing = new Set(store.codes.map((item) => item.code.toUpperCase()));
  const code = generateInviteCode(existing);

  const record: InviteCodeRecord = {
    code,
    status: "active",
    createdAt: new Date().toISOString(),
  };

  store.codes.push(record);
  saveInviteCodesStore(store);
  res.json(ok({ code: record }, randomUUID()));
}
