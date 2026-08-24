// ============================================================
// RuleSets 域 PG 仓储（阶段 2 批 8 · 第 1–3 步）
// ============================================================
// 接口形态：单文档 load/save（与 JSON 整文件语义 1:1），与
// templates-pg.repository.ts 同构——rule_sets 域只有一个活动
// 规则集（config/rules/example-rule-set.json 整文件 = 唯一文档），
// 管理端导入（importRuleSetJson）整体替换。
//
// PG 侧形态（表已存在，字段 1:1，批 8 零 migration）：
//  - rule_sets 表以 rule_set_id 为主键；写入为「按输入 ruleSetId
//    的单行 upsert」，读取取「最近写入行」（updated_at DESC +
//    rule_set_id DESC 确定性兜底）为活动规则集。
//  - 不做整表替换/TRUNCATE（持续性约束 §4.9 C1）：单行 upsert 满足
//    「整文档替换」API 契约（getActiveRuleSet / getRuleSetMeta /
//    估算上下文与 agent 规则查询工具全部经 loadRuleSet() 只见活动
//    文档）；被替换的旧行不对任何 API 可见，由 db:seed --force 兜底。
//
// 五条硬性范式落实（与 templates 同，批 1–7 基准）：
//  1. 错误边界：RuleSetStoreError（稳定 code）+ toSafeError 收敛，
//     原始错误（可能含 SQL 参数/连接串）不外泄。
//  2. 幂等：单行 upsert 对同一输入重复执行结果不变。
//  3. 并发控制：单语句 upsert 无字段混写，同/不同 ruleSetId 并发写
//     均 last-writer-wins 收敛为完整输入（与 JSON 整文件写同构）。
//  4. 时间：updated_at 一律 readDbNow(tx)（DB 时钟）。
//  5. ISS-2026-08-18-004：读取失败抛错；缺行抛
//     RULE_SET_STORE_NOT_FOUND（对齐 JSON「缺文件抛错」语义）。
//
// 缓存策略：不加缓存层。理由：①rule_sets 行体积极小（KB 级，
//    对照模板 414KB 实测亚 3ms，规则集直查更低）；②规则集经管理端
//    导入后必须立即生效（估算口径不容 TTL 滞后）；③多副本部署下
//    进程级缓存引入分歧（§4.7 同论证）；④读取为每次估算/规则查询
//    一次，非高频循环读。带外 SQL 写入立即可见由测试用例证明。

import { desc, sql } from "drizzle-orm";

import { db, type Database } from "../../db/client";
import { readDbNow } from "../../db/now";
import { ruleSets } from "../../db/schema";
import type { RuleSet } from "../../types";

// ============================================================
// 安全错误（范式 #1 / #5）
// ============================================================

export class RuleSetStoreError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "RuleSetStoreError";
    this.code = code;
  }
}

function toSafeError(err: unknown): RuleSetStoreError {
  if (err instanceof RuleSetStoreError) return err;
  return new RuleSetStoreError("RULE_SET_STORE_INTERNAL", "rule set store persistence failed");
}

// ============================================================
// 仓储接口（JSON / PG 双实现共用）
// ============================================================

export interface RuleSetStoreRepository {
  /** 读取活动规则集（范式 #5：失败/缺行抛错） */
  loadRuleSet(): Promise<RuleSet>;
  /** 整文档替换写入（按输入 ruleSetId 单行 upsert） */
  saveRuleSet(ruleSet: RuleSet): Promise<void>;
}

export type RuleSetsPgRepository = RuleSetStoreRepository & {
  /** 测试专用：暴露底层连接以做带外断言/清理 */
  __dbForTest(): Database;
};

// ============================================================
// PG 实现
// ============================================================

export function createRuleSetsPgRepository(dbInstance: Database = db): RuleSetsPgRepository {
  async function loadRuleSet(): Promise<RuleSet> {
    try {
      const rows = await dbInstance
        .select()
        .from(ruleSets)
        .orderBy(desc(ruleSets.updatedAt), desc(ruleSets.ruleSetId))
        .limit(1);
      const row = rows[0];
      if (!row) {
        throw new RuleSetStoreError("RULE_SET_STORE_NOT_FOUND", "rule set row missing");
      }
      return {
        ruleSetId: row.ruleSetId,
        ruleVersion: row.ruleVersion,
        pipelineVersion: row.pipelineVersion,
        pipeline: row.pipeline as RuleSet["pipeline"],
        baseRule: row.baseRule as RuleSet["baseRule"],
        orgIncrementRule: row.orgIncrementRule as RuleSet["orgIncrementRule"],
      };
    } catch (err) {
      throw toSafeError(err);
    }
  }

  async function saveRuleSet(ruleSet: RuleSet): Promise<void> {
    try {
      await dbInstance.transaction(async (tx) => {
        const now = await readDbNow(tx);
        const values = {
          ruleSetId: ruleSet.ruleSetId,
          ruleVersion: ruleSet.ruleVersion,
          pipelineVersion: ruleSet.pipelineVersion,
          pipeline: ruleSet.pipeline,
          baseRule: ruleSet.baseRule,
          orgIncrementRule: ruleSet.orgIncrementRule,
          updatedAt: now,
        };
        await tx
          .insert(ruleSets)
          .values(values)
          .onConflictDoUpdate({
            target: ruleSets.ruleSetId,
            set: values,
          });
      });
    } catch (err) {
      throw toSafeError(err);
    }
  }

  return {
    __dbForTest() {
      return dbInstance;
    },
    loadRuleSet,
    saveRuleSet,
  };
}

// 测试专用：带外核对行数（共享测试库数据集隔离，禁止整表计数）。
export async function countRuleSetRowsByPrefix(
  dbInstance: Database,
  prefix: string
): Promise<number> {
  const result = await dbInstance.execute(
    sql`SELECT count(*)::int AS n FROM rule_sets WHERE rule_set_id LIKE ${prefix + "%"}`
  );
  return Number((result.rows as Array<{ n: number }>)[0]?.n ?? 0);
}

/** 测试专用：按前缀条件清理（数据集隔离，不整表 TRUNCATE）。 */
export async function cleanupRuleSetRowsByPrefix(
  dbInstance: Database,
  prefix: string
): Promise<void> {
  await dbInstance.execute(sql`DELETE FROM rule_sets WHERE rule_set_id LIKE ${prefix + "%"}`);
}
