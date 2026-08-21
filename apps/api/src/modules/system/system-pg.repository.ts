// ============================================================
// System 域 PG 仓储（阶段 2 批 4 · 第 1–3 步）
// ============================================================
// 范围：system.repository.ts 的 8 个 accessor 对应的存储操作——
//   version_code_rules            行式表（sort_order 保序，事务内整表替换）
//   system_configs 三个 config key  jsonb 单行（requirementSettings /
//                                  implementationDependencyRules /
//                                  knowledgeBaseConfig）
// modelVerifyStatus 是第 5 个配置、独立路径，不在批 4 范围。
//
// 五条硬性范式落实（批 1–3 基准，harness 同源）：
//  1. 错误边界：SystemStoreError（稳定 code），每个公开方法 try/catch 后
//     经 toSafeError 收敛；pg/drizzle 原始错误（可能含 SQL 参数/连接串）不外泄。
//  2. 幂等：version_code_rules 为事务内整表替换（同一输入重复执行结果不变）；
//     system_configs 为 onConflictDoUpdate 单行 upsert（天然幂等）。
//  3. 并发控制：行级原子写替代 JSON 整存 RMW——不同 config key 并发写互不
//     覆盖（不同行）；同 key 并发写 last-writer-wins 收敛为完整输入（单语句
//     upsert，无字段混写）；version_code_rules 并发整表替换在事务锁下串行收敛。
//  4. 时间：列时间戳一律 readDbNow(tx)（DB 时钟），禁止 Date.now() 落库。
//  5. ISS-2026-08-18-004：读取失败必须抛错，禁止返回空结构兜底。
//     注意区分「读取失败」（抛 SystemStoreError）与「行不存在」：
//     knowledge-base-config.json 在 .gitignore 中，seed 可能未播种该 key，
//     缺行返回 null（默认值兜底在路由层，与 JSON「缺文件建默认」对齐），
//     且不在读路径写回（避免读触发写）。
//
// 缓存策略：不加缓存层。配置域读多写极少、表极小（4 配置），直查成本可忽略；
// 不加缓存则「管理界面改配置后立即生效」天然成立（无 TTL 滞后、无失效时机
// 问题），多副本部署下每次读即最新提交值，强一致。陈旧配置的可见性虽低于
// 会话内容，但配置错误的修复诉求恰恰是「改完立即生效」，缓存只会引入
// 失效协调成本而无收益。缓存语义用例见 system-pg.repository.test.ts。
//
// 密钥口径（与 JSON 路径逐条对齐，不改数据语义）：
//  - requirementSettings：save 复制 JSON save 的「非空 apiKey 先填充缓存、
//    落库前永久写空串」语义（真实密钥存凭据域）；load 读回同样写空。
//    JSON load 的「文件密钥一次性导入 DB」在 PG 路径不适用——PG save 从源头
//    不落密钥，存储中不存在待导入密钥。
//  - knowledgeBaseConfig：apiKey 随 jsonb 保存（与既有 JSON 文件行为一致，
//    属 pre-existing 安全姿态，本批不改）。

import { asc, eq, sql } from "drizzle-orm";

import { db, type Database } from "../../db/client";
import { readDbNow } from "../../db/now";
import { systemConfigs, versionCodeRules } from "../../db/schema";
import type {
  ImplementationDependencyRulesStore,
  KnowledgeBaseConfigStore,
  RequirementSystemConfigStore,
  VersionCodeRule,
  VersionCodeRulesStore,
} from "../../types";
import { KIMI_SCOPE, setCachedApiKey } from "./credentials.store";

// ============================================================
// 安全错误（范式 #1 / #5）
// ============================================================

export class SystemStoreError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "SystemStoreError";
    this.code = code;
  }
}

function toSafeError(err: unknown): SystemStoreError {
  if (err instanceof SystemStoreError) return err;
  return new SystemStoreError("SYSTEM_STORE_INTERNAL", "system store persistence failed");
}

// ============================================================
// 仓储契约（JSON 实现与 PG 实现共用；路由层选择器装配）
// ============================================================

export interface SystemStoreRepository {
  loadVersionCodeRulesStore(): Promise<VersionCodeRulesStore>;
  saveVersionCodeRulesStore(store: VersionCodeRulesStore): Promise<void>;
  /** 缺行返回 null（默认值兜底在路由层；JSON 实现永不返回 null） */
  loadRequirementSystemConfigStore(): Promise<RequirementSystemConfigStore | null>;
  saveRequirementSystemConfigStore(store: RequirementSystemConfigStore): Promise<void>;
  loadImplementationDependencyRulesStore(): Promise<ImplementationDependencyRulesStore | null>;
  saveImplementationDependencyRulesStore(store: ImplementationDependencyRulesStore): Promise<void>;
  loadKnowledgeBaseConfigStore(): Promise<KnowledgeBaseConfigStore | null>;
  saveKnowledgeBaseConfigStore(store: KnowledgeBaseConfigStore): Promise<void>;
}

// ============================================================
// 行 ↔ 记录映射
// ============================================================

const EMPTY_TIME = "--";

function parseIsoOrNull(value: unknown): Date | null {
  const text = String(value || "").trim();
  if (!text || text === EMPTY_TIME) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date : null;
}

type VersionCodeRuleRow = typeof versionCodeRules.$inferSelect;

