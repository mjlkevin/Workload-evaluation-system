// ============================================================
// SP-2026-007 · MS1（M1 中文混合检索基线）
// knowledge.repository — 仓储契约（接口 + 输入/补丁类型）
// ============================================================
// 阶段 2 S6（2026-08-29）终态：JSON 文件实现类（KnowledgeRepository）与其
// private load/save 已删除，本文件收敛为**纯契约文件**——只保留 JSON / PG
// 双实现共用的接口与类型，实现唯一为 knowledge-pg.repository.ts，
// 装配点在 knowledge.module.ts 的选择器（S6 后恒 PG，无开关分流）。
//
// 为什么不把接口挪进 knowledge.types.ts：批 9 指令要求「类接口保持不变、
// 装配点不变」，controller / usecase / routes / pg 实现四处 import 路径一律
// 不动，删除面最小、可单独 revert。
//
// 源文件 config/knowledge/store.json 保留不删：它仍是 db/seed.ts 的播种来源
// （seed.ts:173），且 seed.guards.test.ts:71 显式断言其必须在仓内——
// 与 templates / rule_sets 的 seed 源文件同口径（台账 §10 P2 更正）。
// ============================================================

import type { KnowledgeEntry } from "./knowledge.types";

export interface CreateEntryInput {
  id?: string;
  title: string;
  content: string;
  category?: string;
  tags?: string[];
}

/** 更新补丁可覆盖的字段集 */
export type UpdateEntryPatch = Partial<
  Pick<KnowledgeEntry, "title" | "content" | "category" | "tags" | "status">
>;

/**
 * 仓储接口（阶段 2 批 9 从 JSON 类公开方法提取，签名逐字不变）。
 * 实现方：knowledge-pg.repository.ts（生产唯一实现）+
 * test-helpers/knowledge-in-memory.repository.ts（检索/路由用例替身）。
 */
export interface KnowledgeStoreRepository {
  list(): Promise<KnowledgeEntry[]>;
  get(id: string): Promise<KnowledgeEntry | null>;
  create(input: CreateEntryInput): Promise<KnowledgeEntry>;
  update(id: string, patch: UpdateEntryPatch): Promise<KnowledgeEntry>;
  archive(id: string): Promise<KnowledgeEntry>;
}
