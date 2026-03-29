// ============================================================
// 认证路由
// ============================================================

import { Router } from "express";
import * as AuthModule from "../modules/auth/auth.module";

const router = Router();

router.post("/register", AuthModule.register);
router.post("/login", AuthModule.login);
router.get("/me", AuthModule.me);
router.post("/logout", AuthModule.logout);
router.get("/users", AuthModule.listUsers);
router.patch("/users/:userId/status", AuthModule.updateUserStatus);
router.get("/invite-codes", AuthModule.listInviteCodes);
router.post("/invite-codes/generate", AuthModule.generateInviteCodeHandler);

export default router;
