// ============================================================
// 健康检查端点测试
// ============================================================
// 为避免 createApp 拉起全部依赖（DB 等），此处只挂载 health 路由做隔离测试。

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import supertest from "supertest";
import healthRoutes from "./health.routes";

function miniApp() {
  const app = express();
  app.use(healthRoutes);
  return app;
}

test("GET /health 返回 liveness 状态", async () => {
  const res = await supertest(miniApp()).get("/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ok");
  assert.equal(typeof res.body.uptime, "number");
  assert.equal(typeof res.body.version, "string");
});

test("GET /health/ready 返回 readiness 检查结果", async () => {
  const res = await supertest(miniApp()).get("/health/ready");
  // 无论 DB / Kimi 是否可用，都应返回 JSON
  assert.equal(typeof res.body.db, "string");
  assert.equal(typeof res.body.kimi, "string");
  assert.equal(typeof res.body.ready, "boolean");
});

test("GET /health/info 返回版本/构建信息", async () => {
  const res = await supertest(miniApp()).get("/health/info");
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.version, "string");
  assert.equal(typeof res.body.commitHash, "string");
  assert.equal(typeof res.body.buildTime, "string");
  assert.equal(typeof res.body.nodeEnv, "string");
});
