// ============================================================
// 批次 10a · master-data 模块 barrel + 默认 repository 单例
// ============================================================
// 装配口径与 knowledge.module.ts 一致：本域自始即 PG 主存储
// （第 10 个存储域，无 JSON 历史实现，不存在开关分流），
// 选择器恒装配 PG 实现，进程内单例供生产路由使用。

import { createIndustryPgRepository, type IndustryPgRepository } from "./industry-pg.repository";

export { createIndustryHandlers } from "./industry.controller";
export { MasterDataError } from "./industry-pg.repository";
export type { IndustryStoreRepository } from "./industry.repository";
export type {
  CreateCategoryInput,
  CreateSubcategoryInput,
  IndustryCategory,
  IndustryOption,
  IndustryPatch,
  IndustryStatus,
  IndustrySubcategory,
  IndustryTreeNode,
  MasterDataErrorCode,
} from "./industry.types";
export {
  buildIndustryOptions,
  buildIndustryTree,
  parseIndustryStatus,
  sortMasterData,
} from "./industry.usecase";

let defaultRepo: IndustryPgRepository | null = null;

/** 进程内默认 repository 单例（生产路由使用）。 */
export function getIndustryRepository(): IndustryPgRepository {
  if (!defaultRepo) defaultRepo = createIndustryPgRepository();
  return defaultRepo;
}

/** 测试专用：重置单例。 */
export function _resetIndustryRepositoryForTest(): void {
  defaultRepo = null;
}
