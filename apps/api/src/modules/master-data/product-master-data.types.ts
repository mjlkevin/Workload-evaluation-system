// ============================================================
// 批次 10b · 产品主数据类型
// ============================================================

export type ProductMasterDataStatus = "active" | "inactive";

export type ProductLine = {
  id: string;
  name: string;
  status: ProductMasterDataStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ProductSku = {
  id: string;
  name: string;
  status: ProductMasterDataStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ProductModule = {
  id: string;
  name: string;
  status: ProductMasterDataStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

/** (产品, SKU, 模块) 关联行，含原 TemplateItem 投影字段。 */
export type ProductSkuModuleAssignment = {
  id: string;
  productId: string;
  productName: string;
  skuId: string;
  skuName: string;
  /** 模块为可选层级：套件类 SKU 直接挂交付要点，此处为 null */
  moduleId: string | null;
  moduleName: string | null;
  templateItemId: string;
  groupId: string;
  groupName: string;
  itemName: string;
  sheetName?: string;
  appGroup?: string;
  defaultIncluded: boolean;
  deliveryPoint?: string;
  deliveryDesc?: string;
  evalDesc?: string;
  standardDays: number;
  status: ProductMasterDataStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ProductTemplateMeta = {
  templateId: string;
  templateVersion: string;
  templateName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateProductLineInput = { name: string; sortOrder?: number; id?: string };
export type CreateProductSkuInput = { name: string; sortOrder?: number; id?: string };
export type CreateProductModuleInput = { name: string; sortOrder?: number; id?: string };

export type CreateAssignmentInput = {
  productId: string;
  skuId: string;
  /** 不传或传 null = 该 SKU 不按模块细分（套件类） */
  moduleId?: string | null;
  standardDays: number;
  templateItemId?: string;
  groupId?: string;
  groupName?: string;
  itemName?: string;
  sheetName?: string;
  appGroup?: string;
  defaultIncluded?: boolean;
  deliveryPoint?: string;
  deliveryDesc?: string;
  evalDesc?: string;
  sortOrder?: number;
};

export type UpdateAssignmentInput = {
  standardDays?: number;
  deliveryPoint?: string;
  deliveryDesc?: string;
  evalDesc?: string;
  itemName?: string;
  sheetName?: string;
  appGroup?: string;
  defaultIncluded?: boolean;
  groupName?: string;
  sortOrder?: number;
};

export type ProductMasterDataPatch = { name?: string; sortOrder?: number };

export type MasterDataErrorCode =
  | "MASTER_DATA_INVALID"
  | "MASTER_DATA_NOT_FOUND"
  | "MASTER_DATA_NAME_EXISTS"
  | "MASTER_DATA_DELETE_FORBIDDEN"
  | "MASTER_DATA_STORE_INTERNAL";