function toRule(row: VersionCodeRuleRow): VersionCodeRule {
  return {
    id: row.ruleId,
    // module_key 为自由 text 列；业务侧字面量联合由 usecase 层校验（写入同源）
    moduleKey: row.moduleKey as VersionCodeRule["moduleKey"],
    moduleName: row.moduleName,
    moduleCode: row.moduleCode,
    prefix: row.prefix,
    format: row.format,
    sample: row.sample ?? "",
    status: row.status,
    effectiveAt: row.effectiveAt ? row.effectiveAt.toISOString() : EMPTY_TIME,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** requirementSettings 的 apiKey 写空（load/save 共用，与 JSON 路径同口径） */
function blankRequirementApiKey(
  store: RequirementSystemConfigStore,
): RequirementSystemConfigStore {
  return {
    ...store,
    draft: { ...store.draft, kimiCredentials: { ...store.draft?.kimiCredentials, apiKey: "" } },
    active: { ...store.active, kimiCredentials: { ...store.active?.kimiCredentials, apiKey: "" } },
  };
}

// ============================================================
// 工厂
// ============================================================

export interface SystemPgRepository extends SystemStoreRepository {
  /** 测试钩子：暴露注入的 db 实例供用例做行级清理 */
  __dbForTest(): Database;
}

export function createSystemPgRepository(dbInstance: Database = db): SystemPgRepository {
  async function loadConfigRow(configKey: string) {
    const [row] = await dbInstance
      .select()
      .from(systemConfigs)
      .where(eq(systemConfigs.configKey, configKey))
      .limit(1);
    return row ?? null;
  }

  async function upsertConfig(configKey: string, store: unknown, version: number): Promise<void> {
    // 单语句 upsert：同 key 并发写收敛为完整输入（无字段混写），天然幂等
    await dbInstance.transaction(async (tx) => {
      const now = await readDbNow(tx);
      await tx
        .insert(systemConfigs)
        .values({ configKey, store, version, updatedAt: now, effectiveAt: now })
        .onConflictDoUpdate({
          target: systemConfigs.configKey,
          set: { store, version, updatedAt: now, effectiveAt: now },
        });
    });
  }

  return {
    __dbForTest() {
      return dbInstance;
    },

    // ── version_code_rules：行式表，sort_order 保序 ──

    async loadVersionCodeRulesStore() {
      try {
        // JSON 数组顺序对 UI 可见：必须按 sort_order 读取（ruleId 兜底确定性）
        const rows = await dbInstance
          .select()
          .from(versionCodeRules)
          .orderBy(asc(versionCodeRules.sortOrder), asc(versionCodeRules.ruleId));
        return { rules: rows.map(toRule) };
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async saveVersionCodeRulesStore(store) {
      try {
        // 整表替换（与 JSON 整存写语义等价：rules 集合作为整体保存）。
        // 必须用 TRUNCATE 而非 DELETE：DELETE 只锁「已有行」，两个并发事务
        // 各自 DELETE 后可同时 INSERT 造成行混合；TRUNCATE 取表级锁（ACCESS
        // EXCLUSIVE），并发整表替换严格串行，最终收敛为其中一个完整输入。
        // （并发用例实测：DELETE 版本必现行混合缺陷，TRUNCATE 后 5/5 收敛。）
        await dbInstance.transaction(async (tx) => {
          const now = await readDbNow(tx);
          await tx.execute(sql`TRUNCATE TABLE ${versionCodeRules}`);
          if (store.rules.length === 0) return;
          await tx.insert(versionCodeRules).values(
            store.rules.map((rule, index) => ({
              ruleId: rule.id,
              moduleKey: rule.moduleKey,
              moduleName: rule.moduleName,
              moduleCode: rule.moduleCode,
              prefix: rule.prefix,
              format: rule.format,
              sample: rule.sample,
              status: rule.status,
              // 写入数组顺序：读路径据此还原 UI 可见顺序
              sortOrder: index,
              effectiveAt: parseIsoOrNull(rule.effectiveAt),
              updatedAt: parseIsoOrNull(rule.updatedAt) ?? now,
            })),
          );
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    // ── system_configs 三 key：jsonb 单行 upsert ──

    async loadRequirementSystemConfigStore() {
      try {
        const row = await loadConfigRow("requirementSettings");
        if (!row) return null;
        // 与 JSON load 同口径：apiKey 读回必为空串（真实密钥存凭据域）
        return blankRequirementApiKey(row.store as RequirementSystemConfigStore);
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async saveRequirementSystemConfigStore(store) {
      try {
        // 复制 JSON save 语义（system.repository.ts 同名 Json 实现）：
        // store 中有非空 apiKey 时先填充缓存（直接调用场景），落库前永久写空串
        const effectiveKey = (
          store.active?.kimiCredentials?.apiKey ||
          store.draft?.kimiCredentials?.apiKey ||
          ""
        ).trim();
        if (effectiveKey) {
          setCachedApiKey(KIMI_SCOPE, effectiveKey);
        }
        await upsertConfig("requirementSettings", blankRequirementApiKey(store), store.version);
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async loadImplementationDependencyRulesStore() {
      try {
        const row = await loadConfigRow("implementationDependencyRules");
        return row ? (row.store as ImplementationDependencyRulesStore) : null;
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async saveImplementationDependencyRulesStore(store) {
      try {
        await upsertConfig("implementationDependencyRules", store, store.version);
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async loadKnowledgeBaseConfigStore() {
      try {
        const row = await loadConfigRow("knowledgeBaseConfig");
        return row ? (row.store as KnowledgeBaseConfigStore) : null;
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async saveKnowledgeBaseConfigStore(store) {
      try {
        await upsertConfig("knowledgeBaseConfig", store, store.version);
      } catch (err) {
        throw toSafeError(err);
      }
    },
  };
}
