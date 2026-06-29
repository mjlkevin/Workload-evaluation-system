// ============================================================
// Harness 核心表
// ============================================================
// WES Harness Phase 1A：记录 Agent 工作流运行、证据、产物、工具事件、
// 模型运行轨迹、评分与回归样本。按设计草案，Harness 作为新业务域进入
// PostgreSQL 主存储，传统 WES JSON 存储暂不迁移。

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const harnessRuns = pgTable(
  "harness_runs",
  {
    harnessRunId: uuid("harness_run_id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    ownerUsername: text("owner_username").notNull(),
    mode: text("mode", { enum: ["interactive", "replay", "regression"] }).notNull(),
    stage: text("stage").notNull(),
    status: text("status", { enum: ["running", "waiting", "completed", "failed", "cancelled"] }).notNull(),
    title: text("title").notNull(),
    aiSessionId: text("ai_session_id"),
    projectEvaluationId: text("project_evaluation_id"),
    requirementVersionId: text("requirement_version_id"),
    originalStandardSetVersion: text("original_standard_set_version"),
    replayStandardSetVersion: text("replay_standard_set_version"),
    promptProfileId: text("prompt_profile_id"),
    promptVersion: text("prompt_version"),
    forceReanalysis: boolean("force_reanalysis").default(false).notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    ownerIdx: index("harness_runs_owner_idx").on(table.ownerUserId),
    sessionIdx: index("harness_runs_ai_session_idx").on(table.aiSessionId),
    statusIdx: index("harness_runs_status_idx").on(table.status, table.stage),
    createdIdx: index("harness_runs_created_idx").on(table.createdAt),
  }),
);

export const harnessFiles = pgTable(
  "harness_files",
  {
    harnessFileId: uuid("harness_file_id").primaryKey(),
    harnessRunId: uuid("harness_run_id").notNull().references(() => harnessRuns.harnessRunId, { onDelete: "cascade" }),
    attachmentId: text("attachment_id").notNull(),
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size"),
    mimeType: text("mime_type"),
    fileHash: text("file_hash"),
    storagePath: text("storage_path"),
    role: text("role"),
    roleConfidence: real("role_confidence"),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runIdx: index("harness_files_run_idx").on(table.harnessRunId),
    attachmentIdx: index("harness_files_attachment_idx").on(table.attachmentId),
  }),
);

export const harnessEvidences = pgTable(
  "harness_evidences",
  {
    harnessEvidenceId: uuid("harness_evidence_id").primaryKey(),
    harnessRunId: uuid("harness_run_id").references(() => harnessRuns.harnessRunId, { onDelete: "cascade" }),
    harnessFileId: uuid("harness_file_id").references(() => harnessFiles.harnessFileId, { onDelete: "cascade" }),
    sourceType: text("source_type", { enum: ["attachment", "standard_file"] }).notNull(),
    sourceId: text("source_id").notNull(),
    evidenceType: text("evidence_type", { enum: ["block", "item"] }).notNull(),
    businessTags: jsonb("business_tags").default([]).notNull(),
    locator: jsonb("locator").default({}).notNull(),
    textSnapshot: text("text_snapshot"),
    tableSnapshot: jsonb("table_snapshot"),
    parserVersion: text("parser_version").notNull(),
    fileHash: text("file_hash"),
    confidence: real("confidence"),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runIdx: index("harness_evidences_run_idx").on(table.harnessRunId),
    fileIdx: index("harness_evidences_file_idx").on(table.harnessFileId),
    sourceIdx: index("harness_evidences_source_idx").on(table.sourceType, table.sourceId),
    runSourceIdx: index("harness_evidences_run_source_idx").on(table.harnessRunId, table.sourceType),
  }),
);

