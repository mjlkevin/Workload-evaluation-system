// drizzle-kit 配置：生成 migration SQL
// 运行：npm run db:generate -w apps/api

import type { Config } from "drizzle-kit";
import "dotenv/config";

export default {
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://kevin@localhost:5432/workload_eval",
  },
  verbose: true,
  strict: true,
} satisfies Config;
