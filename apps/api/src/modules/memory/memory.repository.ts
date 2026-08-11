// ============================================================
// SP-2026-007 · MS2（M2 会话记忆分层蒸馏）
// memory.repository — 原子事实与场景块持久化
// ============================================================

import { randomUUID } from "node:crypto";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import { memoryAtoms, memoryScenes, type MemoryAtomRow, type MemorySceneRow } from "../../db/schema";
import type { DistillOutput, MemoryStatus } from "./memory.types";

export type SaveDistilledMemoryInput = {
  ownerUserId: string;
  projectId: string;
  harnessRunId: string;
  distill: DistillOutput;
};

export type ListMemoryForProjectInput = {
  ownerUserId: string;
  projectId: string;
  status?: MemoryStatus;
  limit?: number;
  offset?: number;
};

/** DEF-2026-08-11-001：owner 全量读取（记忆管理面板默认口径）；ownerUserId 隔离不变 */
export type ListMemoryForOwnerInput = {
  ownerUserId: string;
  status?: MemoryStatus;
  limit?: number;
  offset?: number;
};

export type MemoryListResult = {
  atoms: MemoryAtomRow[];
  scenes: MemorySceneRow[];
  totalAtoms: number;
  totalScenes: number;
};

export interface MemoryRepository {
  saveDistilledMemory(input: SaveDistilledMemoryInput): Promise<{ atoms: MemoryAtomRow[]; scenes: MemorySceneRow[] }>;
  listMemoryForProject(input: ListMemoryForProjectInput): Promise<MemoryListResult>;
  listMemoryForOwner(input: ListMemoryForOwnerInput): Promise<MemoryListResult>;
  confirmMemoryAtom(atomId: string, ownerUserId: string): Promise<MemoryAtomRow | null>;
  confirmMemoryScene(sceneId: string, ownerUserId: string): Promise<MemorySceneRow | null>;
  archiveMemoryAtom(atomId: string, ownerUserId: string): Promise<MemoryAtomRow | null>;
  archiveMemoryScene(sceneId: string, ownerUserId: string): Promise<MemorySceneRow | null>;
  getActiveScenesForProject(ownerUserId: string, projectId: string, limit?: number): Promise<MemorySceneRow[]>;
  getActiveAtomsForProject(ownerUserId: string, projectId: string, limit?: number): Promise<MemoryAtomRow[]>;
}

