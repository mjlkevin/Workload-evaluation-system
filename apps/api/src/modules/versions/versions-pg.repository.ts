// ============================================================
// Versions 域 PG 仓储（阶段 2 批 6 · 第 1–3 步）
// ============================================================
// 目标表：version_records（D8 决定，评估版本域自用的 assessment_versions
// 不在本批范围，不得触碰）。表结构在阶段 0 事项 3/6 已与 VersionRecord
// 逐字段对齐（25 字段 ↔ 26 列，recordId = id），本批无需新增 migration。
//
// 五条硬性范式落实（批 1–5 基准，harness 同源）：
//  1. 错误边界：VersionsStoreError（稳定 code VERSIONS_STORE_INTERNAL），
//     每个公开方法 try/catch 后经 toSafeError 收敛；pg/drizzle 原始错误
//     （可能含 SQL 参数/连接串）不外泄。
//  2. 幂等：createVersionRecord 用 onConflictDoNothing().returning() + 空
//     结果按主键重查消歧；upsertVersionRecord 用 onConflictDoUpdate 整行
//     覆写（重放结果不变）。
//  3. 并发控制：全部写操作为单行/双行事务内行级原子写——
//     - checkout 为条件 UPDATE（WHERE checkout_status='checked_in'）CAS：
//       并发检出恰一个赢家（对齐 §2 批 6「检入检出 CAS 语义依赖 PG
//       条件 UPDATE」）；
//     - checkin / promote 为事务内 SELECT ... FOR UPDATE 行锁串行化；
//     - 不同版本记录并发写互不覆盖（行级写互不干涉，JSON 整存 RMW 的
//       跨记录丢失更新在此消除）。
//  4. 时间：仓储自身产生的时间戳一律 readDbNow(tx)（DB 时钟），禁止
//     Date.now() 落库；usecase 生成的业务时间戳（记录自带 createdAt 等）
//     按值透传（与批 1–5 同口径）。
//  5. ISS-2026-08-18-004：读取失败必须抛错（VersionsStoreError），禁止
//     返回空结构兜底——本约束的原始现场就在 versions 域（JSON 实现
//     catch 后 return { records: [] }）。注意区分「读取失败」（抛错）与
//     「行不存在」（返回 null / 结构化失败原因）。
//
// 读中带写处置（批 6 核心决策，架构侧三选一 → 选「不迁移修复逻辑」）：
// JSON 实现的 repairGlobalPlaceholderVersionCodes 修复两类历史脏码——
// ①旧编码引擎未展开的 {TOKEN} 占位码；②绕过编码引擎的 PROJECT-{uuid}。
// 两类产生路径在当前代码均已不存在（①的写入方旧编码引擎已被规则引擎
// 替换，现网写入必经 applyVersionCodeFormat 全量展开；②的写入方已删除，
// 全仓 grep 仅剩修复正则本身）；现存 records.json 19 条实测 0 条命中。
// 叠加 D2/D7 零数据迁移（PG 空库启动），PG 侧不存在也不会产生需要修复
// 的占位码——修复逻辑不进 PG 仓储，且随本批从读路径剥离（见
// versions.repository.ts 头部说明），读路径纯读。
//
// 缓存策略：不加缓存层。理由：①版本记录用户直接可见（工作台列表/检入
// 检出状态），陈旧状态会直接误导操作（对已检出版本发起检出）；②写操作
// 频繁且语义敏感（CAS），缓存失效协调成本高于直查收益；③表规模小、
// owner_type / owner_code / updated 三索引支撑直查，亚毫秒级；④多副本
// 部署天然强一致。带外 SQL 写入立即可见由测试用例证明。

import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { db, type Database } from "../../db/client";
import { readDbNow } from "../../db/now";
import { versionRecords } from "../../db/schema";
import type { VersionRecord } from "../../types";

// ============================================================
// 安全错误（范式 #1 / #5）
// ============================================================

export class VersionsStoreError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "VersionsStoreError";
    this.code = code;
  }
}

