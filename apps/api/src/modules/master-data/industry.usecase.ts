// ============================================================
// 批次 10a · 行业主数据用例（纯函数，不碰 DB）
// ============================================================
// 两层树组装 + 新建单据选项生成。刻意保持纯函数：
// 层级规则（「父停用则子也不出」）是本域最容易被后人改错的一条，
// 让它能在无 DB 的用例里被逐条钉住，而不是埋在 SQL 里。

import type {
  IndustryCategory,
  IndustryOption,
  IndustryStatus,
  IndustrySubcategory,
  IndustryTreeNode,
} from "./industry.types";

/**
 * 确定性排序：sort_order 升序 → 创建时间升序 → id（末位兜底，避免并列时顺序抖动）。
 *
 * 为什么第二关键字不用名称：中文名称的码点序对用户没有意义——按码点
 * 「其他」(U+5176…) 会排在「制造业」(U+5236…) 前面，列表与下拉会把
 * 后建的项插到先建的项之前。主数据应按**录入顺序**稳定呈现。
 */
export function sortMasterData<T extends { sortOrder: number; createdAt: string; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * 组装两层树。
 *
 * 二级只能挂在一级之下——表的第二列是 categoryId 且外键指向
 * industry_categories，结构上不存在第三种父节点，因此这里不需要
 * 任何「层级过深」的判别分支。
 */
export function buildIndustryTree(
  categories: IndustryCategory[],
  subcategories: IndustrySubcategory[],
): IndustryTreeNode[] {
  const byCategory = new Map<string, IndustrySubcategory[]>();
  for (const sub of subcategories) {
    const bucket = byCategory.get(sub.categoryId);
    if (bucket) bucket.push(sub);
    else byCategory.set(sub.categoryId, [sub]);
  }
  return sortMasterData(categories).map((category) => ({
    ...category,
    children: sortMasterData(byCategory.get(category.id) ?? []),
  }));
}

/**
 * 生成新建单据的行业下拉选项（只含启用项）。
 *
 * 规则：一级停用 → 它自己不出现在选项里，**其下二级也一律不出现**，
 * 即使二级自身状态仍是 active。理由：选项的 value 是名称文本、
 * label 带父级前缀，父级已不可选时把子级放进下拉，等于让用户
 * 选到一个从入口上进不去的节点。
 *
 * 停用的准确效果是「新单据选不到」，不是「从系统里消失」——
 * 历史记录显示的仍是当年存下的文本，与本函数无关。
 */
export function buildIndustryOptions(tree: IndustryTreeNode[]): IndustryOption[] {
  const options: IndustryOption[] = [];
  for (const category of tree) {
    if (category.status !== "active") continue;
    options.push({
      value: category.name,
      label: category.name,
      level: 1,
      parentValue: null,
    });
    for (const sub of category.children) {
      if (sub.status !== "active") continue;
      options.push({
        value: sub.name,
        label: `${category.name} / ${sub.name}`,
        level: 2,
        parentValue: category.name,
      });
    }
  }
  return options;
}

/** 状态字面量收敛（入参来自 HTTP，非法值必须拒而不是当 active 处理）。 */
export function parseIndustryStatus(raw: unknown): IndustryStatus | null {
  return raw === "active" || raw === "inactive" ? raw : null;
}
