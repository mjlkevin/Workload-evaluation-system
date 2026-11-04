import {
  pgTable,
  text,
  uuid,
  jsonb,
  timestamp,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { harnessRuns } from "./harness";
export const harnessSandboxConnections = pgTable(
  "harness_sandbox_connections",
  {
    id: text("id").primaryKey(),
    configuration: jsonb("configuration").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);
export const harnessSandboxJobs = pgTable(
  "harness_sandbox_jobs",
  {
    id: uuid("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    sessionId: text("session_id").notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => harnessRuns.harnessRunId, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    requestDigest: text("request_digest").notNull(),
    request: jsonb("request").notNull(),
    plan: jsonb("plan").notNull(),
    state: text("state").notNull(),
    sandboxId: text("sandbox_id"),
    cleanup: text("cleanup").notNull().default("none"),
    result: jsonb("result"),
    execution: jsonb("execution").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    call: uniqueIndex("harness_sandbox_job_call").on(t.runId, t.ordinal),
    cleanup: index("harness_sandbox_job_cleanup").on(t.cleanup, t.updatedAt),
  }),
);
export const harnessSandboxArtifacts = pgTable(
  "harness_sandbox_artifacts",
  {
    id: uuid("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => harnessSandboxJobs.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    sessionId: text("session_id").notNull(),
    runId: uuid("run_id").notNull(),
    name: text("name").notNull(),
    title: text("title").notNull(),
    format: text("format").notNull(),
    mimeType: text("mime_type").notNull(),
    sha256: text("sha256").notNull(),
    size: integer("size").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    owner: index("harness_sandbox_artifact_owner").on(t.ownerId, t.expiresAt),
  }),
);
