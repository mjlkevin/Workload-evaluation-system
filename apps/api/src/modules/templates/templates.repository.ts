// ============================================================
// Templates 域仓储入口（选择器：缺省 JSON / WES_STORE_TEMPLATES_PG=true 切 PG）
// ============================================================
// 阶段 2 批 8：实现改经选择器分流（§3.1 形态：选择仓储实现）。
// JSON 路径保留至第 4 步（删 JSON 路径 + 退役开关为独立后续批次）。

import { Template } from "../../types";
import { loadJsonFile, saveJsonFile } from "../../utils/file";
import {
  createTemplatesPgRepository,
  type TemplateStoreRepository,
} from "./templates-pg.repository";

const TEMPLATE_PATH = "config/templates/example-template.json";

export type { TemplateStoreRepository, TemplatesPgRepository } from "./templates-pg.repository";
export { TemplateStoreError, createTemplatesPgRepository } from "./templates-pg.repository";

// ============================================================
// JSON 实现（现状，阶段 1 批 6 签名已 async）
// ============================================================

function createTemplateJsonRepository(): TemplateStoreRepository {
  return {
    async loadTemplate(): Promise<Template> {
      return loadJsonFile<Template>(TEMPLATE_PATH);
    },
    async saveTemplate(template: Template): Promise<void> {
      saveJsonFile(TEMPLATE_PATH, template);
    },
  };
}

// ============================================================
// 选择器（第 3 步开关：缺省 JSON，严格 === "true" 切 PG）
// ============================================================

let defaultRepo: TemplateStoreRepository | null = null;

/** 进程内默认 repository 单例（生产路由使用）；开关只读一次，翻开关需重启 */
export function getTemplateRepository(): TemplateStoreRepository {
  if (!defaultRepo) {
    defaultRepo =
      process.env.WES_STORE_TEMPLATES_PG === "true"
        ? createTemplatesPgRepository()
        : createTemplateJsonRepository();
  }
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
 * 阶段 2 批 8：实现改经选择器（缺省 JSON / WES_STORE_TEMPLATES_PG=true 切 PG）。
 */
export async function loadTemplate(): Promise<Template> {
  return getTemplateRepository().loadTemplate();
}

/**
 * 阶段 2 批 8：实现改经选择器（缺省 JSON / WES_STORE_TEMPLATES_PG=true 切 PG）。
 */
export async function saveTemplate(template: Template): Promise<void> {
  return getTemplateRepository().saveTemplate(template);
}
