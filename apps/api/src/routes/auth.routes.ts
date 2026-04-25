// ============================================================
// 认证路由
// ============================================================

import { Router } from "express";
import * as AuthModule from "../modules/auth/auth.module";
import { requireCapability, requireAuthenticated } from "../rbac/middleware";

const router = Router();

// 公开（无需认证）
router.post("/register", AuthModule.register);
router.post("/login", AuthModule.login);

// 仅需登录态
router.get("/me", requireAuthenticated(), AuthModule.me);
router.post("/logout", requireAuthenticated(), AuthModule.logout);

// 用户管理（ADMIN）
router.get("/users", requireCapability("user:manage"), AuthModule.listUsers);
router.patch("/users/:userId/role", requireCapability("user:manage"), AuthModule.updateUserRole);
router.patch("/users/:userId/status", requireCapability("user:manage"), AuthModule.updateUserStatus);
router.get("/invite-codes", requireCapability("user:manage"), AuthModule.listInviteCodes);
router.post("/invite-codes/generate", requireCapability("user:manage"), AuthModule.generateInviteCodeHandler);

export default router;
