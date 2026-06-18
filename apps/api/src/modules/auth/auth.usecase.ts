import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { AuthUser, InviteCodeRecord, PasswordResetTokenRecord } from "../../types";
import { config } from "../../config/env";
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
  isBusinessRole,
  defaultBusinessRoleForSystemRole,
} from "../../middleware/auth";
import {
  loadInviteCodesStore,
  loadPasswordResetTokensStore,
  saveInviteCodesStore,
  savePasswordResetTokensStore,
} from "./auth.repository";

const REMEMBER_ME_EXPIRES_IN = "7d";
const PASSWORD_RESET_EXPIRES_MINUTES = 30;

function asBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createResetToken(): string {
  return randomBytes(32).toString("base64url");
}

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
    businessRole: defaultBusinessRoleForSystemRole(role),
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
  const rememberMe = asBoolean(req.body?.rememberMe);

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

  const expiresIn = rememberMe ? REMEMBER_ME_EXPIRES_IN : undefined;
  const token = signAuthToken(user, expiresIn ? { expiresIn } : {});
  res.json(ok({
    token,
    user: toPublicUser(user),
    rememberMe,
    expiresIn: expiresIn || String(config.jwt.expiresIn),
  }, requestId));
}

export async function requestPasswordReset(req: Request, res: Response) {
  const requestId = randomUUID();
  const username = asString(req.body?.username);
  if (!username) {
    return fail(res, 40001, "参数错误", [{ field: "username", reason: "required" }]);
  }

  const store = loadUsersStore();
  const user = store.users.find((x) => x.username.toLowerCase() === username.toLowerCase());
  if (!user || user.status !== "active") {
    return res.json(ok({
      accepted: true,
      expiresInMinutes: PASSWORD_RESET_EXPIRES_MINUTES,
      delivery: "admin_or_local_link",
    }, requestId));
  }

  const token = createResetToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_EXPIRES_MINUTES * 60 * 1000);
  const resetStore = loadPasswordResetTokensStore();
  for (const item of resetStore.tokens) {
    if (item.userId === user.id && item.status === "active") {
      item.status = "used";
      item.usedAt = now.toISOString();
    }
  }
  const record: PasswordResetTokenRecord = {
    id: randomUUID(),
    userId: user.id,
    username: user.username,
    tokenHash: hashResetToken(token),
    status: "active",
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  resetStore.tokens.push(record);
  savePasswordResetTokensStore(resetStore);

  res.json(ok({
    accepted: true,
    resetToken: token,
    resetUrl: `/reset-password?token=${encodeURIComponent(token)}`,
    expiresInMinutes: PASSWORD_RESET_EXPIRES_MINUTES,
    delivery: "admin_or_local_link",
  }, requestId));
}

export async function confirmPasswordReset(req: Request, res: Response) {
  const requestId = randomUUID();
  const token = asString(req.body?.token);
  const password = asString(req.body?.password);
  if (!token) {
    return fail(res, 40001, "参数错误", [{ field: "token", reason: "required" }]);
  }
  if (!password || password.length < 8) {
    return fail(res, 40001, "参数错误", [{ field: "password", reason: "min_length_8" }]);
  }

  const resetStore = loadPasswordResetTokensStore();
  const tokenHash = hashResetToken(token);
  const record = resetStore.tokens.find((item) => item.tokenHash === tokenHash);
  if (!record || record.status !== "active" || Number(new Date(record.expiresAt)) <= Date.now()) {
    return fail(res, 40001, "参数错误", [{ field: "token", reason: "invalid_or_expired" }]);
  }

  const store = loadUsersStore();
  const user = store.users.find((item) => item.id === record.userId && item.status === "active");
  if (!user) {
    record.status = "used";
    record.usedAt = new Date().toISOString();
    savePasswordResetTokensStore(resetStore);
    return fail(res, 40001, "参数错误", [{ field: "token", reason: "invalid_or_expired" }]);
  }

  user.passwordHash = await bcrypt.hash(password, 10);
  saveUsersStore(store);

  record.status = "used";
  record.usedAt = new Date().toISOString();
  savePasswordResetTokensStore(resetStore);

  res.json(ok({ success: true }, requestId));
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

export function updateUserBusinessRole(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!canManageUsers(auth.user)) {
    return fail(res, 40301, "权限不足", [{ field: "role", reason: "user_mgmt_required" }]);
  }

  const userId = asString(req.params.userId);
  const rawBusinessRole = asString(req.body?.businessRole);
  if (!userId) {
    return fail(res, 40001, "参数错误", [{ field: "userId", reason: "required" }]);
  }
  if (!isBusinessRole(rawBusinessRole)) {
    return fail(res, 40001, "参数错误", [{ field: "businessRole", reason: "invalid" }]);
  }

  const store = loadUsersStore();
  const target = store.users.find((u) => u.id === userId);
  if (!target) {
    return fail(res, 40401, "资源不存在", [{ field: "userId", reason: "not_found" }]);
  }

  if (auth.user.role === "sub_admin" && target.role === "admin") {
    return fail(res, 40301, "权限不足", [{ field: "role", reason: "cannot_modify_super_admin" }]);
  }

  target.businessRole = rawBusinessRole;
  saveUsersStore(store);
  res.json(ok({ user: toPublicUser(target) }, randomUUID()));
}

export async function updateUserPassword(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!canManageUsers(auth.user)) {
    return fail(res, 40301, "权限不足", [{ field: "role", reason: "user_mgmt_required" }]);
  }

  const userId = asString(req.params.userId);
  const password = asString(req.body?.password);
  if (!userId) {
    return fail(res, 40001, "参数错误", [{ field: "userId", reason: "required" }]);
  }
  if (!password || password.length < 8) {
    return fail(res, 40001, "参数错误", [{ field: "password", reason: "min_length_8" }]);
  }

  const store = loadUsersStore();
  const target = store.users.find((u) => u.id === userId);
  if (!target) {
    return fail(res, 40401, "资源不存在", [{ field: "userId", reason: "not_found" }]);
  }

  if (auth.user.role === "sub_admin" && target.role === "admin") {
    return fail(res, 40301, "权限不足", [{ field: "role", reason: "cannot_modify_super_admin" }]);
  }

  target.passwordHash = await bcrypt.hash(password, 10);
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