function toSafeError(err: unknown): VersionsStoreError {
  if (err instanceof VersionsStoreError) return err;
  return new VersionsStoreError("VERSIONS_STORE_INTERNAL", "versions store persistence failed");
}

// ============================================================
// 仓储契约输入/输出类型（JSON 实现与 PG 实现共用）
// ============================================================

/** 审计字段（操作人）：与 usecase 现有字段口径一致 */
export type VersionActor = { actorUserId: string; actorUsername: string };

export type VersionListFilter = {
  ownerUserId?: string;
  type?: VersionRecord["type"];
  templateId?: string;
};

export type CheckoutVersionInput = VersionActor & { recordId: string };

export type CheckoutVersionResult =
  | { outcome: "ok"; record: VersionRecord }
  | { outcome: "not_found" }
  | { outcome: "historical_archive" }
  | { outcome: "reviewed_readonly" }
  | { outcome: "already_checked_out"; checkedOutByUsername?: string };

export type CheckinVersionInput = VersionActor & {
  recordId: string;
  /** 检入时随附的新 payload；缺省沿用当前 payload */
  payload?: Record<string, unknown> | null;
};

export type CheckinVersionResult =
  | { outcome: "ok"; record: VersionRecord }
  | { outcome: "not_found" }
  | { outcome: "not_checked_out" }
  | { outcome: "not_checkout_owner" };

export type PromoteVersionInput = VersionActor & {
  archiveRecordId: string;
  /** 新版本记录（usecase 构造完整行，含新 id/versionCode/检出态） */
  newRecord: VersionRecord;
};

export type PromoteVersionResult =
  | { outcome: "ok"; archived: VersionRecord; newRecord: VersionRecord }
  | { outcome: "not_found" }
  | { outcome: "must_be_checked_in" }
  | { outcome: "must_be_drafting" }
  | { outcome: "historical_archive" };

export type DeleteVersionInput = {
  recordId: string;
  /**
   * 是否执行「被总方案引用不可删」检查（type=global 删除时传 false）。
   * 检查口径对齐 isVersionReferencedByGlobal。
   */
  checkReferenced: boolean;
  /** checkReferenced=true 时必传：目标记录类型（决定 payload 引用字段） */
  targetType?: Exclude<VersionRecord["type"], "global">;
};

export type DeleteVersionResult = { existed: boolean; referenced: boolean };

/** 删除引用检查的 payload 字段映射（与 isVersionReferencedByGlobal 同源） */
export const VERSION_REFERENCE_PAYLOAD_FIELDS: Record<Exclude<VersionRecord["type"], "global">, string> = {
  assessment: "assessmentVersionCode",
  resource: "resourceVersionCode",
  requirementImport: "requirementImportVersionCode",
  dev: "devAssessmentVersionCode",
};

// ============================================================
// 仓储接口（行级；批 2 结论复用——整存 load→改→save 无法表达幂等插入
// 与条件 UPDATE CAS，接口收敛为行级操作）
// ============================================================

export interface VersionsStoreRepository {
  // ── 读（纯读；失败抛错，缺行返回 null） ──
  /** 列表（按 updatedAt desc、recordId 兜底确定性）；条件均可选 */
  listRecords(filter: VersionListFilter): Promise<VersionRecord[]>;
  findRecordById(recordId: string): Promise<VersionRecord | null>;
  /** 唯一性/冲突查询（owner+type+template+code 组合索引支撑） */
  findRecordByCode(
    ownerUserId: string,
    type: VersionRecord["type"],
    templateId: string,
    versionCode: string
  ): Promise<VersionRecord | null>;

