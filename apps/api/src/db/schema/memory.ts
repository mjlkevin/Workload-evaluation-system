// ============================================================
// SP-2026-007 · MS2（M2 会话记忆分层蒸馏）
// memory_atoms（L1 原子事实）与 memory_scenes（L2 场景块）
// ============================================================

import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const memoryAtoms = pgTable(
  "memory_atoms",
  {
    memoryAtomId: uuid("memory_atom_id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    projectId: text("project_id").notNull(),
    harnessRunId: uuid("harness_run_id").notNull(),
    sourceType: text("source_type", { enum: ["distill", "manual"] }).default("distill").notNull(),
    factText: text("fact_text").notNull(),
    factKey: text("fact_key").notNull(),
    confidence: integer("confidence").default(80).notNull(),
    status: text("status", { enum: ["draft", "active", "archived"] }).default("draft").notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => ({
    ownerProjectIdx: index("memory_atoms_owner_project_idx").on(table.ownerUserId, table.projectId),
    runIdx: index("memory_atoms_run_idx").on(table.harnessRunId),
    statusIdx: index("memory_atoms_status_idx").on(table.status),
    projectStatusIdx: index("memory_atoms_project_status_idx").on(table.projectId, table.status),
  }),
);

export const memoryScenes = pgTable(
  "memory_scenes",
  {
    memorySceneId: uuid("memory_scene_id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    projectId: text("project_id").notNull(),
    harnessRunId: uuid("harness_run_id").notNull(),
    sourceType: text("source_type", { enum: ["distill", "manual"] }).default("distill").notNull(),
    sceneTitle: text("scene_title").notNull(),
    sceneSummary: text("scene_summary").notNull(),
    atomIds: jsonb("atom_ids").default([]).notNull(),
    status: text("status", { enum: ["draft", "active", "archived"] }).default("draft").notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => ({
    ownerProjectIdx: index("memory_scenes_owner_project_idx").on(table.ownerUserId, table.projectId),
    runIdx: index("memory_scenes_run_idx").on(table.harnessRunId),
    statusIdx: index("memory_scenes_status_idx").on(table.status),
    projectStatusIdx: index("memory_scenes_project_status_idx").on(table.projectId, table.status),
  }),
);

export type MemoryAtomRow = typeof memoryAtoms.$inferSelect;
export type MemoryAtomInsert = typeof memoryAtoms.$inferInsert;
export type MemorySceneRow = typeof memoryScenes.$inferSelect;
export type MemorySceneInsert = typeof memoryScenes.$inferInsert;
