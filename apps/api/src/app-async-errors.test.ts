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
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createApp } from "./app";
import { errorHandler } from "./middleware/error-handler";
import { loadUsersStore, saveUsersStore } from "./middleware/auth";
import { ApiError } from "./utils/errors";
import { resolveRootDir } from "./utils/file";

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

test("真实端点：POST /api/v1/auth/login async 抛错走统一 500 而非挂起", { timeout: 8000 }, async () => {
  // 返工补充：用 createApp() 产物打真实嵌套路由（非 miniApp），抛错点位于
  // 真实 login handler 执行路径内部（mock bcrypt.compare 抛错）。
  // 若 app.ts 的装配被破坏（如 errorHandler 被挪到路由之前），本用例会挂起超时失败。
  //
  // 竞态隔离（阶段 1 flake 修复）：node:test 多测试文件并发共享 config/auth/users.json，
  // 本用例「读-改-写」窗口与其他测试文件的快照恢复/读改写互相覆盖，
  // 本地与 CI 均已实证随机失败（tempUser 被并发覆盖删除 → login 400；
  // CI 反向覆盖删他人 non-admin 用户 → 断言失败）。
  // 这里把测试进程 chdir 到独立临时目录：resolveRootDir() 基于 process.cwd() 解析，
  // 命中临时目录后 usersStorePath() 指向隔离副本；其余 config 子目录以符号链接
  // 透传主目录，保证 createApp() 装配与 login 链路的其他配置文件读取不受影响。
  // node:test 每测试文件独立进程，chdir 不影响其他测试文件。
  const originalCwd = process.cwd();
  const mainConfigDir = path.join(resolveRootDir(), "config");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wes-app-async-err-"));
  const tmpConfigDir = path.join(tmpDir, "config");
  fs.mkdirSync(path.join(tmpConfigDir, "auth"), { recursive: true });
  for (const entry of fs.readdirSync(mainConfigDir, { withFileTypes: true })) {
    if (entry.name === "auth") continue;
    fs.symlinkSync(
      path.join(mainConfigDir, entry.name),
      path.join(tmpConfigDir, entry.name),
      entry.isDirectory() ? "dir" : "file"
    );
  }
  process.chdir(tmpDir);
  try {
    const uniqueId = randomUUID();
    const tempUser = {
      id: `async-err-login-${uniqueId}`,
      username: `async-err-login-${uniqueId}`,
      role: "admin",
      status: "active",
      passwordHash: "any-hash",
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
    const store = await loadUsersStore();
    store.users.push(tempUser as never);
    await saveUsersStore(store);

    // mock bcrypt.compare 抛错——与 auth.usecase 共享同一 CJS 模块实例
    const originalCompare = bcrypt.compare;
    bcrypt.compare = async () => {
      throw new Error("boom-bcrypt-internal");
    };
    try {
      const res = await supertest(createApp())
        .post("/api/v1/auth/login")
        .send({ username: tempUser.username, password: "anything" })
        .timeout({ response: 5000 });
      assert.equal(res.status, 500);
      assert.equal(res.body.code, 50000);
      assert.equal(res.body.message, "服务器内部错误");
      assert.equal(res.body.details[0].field, "server");
      assert.equal(res.body.details[0].reason, "internal_error");
      assert.equal(typeof res.body.requestId, "string");
      // 内部错误细节不得泄露给客户端
      assert.ok(!JSON.stringify(res.body).includes("boom-bcrypt-internal"));
    } finally {
      bcrypt.compare = originalCompare;
      const s = await loadUsersStore();
      s.users = s.users.filter((u) => u.id !== tempUser.id);
      await saveUsersStore(s);
    }
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
