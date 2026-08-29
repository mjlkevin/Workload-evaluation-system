// ============================================================
// 测试基建：单文档表（templates / rule_sets）种子注入与清理
// ============================================================
// 阶段 2 S6（2026-08-29）：两域的 JSON 读写路径与 WES_STORE_TEMPLATES_PG /
// WES_STORE_RULE_SETS_PG 开关删除后，仓储选择器恒 PG。原先「delete 开关强制
// 走 JSON 实现」的测试隔离法随之失效——被测路径只会去读 PG，而 DB seed 在
// CI 里排在 Test modules 之后（见 .github/workflows/ci.yml：migrate → test:ai
// → test:modules → serial → **db:seed** → integration），此时 templates /
// rule_sets 两张表是空的。空表下 loadRuleSet() 抛 RULE_SET_STORE_NOT_FOUND，
// 凡依赖活动文档的用例都会红（台账 §10 B3：与 B1 同族的存储语义互斥，
// B1 是写者争抢最近写入行，B3 是读者依赖表非空）。
//
// 处置口径（沿用 S1 users 域 test-helpers/test-users.ts 的同一形态）：
// 用例自己经**生产选择器同源的仓储**把 seed 源 fixture 内容写入 PG，
// after 按唯一前缀条件 DELETE（§4.6/C5 数据集隔离，不整表 TRUNCATE）。
// 读写同源，不出现「测试写 test 库、被测代码读 DATABASE_URL」的双连接分裂。
//
// 为什么改 id 前缀而不保留 fixture 原 id：
//  - 单文档表的 load 语义是「updated_at 最新的行」，不按主键取；保留原 id
//    会让多个文件的行互相 upsert 覆盖，且无法按前缀做隔离清理。
//  - 前缀后每个文件拥有自己的行，cleanup 是 LIKE prefix% 的条件 DELETE。
//  因此返回值即「实际落库的文档」，调用方必须用返回的 templateId/ruleSetId
//  构造请求（engine.ts:103 会比对 body 与活动文档的 id，不一致判 not_found）。
//
// 竞态约束：本 helper 是写入方。凡 import 它的测试文件都必须落在
// test:modules:serial-store 串行套件内——守卫
// （single-doc-serial-scope.drift.test.ts）以 seedSingleDocStoreFixture 为
// 写入指纹之一，漏登记即判红。本文件不是 *.test.ts，不在守卫扫描范围内。
// ============================================================

import type { RuleSet, Template } from "../types";
import { loadJsonFile } from "../utils/file";
// 直取 PG 实现模块（不经域 barrel）：cleanup* / __dbForTest 是测试专用带外 API，
// 本就不该出现在对外入口上；与本域自有测试文件（templates-pg.repository.test.ts）
// 的 import 路径保持一致。
import {
  cleanupTemplateRowsByPrefix,
  createTemplatesPgRepository,
} from "../modules/templates/templates-pg.repository";
import {
  cleanupRuleSetRowsByPrefix,
  createRuleSetsPgRepository,
} from "../modules/rules/rules-pg.repository";

/** seed 源文件（长期留存：db/seed.ts 的播种来源，本 helper 只读不写）。 */
const TEMPLATE_FIXTURE = "config/templates/example-template.json";
const RULE_SET_FIXTURE = "config/rules/example-rule-set.json";

export interface SingleDocStoreSeed {
  /** 行 id 前缀，cleanup 按此条件删除。 */
  prefix: string;
  /** 实际落库的模板（templateId 已改为 prefix 派生）。 */
  template: Template;
  /** 实际落库的规则集（ruleSetId 已改为 prefix 派生）。 */
  ruleSet: RuleSet;
}

/**
 * 把 seed 源 fixture 内容写入 PG 单文档表，返回落库后的文档。
 * @param prefix 本文件专属行前缀（建议 wes-t-<域>-，避免与其他文件相撞）
 */
export async function seedSingleDocStoreFixture(prefix: string): Promise<SingleDocStoreSeed> {
  const template: Template = {
    ...loadJsonFile<Template>(TEMPLATE_FIXTURE),
    templateId: `${prefix}tmpl`,
  };
  const ruleSet: RuleSet = {
    ...loadJsonFile<RuleSet>(RULE_SET_FIXTURE),
    ruleSetId: `${prefix}rules`,
  };
  await createTemplatesPgRepository().saveTemplate(template);
  await createRuleSetsPgRepository().saveRuleSet(ruleSet);
  return { prefix, template, ruleSet };
}

/** 按前缀条件清理本 helper 写入的行（不影响其他文件/真实数据）。 */
export async function cleanupSingleDocStoreFixture(prefix: string): Promise<void> {
  await cleanupTemplateRowsByPrefix(createTemplatesPgRepository().__dbForTest(), prefix);
  await cleanupRuleSetRowsByPrefix(createRuleSetsPgRepository().__dbForTest(), prefix);
}
