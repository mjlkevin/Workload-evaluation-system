// ============================================================
// RuleSets 域仓储入口（选择器：缺省 JSON / WES_STORE_RULE_SETS_PG=true 切 PG）
// ============================================================
// 阶段 2 批 8：实现改经选择器分流（§3.1 形态：选择仓储实现）。
// JSON 路径保留至第 4 步（删 JSON 路径 + 退役开关为独立后续批次）。

import { RuleSet } from "../../types";
import { loadJsonFile, saveJsonFile } from "../../utils/file";
import {
  createRuleSetsPgRepository,
  type RuleSetStoreRepository,
} from "./rules-pg.repository";

const RULE_SET_PATH = "config/rules/example-rule-set.json";

export type { RuleSetStoreRepository, RuleSetsPgRepository } from "./rules-pg.repository";
export { RuleSetStoreError, createRuleSetsPgRepository } from "./rules-pg.repository";

// ============================================================
// JSON 实现（现状，阶段 1 批 6 签名已 async）
// ============================================================

function createRuleSetJsonRepository(): RuleSetStoreRepository {
  return {
    async loadRuleSet(): Promise<RuleSet> {
      return loadJsonFile<RuleSet>(RULE_SET_PATH);
    },
    async saveRuleSet(ruleSet: RuleSet): Promise<void> {
      saveJsonFile(RULE_SET_PATH, ruleSet);
    },
  };
}

// ============================================================
// 选择器（第 3 步开关：缺省 JSON，严格 === "true" 切 PG）
// ============================================================

let defaultRepo: RuleSetStoreRepository | null = null;

/** 进程内默认 repository 单例（生产路由使用）；开关只读一次，翻开关需重启 */
export function getRuleSetRepository(): RuleSetStoreRepository {
  if (!defaultRepo) {
    defaultRepo =
      process.env.WES_STORE_RULE_SETS_PG === "true"
        ? createRuleSetsPgRepository()
        : createRuleSetJsonRepository();
  }
  return defaultRepo;
}

/** 测试专用：重置单例 */
export function _resetRuleSetRepositoryForTest(): void {
  defaultRepo = null;
}

// ============================================================
// 公开 accessor（签名不变，经选择器分流）
// ============================================================

/**
 * 阶段 2 批 8：实现改经选择器（缺省 JSON / WES_STORE_RULE_SETS_PG=true 切 PG）。
 */
export async function loadRuleSet(): Promise<RuleSet> {
  return getRuleSetRepository().loadRuleSet();
}

/**
 * 阶段 2 批 8：实现改经选择器（缺省 JSON / WES_STORE_RULE_SETS_PG=true 切 PG）。
 */
export async function saveRuleSet(ruleSet: RuleSet): Promise<void> {
  return getRuleSetRepository().saveRuleSet(ruleSet);
}