  // ── 写 ──
  /** 幂等插入：同 recordId 冲突重放返回原记录（created=false，范式 #2） */
  createVersionRecord(record: VersionRecord): Promise<{ created: boolean; record: VersionRecord }>;
  /** 整行 upsert（project-evaluations 的 saveProjectRecord 语义） */
  upsertVersionRecord(record: VersionRecord): Promise<VersionRecord>;
  /**
   * 批量整行 upsert，一次原子提交（JSON 侧单次整存落盘；PG 侧单事务）。
   * 保留 saveProjectRecords「多记录一次提交」的原语义（harness 草稿
   * 项目+评估双记录原子落盘契约），禁止逐行多次提交。
   */
  upsertVersionRecords(records: VersionRecord[]): Promise<void>;
  /**
   * 行级 patch 更新（行锁串行化 merge）：存在返回更新后记录；不存在返回
   * null。patch 中显式传 null 的可选字段表示清除（对齐 JSON 的
   * `field = undefined` 语义）。
   */
  updateVersionRecord(
    recordId: string,
    patch: Partial<Record<keyof VersionRecord, unknown>>
  ): Promise<VersionRecord | null>;
  /** 检出（条件 UPDATE CAS：仅 checked_in 可检出，并发恰一赢家） */
  checkoutVersionRecord(input: CheckoutVersionInput): Promise<CheckoutVersionResult>;
  /** 检入（行锁事务：版本号递增 + 释放锁，原子完成） */
  checkinVersionRecord(input: CheckinVersionInput): Promise<CheckinVersionResult>;
  /** 升版（行锁事务：旧记录归档 + 新记录插入，原子完成） */
  promoteVersionRecord(input: PromoteVersionInput): Promise<PromoteVersionResult>;
  /** 删除（含可选的总方案引用检查） */
  deleteVersionRecord(input: DeleteVersionInput): Promise<DeleteVersionResult>;
}

// ============================================================
// 行 ↔ 记录映射（PG timestamptz → ISO 字符串契约）
// ============================================================

type VersionRecordRow = typeof versionRecords.$inferSelect;

function toVersionRecord(row: VersionRecordRow): VersionRecord {
  const record: VersionRecord = {
    id: row.recordId,
    type: row.type as VersionRecord["type"],
    versionCode: row.versionCode,
    templateId: row.templateId,
    ownerUserId: row.ownerUserId,
    status: row.status as VersionRecord["status"],
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdByUserId: row.createdByUserId,
    createdByUsername: row.createdByUsername,
    updatedByUserId: row.updatedByUserId,
    updatedByUsername: row.updatedByUsername,
    checkoutStatus: row.checkoutStatus as VersionRecord["checkoutStatus"],
    versionDocStatus: row.versionDocStatus as VersionRecord["versionDocStatus"],
    majorLetter: row.majorLetter,
    minorNumber: row.minorNumber,
    baseCode: row.baseCode,
    isHistoricalArchive: row.isHistoricalArchive,
    lastCheckinPayload: (row.lastCheckinPayload ?? undefined) as Record<string, unknown> | undefined,
  };
  if (row.reviewedAt) record.reviewedAt = row.reviewedAt.toISOString();
  if (row.reviewedByUserId) record.reviewedByUserId = row.reviewedByUserId;
  if (row.checkedOutByUserId) record.checkedOutByUserId = row.checkedOutByUserId;
  if (row.checkedOutByUsername) record.checkedOutByUsername = row.checkedOutByUsername;
  if (row.checkoutAt) record.checkoutAt = row.checkoutAt.toISOString();
  if (row.archivedAt) record.archivedAt = row.archivedAt.toISOString();
  return record;
}

type VersionRecordValues = typeof versionRecords.$inferInsert;

