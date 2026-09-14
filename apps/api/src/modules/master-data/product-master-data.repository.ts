// ============================================================
// 批次 10b · 产品主数据仓储契约（接口）
// ============================================================

import type {
  CreateAssignmentInput,
  CreateProductLineInput,
  CreateProductModuleInput,
  CreateProductSkuInput,
  ProductLine,
  ProductMasterDataPatch,
  ProductModule,
  ProductSku,
  ProductSkuModuleAssignment,
  ProductTemplateMeta,
  UpdateAssignmentInput,
} from "./product-master-data.types";

export interface ProductMasterDataStoreRepository {
  listAssignments(): Promise<ProductSkuModuleAssignment[]>;
  listActiveAssignments(): Promise<ProductSkuModuleAssignment[]>;
  listProductLines(): Promise<ProductLine[]>;
  listProductSkus(): Promise<ProductSku[]>;
  listProductModules(): Promise<ProductModule[]>;
  getAssignment(id: string): Promise<ProductSkuModuleAssignment | null>;

  createProductLine(input: CreateProductLineInput): Promise<ProductLine>;
  createProductSku(input: CreateProductSkuInput): Promise<ProductSku>;
  createProductModule(input: CreateProductModuleInput): Promise<ProductModule>;
  createAssignment(input: CreateAssignmentInput): Promise<ProductSkuModuleAssignment>;

  updateAssignment(id: string, patch: UpdateAssignmentInput): Promise<ProductSkuModuleAssignment>;
  updateProductLine(id: string, patch: ProductMasterDataPatch): Promise<ProductLine>;
  updateProductSku(id: string, patch: ProductMasterDataPatch): Promise<ProductSku>;
  updateProductModule(id: string, patch: ProductMasterDataPatch): Promise<ProductModule>;

  setAssignmentStatus(id: string, status: "active" | "inactive"): Promise<ProductSkuModuleAssignment>;
  setProductLineStatus(id: string, status: "active" | "inactive"): Promise<ProductLine>;
  setProductSkuStatus(id: string, status: "active" | "inactive"): Promise<ProductSku>;
  setProductModuleStatus(id: string, status: "active" | "inactive"): Promise<ProductModule>;

  getActiveTemplateMeta(): Promise<ProductTemplateMeta | null>;
  setActiveTemplateMeta(meta: Omit<ProductTemplateMeta, "createdAt" | "updatedAt">): Promise<void>;
}
