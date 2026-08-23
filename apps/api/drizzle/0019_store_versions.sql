-- 阶段 2 批 7：teams 域 store 级乐观并发版本计数器（元数据表，非业务表加列）
-- JSON 侧 TeamStore.version 承载整存乐观并发（saveTeamStoreWithExpectedVersion）。
-- PG 侧以单行元数据持久化该计数：写事务内单条 UPSERT-CAS（比较+递增原子完成），
-- 「读版本 → 比较 → 写」整体下沉进 where 条件（§4.6 规则 2026-08-23）。
-- teams 域起始 version 0，与 JSON 初始空库对齐。
CREATE TABLE "store_versions" (
	"domain" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "store_versions" ("domain", "version") VALUES ('teams', 0) ON CONFLICT ("domain") DO NOTHING;
