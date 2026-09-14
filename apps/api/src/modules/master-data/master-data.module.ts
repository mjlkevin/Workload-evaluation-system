// ============================================================
// 批次 10a/10b · master-data 模块 barrel + 默认 repository 单例
// ============================================================
// 装配口径与 knowledge.module.ts 一致：本域自始即 PG 主存储
// （无 JSON 历史实现，不存在开关分流），进程内单例供生产路由使用。

import { createIndustryPgRepository, type IndustryPgRepository } from "./industry-pg.repository";
import { createProductMasterDataPgRepository, type ProductMasterDataPgRepository } from "./product-master-data-pg.repository";

export { createIndustryHandlers } from "./industry.controller";
export { createProductMasterDataHandlers } from "./product-master-data.controller";
export { MasterDataError } from "./industry-pg.repository";
export type { IndustryStoreRepository } from "./industry.repository";
export type { ProductMasterDataStoreRepository } from "./product-master-data.repository";
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
export type {
  CreateAssignmentInput,
  CreateProductLineInput,
  CreateProductModuleInput,
  CreateProductSkuInput,
  ProductLine,
  ProductMasterDataPatch,
  ProductModule,
  ProductSku,
  ProductSkuModuleAssignment,
  UpdateAssignmentInput,
} from "./product-master-data.types";
export {
  buildIndustryOptions,
  buildIndustryTree,
  parseIndustryStatus,
  sortMasterData,
} from "./industry.usecase";
export {
  buildModuleOptions,
  buildProductMasterDataTree,
  buildProductMasterSnapshot,
  buildProductOptions,
  buildSkuOptions,
} from "./product-master-data.usecase";

let industryRepo: IndustryPgRepository | null = null;
let productRepo: ProductMasterDataPgRepository | null = null;

/** 进程内默认 repository 单例（生产路由使用）。 */
export function getIndustryRepository(): IndustryPgRepository {
  if (!industryRepo) industryRepo = createIndustryPgRepository();
  return industryRepo;
}

/** 进程内默认 repository 单例（生产路由使用）。 */
export function getProductMasterDataRepository(): ProductMasterDataPgRepository {
  if (!productRepo) productRepo = createProductMasterDataPgRepository();
  return productRepo;
}

/** 测试专用：重置单例。 */
export function _resetIndustryRepositoryForTest(): void {
  industryRepo = null;
}

/** 测试专用：重置单例。 */
export function _resetProductMasterDataRepositoryForTest(): void {
  productRepo = null;
}
