// ============================================================
// 数据库 seed - 首次部署播种（admin + 基础配置）
// ============================================================
// 数据源：仓库内 config/ 下既有 JSON 文件（切换 PG 后降级为只读 seed 源）。
// 播种清单（自 json-to-pg-migrator.ts 搬迁，一条不漏）：
//   1. version_code_rules <- config/versions/version-code-rules.json（6 条生效规则）
//   2. templates          <- config/templates/example-template.json（414KB，含 groups/items/sheets）
//   3. rule_sets          <- config/rules/example-rule-set.json
//   4. system_configs     <- requirementSettings / implementationDependencyRules /
//                            knowledgeBaseConfig（config/system/*.json 三 key）
//   5. system_configs     <- modelVerifyStatus：只建 key（空 store）供运行时写入，
//                            由 saveScenarioVerifyRecord 写，不播种当前内容
//   +  ensureAdminSeed    <- WES_ADMIN_USERNAME / WES_ADMIN_PASSWORD（生产缺密码拒绝启动）
//
// 幂等口径：缺失才插（onConflictDoNothing），不 TRUNCATE、不覆盖运行时写入；
// 连续执行两次，四类配置行数不变。
//
// 本模块只落 seed 函数；db:seed 脚本接线与启动 migrate 属事项 7。

import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "./client";
import { ruleSets, systemConfigs, templates, users, versionCodeRules } from "./schema";
import { resolveRootDir } from "../utils/file";
import type { RuleSet, Template, VersionCodeRule, VersionCodeRulesStore } from "../types";

export type SeedBaseConfigResult = {
  versionCodeRules: number;
  templates: number;
  ruleSets: number;
  systemConfigs: number;
};

export type SeedAdminResult = {
  username: string;
  created: boolean;
};

type SeedBaseConfigOptions = {
  rootDir?: string;
};

type SeedAdminOptions = {
  adminUsername?: string;
  adminPassword?: string;
};

