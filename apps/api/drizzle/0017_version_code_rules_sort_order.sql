-- 批 4（system 四配置切 PG）：version_code_rules 增加排序列
-- ============================================================
-- 背景：JSON store 的 rules 数组顺序对 UI 可见（global → requirement →
-- implementation → dev → resource → wbs，非字母序）。表此前无排序列，
-- 切 PG 后 SELECT 顺序不确定会改变 UI 展示顺序。
-- 本迁移加 sort_order 列并按 JSON 规范顺序回填存量行。
--
-- 手写迁移（与 0016_credentials.sql 同口径）：meta/ 缺 0016_snapshot.json，
-- drizzle-kit generate 会基于 0015 快照 diff 出重复建表语句，故不可用
-- generate 产出，须手写并在 journal 登记。

ALTER TABLE "version_code_rules" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "version_code_rules" SET "sort_order" = CASE "rule_id"
	WHEN 'rule-global' THEN 0
	WHEN 'rule-requirement' THEN 1
	WHEN 'rule-implementation' THEN 2
	WHEN 'rule-dev' THEN 3
	WHEN 'rule-resource' THEN 4
	WHEN 'rule-wbs' THEN 5
	ELSE 0
END;
