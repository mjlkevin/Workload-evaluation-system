// ============================================================
// Knowledge 域 PG 仓储（阶段 2 批 9 · 第 1–3 步）
// ============================================================
// 接口形态：行级条目仓储（list/get/create/update/archive），与
// JSON 类 KnowledgeRepository 公开方法 1:1；类接口保持不变是本批
// 指令要求（装配点 getKnowledgeRepository() 不变，选择器在
// knowledge.module.ts 分流）。
//
// PG 侧形态（本批唯一新建表域，0020 迁移 db:generate 产出）：
//  - knowledge_entries 表字段与 KnowledgeEntry 1:1（tags 为 jsonb，
//    与批 8 json_runtime 口径一致）；status 支持 draft/active/
//    archived 三态（现存 24 条 JSON 条目无 status 字段，归一化为
//    active；建表仍须支持 archived——批 9 指令）。
//  - 零数据迁移（D17）：PG 空库启动，空表不产生功能故障
//    （检索链 buildBm25Index docCount===0 返回空数组，工具侧走
//    既有兜底）。
//
// 五条硬性范式落实（批 1–8 基准）：
//  1. 错误边界：KnowledgeStoreError（稳定 code），每个公开方法
//     try/catch 后经 toSafeError 收敛；基础设施错误统一
//     KNOWLEDGE_STORE_INTERNAL，pg/drizzle 原始错误（可能含 SQL
//     参数/连接串）不外泄。业务错误消息与 JSON 实现逐字一致
//     （controller 透传 err.message，API 响应行为不变）。
//  2. 幂等：create 为 onConflictDoNothing + RETURNING——重复创建
//     同 id 不产生副作用（冲突时抛「id 已存在」，与 JSON 先查后
//     插的报错语义一致）；archive 对已归档条目重复执行仅刷新
//     updatedAt（与 JSON 无守卫行为一致）。
//  3. 并发控制：单语句原子写无字段混写——create 单条 INSERT 整体
//     成行；update 事务内 FOR UPDATE 行锁下「读行 → 合并补丁 →
//     单语句全列 set」，并发写串行化，收敛为完整输入无撕裂；
//     archive 单条条件 UPDATE。
//  4. 时间：createdAt/updatedAt 一律 readDbNow(tx)（DB 时钟），
//     禁止 Date.now() 落库。
//  5. ISS-2026-08-18-004：读取失败必须抛错（收敛为
//     KNOWLEDGE_STORE_INTERNAL）；list/get 对空表返回空集/ null
//     为合法状态（空库降级），非读取失败。
//
// 缓存策略：不加缓存层（批 9 指令：据「条数少但内容较大」判断）：
//  - 知识条目仅 24 条量级、单条 content 最大 76 字符（现存数据，
//    远小于 templates 414KB 单行）；全量 list 为一次顺序扫描，
//    毫秒级以内，且检索每次请求必须全量读（BM25 建索引），缓存
//    命中不了「部分读」。
//  - 条目经管理端创建/归档后必须立即生效（批 4/8 同口径：管理
//    界面变更不容 TTL 滞后）。
//  - 多副本部署下进程级缓存引入分歧（§4.7 同论证）。
//  - 带外 SQL 写入立即可见由测试用例证明（无缓存层 → 无需失效协调）。

import { asc, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { db, type Database } from "../../db/client";
import { readDbNow } from "../../db/now";
import { knowledgeEntries } from "../../db/schema";
import type { KnowledgeEntry, KnowledgeStatus } from "./knowledge.types";
import type {
  CreateEntryInput,
  KnowledgeStoreRepository,
  UpdateEntryPatch,
} from "./knowledge.repository";

// ============================================================
// 安全错误（范式 #1 / #5）
// ============================================================

export class KnowledgeStoreError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "KnowledgeStoreError";
    this.code = code;
  }
}

function toSafeError(err: unknown): KnowledgeStoreError {
  if (err instanceof KnowledgeStoreError) return err;
  return new KnowledgeStoreError("KNOWLEDGE_STORE_INTERNAL", "knowledge store persistence failed");
}

// ============================================================
// PG 实现（类接口与 JSON 侧 KnowledgeRepository 1:1）
// ============================================================

type KnowledgeRow = typeof knowledgeEntries.$inferSelect;

/** raw SQL（FOR UPDATE 行锁）返回 snake_case 列名，不经 drizzle 映射，单独定型。 */
type RawKnowledgeRow = {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[] | null;
  status: string;
  created_at: Date;
  updated_at: Date;
};

