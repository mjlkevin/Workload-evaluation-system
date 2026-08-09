// ============================================================
// SP-2026-007 · MS2（M2 会话记忆分层蒸馏）
// memory.module — 领域 barrel + 默认 repository 单例
// ============================================================

import { createMemoryRepository } from "./memory.repository";

export { createMemoryRouter } from "./memory.controller";
export { createMemoryUsecase } from "./memory.usecase";
export { createMemoryRepository } from "./memory.repository";
export { distillRunMemory } from "./memory.distiller";
export {
  MEMORY_STATUSES,
  MEMORY_SOURCE_TYPES,
  validateDistillOutput,
  validateListMemoryQuery,
  validateMemoryIdsInput,
} from "./memory.types";

export type {
  MemoryStatus,
  MemorySourceType,
  MemoryAtom,
  MemoryScene,
  DistillAtom,
  DistillScene,
  DistillOutput,
  ListMemoryQuery,
  ConfirmMemoryInput,
  ArchiveMemoryInput,
} from "./memory.types";

// MemoryContextBlock 在 usecase 中定义，从这里导出
export type { MemoryContextBlock, MemoryUsecase } from "./memory.usecase";
export type { MemoryRepository } from "./memory.repository";

let defaultRepo: ReturnType<typeof createMemoryRepository> | null = null;

/** 进程内默认 repository 单例（生产路由使用） */
export function getMemoryRepository() {
  if (!defaultRepo) {
    defaultRepo = createMemoryRepository();
  }
  return defaultRepo;
}
