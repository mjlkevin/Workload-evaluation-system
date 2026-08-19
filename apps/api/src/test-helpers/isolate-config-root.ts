// ============================================================
// 测试基建：users.json 竞态隔离（chdir 沙箱）
// ============================================================
// 背景：node:test 按文件并行执行（每文件独立进程），多个测试文件并发
// 「读-改-写」共享的 config/auth/users.json（整存 RMW），互相覆盖对方
// 的写入与快照恢复——即阶段 2 要消灭的整存 RMW 丢失更新在测试基建里
// 的显形。main CI 已实证随机失败（modules.handlers 断言 active user
// required、路由测试临时用户被并发恢复覆盖删除）。
//
// 方案（沿用阶段 1 app-async-errors.test.ts 的先例）：把测试进程 chdir
// 到独立临时根目录，resolveRootDir() 基于 process.cwd() 解析，
// usersStorePath() 即指向隔离副本（以真实 users.json 为基线拷贝）；
// 其余 config 子目录以符号链接透传主目录，保证 createApp()/usecase
// 装配对其他配置文件的读写不受影响。node:test 每文件独立进程，chdir
// 不影响其他测试文件。
//
// 用法：
//   before(() => enterIsolatedConfigRoot("wes-xxx-"));
//   after(() => exitIsolatedConfigRoot());

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveRootDir } from "../utils";

let originalCwd = "";
let tmpDir = "";

/** chdir 到隔离临时根；auth/users.json 用真实文件做基线拷贝，其余配置符号链接透传 */
export function enterIsolatedConfigRoot(prefix: string): void {
  originalCwd = process.cwd();
  const mainConfigDir = path.join(resolveRootDir(), "config");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const tmpConfigDir = path.join(tmpDir, "config");
  const tmpAuthDir = path.join(tmpConfigDir, "auth");
  fs.mkdirSync(tmpAuthDir, { recursive: true });

  for (const entry of fs.readdirSync(mainConfigDir, { withFileTypes: true })) {
    if (entry.name === "auth") continue;
    fs.symlinkSync(
      path.join(mainConfigDir, entry.name),
      path.join(tmpConfigDir, entry.name),
      entry.isDirectory() ? "dir" : "file",
    );
  }
  for (const entry of fs.readdirSync(path.join(mainConfigDir, "auth"), { withFileTypes: true })) {
    if (entry.name === "users.json") {
      // 基线拷贝：隔离副本内的读改写不触碰真实文件
      fs.copyFileSync(path.join(mainConfigDir, "auth", "users.json"), path.join(tmpAuthDir, "users.json"));
      continue;
    }
    fs.symlinkSync(
      path.join(mainConfigDir, "auth", entry.name),
      path.join(tmpAuthDir, entry.name),
      entry.isDirectory() ? "dir" : "file",
    );
  }
  process.chdir(tmpDir);
}

/** 恢复 cwd 并清理临时根（与 enter 成对使用） */
export function exitIsolatedConfigRoot(): void {
  if (originalCwd) process.chdir(originalCwd);
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  originalCwd = "";
  tmpDir = "";
}
