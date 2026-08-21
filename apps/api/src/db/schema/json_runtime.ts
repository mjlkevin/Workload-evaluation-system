// ============================================================
// JSON runtime replacement tables
// ============================================================
// These tables replace the remaining file-backed JSON stores.

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const inviteCodes = pgTable("invite_codes", {
  code: text("code").primaryKey(),
  status: text("status", { enum: ["active", "used"] }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  usedByUserId: text("used_by_user_id"),
  usedByUsername: text("used_by_username"),
});

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    tokenId: text("token_id").primaryKey(),
    userId: text("user_id").notNull(),
    username: text("username").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    status: text("status", { enum: ["active", "used"] }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (table) => ({
    userIdx: index("password_reset_tokens_user_idx").on(table.userId),
    statusIdx: index("password_reset_tokens_status_idx").on(table.status),
  }),
);

export const versionRecords = pgTable(
  "version_records",
  {
    recordId: text("record_id").primaryKey(),
    type: text("type").notNull(),
    versionCode: text("version_code").notNull(),
    templateId: text("template_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    status: text("status").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdByUsername: text("created_by_username").notNull(),
    updatedByUserId: text("updated_by_user_id").notNull(),
    updatedByUsername: text("updated_by_username").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedByUserId: text("reviewed_by_user_id"),
    checkoutStatus: text("checkout_status").notNull().default("checked_in"),
    versionDocStatus: text("version_doc_status").notNull().default("drafting"),
    checkedOutByUserId: text("checked_out_by_user_id"),
    checkedOutByUsername: text("checked_out_by_username"),
    checkoutAt: timestamp("checkout_at", { withTimezone: true }),
    majorLetter: text("major_letter").notNull().default("A"),
    minorNumber: integer("minor_number").notNull().default(0),
    baseCode: text("base_code").notNull(),
    isHistoricalArchive: boolean("is_historical_archive").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    lastCheckinPayload: jsonb("last_checkin_payload"),
  },
  (table) => ({
    ownerTypeIdx: index("version_records_owner_type_idx").on(table.ownerUserId, table.type),
    ownerCodeIdx: index("version_records_owner_code_idx").on(
      table.ownerUserId,
      table.type,
      table.templateId,
      table.versionCode,
    ),
    updatedIdx: index("version_records_updated_idx").on(table.updatedAt),
  }),
);

export const templates = pgTable("templates", {
  templateId: text("template_id").primaryKey(),
  templateVersion: text("template_version").notNull(),
  templateName: text("template_name").notNull(),
  groups: jsonb("groups").notNull().default([]),
  items: jsonb("items").notNull().default([]),
  sheets: jsonb("sheets").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const ruleSets = pgTable("rule_sets", {
  ruleSetId: text("rule_set_id").primaryKey(),
  ruleVersion: text("rule_version").notNull(),
  pipelineVersion: text("pipeline_version").notNull(),
  pipeline: jsonb("pipeline").notNull().default([]),
  baseRule: jsonb("base_rule").notNull().default({}),
  orgIncrementRule: jsonb("org_increment_rule").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const systemConfigs = pgTable("system_configs", {
  configKey: text("config_key").primaryKey(),
  store: jsonb("store").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).defaultNow().notNull(),
});

export const teams = pgTable("teams", {
  teamId: text("team_id").primaryKey(),
  name: text("name").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: text("team_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.teamId, table.userId] }),
    userIdx: index("team_members_user_idx").on(table.userId),
  }),
);

export const teamReviews = pgTable(
  "team_reviews",
  {
    reviewId: text("review_id").primaryKey(),
    teamId: text("team_id").notNull(),
    globalVersionCode: text("global_version_code").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    teamIdx: index("team_reviews_team_idx").on(table.teamId),
  }),
);

export const teamReviewComments = pgTable(
  "team_review_comments",
  {
    commentId: text("comment_id").primaryKey(),
    reviewId: text("review_id").notNull(),
    authorUserId: text("author_user_id").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    reviewIdx: index("team_review_comments_review_idx").on(table.reviewId),
  }),
);

export const teamPlanBindings = pgTable("team_plan_bindings", {
  globalVersionCode: text("global_version_code").primaryKey(),
  teamId: text("team_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  updatedBy: text("updated_by").notNull(),
});

export const teamAuditLogs = pgTable(
  "team_audit_logs",
  {
    auditId: text("audit_id").primaryKey(),
    teamId: text("team_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    teamIdx: index("team_audit_logs_team_idx").on(table.teamId),
  }),
);

export const aiSessions = pgTable(
  "ai_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    ownerUsername: text("owner_username").notNull(),
    title: text("title").notNull(),
    domain: text("domain").notNull(),
    workflowKey: text("workflow_key").notNull(),
    businessRole: text("business_role").notNull(),
    status: text("status").notNull(),
    summary: text("summary").notNull().default(""),
    messages: jsonb("messages").notNull().default([]),
    attachments: jsonb("attachments").notNull().default([]),
    artifacts: jsonb("artifacts").notNull().default([]),
    pendingActions: jsonb("pending_actions").notNull().default([]),
    linkedRecords: jsonb("linked_records").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => ({
    ownerIdx: index("ai_sessions_owner_idx").on(table.ownerUserId),
    ownerUpdatedIdx: index("ai_sessions_owner_updated_idx").on(table.ownerUserId, table.updatedAt),
  }),
);

export const traces = pgTable(
  "traces",
  {
    traceId: text("trace_id").primaryKey(),
    /** 入站 HTTP 请求关联 ID（JSON 侧 TraceRecord.requestId 同义，批 5 补齐） */
    requestId: text("request_id"),
    sourceDomain: text("source_domain").notNull(),
    sourceId: text("source_id"),
    ownerUserId: text("owner_user_id").notNull(),
    ownerUsername: text("owner_username").notNull(),
    userInputSummary: text("user_input_summary"),
    intentResult: jsonb("intent_result"),
    spans: jsonb("spans").notNull().default([]),
    summary: jsonb("summary").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    ownerIdx: index("traces_owner_idx").on(table.ownerUserId),
    sourceIdx: index("traces_source_idx").on(table.sourceDomain, table.sourceId),
    createdIdx: index("traces_created_idx").on(table.createdAt),
  }),
);

export type VersionRecordRow = typeof versionRecords.$inferSelect;
export type VersionRecordInsert = typeof versionRecords.$inferInsert;
export type TemplateRow = typeof templates.$inferSelect;
export type RuleSetRow = typeof ruleSets.$inferSelect;
export type SystemConfigRow = typeof systemConfigs.$inferSelect;
