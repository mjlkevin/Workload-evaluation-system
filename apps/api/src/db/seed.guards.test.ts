// ============================================================
// db:seed 守卫测试 —— 生产保护与输入校验（不触碰数据库）
// ============================================================
// 覆盖：ensureAdminSeed 生产缺密码拒绝 / 密码长度校验；
// seedBaseConfig --force 生产环境拒绝（记录 1 的 --force 评估实现后的守卫）。

import test from "node:test";
import assert from "node:assert/strict";

import { ensureAdminSeed, seedBaseConfig } from "./seed";

test("ensureAdminSeed 生产环境缺少显式密码时拒绝执行", async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevPassword = process.env.WES_ADMIN_PASSWORD;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.WES_ADMIN_PASSWORD;
    await assert.rejects(
      () => ensureAdminSeed(),
      /生产环境必须通过 WES_ADMIN_PASSWORD/,
      "生产环境无显式密码必须拒绝执行",
    );
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    if (prevPassword === undefined) delete process.env.WES_ADMIN_PASSWORD;
    else process.env.WES_ADMIN_PASSWORD = prevPassword;
  }
});

test("ensureAdminSeed 初始密码不足 8 位时拒绝执行", async () => {
  await assert.rejects(
    () => ensureAdminSeed({ adminPassword: "short" }),
    /管理员初始密码至少 8 位/,
    "密码长度不足必须拒绝执行",
  );
});

test("seedBaseConfig --force 在生产环境被拒绝（强制覆盖仅限非生产）", async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    await assert.rejects(
      () => seedBaseConfig({ force: true }),
      /--force 仅限非生产环境/,
      "--force 在生产环境必须被拒绝",
    );
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
  }
});
