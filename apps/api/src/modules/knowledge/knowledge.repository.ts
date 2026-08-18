// ============================================================
// SP-2026-007 · MS1（M1 中文混合检索基线）
// knowledge.repository — JSON 文件存储（config/knowledge/store.json）
// 业务层不直接依赖 JSON 结构（AGENTS.md §2 Repository 边界）；
// 存量记录缺字段时默认值补齐，零人工迁移
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { resolveRootDir } from "../../utils/file";
import type { KnowledgeEntry, KnowledgeStatus } from "./knowledge.types";

export const DEFAULT_STORE_RELATIVE = "config/knowledge/store.json";

interface KnowledgeStore {
  version?: string;
  description?: string;
  entries: Array<Partial<KnowledgeEntry>>;
}

export interface CreateEntryInput {
  id?: string;
  title: string;
  content: string;
  category?: string;
  tags?: string[];
}

export class KnowledgeRepository {
  private readonly storePath: string;

  constructor(storePath?: string) {
    this.storePath = storePath ?? path.resolve(resolveRootDir(), DEFAULT_STORE_RELATIVE);
  }

  /** 阶段 1 批 7：签名改 async，实现不动（仍为 readFileSync），阶段 2 替换实现。 */
  async list(): Promise<KnowledgeEntry[]> {
    const store = this.load();
    return store.entries.map((entry, index) => this.normalize(entry, index));
  }

  /** 阶段 1 批 7：签名改 async（含内部 list 级联），实现不动，阶段 2 替换实现。 */
  async get(id: string): Promise<KnowledgeEntry | null> {
    return (await this.list()).find((entry) => entry.id === id) ?? null;
  }

  /** 阶段 1 批 7：签名改 async，实现不动（仍为 readFileSync/writeFileSync），阶段 2 替换实现。 */
  async create(input: CreateEntryInput): Promise<KnowledgeEntry> {
    if (!input.title || !input.title.trim()) {
      throw new Error("Knowledge entry title is required");
    }
    if (!input.content || !input.content.trim()) {
      throw new Error("Knowledge entry content is required");
    }
    const store = this.load();
    const now = new Date().toISOString();
    const id = input.id?.trim() || `k-${randomUUID().slice(0, 8)}`;
    if (store.entries.some((entry) => entry.id === id)) {
      throw new Error(`Knowledge entry id 已存在: ${id}`);
    }
    const entry: KnowledgeEntry = {
      id,
      title: input.title.trim(),
      content: input.content.trim(),
      category: input.category?.trim() || "general",
      tags: input.tags ?? [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    store.entries.push(entry);
    this.save(store);
    return entry;
  }

  /** 阶段 1 批 7：签名改 async，实现不动（仍为 readFileSync/writeFileSync），阶段 2 替换实现。 */
  async update(id: string, patch: Partial<Pick<KnowledgeEntry, "title" | "content" | "category" | "tags" | "status">>): Promise<KnowledgeEntry> {
    const store = this.load();
    const raw = store.entries.find((entry) => entry.id === id);
    if (!raw) {
      throw new Error(`Knowledge entry 不存在: ${id}`);
    }
    const normalized = this.normalize(raw, 0);
    if (normalized.status === "archived") {
      throw new Error(`Knowledge entry 已归档，不可修改: ${id}`);
    }
    const updated: KnowledgeEntry = {
      ...normalized,
      ...(patch.title != null ? { title: patch.title } : {}),
      ...(patch.content != null ? { content: patch.content } : {}),
      ...(patch.category != null ? { category: patch.category } : {}),
      ...(patch.tags != null ? { tags: patch.tags } : {}),
      ...(patch.status != null ? { status: patch.status } : {}),
      updatedAt: new Date().toISOString(),
    };
    store.entries[store.entries.indexOf(raw)] = updated;
    this.save(store);
    return updated;
  }

  /** 阶段 1 批 7：签名改 async，实现不动（仍为 readFileSync/writeFileSync），阶段 2 替换实现。 */
  async archive(id: string): Promise<KnowledgeEntry> {
    const store = this.load();
    const raw = store.entries.find((entry) => entry.id === id);
    if (!raw) {
      throw new Error(`Knowledge entry 不存在: ${id}`);
    }
    const updated: KnowledgeEntry = {
      ...this.normalize(raw, 0),
      status: "archived",
      updatedAt: new Date().toISOString(),
    };
    store.entries[store.entries.indexOf(raw)] = updated;
    this.save(store);
    return updated;
  }

  private load(): KnowledgeStore {
    if (!fs.existsSync(this.storePath)) {
      return { entries: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(this.storePath, "utf-8")) as KnowledgeStore;
    if (!Array.isArray(parsed.entries)) return { entries: [] };
    return parsed;
  }

  private save(store: KnowledgeStore): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(this.storePath, JSON.stringify(store, null, 2), "utf-8");
  }

  /** 默认值补齐：存量数据缺 status/category/时间戳时不迁移即可读 */
  private normalize(raw: Partial<KnowledgeEntry>, index: number): KnowledgeEntry {
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
}