function toRowValues(record: VersionRecord): VersionRecordValues {
  return {
    recordId: record.id,
    type: record.type,
    versionCode: record.versionCode,
    templateId: record.templateId,
    ownerUserId: record.ownerUserId,
    status: record.status,
    payload: record.payload ?? {},
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    createdByUserId: record.createdByUserId,
    createdByUsername: record.createdByUsername,
    updatedByUserId: record.updatedByUserId,
    updatedByUsername: record.updatedByUsername,
    reviewedAt: record.reviewedAt ? new Date(record.reviewedAt) : null,
    reviewedByUserId: record.reviewedByUserId ?? null,
    checkoutStatus: record.checkoutStatus,
    versionDocStatus: record.versionDocStatus,
    checkedOutByUserId: record.checkedOutByUserId ?? null,
    checkedOutByUsername: record.checkedOutByUsername ?? null,
    checkoutAt: record.checkoutAt ? new Date(record.checkoutAt) : null,
    majorLetter: record.majorLetter,
    minorNumber: record.minorNumber,
    baseCode: record.baseCode,
    isHistoricalArchive: record.isHistoricalArchive,
    archivedAt: record.archivedAt ? new Date(record.archivedAt) : null,
    lastCheckinPayload: record.lastCheckinPayload ?? null,
  };
}

// ============================================================
// 工厂
// ============================================================

export interface VersionsPgRepository extends VersionsStoreRepository {
  /** 测试钩子：暴露注入的 db 实例供用例做行级清理/确定性插入 */
  __dbForTest(): Database;
}