function readJsonOr<T>(rootDir: string, relativePath: string, fallback: T): T {
  const filePath = path.resolve(rootDir, relativePath);
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function parseDateOrNull(value: unknown): Date | null {
  const text = String(value || "").trim();
  if (!text || text === "--") return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseDateOrNow(value: unknown): Date {
  return parseDateOrNull(value) ?? new Date();
}

function resolveAdminCredentials(options: SeedAdminOptions): { username: string; password: string } {
  const username = (options.adminUsername || process.env.WES_ADMIN_USERNAME || "admin").trim();
  const password = options.adminPassword || process.env.WES_ADMIN_PASSWORD || "Admin@2026!";
  if (process.env.NODE_ENV === "production" && !process.env.WES_ADMIN_PASSWORD && !options.adminPassword) {
    throw new Error("生产环境必须通过 WES_ADMIN_PASSWORD 或 --admin-password 显式设置管理员初始密码");
  }
  if (!username) throw new Error("管理员用户名不能为空");
  if (password.length < 8) throw new Error("管理员初始密码至少 8 位");
  return { username, password };
}

function loadSeedSources(rootDir: string) {
  return {
    versionCodeRules: readJsonOr<VersionCodeRulesStore>(rootDir, "config/versions/version-code-rules.json", { rules: [] }),
    template: readJsonOr<Template | null>(rootDir, "config/templates/example-template.json", null),
    ruleSet: readJsonOr<RuleSet | null>(rootDir, "config/rules/example-rule-set.json", null),
    systemConfigs: [
      ["requirementSettings", readJsonOr<unknown>(rootDir, "config/system/requirement-settings.json", null)],
      ["implementationDependencyRules", readJsonOr<unknown>(rootDir, "config/system/implementation-dependency-rules.json", null)],
      ["knowledgeBaseConfig", readJsonOr<unknown>(rootDir, "config/system/knowledge-base-config.json", null)],
    ] as const,
  };
}

/** 播种基础配置：缺失才插（幂等、不 TRUNCATE）。返回本次实际插入的行数。 */
export async function seedBaseConfig(options: SeedBaseConfigOptions = {}): Promise<SeedBaseConfigResult> {
  const rootDir = options.rootDir || resolveRootDir();
  const sources = loadSeedSources(rootDir);

  const insertedRules = await db
    .insert(versionCodeRules)
    .values(
      sources.versionCodeRules.rules.map((rule: VersionCodeRule) => ({
        ruleId: rule.id,
        moduleKey: rule.moduleKey,
        moduleName: rule.moduleName,
        moduleCode: rule.moduleCode,
        prefix: rule.prefix,
        format: rule.format,
        sample: rule.sample,
        status: rule.status,
        effectiveAt: parseDateOrNull(rule.effectiveAt),
        updatedAt: parseDateOrNow(rule.updatedAt),
      })),
    )
    .onConflictDoNothing({ target: versionCodeRules.ruleId })
    .returning();

  const insertedTemplates = sources.template
    ? await db
        .insert(templates)
        .values({
          templateId: sources.template.templateId,
          templateVersion: sources.template.templateVersion,
          templateName: sources.template.templateName,
          groups: sources.template.groups,
          items: sources.template.items,
          sheets: sources.template.sheets ?? [],
          updatedAt: new Date(),
        })
        .onConflictDoNothing({ target: templates.templateId })
        .returning()
    : [];

  const insertedRuleSets = sources.ruleSet
    ? await db
        .insert(ruleSets)
        .values({
          ruleSetId: sources.ruleSet.ruleSetId,
          ruleVersion: sources.ruleSet.ruleVersion,
          pipelineVersion: sources.ruleSet.pipelineVersion,
          pipeline: sources.ruleSet.pipeline,
          baseRule: sources.ruleSet.baseRule,
          orgIncrementRule: sources.ruleSet.orgIncrementRule,
          updatedAt: new Date(),
        })
        .onConflictDoNothing({ target: ruleSets.ruleSetId })
        .returning()
    : [];

  const systemConfigRows = [
    ...sources.systemConfigs
      .filter(([, store]) => store !== null && store !== undefined)
      .map(([key, store]) => {
        const record = store as Record<string, unknown>;
        return {
          configKey: key,
          store,
          version: Number.isFinite(Number(record.version)) ? Number(record.version) : 1,
          updatedAt: parseDateOrNow(record.updatedAt),
          effectiveAt: parseDateOrNow(record.effectiveAt),
        };
      }),
    // 第四 key：modelVerifyStatus 属运行时状态（由 saveScenarioVerifyRecord 写入），
    // 只建 key（空 store）供运行时写入，不播种 config/system/model-verify-status.json 的当前内容。
    {
      configKey: "modelVerifyStatus",
      store: {},
      version: 1,
      updatedAt: new Date(),
      effectiveAt: new Date(),
    },
  ];
  const insertedSystemConfigs = await db
    .insert(systemConfigs)
    .values(systemConfigRows)
    .onConflictDoNothing({ target: systemConfigs.configKey })
    .returning();

  return {
    versionCodeRules: insertedRules.length,
    templates: insertedTemplates.length,
    ruleSets: insertedRuleSets.length,
    systemConfigs: insertedSystemConfigs.length,
  };
}

/** 确保管理员存在：复用原 json-to-pg-migrator 的 seedAdmin 逻辑 + 存在性查重。 */
export async function ensureAdminSeed(options: SeedAdminOptions = {}): Promise<SeedAdminResult> {
  const { username, password } = resolveAdminCredentials(options);

  const existing = await db.select({ userId: users.userId }).from(users).where(eq(users.username, username)).limit(1);
  if (existing.length > 0) {
    return { username, created: false };
  }

  const now = new Date();
  const inserted = await db
    .insert(users)
    .values({
      userId: randomUUID(),
      username,
      passwordHash: await bcrypt.hash(password, 10),
      role: "admin",
      businessRole: "admin",
      status: "active",
      createdAt: now,
      lastLoginAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: users.username })
    .returning();

  return { username, created: inserted.length > 0 };
}
