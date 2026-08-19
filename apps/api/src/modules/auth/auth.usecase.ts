import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { AuthUser } from "../../types";
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
import { getAuthRepository } from "./auth.repository";

const REMEMBER_ME_EXPIRES_IN = "7d";
const PASSWORD_RESET_EXPIRES_MINUTES = 30;
const PASSWORD_RESET_TTL_MS = PASSWORD_RESET_EXPIRES_MINUTES * 60 * 1000;

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

  const repo = getAuthRepository();
  const inviteRecord = await repo.findInviteCode(inviteCode);
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
  const store = await loadUsersStore();
  const exists = store.users.some((user) => user.username.toLowerCase() === normalizedUsername);
  if (exists) {
    return fail(res, 40001, "参数错误", [{ field: "username", reason: "already_exists" }]);
  }

  // 阶段 2 批 1：CAS 先消费邀请码再落用户（PG 侧条件 UPDATE 保证并发注册
  // 恰好一个赢家；旧 JSON 流程为「先落用户后标码」，并发下会双重消费）。
  const userId = randomUUID();
  const usedInvite = await repo.markInviteCodeUsed({
    code: inviteRecord.code,
    usedByUserId: userId,
    usedByUsername: username,
  });
  if (!usedInvite) {
    return fail(res, 40001, "参数错误", [{ field: "inviteCode", reason: "invalid_invite_code" }]);
  }

  const nowIso = new Date().toISOString();
  const role: AuthUser["role"] = store.users.length === 0 ? "admin" : "user";
  const user: AuthUser = {
    id: userId,
    username,
    passwordHash: await bcrypt.hash(password, 10),
    role,
    businessRole: defaultBusinessRoleForSystemRole(role),
    status: "active",
    createdAt: nowIso,
    lastLoginAt: nowIso,
  };

  store.users.push(user);
  await saveUsersStore(store);

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

  const store = await loadUsersStore();
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
  await saveUsersStore(store);

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

  const store = await loadUsersStore();
  const user = store.users.find((x) => x.username.toLowerCase() === username.toLowerCase());
  if (!user || user.status !== "active") {
    return res.json(ok({
      accepted: true,
      expiresInMinutes: PASSWORD_RESET_EXPIRES_MINUTES,
      delivery: "admin_or_local_link",
    }, requestId));
  }

  const token = createResetToken();
  const repo = getAuthRepository();
  // 阶段 2 批 1：先作废存量 active 令牌，再签发新令牌（expiresAt 由仓储
  // 以 DB 时钟 + TTL 计算，禁止调用方传主机时间）。
  await repo.deactivateActiveResetTokens({ userId: user.id });
  await repo.createResetToken({
    userId: user.id,
    username: user.username,
    tokenHash: hashResetToken(token),
    ttlMs: PASSWORD_RESET_TTL_MS,
  });

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

  const repo = getAuthRepository();
  const record = await repo.findResetTokenByHash(hashResetToken(token));
  if (!record || record.status !== "active" || Number(new Date(record.expiresAt)) <= Date.now()) {
    return fail(res, 40001, "参数错误", [{ field: "token", reason: "invalid_or_expired" }]);
  }

  const store = await loadUsersStore();
  const user = store.users.find((item) => item.id === record.userId && item.status === "active");
  if (!user) {
    await repo.consumeResetToken({ tokenId: record.id });
    return fail(res, 40001, "参数错误", [{ field: "token", reason: "invalid_or_expired" }]);
  }

  user.passwordHash = await bcrypt.hash(password, 10);
  await saveUsersStore(store);

  // CAS 消费：active 且未过期（PG 侧另以 DB 时钟双重校验）；
  // 竞争失败/临界过期 → 拒绝（密码已改但令牌重复消费场景以失败告知）。
  const consumed = await repo.consumeResetToken({ tokenId: record.id });
  if (!consumed) {
    return fail(res, 40001, "参数错误", [{ field: "token", reason: "invalid_or_expired" }]);
  }

  res.json(ok({ success: true }, requestId));
}

export async function me(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  res.json(ok({ user: toPublicUser(auth.user) }, randomUUID()));
}

export async function logout(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  res.json(ok({ success: true }, randomUUID()));
}

export async function listUsers(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  if (!canManageUsers(auth.user)) {
    return fail(res, 40301, "权限不足", [{ field: "role", reason: "user_mgmt_required" }]);
  }

  const store = await loadUsersStore();
  const users = [...store.users]
    .sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt)))
    .map((user) => toPublicUser(user));
  res.json(ok({ users }, randomUUID()));
}

export async function updateUserStatus(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
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

  const store = await loadUsersStore();
  const target = store.users.find((user) => user.id === userId);
  if (!target) {
    return fail(res, 40401, "资源不存在", [{ field: "userId", reason: "not_found" }]);
  }

  if (auth.user.role === "sub_admin" && target.role === "admin" && nextStatus === "disabled") {
    return fail(res, 40301, "权限不足", [{ field: "user", reason: "sub_admin_cannot_disable_admin" }]);
  }

  target.status = nextStatus;
  await saveUsersStore(store);
  res.json(ok({ user: toPublicUser(target) }, randomUUID()));
}

export async function updateUserRole(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
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

  const store = await loadUsersStore();
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
  await saveUsersStore(store);
  res.json(ok({ user: toPublicUser(target) }, randomUUID()));
}

export async function updateUserBusinessRole(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
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

  const store = await loadUsersStore();
  const target = store.users.find((u) => u.id === userId);
  if (!target) {
    return fail(res, 40401, "资源不存在", [{ field: "userId", reason: "not_found" }]);
  }

  if (auth.user.role === "sub_admin" && target.role === "admin") {
    return fail(res, 40301, "权限不足", [{ field: "role", reason: "cannot_modify_super_admin" }]);
  }

  target.businessRole = rawBusinessRole;
  await saveUsersStore(store);
  res.json(ok({ user: toPublicUser(target) }, randomUUID()));
}

export async function updateUserPassword(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
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

  const store = await loadUsersStore();
  const target = store.users.find((u) => u.id === userId);
  if (!target) {
    return fail(res, 40401, "资源不存在", [{ field: "userId", reason: "not_found" }]);
  }

  if (auth.user.role === "sub_admin" && target.role === "admin") {
    return fail(res, 40301, "权限不足", [{ field: "role", reason: "cannot_modify_super_admin" }]);
  }

  target.passwordHash = await bcrypt.hash(password, 10);
  await saveUsersStore(store);
  res.json(ok({ user: toPublicUser(target) }, randomUUID()));
}

export async function listInviteCodes(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  if (!isAdminUser(auth.user)) {
    return fail(res, 40301, "权限不足", [{ field: "role", reason: "admin_required" }]);
  }

  const codes = await getAuthRepository().listInviteCodes();
  const sorted = [...codes].sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt)));
  res.json(ok({ codes: sorted }, randomUUID()));
}

export async function generateInviteCodeHandler(req: Request, res: Response) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  if (!isAdminUser(auth.user)) {
    return fail(res, 40301, "权限不足", [{ field: "role", reason: "admin_required" }]);
  }

  const repo = getAuthRepository();
  const codes = await repo.listInviteCodes();
  const existing = new Set(codes.map((item) => item.code.toUpperCase()));
  const code = generateInviteCode(existing);

  // 幂等插入；码空间碰撞（概率近零）时返回既有记录而非报错
  const { record } = await repo.createInviteCode({ code });
  res.json(ok({ code: record }, randomUUID()));
}
