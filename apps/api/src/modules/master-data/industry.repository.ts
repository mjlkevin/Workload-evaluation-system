// ============================================================
// 批次 10a · 行业主数据仓储契约（接口 + 无实现）
// ============================================================
// 与 knowledge.repository.ts 同形态：契约单独成文件，实现唯一
// （industry-pg.repository.ts），装配点在 master-data.module.ts。
//
// 契约里**没有** delete / hardDelete 之类的方法名——取而代之的是
// removeCategory / removeSubcategory 两个恒抛错的成员。理由：
// 「不许硬删」若只表现为「接口上没这个方法」，就退化成「谁都能加一个」；
// 显式命名并让它必然抛错，既让「直接调仓储也被拒」这条判据可测，
// 也让后来人必须先删掉一个有名字的守卫，而不是顺手补个 CRUD 里的 delete。

import type {
  CreateCategoryInput,
  CreateSubcategoryInput,
  IndustryCategory,
  IndustryPatch,
  IndustryStatus,
  IndustrySubcategory,
} from "./industry.types";

export interface IndustryStoreRepository {
  /** 全量一级（含停用），按 sort_order, name 确定性排序；空表返回空数组是合法状态。 */
  listCategories(): Promise<IndustryCategory[]>;
  /** 全量二级（含停用），按 sort_order, name 确定性排序。 */
  listSubcategories(): Promise<IndustrySubcategory[]>;
  getCategory(id: string): Promise<IndustryCategory | null>;
  getSubcategory(id: string): Promise<IndustrySubcategory | null>;

  createCategory(input: CreateCategoryInput): Promise<IndustryCategory>;
  createSubcategory(input: CreateSubcategoryInput): Promise<IndustrySubcategory>;
  updateCategory(id: string, patch: IndustryPatch): Promise<IndustryCategory>;
  updateSubcategory(id: string, patch: IndustryPatch): Promise<IndustrySubcategory>;
  /** 停用 / 启用：幂等（重复设为同一状态仅刷新 updatedAt）。 */
  setCategoryStatus(id: string, status: IndustryStatus): Promise<IndustryCategory>;
  setSubcategoryStatus(id: string, status: IndustryStatus): Promise<IndustrySubcategory>;

  /** 恒抛 MASTER_DATA_DELETE_FORBIDDEN —— 见文件头。 */
  removeCategory(id: string): Promise<never>;
  /** 恒抛 MASTER_DATA_DELETE_FORBIDDEN —— 见文件头。 */
  removeSubcategory(id: string): Promise<never>;
}
