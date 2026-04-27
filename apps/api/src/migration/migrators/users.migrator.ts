// ============================================================
// users.json → PG users 表迁移器
// ============================================================
// 映射规则：
//   v1 id               → v2 id (uuid)
//   v1 username         → v2 username
//   v1 passwordHash     → v2 password_hash
//   v1 role             → v2 role (admin/sub_admin/user 直映)
//   v1 status           → v2 status (active/disabled 直映)
//   v1 createdAt        → v2 created_at
//   v1 lastLoginAt      → v2 last_login_at

import fs from "node:fs";
import path from "node:path";
import { db } from "../../db/client";
import { users } from "../../db/schema";
import { sql } from "drizzle-orm";

interface V1User {
  id: string;
  username: string;
  passwordHash: string;
  role: "admin" | "sub_admin" | "user";
  status: "active" | "disabled";
  createdAt: string;
  lastLoginAt?: string;
}

interface V1UsersFile {
  users: V1User[];
}

export interface UserMigrationResult {
  sourceCount: number;
  inserted: number;
  skipped: number;
  errors: Array<{ username: string; error: string }>;
}

export async function migrateUsers(options: {
  dryRun?: boolean;
  configRoot?: string;
}): Promise<UserMigrationResult> {
  const { dryRun = false, configRoot = path.resolve(process.cwd(), "../../config") } = options;
  const filePath = path.join(configRoot, "auth", "users.json");

  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as V1UsersFile;
  const source = raw.users ?? [];

  const result: UserMigrationResult = {
    sourceCount: source.length,
    inserted: 0,
    skipped: 0,
    errors: [],
  };

  if (source.length === 0) {
    console.log("[migrate:users] 源数据为空，跳过");
    return result;
  }

  // 检查已有数据（幂等：按 username 跳过）
  const existingRows = await db.select({ username: users.username }).from(users);
  const existingSet = new Set(existingRows.map((r) => r.username));

  for (const u of source) {
    if (existingSet.has(u.username)) {
      result.skipped++;
      console.log(`[migrate:users] 跳过已存在: ${u.username}`);
      continue;
    }

    const row = {
      userId: u.id,
      username: u.username,
      passwordHash: u.passwordHash,
      role: u.role,
      status: u.status,
      createdAt: new Date(u.createdAt),
      lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt) : null,
    };

    if (dryRun) {
      console.log(`[migrate:users] [dry-run] 将插入: ${u.username} (${u.role})`);
      result.inserted++;
      continue;
    }

    try {
      await db.insert(users).values(row);
      result.inserted++;
      console.log(`[migrate:users] 已插入: ${u.username}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ username: u.username, error: message });
      console.error(`[migrate:users] 插入失败: ${u.username} — ${message}`);
    }
  }

  return result;
}
