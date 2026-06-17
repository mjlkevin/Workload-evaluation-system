// ============================================================
// Harness Repository
// ============================================================
// 纯数据访问层：基于 Drizzle 提供 HarnessRun、文件、产物、工具事件、
// 模型运行等表的读写函数。本层不包含请求/鉴权/业务状态机逻辑。

import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";

import { db, type Database } from "../../db/client";
import {
  harnessArtifacts,
  harnessFiles,
  harnessModelRuns,
  harnessRuns,
  harnessToolEvents,
  type HarnessArtifactInsert,
  type HarnessArtifactRow,
  type HarnessFileInsert,
  type HarnessFileRow,
  type HarnessModelRunInsert,
  type HarnessModelRunRow,
  type HarnessRunInsert,
  type HarnessRunRow,
  type HarnessToolEventInsert,
  type HarnessToolEventRow,
} from "../../db/schema";
import type { HarnessRunStage, HarnessRunStatus } from "./harness.types";

export interface CreateHarnessRunRecordInput {
  ownerUserId: string;
  ownerUsername: string;
  mode: "interactive" | "replay" | "regression";
  stage: HarnessRunStage;
  status: HarnessRunStatus;
  title: string;
  aiSessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface HarnessRepository {
  createRun(input: CreateHarnessRunRecordInput): Promise<HarnessRunRow>;
  findRunById(id: string): Promise<HarnessRunRow | null>;
  listRunsForOwner(ownerUserId: string, opts?: { limit?: number; offset?: number }): Promise<HarnessRunRow[]>;
  updateRun(id: string, patch: Partial<HarnessRunInsert>): Promise<HarnessRunRow | null>;
  addFile(input: Omit<HarnessFileInsert, "harnessFileId" | "createdAt">): Promise<HarnessFileRow>;
  listFiles(runId: string): Promise<HarnessFileRow[]>;
  addArtifact(input: Omit<HarnessArtifactInsert, "harnessArtifactId" | "createdAt" | "updatedAt">): Promise<HarnessArtifactRow>;
  listArtifacts(runId: string): Promise<HarnessArtifactRow[]>;
  addToolEvent(input: Omit<HarnessToolEventInsert, "harnessToolEventId" | "createdAt">): Promise<HarnessToolEventRow>;
  listToolEvents(runId: string): Promise<HarnessToolEventRow[]>;
  addModelRun(input: Omit<HarnessModelRunInsert, "harnessModelRunId" | "createdAt">): Promise<HarnessModelRunRow>;
  listModelRuns(runId: string): Promise<HarnessModelRunRow[]>;
}

export function createHarnessRepository(dbInstance: Database = db): HarnessRepository {
  return {
    createRun: (input) => createHarnessRunRecord(input, dbInstance),
    findRunById: (id) => findHarnessRunById(id, dbInstance),
    listRunsForOwner: (ownerUserId, opts) => listHarnessRunsForOwner(ownerUserId, opts, dbInstance),
    updateRun: (id, patch) => updateHarnessRunRecord(id, patch, dbInstance),
    addFile: (input) => addHarnessFileRecord(input, dbInstance),
    listFiles: (runId) => listHarnessFiles(runId, dbInstance),
    addArtifact: (input) => addHarnessArtifactRecord(input, dbInstance),
    listArtifacts: (runId) => listHarnessArtifacts(runId, dbInstance),
    addToolEvent: (input) => addHarnessToolEventRecord(input, dbInstance),
    listToolEvents: (runId) => listHarnessToolEvents(runId, dbInstance),
    addModelRun: (input) => addHarnessModelRunRecord(input, dbInstance),
    listModelRuns: (runId) => listHarnessModelRuns(runId, dbInstance),
  };
}

export function createHarnessRunRecord(input: CreateHarnessRunRecordInput, dbInstance: Database = db): Promise<HarnessRunRow> {
  const now = new Date();
  return dbInstance
    .insert(harnessRuns)
    .values({
      harnessRunId: randomUUID(),
      ownerUserId: input.ownerUserId,
      ownerUsername: input.ownerUsername,
      mode: input.mode,
      stage: input.stage,
      status: input.status,
      title: input.title,
      aiSessionId: input.aiSessionId ?? null,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    } as HarnessRunInsert)
    .returning()
    .then((rows) => rows[0]);
}

export function findHarnessRunById(id: string, dbInstance: Database = db): Promise<HarnessRunRow | null> {
  return dbInstance
    .select()
    .from(harnessRuns)
    .where(eq(harnessRuns.harnessRunId, id))
    .then((rows) => rows[0] ?? null);
}

export function listHarnessRunsForOwner(
  ownerUserId: string,
  opts: { limit?: number; offset?: number } = {},
  dbInstance: Database = db,
): Promise<HarnessRunRow[]> {
  const limit = Math.max(1, Math.min(100, opts.limit ?? 20));
  const offset = Math.max(0, opts.offset ?? 0);
  return dbInstance
    .select()
    .from(harnessRuns)
    .where(eq(harnessRuns.ownerUserId, ownerUserId))
    .orderBy(desc(harnessRuns.createdAt))
    .limit(limit)
    .offset(offset);
}

export function updateHarnessRunRecord(
  id: string,
  patch: Partial<HarnessRunInsert>,
  dbInstance: Database = db,
): Promise<HarnessRunRow | null> {
  return dbInstance
    .update(harnessRuns)
    .set({ ...patch, updatedAt: new Date() } as Partial<HarnessRunInsert>)
    .where(eq(harnessRuns.harnessRunId, id))
    .returning()
    .then((rows) => rows[0] ?? null);
}

export function addHarnessFileRecord(
  input: Omit<HarnessFileInsert, "harnessFileId" | "createdAt">,
  dbInstance: Database = db,
): Promise<HarnessFileRow> {
  return dbInstance.insert(harnessFiles).values({ ...input, harnessFileId: randomUUID() } as HarnessFileInsert).returning().then((rows) => rows[0]);
}

export function listHarnessFiles(runId: string, dbInstance: Database = db): Promise<HarnessFileRow[]> {
  return dbInstance.select().from(harnessFiles).where(eq(harnessFiles.harnessRunId, runId));
}

export function addHarnessArtifactRecord(
  input: Omit<HarnessArtifactInsert, "harnessArtifactId" | "createdAt" | "updatedAt">,
  dbInstance: Database = db,
): Promise<HarnessArtifactRow> {
  const now = new Date();
  return dbInstance.insert(harnessArtifacts).values({ ...input, harnessArtifactId: randomUUID(), createdAt: now, updatedAt: now } as HarnessArtifactInsert).returning().then((rows) => rows[0]);
}

export function listHarnessArtifacts(runId: string, dbInstance: Database = db): Promise<HarnessArtifactRow[]> {
  return dbInstance.select().from(harnessArtifacts).where(eq(harnessArtifacts.harnessRunId, runId));
}

export function addHarnessToolEventRecord(
  input: Omit<HarnessToolEventInsert, "harnessToolEventId" | "createdAt">,
  dbInstance: Database = db,
): Promise<HarnessToolEventRow> {
  return dbInstance.insert(harnessToolEvents).values({ ...input, harnessToolEventId: randomUUID() } as HarnessToolEventInsert).returning().then((rows) => rows[0]);
}

export function listHarnessToolEvents(runId: string, dbInstance: Database = db): Promise<HarnessToolEventRow[]> {
  return dbInstance.select().from(harnessToolEvents).where(eq(harnessToolEvents.harnessRunId, runId));
}

export function addHarnessModelRunRecord(
  input: Omit<HarnessModelRunInsert, "harnessModelRunId" | "createdAt">,
  dbInstance: Database = db,
): Promise<HarnessModelRunRow> {
  return dbInstance.insert(harnessModelRuns).values({ ...input, harnessModelRunId: randomUUID() } as HarnessModelRunInsert).returning().then((rows) => rows[0]);
}

export function listHarnessModelRuns(runId: string, dbInstance: Database = db): Promise<HarnessModelRunRow[]> {
  return dbInstance.select().from(harnessModelRuns).where(eq(harnessModelRuns.harnessRunId, runId));
}
