// ============================================================
// 事项 1 回归测试：async 路由 handler 抛错必须被全局错误处理捕获
// ============================================================
// 背景：Express 4 不自动捕获 async handler 的 rejected promise，
// 未装配 express-async-errors 时这类错误会被静默吞掉、请求挂起（无响应）。
// 本文件 import ./app 以真实触发 app.ts 装配链——express-async-errors
// 在 app.ts 顶部 import 后对进程内所有 Express 实例生效（monkey-patch），
// 因此用 miniApp + errorHandler 即可验证 async rejection 走统一错误结构。
// 若 app.ts 移除该装配，下方 async 用例将请求挂起并超时失败（RED）。

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import supertest from "supertest";

import { createApp } from "./app";
import { errorHandler } from "./middleware/error-handler";
import { ApiError } from "./utils/errors";

function miniAppWithAsyncThrow() {
  const app = express();
  app.get("/async-throw", async () => {
    throw new Error("boom-internal-detail");
  });
  app.use(errorHandler);
  return app;
}

test("装配冒烟：createApp 在装配 express-async-errors 后仍可正常启动", async () => {
  const res = await supertest(createApp()).get("/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ok");
});

test("async handler 抛普通 Error 时返回统一 500 结构，而非请求挂起", { timeout: 8000 }, async () => {
  const res = await supertest(miniAppWithAsyncThrow())
    .get("/async-throw")
    .timeout({ response: 5000 });
  assert.equal(res.status, 500);
  assert.equal(res.body.code, 50000);
  assert.equal(res.body.message, "服务器内部错误");
  assert.equal(res.body.details[0].field, "server");
  assert.equal(res.body.details[0].reason, "internal_error");
  assert.equal(typeof res.body.requestId, "string");
  // 内部错误细节不得泄露给客户端
  assert.ok(!JSON.stringify(res.body).includes("boom-internal-detail"));
});

test("async handler 抛 ApiError 时走 ApiError 分支返回业务状态码", { timeout: 8000 }, async () => {
  const app = express();
  app.get("/async-apierror", async () => {
    throw new ApiError(422, "校验失败", [{ field: "name", reason: "required" }]);
  });
  app.use(errorHandler);
  const res = await supertest(app).get("/async-apierror").timeout({ response: 5000 });
  assert.equal(res.status, 422);
  assert.equal(res.body.code, 42200);
  assert.equal(res.body.message, "校验失败");
  assert.deepEqual(res.body.details, [{ field: "name", reason: "required" }]);
});
