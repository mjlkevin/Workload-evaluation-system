import type {
  InviteCodesStore,
  PasswordResetTokensStore,
  RuleSet,
  Template,
  UsersStore,
  VersionCodeRule,
  VersionCodeRulesStore,
  VersionsStore,
} from "../types";
import type { AiSessionsStore } from "../modules/ai-sessions/ai-sessions.types";
import type { TeamStore } from "../modules/team/team.types";
import type { TraceStore } from "../modules/trace/trace.types";

type SystemConfigInput = Record<string, unknown>;

export type JsonToPgMigrationSources = {
  users: UsersStore;
  inviteCodes: InviteCodesStore;
  passwordResetTokens: PasswordResetTokensStore;
  versionRecords: VersionsStore;
  team: TeamStore;
  aiSessions: AiSessionsStore;
  traces: TraceStore;
  versionCodeRules: VersionCodeRulesStore;
  template: Template | null;
  ruleSet: RuleSet | null;
  systemConfigs: SystemConfigInput;
};

export type DiscardedSourceSummary = {
  source: string;
  count: number;
};

export type SystemConfigUpsert = {
  key: string;
  store: unknown;
};

export type JsonToPgMigrationPlan = {
  resetTables: string[];
  discardedSources: DiscardedSourceSummary[];
  upserts: {
    users: [];
    versionRecords: [];
    versionCodeRules: VersionCodeRule[];
    templates: Template[];
    ruleSets: RuleSet[];
    systemConfigs: SystemConfigUpsert[];
  };
};

const RESET_TABLES = [
  "users",
  "invite_codes",
  "password_reset_tokens",
  "version_records",
  "teams",
  "team_members",
  "team_reviews",
  "team_review_comments",
  "team_plan_bindings",
  "team_audit_logs",
  "ai_sessions",
  "traces",
] as const;

const SYSTEM_CONFIG_ORDER = [
  "requirementSettings",
  "implementationDependencyRules",
  "knowledgeBaseConfig",
] as const;

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function buildJsonToPgMigrationPlan(sources: JsonToPgMigrationSources): JsonToPgMigrationPlan {
  const systemConfigs = SYSTEM_CONFIG_ORDER
    .filter((key) => Object.prototype.hasOwnProperty.call(sources.systemConfigs, key))
    .map((key) => ({ key, store: sources.systemConfigs[key] }));

  return {
    resetTables: [...RESET_TABLES],
    discardedSources: [
      { source: "users", count: countArray(sources.users.users) },
      { source: "inviteCodes", count: countArray(sources.inviteCodes.codes) },
      { source: "passwordResetTokens", count: countArray(sources.passwordResetTokens.tokens) },
      { source: "versionRecords", count: countArray(sources.versionRecords.records) },
      { source: "team.teams", count: countArray(sources.team.teams) },
      { source: "team.reviews", count: countArray(sources.team.reviews) },
      { source: "team.comments", count: countArray(sources.team.comments) },
      { source: "team.planBindings", count: countArray(sources.team.planBindings) },
      { source: "team.auditLogs", count: countArray(sources.team.auditLogs) },
      { source: "aiSessions", count: countArray(sources.aiSessions.sessions) },
      { source: "traces", count: countArray(sources.traces.traces) },
    ],
    upserts: {
      users: [],
      versionRecords: [],
      versionCodeRules: [...sources.versionCodeRules.rules],
      templates: sources.template ? [sources.template] : [],
      ruleSets: sources.ruleSet ? [sources.ruleSet] : [],
      systemConfigs,
    },
  };
}
