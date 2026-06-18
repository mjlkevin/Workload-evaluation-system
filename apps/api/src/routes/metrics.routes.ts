// ============================================================
// Prometheus Metrics 端点
// ============================================================
// 无需鉴权 或 简单 token 保护（运维/监控系统直接访问）
//   GET /metrics → prom-client 默认 + 自定义指标

import { Router, Request, Response } from "express";
import { register } from "../metrics";

const router = Router();

const METRICS_TOKEN = process.env.METRICS_TOKEN || "";

function isAuthorized(req: Request): boolean {
  if (!METRICS_TOKEN) return true;
  const auth = req.headers.authorization || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return token === METRICS_TOKEN;
}

router.get("/metrics", async (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    res.status(401).set("Content-Type", "text/plain").end("Unauthorized");
    return;
  }

  try {
    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).set("Content-Type", "text/plain").end(String(err));
  }
});

export default router;
