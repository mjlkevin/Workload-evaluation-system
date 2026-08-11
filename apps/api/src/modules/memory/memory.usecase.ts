// ============================================================
// SP-2026-007 · MS2（M2 会话记忆分层蒸馏）
// memory.usecase — 记忆业务逻辑：蒸馏保存、查询、确认/归档
// ============================================================

import type { MemoryRepository } from "./memory.repository";
import type { DistillOutput, ListMemoryQuery, ConfirmMemoryInput, ArchiveMemoryInput, MemoryStatus } from "./memory.types";

export type MemoryUsecaseDeps = {
  repo: MemoryRepository;
};

export type InjectMemoryContextInput = {
  ownerUserId: string;
  projectId: string;
  maxScenes?: number;
  maxAtoms?: number;
};

export type MemoryContextBlock = {
  scenes: { title: string; summary: string }[];
  atoms: { factKey: string; factText: string }[];
};

export function createMemoryUsecase(deps: MemoryUsecaseDeps) {
  const { repo } = deps;

  return {
    async saveDistill(input: {
      ownerUserId: string;
      projectId: string;
      harnessRunId: string;
      distill: DistillOutput;
    }) {
      return await repo.saveDistilledMemory(input);
    },

    async listMemory(query: ListMemoryQuery & { ownerUserId: string }) {
      const { ownerUserId, projectId, status, page, pageSize } = query;
      // DEF-2026-08-11-001：缺 projectId 时返回 owner 全量（面板默认口径），
      // 与 harness 读取侧一致保持 ownerUserId 隔离；显式传 projectId 的调用方行为不变。
      if (!projectId) {
        const result = await repo.listMemoryForOwner({
          ownerUserId,
          status,
          limit: pageSize,
          offset: (page - 1) * pageSize,
        });
        return { ...result, page, pageSize };
      }
      const result = await repo.listMemoryForProject({
        ownerUserId,
        projectId,
        status,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      return { ...result, page, pageSize };
    },

    async confirmAtoms(input: ConfirmMemoryInput & { ownerUserId: string }) {
      const results = await Promise.all(
        input.memoryIds.map((id) => repo.confirmMemoryAtom(id, input.ownerUserId)),
      );
      return { confirmed: results.filter(Boolean).length };
    },

    async confirmScenes(input: ConfirmMemoryInput & { ownerUserId: string }) {
      const results = await Promise.all(
        input.memoryIds.map((id) => repo.confirmMemoryScene(id, input.ownerUserId)),
      );
      return { confirmed: results.filter(Boolean).length };
    },

    async archiveAtoms(input: ArchiveMemoryInput & { ownerUserId: string }) {
      const results = await Promise.all(
        input.memoryIds.map((id) => repo.archiveMemoryAtom(id, input.ownerUserId)),
      );
      return { archived: results.filter(Boolean).length };
    },

    async archiveScenes(input: ArchiveMemoryInput & { ownerUserId: string }) {
      const results = await Promise.all(
        input.memoryIds.map((id) => repo.archiveMemoryScene(id, input.ownerUserId)),
      );
      return { archived: results.filter(Boolean).length };
    },

    /** 为 AI 工作台 system prompt 组装记忆上下文 */
    async buildMemoryContext(input: InjectMemoryContextInput): Promise<MemoryContextBlock> {
      const scenes = await repo.getActiveScenesForProject(input.ownerUserId, input.projectId, input.maxScenes ?? 5);
      const atoms = await repo.getActiveAtomsForProject(input.ownerUserId, input.projectId, input.maxAtoms ?? 10);
      return {
        scenes: scenes.map((s) => ({ title: s.sceneTitle, summary: s.sceneSummary })),
        atoms: atoms.map((a) => ({ factKey: a.factKey, factText: a.factText })),
      };
    },
  };
}

export type MemoryUsecase = ReturnType<typeof createMemoryUsecase>;
