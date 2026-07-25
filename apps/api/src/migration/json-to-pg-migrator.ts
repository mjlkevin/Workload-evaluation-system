import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db, pool } from "../db/client";
import {
  ruleSets,
  systemConfigs,
  templates,
  users,
  versionCodeRules,
} from "../db/schema";
import { resolveRootDir } from "../utils/file";
import type {
  InviteCodesStore,
  PasswordResetTokensStore,
  RuleSet,
  Template,
  UsersStore,
  VersionCodeRulesStore,
  VersionsStore,
} from "../types";
import type { TeamStore } from "../modules/team/team.types";
import type { AiSessionsStore } from "../modules/ai-sessions/ai-sessions.types";
import type { TraceStore } from "../modules/trace/trace.types";
import { buildJsonToPgMigrationPlan, type JsonToPgMigrationPlan } from "./json-to-pg-migration-plan";

const RESET_TABLES = [
  "password_reset_tokens",
  "invite_codes",
  "team_audit_logs",
  "team_review_comments",
  "team_reviews",
  "team_plan_bindings",
  "team_members",
  "teams",
  "ai_sessions",
  "traces",
  "version_records",
  "users",
] as const;

type MigrationOptions = {
  dryRun?: boolean;
  rootDir?: string;
  adminUsername?: string;
  adminPassword?: string;
};

export type JsonToPgMigrationResult = {
  mode: "dry-run" | "live";
  timestamp: string;
  plan: JsonToPgMigrationPlan;
  resetTables: string[];
  admin: {
    username: string;
    created: boolean;
  };
  upserts: {
    versionCodeRules: number;
    templates: number;
    ruleSets: number;
    systemConfigs: number;
  };
  validation?: JsonToPgValidationResult;
};

export type JsonToPgValidationResult = {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; expected: number; actual: number }>;
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

function loadSources(rootDir: string) {
  return {
    users: readJsonOr<UsersStore>(rootDir, "config/auth/users.json", { users: [] }),
    inviteCodes: readJsonOr<InviteCodesStore>(rootDir, "config/auth/invite-codes.json", { codes: [] }),
    passwordResetTokens: readJsonOr<PasswordResetTokensStore>(rootDir, "config/auth/password-reset-tokens.json", { tokens: [] }),
    versionRecords: readJsonOr<VersionsStore>(rootDir, "config/versions/records.json", { records: [] }),
    team: readJsonOr<TeamStore>(rootDir, "config/teams/store.json", {
      version: 0,
      teams: [],
      reviews: [],
      comments: [],
      planBindings: [],
      auditLogs: [],
    }),
    aiSessions: readJsonOr<AiSessionsStore>(rootDir, "data/ai-sessions.json", { sessions: [] }),
    traces: readJsonOr<TraceStore>(rootDir, "data/traces/trace-store.json", { version: 1, traces: [] }),
    versionCodeRules: readJsonOr<VersionCodeRulesStore>(rootDir, "config/versions/version-code-rules.json", { rules: [] }),
    template: readJsonOr<Template | null>(rootDir, "config/templates/example-template.json", null),
    ruleSet: readJsonOr<RuleSet | null>(rootDir, "config/rules/example-rule-set.json", null),
    systemConfigs: {
      requirementSettings: readJsonOr<unknown>(rootDir, "config/system/requirement-settings.json", null),
      implementationDependencyRules: readJsonOr<unknown>(rootDir, "config/system/implementation-dependency-rules.json", null),
      knowledgeBaseConfig: readJsonOr<unknown>(rootDir, "config/system/knowledge-base-config.json", null),
    },
  };
}

function resolveAdminCredentials(options: MigrationOptions): { username: string; password: string } {
  const username = (options.adminUsername || process.env.WES_ADMIN_USERNAME || "admin").trim();
  const password = options.adminPassword || process.env.WES_ADMIN_PASSWORD || "Admin@2026!";
  if (process.env.NODE_ENV === "production" && !process.env.WES_ADMIN_PASSWORD && !options.adminPassword) {
    throw new Error("生产环境必须通过 WES_ADMIN_PASSWORD 或 --admin-password 显式设置管理员初始密码");
  }
  if (!username) throw new Error("管理员用户名不能为空");
  if (password.length < 8) throw new Error("管理员初始密码至少 8 位");
  return { username, password };
}

async function resetRuntimeTables(): Promise<void> {
  const quoted = RESET_TABLES.map((name) => `"${name}"`).join(", ");
  await pool.query(`TRUNCATE ${quoted} RESTART IDENTITY CASCADE`);
}

async function seedAdmin(username: string, password: string): Promise<void> {
  const now = new Date();
  await db.insert(users).values({
    userId: randomUUID(),
    username,
    passwordHash: await bcrypt.hash(password, 10),
    role: "admin",
    businessRole: "admin",
    status: "active",
    createdAt: now,
    lastLoginAt: now,
    updatedAt: now,
  });
}

