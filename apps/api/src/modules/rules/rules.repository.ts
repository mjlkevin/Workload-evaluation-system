// ============================================================
// RuleSets 域仓储入口（阶段 2 S6 终态：PG-only）
// ============================================================
// 阶段 2 批 8 起实现改经选择器分流（§3.1 形态）；S6（2026-08-29）删除
// JSON 读写路径并退役 WES_STORE_RULE_SETS_PG，选择器恒装配 PG 实现——
// 与 templates 域同批同形态（两域同为单文档 store，见台账 §10 B1）。
//
// seed 源文件 config/rules/example-rule-set.json 保留不删：它仍是
// db/seed.ts 的播种来源，删除即断 seed。

import { RuleSet } from "../../types";
import {
  createRuleSetsPgRepository,
  type RuleSetStoreRepository,
} from "./rules-pg.repository";

export type { RuleSetStoreRepository, RuleSetsPgRepository } from "./rules-pg.repository";
export { RuleSetStoreError, createRuleSetsPgRepository } from "./rules-pg.repository";

// ============================================================
// 选择器（S6 后恒 PG，无开关分流；单例语义保留）
// ============================================================

let defaultRepo: RuleSetStoreRepository | null = null;

/** 进程内默认 repository 单例（生产路由使用）；S6 后恒 PG 实现 */
export function getRuleSetRepository(): RuleSetStoreRepository {
  if (!defaultRepo) defaultRepo = createRuleSetsPgRepository();
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
 * 阶段 2 S6：实现改经选择器恒直连 PG（JSON 路径与开关已退役）。
 */
export async function loadRuleSet(): Promise<RuleSet> {
  return getRuleSetRepository().loadRuleSet();
}

/**
 * 阶段 2 S6：实现改经选择器恒直连 PG（JSON 路径与开关已退役）。
 */
export async function saveRuleSet(ruleSet: RuleSet): Promise<void> {
  return getRuleSetRepository().saveRuleSet(ruleSet);
}
