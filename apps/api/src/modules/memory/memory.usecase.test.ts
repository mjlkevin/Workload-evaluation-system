// ============================================================
// SP-2026-007 · MS2（M2 会话记忆分层蒸馏）
// memory.usecase.test — 记忆 usecase 单元测试
// ============================================================
// 使用 node:test + node:assert，不依赖 vitest

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { createMemoryUsecase } from "./memory.usecase";
import type { MemoryRepository, MemoryListResult } from "./memory.repository";
import type { MemoryAtomRow, MemorySceneRow } from "../../db/schema";

function makeFakeRepo(overrides?: Partial<MemoryRepository>): MemoryRepository {
  const noop = async () => null;
  return {
    saveDistilledMemory: async () => ({ atoms: [] as MemoryAtomRow[], scenes: [] as MemorySceneRow[] }),
    listMemoryForProject: async () => ({ atoms: [], scenes: [], totalAtoms: 0, totalScenes: 0 }) as MemoryListResult,
    confirmMemoryAtom: noop as MemoryRepository["confirmMemoryAtom"],
    confirmMemoryScene: noop as MemoryRepository["confirmMemoryScene"],
    archiveMemoryAtom: noop as MemoryRepository["archiveMemoryAtom"],
    archiveMemoryScene: noop as MemoryRepository["archiveMemoryScene"],
    getActiveScenesForProject: async () => [],
    getActiveAtomsForProject: async () => [],
    ...overrides,
  };
}

describe("memory.usecase", () => {
  const ownerUserId = "user-001";

  test("should save distill through repo", async () => {
    let called = false;
    const repo = makeFakeRepo({
      saveDistilledMemory: async () => {
        called = true;
        return { atoms: [], scenes: [] };
      },
    });
    const usecase = createMemoryUsecase({ repo });

    await usecase.saveDistill({
      ownerUserId,
      projectId: "proj-001",
      harnessRunId: "run-001",
      distill: { atoms: [{ factKey: "a", factText: "b" }], scenes: [] },
    });

    assert.ok(called, "saveDistilledMemory should have been called");
  });

  test("should list memory with pagination", async () => {
    const repo = makeFakeRepo({
      listMemoryForProject: async () => ({
        atoms: [{ memoryAtomId: "a1" } as MemoryAtomRow],
        scenes: [],
        totalAtoms: 1,
        totalScenes: 0,
      }),
    });
    const usecase = createMemoryUsecase({ repo });

    const result = await usecase.listMemory({ ownerUserId, projectId: "proj-001", page: 1, pageSize: 10 });

    assert.equal(result.atoms.length, 1);
    assert.equal(result.totalAtoms, 1);
    assert.equal(result.page, 1);
  });

  test("should return empty when projectId is missing", async () => {
    let called = false;
    const repo = makeFakeRepo({
      listMemoryForProject: async () => {
        called = true;
        return { atoms: [], scenes: [], totalAtoms: 0, totalScenes: 0 };
      },
    });
    const usecase = createMemoryUsecase({ repo });

    const result = await usecase.listMemory({ ownerUserId, page: 1, pageSize: 10 } as any);

    assert.equal(result.atoms.length, 0);
    assert.equal(result.totalAtoms, 0);
    assert.equal(called, false);
  });

  test("should confirm atoms", async () => {
    const repo = makeFakeRepo({
      confirmMemoryAtom: (async (id: string) => ({ memoryAtomId: id, status: "active" } as MemoryAtomRow)) as MemoryRepository["confirmMemoryAtom"],
    });
    const usecase = createMemoryUsecase({ repo });

    const result = await usecase.confirmAtoms({ ownerUserId, memoryIds: ["a1", "a2"] });

    assert.equal(result.confirmed, 2);
  });

  test("should archive scenes", async () => {
    const repo = makeFakeRepo({
      archiveMemoryScene: (async (id: string) => ({ memorySceneId: id, status: "archived" } as MemorySceneRow)) as MemoryRepository["archiveMemoryScene"],
    });
    const usecase = createMemoryUsecase({ repo });

    const result = await usecase.archiveScenes({ ownerUserId, memoryIds: ["s1"] });

    assert.equal(result.archived, 1);
  });

  test("should build memory context", async () => {
    const repo = makeFakeRepo({
      getActiveScenesForProject: async () => [
        { sceneTitle: "场景1", sceneSummary: "摘要1" } as MemorySceneRow,
      ],
      getActiveAtomsForProject: async () => [
        { factKey: "fk1", factText: "ft1" } as MemoryAtomRow,
      ],
    });
    const usecase = createMemoryUsecase({ repo });

    const ctx = await usecase.buildMemoryContext({ ownerUserId, projectId: "proj-001" });

    assert.equal(ctx.scenes.length, 1);
    assert.equal(ctx.scenes[0].title, "场景1");
    assert.equal(ctx.atoms.length, 1);
    assert.equal(ctx.atoms[0].factKey, "fk1");
  });
});
