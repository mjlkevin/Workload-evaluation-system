// ============================================================
// 认证中间件 - 从 main.ts 提取
// ============================================================

import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

import { config } from "../config/env";
import { AuthUser, AuthJwtPayload, UsersStore } from "../types";
import { asString, usersStorePath } from "../utils";

// -------------------- 用户存储操作 --------------------

function normalizeAuthUserRole(user: AuthUser): AuthUser {
  const r = user.role as string;
  if (r === "admin" || r === "sub_admin" || r === "user") return user;
  return { ...user, role: "user" };
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

export function signAuthToken(user: AuthUser): string {
  const expiresIn = config.jwt.expiresIn as jwt.SignOptions["expiresIn"];
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role
    } satisfies AuthJwtPayload,
    config.jwt.secret,
    { expiresIn }
  );
}

export function verifyAuthToken(token: string): AuthJwtPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    if (!decoded || typeof decoded === "string") return null;
    const payload = decoded as jwt.JwtPayload;
    const sub = asString(payload.sub);
    const username = asString(payload.username);
    const roleRaw = asString(payload.role);
    const role: AuthUser["role"] =
      roleRaw === "admin" ? "admin" : roleRaw === "sub_admin" ? "sub_admin" : "user";
    if (!sub || !username) return null;
    return { sub, username, role };
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

export function toPublicUser(user: AuthUser): Omit<AuthUser, "passwordHash"> {
  const { passwordHash, ...rest } = user;
  return rest;
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
 */
export function requireAuth(req: Request, res: Response): { payload: AuthJwtPayload; user: AuthUser } | null {
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
 */
export function requireRole(req: Request, res: Response, allowed: Array<"admin" | "operator">): boolean {
  const auth = requireAuth(req, res);
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
 */
export function requireRoleWithAuth(
  req: Request,
  res: Response,
  allowed: Array<"admin" | "operator">
): { payload: AuthJwtPayload; user: AuthUser } | null {
  const auth = requireAuth(req, res);
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
