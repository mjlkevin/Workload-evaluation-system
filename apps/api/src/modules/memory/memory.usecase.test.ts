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
    listMemoryForOwner: async () => ({ atoms: [], scenes: [], totalAtoms: 0, totalScenes: 0 }) as MemoryListResult,
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

  // DEF-2026-08-11-001：缺 projectId 时面板恒空 —— 改为 owner 全量口径
  // （ownerUserId 隔离不变；projectId 仍为可选收窄过滤，显式传 projectId 的调用方行为不变）
  test("should list owner-wide memory when projectId is missing", async () => {
    let ownerCalled = false;
    let projectCalled = false;
    const repo = makeFakeRepo({
      listMemoryForOwner: async (input) => {
        ownerCalled = true;
        assert.equal(input.ownerUserId, ownerUserId);
        return {
          atoms: [{ memoryAtomId: "a1" } as MemoryAtomRow, { memoryAtomId: "a2" } as MemoryAtomRow],
          scenes: [{ memorySceneId: "s1" } as MemorySceneRow],
          totalAtoms: 2,
          totalScenes: 1,
        };
      },
      listMemoryForProject: async () => {
        projectCalled = true;
        return { atoms: [], scenes: [], totalAtoms: 0, totalScenes: 0 };
      },
    });
    const usecase = createMemoryUsecase({ repo });

    const result = await usecase.listMemory({ ownerUserId, page: 1, pageSize: 10 } as any);

    assert.equal(ownerCalled, true, "缺 projectId 时应走 owner 全量查询");
    assert.equal(projectCalled, false, "缺 projectId 时不应走项目过滤查询");
    assert.equal(result.atoms.length, 2);
    assert.equal(result.scenes.length, 1);
    assert.equal(result.totalAtoms, 2);
    assert.equal(result.totalScenes, 1);
  });

  test("should pass status filter through on owner-wide listing", async () => {
    let seenStatus: string | undefined;
    const repo = makeFakeRepo({
      listMemoryForOwner: async (input) => {
        seenStatus = input.status;
        return { atoms: [], scenes: [], totalAtoms: 0, totalScenes: 0 };
      },
    });
    const usecase = createMemoryUsecase({ repo });

    await usecase.listMemory({ ownerUserId, status: "draft", page: 1, pageSize: 10 } as any);

    assert.equal(seenStatus, "draft", "owner 全量查询应透传 status 过滤");
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