export function createVersionsPgRepository(dbInstance: Database = db): VersionsPgRepository {
  return {
    __dbForTest() {
      return dbInstance;
    },

    // ── 读路径（纯读；范式 #5：失败抛错，缺行返回 null） ──

    async listRecords(filter) {
      try {
        const conditions: SQL[] = [];
        if (filter.ownerUserId) conditions.push(eq(versionRecords.ownerUserId, filter.ownerUserId));
        if (filter.type) conditions.push(eq(versionRecords.type, filter.type));
        if (filter.templateId) conditions.push(eq(versionRecords.templateId, filter.templateId));
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        // updatedAt desc 对齐 usecase 列表排序；recordId 兜底确定性
        const rows = await dbInstance
          .select()
          .from(versionRecords)
          .where(where)
          .orderBy(desc(versionRecords.updatedAt), asc(versionRecords.recordId));
        return rows.map(toVersionRecord);
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async findRecordById(recordId) {
      try {
        const [row] = await dbInstance.select().from(versionRecords).where(eq(versionRecords.recordId, recordId));
        return row ? toVersionRecord(row) : null;
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async findRecordByCode(ownerUserId, type, templateId, versionCode) {
      try {
        // version_records_owner_code_idx 覆盖（owner, type, template, code）
        const [row] = await dbInstance
          .select()
          .from(versionRecords)
          .where(
            and(
              eq(versionRecords.ownerUserId, ownerUserId),
              eq(versionRecords.type, type),
              eq(versionRecords.templateId, templateId),
              eq(versionRecords.versionCode, versionCode)
            )
          )
          .limit(1);
        return row ? toVersionRecord(row) : null;
      } catch (err) {
        throw toSafeError(err);
      }
    },

    // ── 写路径 ──

    async createVersionRecord(record) {
      try {
        const inserted = await dbInstance
          .insert(versionRecords)
          .values(toRowValues(record))
          .onConflictDoNothing()
          .returning();
        if (inserted.length > 0) return { created: true, record: toVersionRecord(inserted[0]) };
        // 幂等消歧：插入被跳过（recordId 冲突）→ 重查返回原记录（范式 #2）
        const [byId] = await dbInstance
          .select()
          .from(versionRecords)
          .where(eq(versionRecords.recordId, record.id));
        if (byId) return { created: false, record: toVersionRecord(byId) };
        throw new VersionsStoreError("VERSIONS_STORE_INTERNAL", "version insert conflict unresolved");
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async upsertVersionRecord(record) {
      try {
        const values = toRowValues(record);
        const [row] = await dbInstance
          .insert(versionRecords)
          .values(values)
          .onConflictDoUpdate({ target: versionRecords.recordId, set: values })
          .returning();
        return row ? toVersionRecord(row) : record;
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async upsertVersionRecords(records) {
      if (records.length === 0) return;
      try {
        // 单事务一次提交多行，对齐 JSON 侧单次整存落盘的原子语义；
        // 中途失败整体回滚，不出现部分记录落库的中间态。
        await dbInstance.transaction(async (tx) => {
          for (const record of records) {
            const values = toRowValues(record);
            await tx
              .insert(versionRecords)
              .values(values)
              .onConflictDoUpdate({ target: versionRecords.recordId, set: values });
          }
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async updateVersionRecord(recordId, patch) {
      try {
        return await dbInstance.transaction(async (tx) => {
          // 行锁串行化：同记录并发 patch 不撕裂（范式 #3）
          const rows = await tx.select().from(versionRecords).where(eq(versionRecords.recordId, recordId)).for("update");
          const row = rows[0];
          if (!row) return null;
          const current = toVersionRecord(row);
          const merged: VersionRecord = { ...current, ...(patch as Partial<VersionRecord>) };
          // patch 显式传 null 的可选字段表示清除（JSON 侧对应删除键）
          for (const key of Object.keys(patch)) {
            if ((patch as Record<string, unknown>)[key] === null) {
              delete (merged as Record<string, unknown>)[key];
            }
          }
          const [updated] = await tx
            .update(versionRecords)
            .set(toRowValues(merged))
            .where(eq(versionRecords.recordId, recordId))
            .returning();
          return updated ? toVersionRecord(updated) : null;
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async checkoutVersionRecord(input) {
      try {
        return await dbInstance.transaction(async (tx) => {
          const now = await readDbNow(tx);
          // 条件 UPDATE CAS（范式 #3）：仅 checked_in 行可检出，并发恰一赢家
          const updated = await tx
            .update(versionRecords)
            .set({
              checkoutStatus: "checked_out",
              checkedOutByUserId: input.actorUserId,
              checkedOutByUsername: input.actorUsername,
              checkoutAt: now,
              updatedAt: now,
              updatedByUserId: input.actorUserId,
              updatedByUsername: input.actorUsername,
              // 检出时落当前 payload 快照（对齐 JSON 原 handler）：检出态下若经
              // save-draft 改了 payload，撤销检出按该快照恢复；引用本行 payload
              // 列，条件 UPDATE 内直接取当前值。
              lastCheckinPayload: sql`${versionRecords.payload}`,
            })
            .where(
              and(
                eq(versionRecords.recordId, input.recordId),
                eq(versionRecords.checkoutStatus, "checked_in"),
                // CAS 前置校验入条件（对齐 JSON 原 handler 先校验后写）：
                // 历史归档 / 已审核文档不得被检出，否则条件 UPDATE 会直接成功。
                eq(versionRecords.isHistoricalArchive, false),
                ne(versionRecords.versionDocStatus, "reviewed"),
              ),
            )
            .returning();
          if (updated.length > 0) return { outcome: "ok", record: toVersionRecord(updated[0]) } as CheckoutVersionResult;
          // CAS 失败消歧：行不存在 / 历史归档 / 已审核文档 / 已被检出
          const [row] = await tx.select().from(versionRecords).where(eq(versionRecords.recordId, input.recordId));
          if (!row) return { outcome: "not_found" } as CheckoutVersionResult;
          if (row.isHistoricalArchive) return { outcome: "historical_archive" } as CheckoutVersionResult;
          if (row.versionDocStatus === "reviewed") return { outcome: "reviewed_readonly" } as CheckoutVersionResult;
          return {
            outcome: "already_checked_out",
            checkedOutByUsername: row.checkedOutByUsername ?? undefined,
          } as CheckoutVersionResult;
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async checkinVersionRecord(input) {
      try {
        return await dbInstance.transaction(async (tx) => {
          const now = await readDbNow(tx);
          // 行锁串行化：检入含版本号递增，禁止撕裂（范式 #3）
          const rows = await tx.select().from(versionRecords).where(eq(versionRecords.recordId, input.recordId)).for("update");
          const row = rows[0];
          if (!row) return { outcome: "not_found" } as CheckinVersionResult;
          if (row.checkoutStatus !== "checked_out") return { outcome: "not_checked_out" } as CheckinVersionResult;
          if (row.checkedOutByUserId !== input.actorUserId) return { outcome: "not_checkout_owner" } as CheckinVersionResult;

          const nextMinor = row.minorNumber + 1;
          const baseCode = row.baseCode || row.versionCode;
          const newVersionCode = `${baseCode}-V${row.majorLetter}${nextMinor}`;
          const payload = input.payload ?? ((row.payload ?? {}) as Record<string, unknown>);
          const [updated] = await tx
            .update(versionRecords)
            .set({
              versionCode: newVersionCode,
              minorNumber: nextMinor,
              baseCode,
              checkoutStatus: "checked_in",
              checkedOutByUserId: null,
              checkedOutByUsername: null,
              checkoutAt: null,
              payload,
              lastCheckinPayload: payload,
              updatedAt: now,
              updatedByUserId: input.actorUserId,
              updatedByUsername: input.actorUsername,
            })
            .where(eq(versionRecords.recordId, input.recordId))
            .returning();
          return { outcome: "ok", record: toVersionRecord(updated) } as CheckinVersionResult;
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async promoteVersionRecord(input) {
      try {
        return await dbInstance.transaction(async (tx) => {
          const now = await readDbNow(tx);
          // 行锁串行化：归档 + 新行为单一原子事务
          const rows = await tx.select().from(versionRecords).where(eq(versionRecords.recordId, input.archiveRecordId)).for("update");
          const row = rows[0];
          if (!row) return { outcome: "not_found" } as PromoteVersionResult;
          if (row.checkoutStatus !== "checked_in") return { outcome: "must_be_checked_in" } as PromoteVersionResult;
          if (row.versionDocStatus !== "drafting") return { outcome: "must_be_drafting" } as PromoteVersionResult;
          if (row.isHistoricalArchive) return { outcome: "historical_archive" } as PromoteVersionResult;

          const [archived] = await tx
            .update(versionRecords)
            .set({
              isHistoricalArchive: true,
              archivedAt: now,
              updatedAt: now,
              updatedByUserId: input.actorUserId,
              updatedByUsername: input.actorUsername,
            })
            .where(eq(versionRecords.recordId, input.archiveRecordId))
            .returning();

          const [created] = await tx
            .insert(versionRecords)
            .values(toRowValues(input.newRecord))
            .onConflictDoNothing()
            .returning();
          if (!created) {
            throw new VersionsStoreError("VERSIONS_STORE_INTERNAL", "promote insert conflict");
          }
          return {
            outcome: "ok",
            archived: toVersionRecord(archived),
            newRecord: toVersionRecord(created),
          } as PromoteVersionResult;
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async deleteVersionRecord(input) {
      try {
        const [target] = await dbInstance
          .select()
          .from(versionRecords)
          .where(eq(versionRecords.recordId, input.recordId));
        if (!target) return { existed: false, referenced: false };

        if (input.checkReferenced && input.targetType) {
          // 对齐 isVersionReferencedByGlobal：同 owner+template 的 global 记录
          // 在其 payload 指定字段引用了目标版本号
          const field = VERSION_REFERENCE_PAYLOAD_FIELDS[input.targetType];
          const globals = await dbInstance
            .select()
            .from(versionRecords)
            .where(
              and(
                eq(versionRecords.type, "global"),
                eq(versionRecords.ownerUserId, target.ownerUserId),
                eq(versionRecords.templateId, target.templateId)
              )
            );
          const referenced = globals.some(
            (g) => String(((g.payload ?? {}) as Record<string, unknown>)[field] ?? "") === target.versionCode
          );
          if (referenced) return { existed: true, referenced: true };
        }

        const removed = await dbInstance
          .delete(versionRecords)
          .where(eq(versionRecords.recordId, input.recordId))
          .returning({ recordId: versionRecords.recordId });
        return { existed: removed.length > 0, referenced: false };
      } catch (err) {
        throw toSafeError(err);
      }
    },
  };
}