export const harnessToolEvents = pgTable(
  "harness_tool_events",
  {
    harnessToolEventId: uuid("harness_tool_event_id").primaryKey(),
    harnessRunId: uuid("harness_run_id").notNull().references(() => harnessRuns.harnessRunId, { onDelete: "cascade" }),
    actionId: text("action_id"),
    toolName: text("tool_name").notNull(),
    eventType: text("event_type").notNull(),
    status: text("status").notNull(),
    riskLevel: text("risk_level"),
    input: jsonb("input").default({}).notNull(),
    output: jsonb("output"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => ({
    runIdx: index("harness_tool_events_run_idx").on(table.harnessRunId),
    actionIdx: index("harness_tool_events_action_idx").on(table.actionId),
    runActionIdx: index("harness_tool_events_run_action_idx").on(table.harnessRunId, table.actionId),
  }),
);

export const harnessModelRuns = pgTable(
  "harness_model_runs",
  {
    harnessModelRunId: uuid("harness_model_run_id").primaryKey(),
    harnessRunId: uuid("harness_run_id").notNull().references(() => harnessRuns.harnessRunId, { onDelete: "cascade" }),
    toolEventId: uuid("tool_event_id").references(() => harnessToolEvents.harnessToolEventId, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    mode: text("mode", { enum: ["model", "rule_fallback", "cached"] }).notNull(),
    promptProfileId: text("prompt_profile_id"),
    promptVersion: text("prompt_version"),
    evidenceIds: jsonb("evidence_ids").default([]).notNull(),
    inputTokenEstimate: integer("input_token_estimate"),
    outputTokenEstimate: integer("output_token_estimate"),
    rawContentHash: text("raw_content_hash"),
    rawContentSummary: text("raw_content_summary"),
    elapsedMs: integer("elapsed_ms"),
    fallbackReason: text("fallback_reason"),
    schemaValidationErrors: jsonb("schema_validation_errors").default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runIdx: index("harness_model_runs_run_idx").on(table.harnessRunId),
    modelIdx: index("harness_model_runs_model_idx").on(table.provider, table.model),
    runProviderIdx: index("harness_model_runs_run_provider_idx").on(table.harnessRunId, table.provider),
  }),
);

export const harnessArtifacts = pgTable(
  "harness_artifacts",
  {
    harnessArtifactId: uuid("harness_artifact_id").primaryKey(),
    harnessRunId: uuid("harness_run_id").notNull().references(() => harnessRuns.harnessRunId, { onDelete: "cascade" }),
    artifactType: text("artifact_type").notNull(),
    title: text("title").notNull(),
    version: text("version").notNull(),
    status: text("status").notNull(),
    content: jsonb("content").notNull(),
    evidenceIds: jsonb("evidence_ids").default([]).notNull(),
    modelRunId: uuid("model_run_id").references(() => harnessModelRuns.harnessModelRunId, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runIdx: index("harness_artifacts_run_idx").on(table.harnessRunId),
    typeIdx: index("harness_artifacts_type_idx").on(table.artifactType),
    runTypeIdx: index("harness_artifacts_run_type_idx").on(table.harnessRunId, table.artifactType),
  }),
);

export const harnessScores = pgTable(
  "harness_scores",
  {
    harnessScoreId: uuid("harness_score_id").primaryKey(),
    harnessRunId: uuid("harness_run_id").notNull().references(() => harnessRuns.harnessRunId, { onDelete: "cascade" }),
    caseId: text("case_id"),
    scoreType: text("score_type").notNull(),
    value: real("value").notNull(),
    passed: boolean("passed").notNull(),
    details: jsonb("details").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runIdx: index("harness_scores_run_idx").on(table.harnessRunId),
    caseIdx: index("harness_scores_case_idx").on(table.caseId),
  }),
);

export const harnessCases = pgTable(
  "harness_cases",
  {
    harnessCaseId: uuid("harness_case_id").primaryKey(),
    caseKey: text("case_key").notNull(),
    title: text("title").notNull(),
    sampleType: text("sample_type").notNull(),
    fileRefs: jsonb("file_refs").default([]).notNull(),
    active: boolean("active").default(true).notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    keyIdx: index("harness_cases_key_idx").on(table.caseKey),
    activeIdx: index("harness_cases_active_idx").on(table.active),
  }),
);

export const harnessExpectedAnswers = pgTable(
  "harness_expected_answers",
  {
    harnessExpectedAnswerId: uuid("harness_expected_answer_id").primaryKey(),
    harnessCaseId: uuid("harness_case_id").notNull().references(() => harnessCases.harnessCaseId, { onDelete: "cascade" }),
    granularity: text("granularity", { enum: ["report", "requirement_item"] }).notNull(),
    expected: jsonb("expected").notNull(),
    version: text("version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    caseIdx: index("harness_expected_answers_case_idx").on(table.harnessCaseId),
  }),
);

export const harnessManualTestResults = pgTable(
  "harness_manual_test_results",
  {
    manualTestResultId: uuid("manual_test_result_id").primaryKey(),
    harnessRunId: uuid("harness_run_id").references(() => harnessRuns.harnessRunId, { onDelete: "set null" }),
    harnessToolEventId: uuid("harness_tool_event_id"),
    testCaseKey: text("test_case_key"),
    executorName: text("executor_name").notNull(),
    environment: text("environment").notNull(),
    account: text("account"),
    screenshotUrl: text("screenshot_url"),
    resultStatus: text("result_status", { enum: ["passed", "failed", "blocked", "skipped"] }).notNull(),
    notes: text("notes"),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runIdx: index("harness_mtr_run_idx").on(table.harnessRunId),
    statusIdx: index("harness_mtr_status_idx").on(table.resultStatus),
    caseKeyIdx: index("harness_mtr_case_key_idx").on(table.testCaseKey),
  }),
);

export type HarnessRunRow = typeof harnessRuns.$inferSelect;
export type HarnessRunInsert = typeof harnessRuns.$inferInsert;
export type HarnessFileRow = typeof harnessFiles.$inferSelect;
export type HarnessFileInsert = typeof harnessFiles.$inferInsert;
export type HarnessEvidenceRow = typeof harnessEvidences.$inferSelect;
export type HarnessEvidenceInsert = typeof harnessEvidences.$inferInsert;
export type HarnessArtifactRow = typeof harnessArtifacts.$inferSelect;
export type HarnessArtifactInsert = typeof harnessArtifacts.$inferInsert;
export type HarnessToolEventRow = typeof harnessToolEvents.$inferSelect;
export type HarnessToolEventInsert = typeof harnessToolEvents.$inferInsert;
export type HarnessModelRunRow = typeof harnessModelRuns.$inferSelect;
export type HarnessModelRunInsert = typeof harnessModelRuns.$inferInsert;
export type HarnessScoreRow = typeof harnessScores.$inferSelect;
export type HarnessScoreInsert = typeof harnessScores.$inferInsert;
export type HarnessCaseRow = typeof harnessCases.$inferSelect;
export type HarnessCaseInsert = typeof harnessCases.$inferInsert;
export type HarnessExpectedAnswerRow = typeof harnessExpectedAnswers.$inferSelect;
export type HarnessExpectedAnswerInsert = typeof harnessExpectedAnswers.$inferInsert;
export type HarnessManualTestResultRow = typeof harnessManualTestResults.$inferSelect;
export type HarnessManualTestResultInsert = typeof harnessManualTestResults.$inferInsert;