async function upsertVersionCodeRules(plan: JsonToPgMigrationPlan): Promise<number> {
  await db.delete(versionCodeRules);
  if (plan.upserts.versionCodeRules.length === 0) return 0;
  await db.insert(versionCodeRules).values(
    plan.upserts.versionCodeRules.map((rule) => ({
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
  );
  return plan.upserts.versionCodeRules.length;
}

async function upsertTemplates(plan: JsonToPgMigrationPlan): Promise<number> {
  await db.delete(templates);
  if (plan.upserts.templates.length === 0) return 0;
  await db.insert(templates).values(
    plan.upserts.templates.map((template) => ({
      templateId: template.templateId,
      templateVersion: template.templateVersion,
      templateName: template.templateName,
      groups: template.groups,
      items: template.items,
      sheets: template.sheets ?? [],
      updatedAt: new Date(),
    })),
  );
  return plan.upserts.templates.length;
}

async function upsertRuleSets(plan: JsonToPgMigrationPlan): Promise<number> {
  await db.delete(ruleSets);
  if (plan.upserts.ruleSets.length === 0) return 0;
  await db.insert(ruleSets).values(
    plan.upserts.ruleSets.map((ruleSet) => ({
      ruleSetId: ruleSet.ruleSetId,
      ruleVersion: ruleSet.ruleVersion,
      pipelineVersion: ruleSet.pipelineVersion,
      pipeline: ruleSet.pipeline,
      baseRule: ruleSet.baseRule,
      orgIncrementRule: ruleSet.orgIncrementRule,
      updatedAt: new Date(),
    })),
  );
  return plan.upserts.ruleSets.length;
}

async function upsertSystemConfigs(plan: JsonToPgMigrationPlan): Promise<number> {
  await db.delete(systemConfigs);
  if (plan.upserts.systemConfigs.length === 0) return 0;
  await db.insert(systemConfigs).values(
    plan.upserts.systemConfigs
      .filter((item) => item.store !== null && item.store !== undefined)
      .map((item) => {
        const store = item.store as Record<string, unknown>;
        return {
          configKey: item.key,
          store: item.store,
          version: Number.isFinite(Number(store.version)) ? Number(store.version) : 1,
          updatedAt: parseDateOrNow(store.updatedAt),
          effectiveAt: parseDateOrNow(store.effectiveAt),
        };
      }),
  );
  return plan.upserts.systemConfigs.filter((item) => item.store !== null && item.store !== undefined).length;
}

async function validateCount(name: string, expected: number, query: Promise<Array<unknown>>) {
  const rows = await query;
  return { name, expected, actual: rows.length, ok: rows.length === expected };
}

export async function validateJsonToPgMigration(plan: JsonToPgMigrationPlan): Promise<JsonToPgValidationResult> {
  const checks = [
    await validateCount("users.seedAdmin", 1, db.select({ id: users.userId }).from(users)),
    await validateCount("versionCodeRules", plan.upserts.versionCodeRules.length, db.select({ id: versionCodeRules.ruleId }).from(versionCodeRules)),
    await validateCount("templates", plan.upserts.templates.length, db.select({ id: templates.templateId }).from(templates)),
    await validateCount("ruleSets", plan.upserts.ruleSets.length, db.select({ id: ruleSets.ruleSetId }).from(ruleSets)),
    await validateCount(
      "systemConfigs",
      plan.upserts.systemConfigs.filter((item) => item.store !== null && item.store !== undefined).length,
      db.select({ key: systemConfigs.configKey }).from(systemConfigs),
    ),
  ];
  return { ok: checks.every((item) => item.ok), checks };
}

export async function runJsonToPgMigration(options: MigrationOptions = {}): Promise<JsonToPgMigrationResult> {
  const rootDir = options.rootDir || resolveRootDir();
  const dryRun = Boolean(options.dryRun);
  const sources = loadSources(rootDir);
  const plan = buildJsonToPgMigrationPlan(sources);
  const admin = resolveAdminCredentials(options);

  const result: JsonToPgMigrationResult = {
    mode: dryRun ? "dry-run" : "live",
    timestamp: new Date().toISOString(),
    plan,
    resetTables: [...RESET_TABLES],
    admin: { username: admin.username, created: false },
    upserts: {
      versionCodeRules: plan.upserts.versionCodeRules.length,
      templates: plan.upserts.templates.length,
      ruleSets: plan.upserts.ruleSets.length,
      systemConfigs: plan.upserts.systemConfigs.filter((item) => item.store !== null && item.store !== undefined).length,
    },
  };

  if (dryRun) {
    return result;
  }

  await resetRuntimeTables();
  await seedAdmin(admin.username, admin.password);
  result.admin.created = true;
  result.upserts.versionCodeRules = await upsertVersionCodeRules(plan);
  result.upserts.templates = await upsertTemplates(plan);
  result.upserts.ruleSets = await upsertRuleSets(plan);
  result.upserts.systemConfigs = await upsertSystemConfigs(plan);
  result.validation = await validateJsonToPgMigration(plan);
  return result;
}

export async function readSystemConfigStore(configKey: string): Promise<unknown | null> {
  const rows = await db.select({ store: systemConfigs.store }).from(systemConfigs).where(eq(systemConfigs.configKey, configKey)).limit(1);
  return rows[0]?.store ?? null;
}