export function createMemoryRepository(dbInstance: Database = db): MemoryRepository {
  // listMemoryForProject / listMemoryForOwner 共用实现：projectId 缺省时仅按 owner 过滤
  async function listMemory(input: { ownerUserId: string; projectId?: string; status?: MemoryStatus; limit?: number; offset?: number }): Promise<MemoryListResult> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const offset = Math.max(input.offset ?? 0, 0);
    const baseWhere: SQL[] = [eq(memoryAtoms.ownerUserId, input.ownerUserId)];
    if (input.projectId) {
      baseWhere.push(eq(memoryAtoms.projectId, input.projectId));
    }
    if (input.status) {
      baseWhere.push(eq(memoryAtoms.status, input.status));
    }

    const atoms = await dbInstance
      .select()
      .from(memoryAtoms)
      .where(and(...baseWhere))
      .orderBy(desc(memoryAtoms.createdAt))
      .limit(limit)
      .offset(offset);

    const atomCountResult = await dbInstance
      .select({ count: sql<number>`count(*)::int` })
      .from(memoryAtoms)
      .where(and(...baseWhere));
    const totalAtoms = Number(atomCountResult[0]?.count ?? 0);

    const sceneWhere: SQL[] = [eq(memoryScenes.ownerUserId, input.ownerUserId)];
    if (input.projectId) {
      sceneWhere.push(eq(memoryScenes.projectId, input.projectId));
    }
    if (input.status) {
      sceneWhere.push(eq(memoryScenes.status, input.status));
    }

    const scenes = await dbInstance
      .select()
      .from(memoryScenes)
      .where(and(...sceneWhere))
      .orderBy(desc(memoryScenes.createdAt))
      .limit(limit)
      .offset(offset);

    const sceneCountResult = await dbInstance
      .select({ count: sql<number>`count(*)::int` })
      .from(memoryScenes)
      .where(and(...sceneWhere));
    const totalScenes = Number(sceneCountResult[0]?.count ?? 0);

    return {
      atoms,
      scenes,
      totalAtoms,
      totalScenes,
    };
  }

  return {
    async saveDistilledMemory(input: SaveDistilledMemoryInput): Promise<{ atoms: MemoryAtomRow[]; scenes: MemorySceneRow[] }> {
      return await dbInstance.transaction(async (tx) => {
        const now = new Date();
        const atomRows: MemoryAtomRow[] = [];
        const atomKeyToId = new Map<string, string>();

        for (const atom of input.distill.atoms) {
          const atomId = randomUUID();
          atomKeyToId.set(atom.factKey, atomId);
          const [row] = await tx
            .insert(memoryAtoms)
            .values({
              memoryAtomId: atomId,
              ownerUserId: input.ownerUserId,
              projectId: input.projectId,
              harnessRunId: input.harnessRunId,
              sourceType: "distill",
              factText: atom.factText,
              factKey: atom.factKey,
              confidence: atom.confidence ?? 80,
              status: "draft",
              metadata: {},
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          atomRows.push(row);
        }

        const sceneRows: MemorySceneRow[] = [];
        for (const scene of input.distill.scenes) {
          const sceneAtomIds = scene.atomKeys
            .map((key) => atomKeyToId.get(key))
            .filter((id): id is string => Boolean(id));

          const [row] = await tx
            .insert(memoryScenes)
            .values({
              memorySceneId: randomUUID(),
              ownerUserId: input.ownerUserId,
              projectId: input.projectId,
              harnessRunId: input.harnessRunId,
              sourceType: "distill",
              sceneTitle: scene.sceneTitle,
              sceneSummary: scene.sceneSummary,
              atomIds: sceneAtomIds,
              status: "draft",
              metadata: {},
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          sceneRows.push(row);
        }

        return { atoms: atomRows, scenes: sceneRows };
      });
    },

    async listMemoryForProject(input: ListMemoryForProjectInput): Promise<MemoryListResult> {
      return await listMemory(input);
    },

    async listMemoryForOwner(input: ListMemoryForOwnerInput): Promise<MemoryListResult> {
      return await listMemory(input);
    },

    async confirmMemoryAtom(atomId: string, ownerUserId: string): Promise<MemoryAtomRow | null> {
      const now = new Date();
      const [updated] = await dbInstance
        .update(memoryAtoms)
        .set({ status: "active", confirmedAt: now, updatedAt: now })
        .where(and(eq(memoryAtoms.memoryAtomId, atomId), eq(memoryAtoms.ownerUserId, ownerUserId)))
        .returning();
      return updated ?? null;
    },

    async confirmMemoryScene(sceneId: string, ownerUserId: string): Promise<MemorySceneRow | null> {
      const now = new Date();
      const [updated] = await dbInstance
        .update(memoryScenes)
        .set({ status: "active", confirmedAt: now, updatedAt: now })
        .where(and(eq(memoryScenes.memorySceneId, sceneId), eq(memoryScenes.ownerUserId, ownerUserId)))
        .returning();
      return updated ?? null;
    },

    async archiveMemoryAtom(atomId: string, ownerUserId: string): Promise<MemoryAtomRow | null> {
      const now = new Date();
      const [updated] = await dbInstance
        .update(memoryAtoms)
        .set({ status: "archived", archivedAt: now, updatedAt: now })
        .where(and(eq(memoryAtoms.memoryAtomId, atomId), eq(memoryAtoms.ownerUserId, ownerUserId)))
        .returning();
      return updated ?? null;
    },

    async archiveMemoryScene(sceneId: string, ownerUserId: string): Promise<MemorySceneRow | null> {
      const now = new Date();
      const [updated] = await dbInstance
        .update(memoryScenes)
        .set({ status: "archived", archivedAt: now, updatedAt: now })
        .where(and(eq(memoryScenes.memorySceneId, sceneId), eq(memoryScenes.ownerUserId, ownerUserId)))
        .returning();
      return updated ?? null;
    },

    async getActiveScenesForProject(ownerUserId: string, projectId: string, limit = 10): Promise<MemorySceneRow[]> {
      return await dbInstance
        .select()
        .from(memoryScenes)
        .where(
          and(
            eq(memoryScenes.ownerUserId, ownerUserId),
            eq(memoryScenes.projectId, projectId),
            eq(memoryScenes.status, "active"),
          ),
        )
        .orderBy(desc(memoryScenes.createdAt))
        .limit(limit);
    },

    async getActiveAtomsForProject(ownerUserId: string, projectId: string, limit = 20): Promise<MemoryAtomRow[]> {
      return await dbInstance
        .select()
        .from(memoryAtoms)
        .where(
          and(
            eq(memoryAtoms.ownerUserId, ownerUserId),
            eq(memoryAtoms.projectId, projectId),
            eq(memoryAtoms.status, "active"),
          ),
        )
        .orderBy(desc(memoryAtoms.confidence), desc(memoryAtoms.createdAt))
        .limit(limit);
    },
  };
}
