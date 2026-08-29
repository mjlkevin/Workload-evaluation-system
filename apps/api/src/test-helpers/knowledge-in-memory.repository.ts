// ============================================================
// Knowledge 域测试替身：in-memory 实现 KnowledgeStoreRepository
// ============================================================
// 阶段 2 S6（2026-08-29）：knowledge JSON 仓储类（KnowledgeRepository）删除后，
// 检索编排用例与路由契约用例需要「语料由用例自己给」的仓储实现。本替身用数组
// 承载条目——零 fs、零 DB，不构成生产 JSON 读写路径（AGENTS.md §2 Repository
// 边界：测试替身不得复用被删的存储实现）。
//
// 语义与 PG 实现（knowledge-pg.repository.ts）逐项对齐：归一化补齐
// category/tags/status/时间戳、重复 id 抛「已存在」、空 title/content 抛错、
// 缺行抛「不存在」、archived 不可再改；错误码与消息复用 KnowledgeStoreError，
// 使替身与真库在断言上不可区分（防止「断言存在但断的不是同一件事」）。
//
// 本文件不是 *.test.ts，不进入防漂移守卫的扫描范围（守卫只收测试文件）。
// ============================================================

import { randomUUID } from "node:crypto";

import { KnowledgeStoreError } from "../modules/knowledge/knowledge-pg.repository";
import type { KnowledgeEntry, KnowledgeStatus } from "../modules/knowledge/knowledge.types";
import type {
  CreateEntryInput,
  KnowledgeStoreRepository,
  UpdateEntryPatch,
} from "../modules/knowledge/knowledge.repository";

/** 与 JSON/PG 实现同口径的默认值补齐（存量条目缺 status/category/时间戳即可读）。 */
function normalize(raw: Partial<KnowledgeEntry>, index: number): KnowledgeEntry {
  const now = new Date().toISOString();
  return {
    id: raw.id ?? `k-legacy-${index + 1}`,
    title: raw.title ?? "",
    content: raw.content ?? "",
    category: raw.category ?? "general",
    tags: raw.tags ?? [],
    status: (raw.status as KnowledgeStatus) ?? "active",
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? raw.createdAt ?? now,
  };
}

export interface KnowledgeInMemoryRepository extends KnowledgeStoreRepository {
  /** 追加种子条目（沿用 store.json 的原始结构，缺字段由 normalize 补齐）。 */
  seed(entries: Array<Partial<KnowledgeEntry>>): void;
  /** 当前条行数（仅供用例自查，不参与断言语义）。 */
  size(): number;
}

/**
 * 构造一个内存仓储。
 * @param entries 初始条目（可选），语义等同 store.json 的 entries 数组。
 */
export function createKnowledgeInMemoryRepository(
  entries: Array<Partial<KnowledgeEntry>> = [],
): KnowledgeInMemoryRepository {
  let rows: KnowledgeEntry[] = entries.map((entry, index) => normalize(entry, index));

  const indexOf = (id: string): number => rows.findIndex((entry) => entry.id === id);

  return {
    seed(extra) {
      rows = rows.concat(extra.map((entry, index) => normalize(entry, rows.length + index)));
    },
    size() {
      return rows.length;
    },
    async list() {
      return rows.map((entry) => ({ ...entry }));
    },
    async get(id) {
      const found = rows[indexOf(id)];
      return found ? { ...found } : null;
    },
    async create(input: CreateEntryInput) {
      if (!input.title || !input.title.trim()) {
        throw new KnowledgeStoreError("KNOWLEDGE_ENTRY_INVALID", "Knowledge entry title is required");
      }
      if (!input.content || !input.content.trim()) {
        throw new KnowledgeStoreError("KNOWLEDGE_ENTRY_INVALID", "Knowledge entry content is required");
      }
      const id = input.id?.trim() || `k-${randomUUID().slice(0, 8)}`;
      if (indexOf(id) >= 0) {
        throw new KnowledgeStoreError("KNOWLEDGE_ENTRY_ID_EXISTS", `Knowledge entry id 已存在: ${id}`);
      }
      const created = normalize(
        {
          id,
          title: input.title.trim(),
          content: input.content.trim(),
          category: input.category?.trim() || "general",
          tags: input.tags ?? [],
          status: "active",
        },
        rows.length,
      );
      rows = rows.concat([created]);
      return { ...created };
    },
    async update(id: string, patch: UpdateEntryPatch) {
      const at = indexOf(id);
      if (at < 0) {
        throw new KnowledgeStoreError("KNOWLEDGE_ENTRY_NOT_FOUND", `Knowledge entry 不存在: ${id}`);
      }
      if (rows[at].status === "archived") {
        throw new KnowledgeStoreError(
          "KNOWLEDGE_ENTRY_ARCHIVED",
          `Knowledge entry 已归档，不可修改: ${id}`,
        );
      }
      const updated: KnowledgeEntry = {
        ...rows[at],
        ...(patch.title != null ? { title: patch.title } : {}),
        ...(patch.content != null ? { content: patch.content } : {}),
        ...(patch.category != null ? { category: patch.category } : {}),
        ...(patch.tags != null ? { tags: patch.tags } : {}),
        ...(patch.status != null ? { status: patch.status } : {}),
        updatedAt: new Date().toISOString(),
      };
      rows[at] = updated;
      return { ...updated };
    },
    async archive(id: string) {
      const at = indexOf(id);
      if (at < 0) {
        throw new KnowledgeStoreError("KNOWLEDGE_ENTRY_NOT_FOUND", `Knowledge entry 不存在: ${id}`);
      }
      const archived: KnowledgeEntry = {
        ...rows[at],
        status: "archived",
        updatedAt: new Date().toISOString(),
      };
      rows[at] = archived;
      return { ...archived };
    },
  };
}
