// ============================================================
// 批次 10a · 行业主数据 in-memory 替身（仅供测试注入）
// ============================================================
// 用途：路由/控制层用例注入，零 fs、零 industry_* 表写入，
// 因此引用它的测试文件不进 single-doc-serial-scope 串行组
// （与 knowledge-in-memory.repository.ts 同定位）。
//
// 规则复刻范围：只复刻 controller 会依赖的那几条
// （名称 trim/非空、大类名全局唯一、同大类下细分唯一、
// 细分名不撞大类名、父键存在性、remove* 恒抛）。
// 需要验证真实 PG 行为（外键、行锁、DB 时钟）的用例走
// industry-pg.repository.test.ts，不走这里。

import { MasterDataError } from "../modules/master-data/industry-pg.repository";
import type { IndustryStoreRepository } from "../modules/master-data/industry.repository";
import type {
  CreateCategoryInput,
  CreateSubcategoryInput,
  IndustryCategory,
  IndustryPatch,
  IndustryStatus,
  IndustrySubcategory,
} from "../modules/master-data/industry.types";

export interface IndustryInMemoryRepository extends IndustryStoreRepository {
  /** 直接塞入既有行（不跑唯一性守卫），用于构造特定初始态。 */
  seed(input: { categories?: IndustryCategory[]; subcategories?: IndustrySubcategory[] }): void;
  snapshot(): { categories: IndustryCategory[]; subcategories: IndustrySubcategory[] };
}

function requireName(raw: unknown, label: string): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) throw new MasterDataError("MASTER_DATA_INVALID", `${label}名称不能为空`);
  return name;
}

/** 与 usecase.sortMasterData 同口径：sort_order → 录入时间 → id。 */
function byOrderThenName<T extends { sortOrder: number; createdAt: string; id: string }>(a: T, b: T): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function createIndustryInMemoryRepository(
  initial: { categories?: IndustryCategory[]; subcategories?: IndustrySubcategory[] } = {},
): IndustryInMemoryRepository {
  const categories: IndustryCategory[] = (initial.categories ?? []).map((c) => ({ ...c }));
  const subcategories: IndustrySubcategory[] = (initial.subcategories ?? []).map((s) => ({ ...s }));
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-mem-${++seq}`;
  // 严格递增且不低于当前时刻：替身里新建行的 createdAt 必须晚于既有的种子行，
  // 否则按「录入时间」排序时新行会插到种子行前面，与 PG（created_at = now()）行为相反。
  let lastMs = Date.now();
  const stamp = () => {
    lastMs = Math.max(Date.now(), lastMs + 1);
    return new Date(lastMs).toISOString();
  };

  const repository: IndustryInMemoryRepository = {
    seed(input) {
      for (const c of input.categories ?? []) categories.push({ ...c });
      for (const s of input.subcategories ?? []) subcategories.push({ ...s });
    },
    snapshot() {
      return { categories: categories.map((c) => ({ ...c })), subcategories: subcategories.map((s) => ({ ...s })) };
    },

    async listCategories() {
      return [...categories].sort(byOrderThenName);
    },
    async listSubcategories() {
      return [...subcategories].sort(byOrderThenName);
    },
    async getCategory(id) {
      return categories.find((c) => c.id === id) ?? null;
    },
    async getSubcategory(id) {
      return subcategories.find((s) => s.id === id) ?? null;
    },

    async createCategory(input: CreateCategoryInput) {
      const name = requireName(input.name, "行业大类");
      if (categories.some((c) => c.name === name || c.id === (input.id ?? ""))) {
        throw new MasterDataError("MASTER_DATA_NAME_EXISTS", `行业大类名称已存在: ${name}`);
      }
      const row: IndustryCategory = {
        id: input.id?.trim() || nextId("industry-cat"),
        name,
        status: "active",
        sortOrder: input.sortOrder ?? 0,
        createdAt: stamp(),
        updatedAt: stamp(),
      };
      categories.push(row);
      return { ...row };
    },

    async createSubcategory(input: CreateSubcategoryInput) {
      const name = requireName(input.name, "行业细分");
      const categoryId = typeof input.categoryId === "string" ? input.categoryId.trim() : "";
      if (!categoryId) throw new MasterDataError("MASTER_DATA_INVALID", "必须指定所属行业大类");
      if (!categories.some((c) => c.id === categoryId)) {
        throw new MasterDataError("MASTER_DATA_NOT_FOUND", `行业大类不存在: ${categoryId}`);
      }
      if (
        subcategories.some((s) => s.categoryId === categoryId && s.name === name) ||
        categories.some((c) => c.name === name)
      ) {
        throw new MasterDataError("MASTER_DATA_NAME_EXISTS", `行业细分名称冲突: ${name}`);
      }
      const row: IndustrySubcategory = {
        id: input.id?.trim() || nextId("industry-sub"),
        categoryId,
        name,
        status: "active",
        sortOrder: input.sortOrder ?? 0,
        createdAt: stamp(),
        updatedAt: stamp(),
      };
      subcategories.push(row);
      return { ...row };
    },

    async updateCategory(id: string, patch: IndustryPatch) {
      const row = categories.find((c) => c.id === id);
      if (!row) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `行业大类不存在: ${id}`);
      const name = patch.name === undefined ? row.name : requireName(patch.name, "行业大类");
      if (name !== row.name && categories.some((c) => c.id !== id && c.name === name)) {
        throw new MasterDataError("MASTER_DATA_NAME_EXISTS", `行业大类名称已存在: ${name}`);
      }
      Object.assign(row, { name, sortOrder: patch.sortOrder ?? row.sortOrder, updatedAt: stamp() });
      return { ...row };
    },

    async updateSubcategory(id: string, patch: IndustryPatch) {
      const row = subcategories.find((s) => s.id === id);
      if (!row) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `行业细分不存在: ${id}`);
      const name = patch.name === undefined ? row.name : requireName(patch.name, "行业细分");
      if (
        name !== row.name &&
        (subcategories.some((s) => s.id !== id && s.categoryId === row.categoryId && s.name === name) ||
          categories.some((c) => c.name === name))
      ) {
        throw new MasterDataError("MASTER_DATA_NAME_EXISTS", `行业细分名称冲突: ${name}`);
      }
      Object.assign(row, { name, sortOrder: patch.sortOrder ?? row.sortOrder, updatedAt: stamp() });
      return { ...row };
    },

    async setCategoryStatus(id: string, status: IndustryStatus) {
      const row = categories.find((c) => c.id === id);
      if (!row) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `行业大类不存在: ${id}`);
      Object.assign(row, { status, updatedAt: stamp() });
      return { ...row };
    },

    async setSubcategoryStatus(id: string, status: IndustryStatus) {
      const row = subcategories.find((s) => s.id === id);
      if (!row) throw new MasterDataError("MASTER_DATA_NOT_FOUND", `行业细分不存在: ${id}`);
      Object.assign(row, { status, updatedAt: stamp() });
      return { ...row };
    },

    async removeCategory(id: string): Promise<never> {
      throw new MasterDataError("MASTER_DATA_DELETE_FORBIDDEN", `行业主数据禁止硬删，请改用停用: ${id}`);
    },
    async removeSubcategory(id: string): Promise<never> {
      throw new MasterDataError("MASTER_DATA_DELETE_FORBIDDEN", `行业主数据禁止硬删，请改用停用: ${id}`);
    },
  };

  return repository;
}
