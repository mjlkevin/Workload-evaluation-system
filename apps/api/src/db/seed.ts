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
//   6. knowledge_entries  <- config/knowledge/store.json（业务域种子语料，AI 检索依赖）
//                            2026-08-29 补：本项原先不在清单内，导致新库重建后
//                            知识语料不会被带回、「AI 检索恒空」事故复发（见事故记录）；
//                            同时吸收一次性脚本 scripts/migrate-knowledge-json-to-pg.cjs 的职责
//   +  ensureAdminSeed    <- WES_ADMIN_USERNAME / WES_ADMIN_PASSWORD（生产缺密码拒绝启动）
//
// 幂等口径：缺失才插（onConflictDoNothing），不 TRUNCATE、不覆盖运行时写入；
// 连续执行两次，各类配置行数不变。
//
// 编辑过种子行的处置口径（knowledge_entries 与 templates / rule_sets / version_code_rules /
// system_configs 同源）：
//   - 普通 db:seed：只补缺、不覆盖——用户改过的种子行**保持改后的值**，不会被还原；
//   - db:seed --force：先删源文件派生行再重播，用户对这些行的编辑**会被还原成仓库 JSON
//     源里的值**。种子数据以仓库文件为准是 --force 的设计语义，不是数据丢失；
//     用户自建、id 不在种子源里的知识词条，两种模式下都不会被动。
//
// 本模块只落 seed 函数；db:seed 脚本接线与启动 migrate 属事项 7。

import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";

import { db } from "./client";
import { knowledgeEntries, ruleSets, systemConfigs, templates, users, versionCodeRules } from "./schema";
import { resolveRootDir } from "../utils/file";
import type { RuleSet, Template, VersionCodeRule, VersionCodeRulesStore } from "../types";

export type SeedBaseConfigResult = {
  versionCodeRules: number;
  templates: number;
  ruleSets: number;
  systemConfigs: number;
  knowledgeEntries: number;
};

export type SeedAdminResult = {
  username: string;
  created: boolean;
};

type SeedBaseConfigOptions = {
  rootDir?: string;
  /**
   * 强制覆盖（db:seed --force）：先删除源文件对应的既有行再插入。
   * 仅限非生产环境（生产环境直接拒绝）；modelVerifyStatus 属运行时 key，不参与覆盖。
   * 背景：缺失才插口径下，PG 中一旦存在该行，修改仓库 JSON 源文件不再自动生效（记录 1）。
   */
  force?: boolean;
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

/** seed 源里的单条知识词（config/knowledge/store.json 只保证 id/title/content/category/tags，无 status/时间列）。 */
type KnowledgeSeedSourceEntry = {
  id?: unknown;
  title?: unknown;
  content?: unknown;
  category?: unknown;
  tags?: unknown;
};

/**
 * 知识词条 seed 行构造（纯函数，不碰 DB）。
 *
 * 字段口径与 knowledge-pg.repository.create 一致：title/content 去首尾空白、
 * category 缺省 general、tags 缺省 []、status 直接 active（新库重建后 AI 检索需立刻可检）。
 * 语料文件里没有 status/createdAt/updatedAt 三列，统一由本函数补齐。
 * 缺 id / title / content 任一项的条目直接跳过，不产生脏行。
 */
export function buildKnowledgeSeedRows(
  raw: unknown,
  now: Date = new Date(),
): Array<{
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  status: "active";
  createdAt: Date;
  updatedAt: Date;
}> {
  const entries = Array.isArray((raw as { entries?: unknown } | null)?.entries)
    ? ((raw as { entries: KnowledgeSeedSourceEntry[] }).entries ?? [])
    : [];

  const rows: Array<{
    id: string;
    title: string;
    content: string;
    category: string;
    tags: string[];
    status: "active";
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  for (const entry of entries) {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    const title = typeof entry?.title === "string" ? entry.title.trim() : "";
    const content = typeof entry?.content === "string" ? entry.content.trim() : "";
    if (!id || !title || !content) continue;
    rows.push({
      id,
      title,
      content,
      category: typeof entry.category === "string" && entry.category.trim() ? entry.category.trim() : "general",
      tags: Array.isArray(entry.tags) ? (entry.tags as string[]) : [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }

  return rows;
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
    knowledgeStore: readJsonOr<unknown>(rootDir, "config/knowledge/store.json", null),
  };
}

/** 播种基础配置：缺失才插（幂等、不 TRUNCATE）。返回本次实际插入的行数。 */
export async function seedBaseConfig(options: SeedBaseConfigOptions = {}): Promise<SeedBaseConfigResult> {
  const rootDir = options.rootDir || resolveRootDir();
  const sources = loadSeedSources(rootDir);

  if (options.force) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("--force 仅限非生产环境使用（生产环境禁止覆盖既有配置行）");
    }
    // 只覆盖源文件派生的行：三张整表 + system_configs 的三个源 key。
    // modelVerifyStatus 是运行时状态 key（由 saveScenarioVerifyRecord 写入），不随 force 重置。
    const sourceKeys = sources.systemConfigs.filter(([, store]) => store !== null && store !== undefined).map(([key]) => key);
    await db.delete(systemConfigs).where(inArray(systemConfigs.configKey, sourceKeys));
    await db.delete(templates);
    await db.delete(ruleSets);
    await db.delete(versionCodeRules);
    // knowledge_entries 与上面三张“只由 seed 写”的表不同：它是运行时可写表
    // （用户可在知识管理入口新增/修改词条）。因此 force 只按 seed 源里的 id 定点删除，
    // 不得整表删除，否则会把切换后用户新增的词条一并清掉。
    const knowledgeSeedIds = buildKnowledgeSeedRows(sources.knowledgeStore).map((row) => row.id);
    if (knowledgeSeedIds.length > 0) {
      await db.delete(knowledgeEntries).where(inArray(knowledgeEntries.id, knowledgeSeedIds));
    }
  }

  const insertedRules = await db
    .insert(versionCodeRules)
    .values(
      sources.versionCodeRules.rules.map((rule: VersionCodeRule, index: number) => ({
        ruleId: rule.id,
        moduleKey: rule.moduleKey,
        moduleName: rule.moduleName,
        moduleCode: rule.moduleCode,
        prefix: rule.prefix,
        format: rule.format,
        sample: rule.sample,
        status: rule.status,
        // JSON 数组顺序对 UI 可见，用数组下标保序
        sortOrder: index,
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

  const knowledgeSeedRows = buildKnowledgeSeedRows(sources.knowledgeStore);
  const insertedKnowledgeEntries = knowledgeSeedRows.length
    ? await db
        .insert(knowledgeEntries)
        .values(knowledgeSeedRows)
        .onConflictDoNothing({ target: knowledgeEntries.id })
        .returning()
    : [];

  return {
    versionCodeRules: insertedRules.length,
    templates: insertedTemplates.length,
    ruleSets: insertedRuleSets.length,
    systemConfigs: insertedSystemConfigs.length,
    knowledgeEntries: insertedKnowledgeEntries.length,
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
