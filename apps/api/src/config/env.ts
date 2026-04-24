// ============================================================
// 环境变量配置 - 从 main.ts 提取
// ============================================================

import dotenv from "dotenv";
import path from "node:path";

// 优先加载本地私有配置，再回退默认 .env
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  
  jwt: {
    secret: process.env.JWT_SECRET || "dev-jwt-secret-change-me",
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  },
  
  kimi: {
    apiKey: process.env.KIMI_API_KEY || "",
    model: process.env.KIMI_MODEL || "kimi-k2.5",
    apiBaseUrl: process.env.KIMI_API_BASE_URL || "https://api.moonshot.cn/v1",
  },

  database: {
    /** PG 连接串，dev 默认 workload_eval 库；测试用 workload_eval_test */
    url: process.env.DATABASE_URL || "",
    poolMax: Number(process.env.DATABASE_POOL_MAX || 10),
  },

  // 常量配置
  constants: {
    EXPORT_IDEMPOTENCY_TTL_MS: 10 * 60 * 1000,
    SESSION_TTL_MS: 2 * 60 * 60 * 1000,
    MAX_FILE_SIZE: 10 * 1024 * 1024,
  },
};

export type Config = typeof config;
