// ============================================================
// 认证中间件 - 从 main.ts 提取
// ============================================================

import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

import { config } from "../config/env";
import { AuthUser, AuthJwtPayload, BusinessRole, UsersStore } from "../types";
import { asString, usersStorePath } from "../utils";

// -------------------- 用户存储操作 --------------------

function normalizeAuthUserRole(user: AuthUser): AuthUser {
  const r = user.role as string;
  if (r === "admin" || r === "sub_admin" || r === "user") return user;
  return { ...user, role: "user" };
}

const BUSINESS_ROLES: BusinessRole[] = ["sales", "pre_sales", "delivery", "pm", "pmo", "dev", "admin"];

export function isBusinessRole(value: string): value is BusinessRole {
  return BUSINESS_ROLES.includes(value as BusinessRole);
}

export function defaultBusinessRoleForSystemRole(role: AuthUser["role"]): BusinessRole {
  if (role === "admin") return "admin";
  if (role === "sub_admin") return "pm";
  return "pre_sales";
}

export function resolveBusinessRole(user: Pick<AuthUser, "role" | "businessRole">): BusinessRole {
  return user.businessRole && isBusinessRole(user.businessRole)
    ? user.businessRole
    : defaultBusinessRoleForSystemRole(user.role);
}

export function loadUsersStore(): UsersStore {
  const filePath = usersStorePath();
  if (!fs.existsSync(filePath)) {
    const initStore: UsersStore = { users: [] };
    fs.mkdirSync(require("path").dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(initStore, null, 2), "utf-8");
    return initStore;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as UsersStore;
    if (!parsed || !Array.isArray(parsed.users)) {
      return { users: [] };
    }
    return { users: parsed.users.map((u) => normalizeAuthUserRole(u as AuthUser)) };
  } catch {
    return { users: [] };
  }
}

export function saveUsersStore(store: UsersStore): void {
  const filePath = usersStorePath();
  fs.mkdirSync(require("path").dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf-8");
}

// -------------------- JWT 操作 --------------------

// W5-E: 固定 HS256 算法，避免算法混淆攻击（如 alg=none / RSA→HMAC 切换）
const JWT_ALGORITHM: jwt.Algorithm = "HS256";

export function signAuthToken(user: AuthUser, options: { expiresIn?: jwt.SignOptions["expiresIn"] } = {}): string {
  const expiresIn = options.expiresIn || (config.jwt.expiresIn as jwt.SignOptions["expiresIn"]);
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      businessRole: resolveBusinessRole(user)
    } satisfies AuthJwtPayload,
    config.jwt.secret,
    { expiresIn, algorithm: JWT_ALGORITHM }
  );
}

export function verifyAuthToken(token: string): AuthJwtPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwt.secret, { algorithms: [JWT_ALGORITHM] });
    if (!decoded || typeof decoded === "string") return null;
    const payload = decoded as jwt.JwtPayload;
    const sub = asString(payload.sub);
    const username = asString(payload.username);
    const roleRaw = asString(payload.role);
    const role: AuthUser["role"] =
      roleRaw === "admin" ? "admin" : roleRaw === "sub_admin" ? "sub_admin" : "user";
    const businessRoleRaw = asString(payload.businessRole);
    const businessRole = isBusinessRole(businessRoleRaw)
      ? businessRoleRaw
      : defaultBusinessRoleForSystemRole(role);
    if (!sub || !username) return null;
    return { sub, username, role, businessRole };
  } catch {
    return null;
  }
}

export function readBearerToken(req: Request): string {
  const auth = asString(req.header("Authorization"));
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

// -------------------- 权限检查 --------------------

export function toPublicUser(user: AuthUser): Omit<AuthUser, "passwordHash"> & { businessRole: BusinessRole } {
  const { passwordHash, ...rest } = user;
  return { ...rest, businessRole: resolveBusinessRole(user) };
}

export function isAdminUser(user: AuthUser): boolean {
  return user.role === "admin";
}

/** 可进入用户管理：超级管理员 + 子管理员 */
export function canManageUsers(user: AuthUser): boolean {
  return user.role === "admin" || user.role === "sub_admin";
}

export function resolveApiRoleFromUser(user: AuthUser): "admin" | "operator" {
  return user.role === "admin" ? "admin" : "operator";
}

/**
 * 要求认证（返回用户信息或 null）
 *
 * 阶段 1 批 2：签名改 async（Promise<...|null>），函数体一字未动——
 * 内部仍同步调用 loadUsersStore（其异步化属批 3），await 同步返回值不改变行为。
 */
export async function requireAuth(
  req: Request,
  res: Response
): Promise<{ payload: AuthJwtPayload; user: AuthUser } | null> {
  const token = readBearerToken(req);
  if (!token) {
    res.status(401).json({
      code: 40101,
      message: "未登录或凭证缺失",
      details: [{ field: "Authorization", reason: "missing_bearer_token" }],
      requestId: randomUUID()
    });
    return null;
  }
  const payload = verifyAuthToken(token);
  if (!payload) {
    res.status(401).json({
      code: 40102,
      message: "登录态无效",
      details: [{ field: "Authorization", reason: "invalid_or_expired_token" }],
      requestId: randomUUID()
    });
    return null;
  }
  const store = loadUsersStore();
  const user = store.users.find((x) => x.id === payload.sub && x.username === payload.username);
  if (!user || user.status !== "active") {
    res.status(401).json({
      code: 40103,
      message: "用户不可用",
      details: [{ field: "user", reason: "not_found_or_disabled" }],
      requestId: randomUUID()
    });
    return null;
  }
  return { payload, user };
}

/**
 * 要求特定角色
 * 阶段 1 批 2：签名改 async；内部 await requireAuth。
 */
export async function requireRole(req: Request, res: Response, allowed: Array<"admin" | "operator">): Promise<boolean> {
  const auth = await requireAuth(req, res);
  if (!auth) {
    return false;
  }
  const role = resolveApiRoleFromUser(auth.user);
  if (!allowed.includes(role)) {
    res.status(403).json({
      code: 40301,
      message: "权限不足",
      details: [{ field: "role", reason: "forbidden" }],
      requestId: randomUUID()
    });
    return false;
  }
  return true;
}

/**
 * 要求特定角色并返回用户信息
 * 阶段 1 批 2：签名改 async；内部 await requireAuth。
 */
export async function requireRoleWithAuth(
  req: Request,
  res: Response,
  allowed: Array<"admin" | "operator">
): Promise<{ payload: AuthJwtPayload; user: AuthUser } | null> {
  const auth = await requireAuth(req, res);
  if (!auth) return null;
  const role = resolveApiRoleFromUser(auth.user);
  if (!allowed.includes(role)) {
    res.status(403).json({
      code: 40301,
      message: "权限不足",
      details: [{ field: "role", reason: "forbidden" }],
      requestId: randomUUID()
    });
    return null;
  }
  return auth;
}
