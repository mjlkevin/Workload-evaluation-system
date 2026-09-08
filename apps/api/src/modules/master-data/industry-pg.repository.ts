// ============================================================
// 批次 10a · 行业主数据 PG 仓储（第 10 个存储域）
// ============================================================
// 阶段 2 批 1–9 的五条硬性范式逐条落实：
//  1. 错误边界：MasterDataError（稳定 code），每个公开方法 try/catch 后经
//     toSafeError 收敛；pg/drizzle 原始错误（含连接串与 SQL 片段）不外泄。
//  2. 幂等：create 走 onConflictDoNothing + RETURNING，冲突检测与写入同一
//     语句，无「先查后插」竞态；setStatus 是条件 UPDATE，重复设同一状态只
//     刷新 updatedAt。
//  3. 并发控制：update 在事务内 FOR UPDATE 行锁下「读行 → 合并补丁 →
//     单语句全列 set」，并发写串行化，无字段混写撕裂。
//  4. 时间：createdAt / updatedAt 一律 readDbNow(tx)（DB 时钟），禁止
//     Date.now() 落库。
//  5. 读失败必须抛错（收敛为 MASTER_DATA_STORE_INTERNAL）；空表返回空集 /
//     查无返回 null 是合法状态，不是失败。
//
// 禁止硬删落在本层的形态（本批要害，另两层见 db/schema/industry.ts 文件头）：
// 仓储**不出现任何 DELETE 语句**。removeCategory / removeSubcategory 是
// 显式命名的守卫方法：无条件抛 MASTER_DATA_DELETE_FORBIDDEN，先抛后查——
// 连目标行存不存在都不去看，因为「删除」这个动作本身不在授权范围内。
// 之所以不干脆不定义这两个方法：那会让「不许硬删」退化成「谁都能顺手补一个
// delete」；有名字的必然抛错守卫，后来人要删必须先移除一个看得见的守卫。
//
// 跨层唯一性守卫（二级名不得与一级名相同）也在本层、同一事务内做：
// 选项 value 存的是名称文本（业务记录按文本引用行业，见 industry.types.ts），
// 两层撞名会让同一个文本指向两个节点，「停用其一」与「历史值归属」双双分叉。
//
// 缓存策略：不加缓存层。主数据条数少（首批 2 条一级、二级由用户自行维护）、
// 管理端改完必须立即对新单据生效、多副本下进程级缓存会引入分歧
// （批 4 / 批 8 / 批 9 同口径）。

import { and, asc, eq, ne, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { db, type Database } from "../../db/client";
import { readDbNow } from "../../db/now";
import { industryCategories, industrySubcategories } from "../../db/schema";
import type {
  CreateCategoryInput,
  CreateSubcategoryInput,
  IndustryCategory,
  IndustryPatch,
  IndustryStatus,
  IndustrySubcategory,
  MasterDataErrorCode,
} from "./industry.types";
import type { IndustryStoreRepository } from "./industry.repository";

// ============================================================
// 安全错误（范式 #1）
// ============================================================

export class MasterDataError extends Error {
  readonly code: MasterDataErrorCode;

  constructor(code: MasterDataErrorCode, message?: string) {
    super(message ?? code);
    this.name = "MasterDataError";
    this.code = code;
  }
}

function toSafeError(err: unknown): MasterDataError {
  if (err instanceof MasterDataError) return err;
  // 不带原始 err.message：pg 驱动的错误里含连接串与 SQL 文本。
  return new MasterDataError("MASTER_DATA_STORE_INTERNAL", "industry master data persistence failed");
}

/** PG 唯一约束冲突（23505）——用于把数据库兜底唯一键翻译成本域稳定码。 */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23505";
}

/**
 * 事务对象与根 db 的公共查询面（Database 类型含 .transaction，事务对象没有，
 * 故内部辅助函数一律收这个窄类型，避免每处 `tx as unknown as Database` 的强转）。
 */
type DbLike = Pick<Database, "select" | "insert" | "update" | "execute">;

type CategoryRow = typeof industryCategories.$inferSelect;
type SubcategoryRow = typeof industrySubcategories.$inferSelect;

