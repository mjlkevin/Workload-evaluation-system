// ============================================================
// RBAC - Express 中间件
// ============================================================
// 提供基于能力位的路由拦截。
//
// 使用方式：
//   router.post("/extractor", requireCapability("extractor:trigger"), handler);
//
// 设计要点：
//   - 复用现有 requireAuth（JWT 验证 + 用户查找）
//   - 旧角色通过 legacyRoleToV2Roles 映射
//   - 映射后的 v2Roles 挂载到 req.v2Roles，供下游 handler 使用
//   - 无权限时返回 403，与现有 requireRole 错误格式一致

import { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";

import { requireAuth } from "../middleware/auth";
import { legacyRoleToV2Roles, type V2Role } from "./roles";
import { anyRoleHasCapability, type Capability } from "./permissions";
import type { AuthUser } from "../types";

// ------------------------------------------------------------------
// Express Request 扩展（TypeScript 声明合并）
// ------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      /** RBAC 映射后的 v2 角色列表 */
      v2Roles?: V2Role[];
      /** 当前认证用户（由 requireCapability 等中间件挂载） */
      user?: AuthUser;
    }
  }
}

// ------------------------------------------------------------------
// 中间件工厂
// ------------------------------------------------------------------

/**
 * 仅要求调用方已认证（JWT 有效 + 用户存在且活跃）。
 * 不检查任何能力位，只挂载 v2Roles 到 req。
 * 用于 /auth/me、/auth/logout 等仅需登录态的端点。
 */
export function requireAuthenticated() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req, res);
    if (!auth) {
      return; // requireAuth 已写 401 响应
    }
    req.user = auth.user;
    req.v2Roles = legacyRoleToV2Roles(auth.user.role);
    next();
  };
}

/**
 * 要求调用方拥有指定能力位。
 * 返回 Express 中间件函数。
 */
export function requireCapability(capability: Capability) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req, res);
    if (!auth) {
      return; // requireAuth 已写 401 响应
    }

    req.user = auth.user;
    const v2Roles = legacyRoleToV2Roles(auth.user.role);
    req.v2Roles = v2Roles;

    if (!anyRoleHasCapability(v2Roles, capability)) {
      res.status(403).json({
        code: 40301,
        message: "权限不足",
        details: [
          {
            field: "capability",
            reason: `缺少能力位: ${capability}`,
            required: capability,
            userLegacyRole: auth.user.role,
            userV2Roles: v2Roles,
          },
        ],
        requestId: randomUUID(),
      });
      return;
    }

    next();
  };
}

/**
 * 要求调用方拥有指定能力位中的**任意一个**（OR 关系）。
 */
export function requireAnyCapability(...capabilities: Capability[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    req.user = auth.user;
    const v2Roles = legacyRoleToV2Roles(auth.user.role);
    req.v2Roles = v2Roles;

    const hasAny = capabilities.some((c) => anyRoleHasCapability(v2Roles, c));
    if (!hasAny) {
      res.status(403).json({
        code: 40301,
        message: "权限不足",
        details: [
          {
            field: "capability",
            reason: `需要以下能力位之一: ${capabilities.join(", ")}`,
            required: capabilities,
            userLegacyRole: auth.user.role,
            userV2Roles: v2Roles,
          },
        ],
        requestId: randomUUID(),
      });
      return;
    }

    next();
  };
}

/**
 * 要求调用方是指定 v2 角色之一（用于需要精确角色判断的场景）。
 * 注意：旧角色 user/sub_admin/admin 仍先映射到 v2，再匹配。
 */
export function requireV2Role(...allowedRoles: V2Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    req.user = auth.user;
    const v2Roles = legacyRoleToV2Roles(auth.user.role);
    req.v2Roles = v2Roles;

    const matched = v2Roles.some((r) => allowedRoles.includes(r));
    if (!matched) {
      res.status(403).json({
        code: 40301,
        message: "权限不足",
        details: [
          {
            field: "role",
            reason: `需要以下角色之一: ${allowedRoles.join(", ")}`,
            required: allowedRoles,
            userLegacyRole: auth.user.role,
            userV2Roles: v2Roles,
          },
        ],
        requestId: randomUUID(),
      });
      return;
    }

    next();
  };
}
