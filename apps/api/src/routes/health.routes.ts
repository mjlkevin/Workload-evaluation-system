// ============================================================
// 健康检查端点
// ============================================================
// 无需鉴权（运维探针用）
//   GET /health      → liveness
//   GET /health/ready → readiness（DB + Kimi API）
//   GET /health/info  → 版本/构建信息

import { Router, Request, Response } from "express";
import { pool } from "../db/client";
import { config } from "../config/env";
import { defaultProviderRegistry } from "../ai/provider";
import { logger } from "../utils/logger";

const router = Router();

// 启动时间戳
const startedAt = new Date().toISOString();
const uptimeStart = Date.now();

// 版本信息尽量从 package.json 读取，回退到硬编码
let version = "0.1.0";
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  version = require("../../package.json").version || "0.1.0";
} catch {
  // 忽略读取失败
}

// ---------- Liveness ----------
router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    uptime: Date.now() - uptimeStart,
    version,
  });
});

// ---------- Readiness ----------
router.get("/health/ready", async (_req: Request, res: Response) => {
  const checks: Record<string, "ok" | "fail"> = {};

  // 1) DB 连通性
  try {
    await pool.query("SELECT 1");
    checks.db = "ok";
  } catch (err) {
    checks.db = "fail";
    logger.warn({ err, event: "health_check" }, "DB readiness check failed");
  }

  // 2) Kimi API 可达性
  try {
    const kimi = defaultProviderRegistry.get("kimi");
    if (kimi && kimi.isAvailable()) {
      checks.kimi = "ok";
    } else {
      checks.kimi = "fail";
    }
  } catch (err) {
    checks.kimi = "fail";
    logger.warn({ err, event: "health_check" }, "Kimi readiness check failed");
  }

  const ready = checks.db === "ok" && checks.kimi === "ok";
  const statusCode = ready ? 200 : 503;

  res.status(statusCode).json({
    ...checks,
    ready,
  });
});

// ---------- Build Info ----------
router.get("/health/info", (_req: Request, res: Response) => {
  res.json({
    version,
    commitHash: process.env.GIT_COMMIT_HASH || "unknown",
    buildTime: process.env.BUILD_TIME || startedAt,
    nodeEnv: process.env.NODE_ENV || "development",
  });
});

export default router;