function toCategory(row: CategoryRow): IndustryCategory {
  return {
    id: row.id,
    name: row.name,
    status: row.status as IndustryStatus,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSubcategory(row: SubcategoryRow): IndustrySubcategory {
  return {
    ...toCategory(row),
    categoryId: row.categoryId,
  };
}

/** 确定性排序：sort_order → 录入时间 → id（口径与理由见 usecase.sortMasterData）。 */
const categoryOrder = [
  asc(industryCategories.sortOrder),
  asc(industryCategories.createdAt),
  asc(industryCategories.id),
];
const subcategoryOrder = [
  asc(industrySubcategories.sortOrder),
  asc(industrySubcategories.createdAt),
  asc(industrySubcategories.id),
];

/** 空白名一律拒（trim 后入库，避免「制造业 」与「制造业」并存）。 */
function normalizeName(raw: unknown, label: string): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) throw new MasterDataError("MASTER_DATA_INVALID", `${label}名称不能为空`);
  return name;
}

function normalizeSortOrder(raw: unknown): number {
  if (raw === undefined || raw === null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new MasterDataError("MASTER_DATA_INVALID", "排序值必须是非负整数");
  }
  return n;
}

function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

// ============================================================
// 仓储实现
// ============================================================

export function createIndustryPgRepository(dbInstance: Database = db): IndustryPgRepository {
  /** 同事务内查「该名称是否已被别的行占用」。 */
  async function ensureCategoryNameFree(
    tx: DbLike,
    name: string,
    exceptId: string | null,
  ): Promise<void> {
    const conditions = [eq(industryCategories.name, name)];
    if (exceptId) conditions.push(ne(industryCategories.id, exceptId));
    const hits = await tx
      .select({ id: industryCategories.id })
      .from(industryCategories)
      .where(and(...conditions))
      .limit(1);
    if (hits.length > 0) {
      throw new MasterDataError("MASTER_DATA_NAME_EXISTS", `行业大类名称已存在: ${name}`);
    }
  }

  /** 二级名称的两条唯一性：同大类下不重名 + 不与任何大类名撞（跨层）。 */
  async function ensureSubcategoryNameFree(
    tx: DbLike,
    categoryId: string,
    name: string,
    exceptId: string | null,
  ): Promise<void> {
    const sameCatConditions = [
      eq(industrySubcategories.categoryId, categoryId),
      eq(industrySubcategories.name, name),
    ];
    if (exceptId) sameCatConditions.push(ne(industrySubcategories.id, exceptId));
    const sameCat = await tx
      .select({ id: industrySubcategories.id })
      .from(industrySubcategories)
      .where(and(...sameCatConditions))
      .limit(1);
    if (sameCat.length > 0) {
      throw new MasterDataError("MASTER_DATA_NAME_EXISTS", `该行业大类下已存在同名细分: ${name}`);
    }
    const crossLevel = await tx
      .select({ id: industryCategories.id })
      .from(industryCategories)
      .where(eq(industryCategories.name, name))
      .limit(1);
    if (crossLevel.length > 0) {
      throw new MasterDataError(
        "MASTER_DATA_NAME_EXISTS",
        `细分名称不得与行业大类同名（会造成选项值指向两个节点）: ${name}`,
      );
    }
  }

  async function lockCategoryRow(tx: DbLike, id: string): Promise<CategoryRow | null> {
    const result = await tx.execute(
      sql`SELECT * FROM industry_categories WHERE id = ${id} FOR UPDATE`,
    );
    return (result.rows as CategoryRow[])[0] ?? null;
  }

  async function lockSubcategoryRow(tx: DbLike, id: string): Promise<SubcategoryRow | null> {
    const result = await tx.execute(
      sql`SELECT * FROM industry_subcategories WHERE id = ${id} FOR UPDATE`,
    );
    return (result.rows as SubcategoryRow[])[0] ?? null;
  }

  const repository: IndustryStoreRepository & { __dbForTest(): Database } = {
    __dbForTest() {
      return dbInstance;
    },

    async listCategories(): Promise<IndustryCategory[]> {
      try {
        const rows = await dbInstance.select().from(industryCategories).orderBy(...categoryOrder);
        return rows.map(toCategory);
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async listSubcategories(): Promise<IndustrySubcategory[]> {
      try {
        const rows = await dbInstance.select().from(industrySubcategories).orderBy(...subcategoryOrder);
        return rows.map(toSubcategory);
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async getCategory(id: string): Promise<IndustryCategory | null> {
      try {
        const rows = await dbInstance
          .select()
          .from(industryCategories)
          .where(eq(industryCategories.id, id))
          .limit(1);
        return rows[0] ? toCategory(rows[0]) : null;
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async getSubcategory(id: string): Promise<IndustrySubcategory | null> {
      try {
        const rows = await dbInstance
          .select()
          .from(industrySubcategories)
          .where(eq(industrySubcategories.id, id))
          .limit(1);
        return rows[0] ? toSubcategory(rows[0]) : null;
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async createCategory(input: CreateCategoryInput): Promise<IndustryCategory> {
      const name = normalizeName(input.name, "行业大类");
      const sortOrder = normalizeSortOrder(input.sortOrder);
      try {
        return await dbInstance.transaction(async (tx) => {
          const now = await readDbNow(tx);
          const id = input.id?.trim() || newId("industry-cat");
          const rows = await tx
            .insert(industryCategories)
            .values({ id, name, status: "active", sortOrder, createdAt: now, updatedAt: now })
            .onConflictDoNothing()
            .returning();
          const row = rows[0];
          if (!row) {
            // 冲突有两种来源（主键 / 名称唯一键），码值统一为 NAME_EXISTS，
            // 消息分别——seed 的幂等口径靠「冲突即不插」而非靠读消息。
            const idTaken = await tx
              .select({ id: industryCategories.id })
              .from(industryCategories)
              .where(eq(industryCategories.id, id))
              .limit(1);
            throw new MasterDataError(
              "MASTER_DATA_NAME_EXISTS",
              idTaken.length > 0 ? `行业大类 id 已存在: ${id}` : `行业大类名称已存在: ${name}`,
            );
          }
          return toCategory(row);
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new MasterDataError("MASTER_DATA_NAME_EXISTS", `行业大类名称已存在: ${name}`);
        }
        throw toSafeError(err);
      }
    },

    async createSubcategory(input: CreateSubcategoryInput): Promise<IndustrySubcategory> {
      const name = normalizeName(input.name, "行业细分");
      const sortOrder = normalizeSortOrder(input.sortOrder);
      const categoryId = typeof input.categoryId === "string" ? input.categoryId.trim() : "";
      if (!categoryId) throw new MasterDataError("MASTER_DATA_INVALID", "必须指定所属行业大类");
      try {
        return await dbInstance.transaction(async (tx) => {
          // 父键存在性在同一事务内确认：表结构上二级只能挂一级，
          // 挂错目标（不存在）在这里挡，不等到外键报错。
          const parent = await tx
            .select({ id: industryCategories.id })
            .from(industryCategories)
            .where(eq(industryCategories.id, categoryId))
            .limit(1);
          if (parent.length === 0) {
            throw new MasterDataError("MASTER_DATA_NOT_FOUND", `行业大类不存在: ${categoryId}`);
          }
          await ensureSubcategoryNameFree(tx, categoryId, name, null);
          const now = await readDbNow(tx);
          const id = input.id?.trim() || newId("industry-sub");
          const rows = await tx
            .insert(industrySubcategories)
            .values({ id, categoryId, name, status: "active", sortOrder, createdAt: now, updatedAt: now })
            .onConflictDoNothing()
            .returning();
          const row = rows[0];
          if (!row) {
            throw new MasterDataError("MASTER_DATA_NAME_EXISTS", `该行业大类下已存在同名细分: ${name}`);
          }
          return toSubcategory(row);
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new MasterDataError("MASTER_DATA_NAME_EXISTS", `行业细分名称冲突: ${name}`);
        }
        throw toSafeError(err);
      }
    },

    async updateCategory(id: string, patch: IndustryPatch): Promise<IndustryCategory> {
      try {
        return await dbInstance.transaction(async (tx) => {
          const current = await lockCategoryRow(tx, id);
          if (!current) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `行业大类不存在: ${id}`);
          const nextName = patch.name === undefined ? current.name : normalizeName(patch.name, "行业大类");
          const nextSortOrder = patch.sortOrder === undefined ? current.sortOrder : normalizeSortOrder(patch.sortOrder);
          if (nextName !== current.name) {
            await ensureCategoryNameFree(tx, nextName, id);
          }
          const now = await readDbNow(tx);
          const rows = await tx
            .update(industryCategories)
            .set({ name: nextName, sortOrder: nextSortOrder, updatedAt: now })
            .where(eq(industryCategories.id, id))
            .returning();
          return toCategory(rows[0]);
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new MasterDataError("MASTER_DATA_NAME_EXISTS", "行业大类名称已存在");
        }
        throw toSafeError(err);
      }
    },

    async updateSubcategory(id: string, patch: IndustryPatch): Promise<IndustrySubcategory> {
      try {
        return await dbInstance.transaction(async (tx) => {
          const current = await lockSubcategoryRow(tx, id);
          if (!current) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `行业细分不存在: ${id}`);
          const nextName = patch.name === undefined ? current.name : normalizeName(patch.name, "行业细分");
          const nextSortOrder = patch.sortOrder === undefined ? current.sortOrder : normalizeSortOrder(patch.sortOrder);
          if (nextName !== current.name) {
            await ensureSubcategoryNameFree(tx, current.categoryId, nextName, id);
          }
          const now = await readDbNow(tx);
          const rows = await tx
            .update(industrySubcategories)
            .set({ name: nextName, sortOrder: nextSortOrder, updatedAt: now })
            .where(eq(industrySubcategories.id, id))
            .returning();
          return toSubcategory(rows[0]);
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new MasterDataError("MASTER_DATA_NAME_EXISTS", "行业细分名称冲突");
        }
        throw toSafeError(err);
      }
    },

    async setCategoryStatus(id: string, status: IndustryStatus): Promise<IndustryCategory> {
      if (status !== "active" && status !== "inactive") {
        throw new MasterDataError("MASTER_DATA_INVALID", `非法状态: ${String(status)}`);
      }
      try {
        return await dbInstance.transaction(async (tx) => {
          const now = await readDbNow(tx);
          const rows = await tx
            .update(industryCategories)
            .set({ status, updatedAt: now })
            .where(eq(industryCategories.id, id))
            .returning();
          const row = rows[0];
          if (!row) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `行业大类不存在: ${id}`);
          return toCategory(row);
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async setSubcategoryStatus(id: string, status: IndustryStatus): Promise<IndustrySubcategory> {
      if (status !== "active" && status !== "inactive") {
        throw new MasterDataError("MASTER_DATA_INVALID", `非法状态: ${String(status)}`);
      }
      try {
        return await dbInstance.transaction(async (tx) => {
          const now = await readDbNow(tx);
          const rows = await tx
            .update(industrySubcategories)
            .set({ status, updatedAt: now })
            .where(eq(industrySubcategories.id, id))
            .returning();
          const row = rows[0];
          if (!row) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `行业细分不存在: ${id}`);
          return toSubcategory(row);
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    // -------------------- 硬删守卫：本文件到此为止没有任何 DELETE --------------------

    async removeCategory(id: string): Promise<never> {
      throw new MasterDataError(
        "MASTER_DATA_DELETE_FORBIDDEN",
        `行业主数据禁止硬删（历史记录按名称文本引用行业，删掉即指向不存在的选项）；请改用停用: ${id}`,
      );
    },

    async removeSubcategory(id: string): Promise<never> {
      throw new MasterDataError(
        "MASTER_DATA_DELETE_FORBIDDEN",
        `行业主数据禁止硬删（历史记录按名称文本引用行业，删掉即指向不存在的选项）；请改用停用: ${id}`,
      );
    },
  };

  return repository;
}

export type IndustryPgRepository = IndustryStoreRepository & { __dbForTest(): Database };
