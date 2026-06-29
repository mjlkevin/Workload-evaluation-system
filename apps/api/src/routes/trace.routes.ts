// ============================================================
// RP-030 · Trace 查询路由
// ============================================================
// GET /traces — 查询当前用户的 trace 列表
// GET /traces/:traceId — 查询单条 trace 详情
// 鉴权：requireCapability("estimates:read") — 与 AI 工作台一致
// ============================================================

import { Router } from "express";

import { requireCapability } from "../rbac/middleware";
import * as TraceModule from "../modules/trace/trace.module";

const router = Router();

// 查询当前用户的 trace 列表（admin 可通过 ?all=true 查全量）
router.get("/", requireCapability("estimates:read"), TraceModule.listTracesHandler);

// 查询单条 trace 详情
router.get("/:traceId", requireCapability("estimates:read"), TraceModule.getTraceHandler);

export default router;
