// ============================================================
// 批次 10a · 行业主数据类型定义
// ============================================================
// 【基础管理】第一份主数据的领域类型。表结构见 db/schema/industry.ts，
// 两层级固定（一级大类 / 二级细分）由两张表的结构本身保证。
//
// 时间一律 ISO 字符串（与 knowledge.types.ts 同口径）：仓储读 DB 时钟
// （范式 #4），出参序列化给前端时不再带 Date 对象。

/** 主数据启用状态。表内没有第三种取值，也没有可表达「已删除」的列。 */
export type IndustryStatus = "active" | "inactive";

/** 一级：行业大类。 */
export interface IndustryCategory {
  id: string;
  name: string;
  status: IndustryStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** 二级：行业细分。categoryId 恒指向一级，不存在第三种父节点。 */
export interface IndustrySubcategory extends IndustryCategory {
  categoryId: string;
}

/** 两层树节点：列表页与「新增二级」的父键选择器共用。 */
export interface IndustryTreeNode extends IndustryCategory {
  children: IndustrySubcategory[];
}

/**
 * 新建单据用的行业选项（只含启用项）。
 *
 * value 存**名称文本**而不是主键：业务记录按文本引用行业
 * （version_records.payload->>'industry' 现存的 `制造业` / `其他` 即文本），
 * 若改存主键，同一字段里会同时躺着两种代际的值，正是本批要消灭的漂移。
 * 名称在两层之间不重复由仓储的唯一性守卫保证（见 industry-pg.repository.ts）。
 */
export interface IndustryOption {
  value: string;
  /** 二级带父级前缀，避免下拉里出现两个无法区分的同名项 */
  label: string;
  level: 1 | 2;
  /** 二级的父级名称；一级为 null */
  parentValue: string | null;
}

export interface CreateCategoryInput {
  /** 可选：seed 行走可读稳定 id；运行时不传则生成 */
  id?: string;
  name: string;
  sortOrder?: number;
}

export interface CreateSubcategoryInput {
  id?: string;
  categoryId: string;
  name: string;
  sortOrder?: number;
}

/** 修改补丁：只允许改名称与排序，状态走 setStatus（停用/启用是独立动作）。 */
export interface IndustryPatch {
  name?: string;
  sortOrder?: number;
}

/** 稳定错误码（范式 #1）：消息透传到 API 响应，码用于分类而非文案匹配。 */
export type MasterDataErrorCode =
  | "MASTER_DATA_DELETE_FORBIDDEN"
  | "MASTER_DATA_INVALID"
  | "MASTER_DATA_NOT_FOUND"
  | "MASTER_DATA_NAME_EXISTS"
  | "MASTER_DATA_STORE_INTERNAL";