function toEntry(row: KnowledgeRow): KnowledgeEntry {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    category: row.category,
    tags: (row.tags as string[]) ?? [],
    status: row.status as KnowledgeStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class KnowledgePgRepository implements KnowledgeStoreRepository {
  private readonly dbInstance: Database;

  constructor(dbInstance: Database = db) {
    this.dbInstance = dbInstance;
  }

  /** 测试专用：暴露底层连接以做带外断言/清理 */
  __dbForTest(): Database {
    return this.dbInstance;
  }

  /** 空表返回空数组为合法状态（空库降级，非读取失败）；确定性排序。 */
  async list(): Promise<KnowledgeEntry[]> {
    try {
      const rows = await this.dbInstance
        .select()
        .from(knowledgeEntries)
        .orderBy(asc(knowledgeEntries.createdAt), asc(knowledgeEntries.id));
      return rows.map(toEntry);
    } catch (err) {
      throw toSafeError(err);
    }
  }

  async get(id: string): Promise<KnowledgeEntry | null> {
    try {
      const rows = await this.dbInstance
        .select()
        .from(knowledgeEntries)
        .where(sql`${knowledgeEntries.id} = ${id}`)
        .limit(1);
      const row = rows[0];
      return row ? toEntry(row) : null;
    } catch (err) {
      throw toSafeError(err);
    }
  }

  /** 单条 INSERT（onConflictDoNothing + RETURNING）：冲突检测与写入同一语句，无先查后插竞态。 */
  async create(input: CreateEntryInput): Promise<KnowledgeEntry> {
    if (!input.title || !input.title.trim()) {
      throw new KnowledgeStoreError("KNOWLEDGE_ENTRY_INVALID", "Knowledge entry title is required");
    }
    if (!input.content || !input.content.trim()) {
      throw new KnowledgeStoreError("KNOWLEDGE_ENTRY_INVALID", "Knowledge entry content is required");
    }
    try {
      return await this.dbInstance.transaction(async (tx) => {
        const now = await readDbNow(tx);
        const id = input.id?.trim() || `k-${randomUUID().slice(0, 8)}`;
        const rows = await tx
          .insert(knowledgeEntries)
          .values({
            id,
            title: input.title.trim(),
            content: input.content.trim(),
            category: input.category?.trim() || "general",
            tags: input.tags ?? [],
            status: "active",
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .returning();
        const row = rows[0];
        if (!row) {
          throw new KnowledgeStoreError("KNOWLEDGE_ENTRY_ID_EXISTS", `Knowledge entry id 已存在: ${id}`);
        }
        return toEntry(row);
      });
    } catch (err) {
      throw toSafeError(err);
    }
  }

  /** 事务内 FOR UPDATE 行锁 + 单语句全列 set（范式 #3：无字段混写）；归档守卫与 JSON 一致。 */
  async update(id: string, patch: UpdateEntryPatch): Promise<KnowledgeEntry> {
    try {
      return await this.dbInstance.transaction(async (tx) => {
        const locked = await tx.execute(
          sql`SELECT * FROM knowledge_entries WHERE id = ${id} FOR UPDATE`,
        );
        const current = (locked.rows as RawKnowledgeRow[])[0];
        if (!current) {
          throw new KnowledgeStoreError("KNOWLEDGE_ENTRY_NOT_FOUND", `Knowledge entry 不存在: ${id}`);
        }
        if ((current.status as KnowledgeStatus) === "archived") {
          throw new KnowledgeStoreError("KNOWLEDGE_ENTRY_ARCHIVED", `Knowledge entry 已归档，不可修改: ${id}`);
        }
        const now = await readDbNow(tx);
        const values = {
          title: patch.title ?? current.title,
          content: patch.content ?? current.content,
          category: patch.category ?? current.category,
          tags: patch.tags ?? ((current.tags as string[]) ?? []),
          status: (patch.status ?? (current.status as KnowledgeStatus)) as KnowledgeStatus,
          updatedAt: now,
        };
        const rows = await tx
          .update(knowledgeEntries)
          .set(values)
          .where(sql`${knowledgeEntries.id} = ${id}`)
          .returning();
        return toEntry(rows[0]);
      });
    } catch (err) {
      throw toSafeError(err);
    }
  }

  /** 单条条件 UPDATE（与 JSON 一致：已归档条目可重复归档，无守卫）。 */
  async archive(id: string): Promise<KnowledgeEntry> {
    try {
      return await this.dbInstance.transaction(async (tx) => {
        const now = await readDbNow(tx);
        const rows = await tx
          .update(knowledgeEntries)
          .set({ status: "archived", updatedAt: now })
          .where(sql`${knowledgeEntries.id} = ${id}`)
          .returning();
        const row = rows[0];
        if (!row) {
          throw new KnowledgeStoreError("KNOWLEDGE_ENTRY_NOT_FOUND", `Knowledge entry 不存在: ${id}`);
        }
        return toEntry(row);
      });
    } catch (err) {
      throw toSafeError(err);
    }
  }
}

// ============================================================
// 测试专用（数据集隔离，禁止整表计数/清理）
// ============================================================

/** 测试专用：带外核对行数（共享测试库，按前缀计数）。 */
export async function countKnowledgeRowsByPrefix(
  dbInstance: Database,
  prefix: string,
): Promise<number> {
  const result = await dbInstance.execute(
    sql`SELECT count(*)::int AS n FROM knowledge_entries WHERE id LIKE ${prefix + "%"}`,
  );
  return Number((result.rows as Array<{ n: number }>)[0]?.n ?? 0);
}

/** 测试专用：按前缀条件清理（数据集隔离，不整表 TRUNCATE）。 */
export async function cleanupKnowledgeRowsByPrefix(
  dbInstance: Database,
  prefix: string,
): Promise<void> {
  await dbInstance.execute(sql`DELETE FROM knowledge_entries WHERE id LIKE ${prefix + "%"}`);
}
