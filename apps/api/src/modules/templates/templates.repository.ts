// ============================================================
// Templates 域仓储入口（阶段 2 S6 终态：PG-only）
// ============================================================
// 阶段 2 批 8 起实现改经选择器分流（§3.1 形态）；S6（2026-08-29）删除
// JSON 读写路径并退役 WES_STORE_TEMPLATES_PG，选择器恒装配 PG 实现——
// 与本域外其余「第 4 步已完成」域（ai-sessions S2b-2）同形态。
//
// seed 源文件 config/templates/example-template.json 保留不删：它仍是
// db/seed.ts 的播种来源（阶段 2 D17「零数据迁移」口径下，PG 里的活动
// 模板即由该文件播入），删除即断 seed。

import { Template } from "../../types";
import {
  createTemplatesPgRepository,
  type TemplateStoreRepository,
} from "./templates-pg.repository";

export type { TemplateStoreRepository, TemplatesPgRepository } from "./templates-pg.repository";
export { TemplateStoreError, createTemplatesPgRepository } from "./templates-pg.repository";

// ============================================================
// 选择器（S6 后恒 PG，无开关分流；单例语义保留）
// ============================================================

let defaultRepo: TemplateStoreRepository | null = null;

/** 进程内默认 repository 单例（生产路由使用）；S6 后恒 PG 实现 */
export function getTemplateRepository(): TemplateStoreRepository {
  if (!defaultRepo) defaultRepo = createTemplatesPgRepository();
  return defaultRepo;
}

/** 测试专用：重置单例 */
export function _resetTemplateRepositoryForTest(): void {
  defaultRepo = null;
}

// ============================================================
// 公开 accessor（签名不变，经选择器分流）
// ============================================================

/**
 * 阶段 2 S6：实现改经选择器恒直连 PG（JSON 路径与开关已退役）。
 */
export async function loadTemplate(): Promise<Template> {
  return getTemplateRepository().loadTemplate();
}

/**
 * 阶段 2 S6：实现改经选择器恒直连 PG（JSON 路径与开关已退役）。
 */
export async function saveTemplate(template: Template): Promise<void> {
  return getTemplateRepository().saveTemplate(template);
}
