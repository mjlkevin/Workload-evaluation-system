// ============================================================
// Versions 域仓储（阶段 2 批 6 · 第 1–3 步）
// ============================================================
// 纯数据访问层：JSON 文件实现（遗留语义原样保留，第 4 步删除）+
// PG 实现（versions-pg.repository.ts，五范式）+ 选择器路由。
// 不涉及业务逻辑，不包含权限校验。
//
// 接口形态（批 2 结论复用）：整存 load→改→save 无法表达幂等插入（范式 #2）
// 与条件 UPDATE CAS（范式 #3），接口收敛为行级操作。JSON 实现为既有
// loadVersionsStore/saveVersionsStore 的行级封装（遗留语义原样保留，包括
// 整存 RMW 的丢失更新窗口——切换观察期结束、第 4 步删除 JSON 路径后消解）。
//
// 读中带写剥离（批 6 核心决策，架构侧指令）：
// 原 loadVersionsStore 通过 repairGlobalPlaceholderVersionCodes 在读取时
// 修复占位版本号并回写整个文件（「读操作里带写操作」）。处置采用三选一
// 中的「不迁移该修复逻辑」：
//  - 该修复针对两类历史脏码——①旧编码引擎未展开的 {TOKEN} 占位码；
//    ②绕过编码规则引擎的 PROJECT-{uuid}。两类产生路径在当前代码均已
//    不存在（①的写入方旧编码引擎已被规则引擎替换，现网写入必经
//    applyVersionCodeFormat 全量展开；②的写入方已删除，全仓检索仅剩
//    原修复正则本身）。
//  - 现存 config/versions/records.json 19 条记录实测 0 条命中两类脏码
//    （2026-08-22 脚本核验），修复逻辑当前即为无操作。
//  - 叠加 D2/D7 零数据迁移（PG 空库启动），PG 侧不存在也不会产生需要
//    修复的占位码。
// 因此：修复逻辑不进 PG 仓储（读路径纯读），同时自 JSON 读路径移除，
// 避免每次列表查询触发整表回写。回退安全：PG 开关翻回后读到的 JSON
// 数据与切换前完全一致（切换期间 PG 写入不落 JSON，且 0 条脏码无需修复）。
//
// 遗留 accessor（loadVersionsStore/saveVersionsStore）原样保留：
//  - 供 createVersionsJsonRepository 行级封装内部使用；
//  - 供既有测试契约直接使用（modules.unit/usecase 测试）；
//  - §5.1 遗留模式（读取失败静默空库），勿复制到任何新实现；
//  - 第 4 步（独立批次，须架构侧事先确认）删除。
// ============================================================

import fs from "node:fs";
import path from "node:path";

import { VersionRecord, VersionType, VersionsStore, migrateVersionRecord } from "../../types";
import { versionsStorePath } from "../../utils";
import { asString } from "../../utils/helpers";
import {
  createVersionsPgRepository,
  VERSION_REFERENCE_PAYLOAD_FIELDS,
  type CheckinVersionInput,
  type CheckinVersionResult,
  type CheckoutVersionInput,
  type CheckoutVersionResult,
  type DeleteVersionInput,
  type DeleteVersionResult,
  type PromoteVersionInput,
  type PromoteVersionResult,
  type VersionListFilter,
  type VersionsStoreRepository,
} from "./versions-pg.repository";

export type {
  VersionsStoreRepository,
  VersionListFilter,
  VersionActor,
  CheckoutVersionInput,
  CheckoutVersionResult,
  CheckinVersionInput,
  CheckinVersionResult,
  PromoteVersionInput,
  PromoteVersionResult,
  DeleteVersionInput,
  DeleteVersionResult,
} from "./versions-pg.repository";

// ============================================================
// 遗留 JSON accessor（§5.1 遗留模式，勿复制；第 4 步删除）
// ============================================================

/**
 * 遗留 JSON 读取（批 6 剥离读中带写：移除 repairGlobalPlaceholderVersionCodes
 * 调用，读路径纯读；理由见文件头部）。
 * §5.1 遗留模式（读取失败静默空库），勿复制。
 */
export async function loadVersionsStore(): Promise<VersionsStore> {
  const filePath = versionsStorePath();
  if (!fs.existsSync(filePath)) {
    const initStore: VersionsStore = { records: [] };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(initStore, null, 2), "utf-8");
    return initStore;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as VersionsStore;
    if (!parsed || !Array.isArray(parsed.records)) {
      return { records: [] };
    }
    // 迁移补全旧版本记录缺失的检入检出字段
    return { records: parsed.records.map(migrateVersionRecord) };
  } catch {
    return { records: [] };
  }
}

/** 遗留 JSON 写入（writeFileSync + renameSync 原子写；第 4 步删除）。 */
export async function saveVersionsStore(store: VersionsStore): Promise<void> {
  const filePath = versionsStorePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), "utf-8");
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    throw error;
  }
}

// ============================================================
// 公开纯函数（不触存储，双后端共用）
// ============================================================

export function toPublicVersionRecord(record: VersionRecord): VersionRecord {
  return { ...record };
}

export function isVersionReferencedByGlobal(
  store: VersionsStore,
  ownerUserId: string,
  templateId: string,
  targetType: Exclude<VersionType, "global">,
  targetVersionCode: string
): boolean {
  const targetField = VERSION_REFERENCE_PAYLOAD_FIELDS[targetType];
  return store.records.some((record) => {
    if (record.type !== "global") return false;
    if (record.ownerUserId !== ownerUserId) return false;
    if (record.templateId !== templateId) return false;
    const linked = asString(record.payload?.[targetField]);
    return linked === targetVersionCode;
  });
}

// ============================================================
// JSON 实现装配（行级封装，遗留语义原样：整存 RMW；§5.1 遗留模式，勿复制）
// ============================================================

/** 行内查找（含 owner 隔离）；forceUnlock 场景不限 owner 由 usecase 自持 */
function findInStore(store: VersionsStore, recordId: string): VersionRecord | undefined {
  return store.records.find((record) => record.id === recordId);
}

/** patch 应用：null 表示清除该字段（对齐 PG 实现语义） */
function applyPatch(target: VersionRecord, patch: Partial<Record<keyof VersionRecord, unknown>>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete (target as Record<string, unknown>)[key];
    } else {
      (target as Record<string, unknown>)[key] = value;
    }
  }
}

export function createVersionsJsonRepository(): VersionsStoreRepository {
  return {
    async listRecords(filter) {
      const store = await loadVersionsStore();
      return store.records
        .filter((record) => !filter.ownerUserId || record.ownerUserId === filter.ownerUserId)
        .filter((record) => !filter.type || record.type === filter.type)
        .filter((record) => !filter.templateId || record.templateId === filter.templateId)
        .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)) || a.id.localeCompare(b.id));
    },

    async findRecordById(recordId) {
      const store = await loadVersionsStore();
      return findInStore(store, recordId) ?? null;
    },

    async findRecordByCode(ownerUserId, type, templateId, versionCode) {
      const store = await loadVersionsStore();
      return (
        store.records.find(
          (record) =>
            record.ownerUserId === ownerUserId &&
            record.type === type &&
            record.templateId === templateId &&
            record.versionCode === versionCode
        ) ?? null
      );
    },

    async createVersionRecord(record) {
      const store = await loadVersionsStore();
      const existing = findInStore(store, record.id);
      if (existing) return { created: false, record: existing };
      store.records.push(record);
      await saveVersionsStore(store);
      return { created: true, record };
    },

    async upsertVersionRecord(record) {
      const store = await loadVersionsStore();
      const index = store.records.findIndex((item) => item.id === record.id);
      if (index >= 0) store.records[index] = record;
      else store.records.push(record);
      await saveVersionsStore(store);
      return record;
    },

    async upsertVersionRecords(records) {
      if (records.length === 0) return;
      // 批量一次整存落盘（单次原子提交），对齐原 saveProjectRecords
      // 「多记录一次 save」语义；禁止逐行多次 saveVersionsStore。
      const store = await loadVersionsStore();
      for (const record of records) {
        const index = store.records.findIndex((item) => item.id === record.id);
        if (index >= 0) store.records[index] = record;
        else store.records.push(record);
      }
      await saveVersionsStore(store);
    },

    async updateVersionRecord(recordId, patch) {
      const store = await loadVersionsStore();
      const target = findInStore(store, recordId);
      if (!target) return null;
      migrateVersionRecord(target);
      applyPatch(target, patch);
      await saveVersionsStore(store);
      return target;
    },

    async checkoutVersionRecord(input: CheckoutVersionInput): Promise<CheckoutVersionResult> {
      const store = await loadVersionsStore();
      const target = findInStore(store, input.recordId);
      if (!target) return { outcome: "not_found" };
      migrateVersionRecord(target);
      if (target.isHistoricalArchive) return { outcome: "historical_archive" };
      if (target.versionDocStatus === "reviewed") return { outcome: "reviewed_readonly" };
      if (target.checkoutStatus === "checked_out") {
        return { outcome: "already_checked_out", checkedOutByUsername: target.checkedOutByUsername };
      }
      const nowIso = new Date().toISOString();
      target.checkoutStatus = "checked_out";
      target.checkedOutByUserId = input.actorUserId;
      target.checkedOutByUsername = input.actorUsername;
      target.checkoutAt = nowIso;
      target.updatedAt = nowIso;
      target.updatedByUserId = input.actorUserId;
      target.updatedByUsername = input.actorUsername;
      // 保留当前检入快照，用于必要时撤销恢复
      target.lastCheckinPayload = target.payload ? { ...target.payload } : {};
      await saveVersionsStore(store);
      return { outcome: "ok", record: target };
    },

    async checkinVersionRecord(input: CheckinVersionInput): Promise<CheckinVersionResult> {
      const store = await loadVersionsStore();
      const target = findInStore(store, input.recordId);
      if (!target) return { outcome: "not_found" };
      migrateVersionRecord(target);
      if (target.checkoutStatus !== "checked_out") return { outcome: "not_checked_out" };
      if (target.checkedOutByUserId !== input.actorUserId) return { outcome: "not_checkout_owner" };

      const nextMinor = (target.minorNumber || 0) + 1;
      const baseCode = target.baseCode || target.versionCode;
      target.versionCode = `${baseCode}-V${target.majorLetter || "A"}${nextMinor}`;
      target.minorNumber = nextMinor;
      target.baseCode = baseCode;
      target.checkoutStatus = "checked_in";
      target.checkedOutByUserId = undefined;
      target.checkedOutByUsername = undefined;
      target.checkoutAt = undefined;
      if (input.payload) {
        target.payload = input.payload;
        target.lastCheckinPayload = { ...input.payload };
      } else {
        target.lastCheckinPayload = target.payload ? { ...target.payload } : {};
      }
      target.updatedAt = new Date().toISOString();
      target.updatedByUserId = input.actorUserId;
      target.updatedByUsername = input.actorUsername;
      await saveVersionsStore(store);
      return { outcome: "ok", record: target };
    },

    async promoteVersionRecord(input: PromoteVersionInput): Promise<PromoteVersionResult> {
      const store = await loadVersionsStore();
      const target = findInStore(store, input.archiveRecordId);
      if (!target) return { outcome: "not_found" };
      migrateVersionRecord(target);
      if (target.checkoutStatus !== "checked_in") return { outcome: "must_be_checked_in" };
      if (target.versionDocStatus !== "drafting") return { outcome: "must_be_drafting" };
      if (target.isHistoricalArchive) return { outcome: "historical_archive" };

      const archiveNowIso = new Date().toISOString();
      target.isHistoricalArchive = true;
      target.archivedAt = archiveNowIso;
      target.updatedAt = archiveNowIso;
      target.updatedByUserId = input.actorUserId;
      target.updatedByUsername = input.actorUsername;
      store.records.push(input.newRecord);
      await saveVersionsStore(store);
      return { outcome: "ok", archived: target, newRecord: input.newRecord };
    },

    async deleteVersionRecord(input: DeleteVersionInput): Promise<DeleteVersionResult> {
      const store = await loadVersionsStore();
      const index = store.records.findIndex((record) => record.id === input.recordId);
      if (index < 0) return { existed: false, referenced: false };
      const target = store.records[index];

      if (input.checkReferenced && input.targetType) {
        const referenced = isVersionReferencedByGlobal(
          store,
          target.ownerUserId,
          target.templateId,
          input.targetType,
          target.versionCode
        );
        if (referenced) return { existed: true, referenced: true };
      }

      store.records.splice(index, 1);
      await saveVersionsStore(store);
      return { existed: true, referenced: false };
    },
  };
}

// ============================================================
// 选择器（第 3 步开关：缺省 JSON，严格 === "true" 切 PG）
// ============================================================

let defaultRepo: VersionsStoreRepository | null = null;

/** 进程内默认 repository 单例（生产路由使用）；开关只读一次，翻开关需重启 */
export function getVersionsRepository(): VersionsStoreRepository {
  if (!defaultRepo) {
    defaultRepo =
      process.env.WES_STORE_VERSIONS_PG === "true"
        ? createVersionsPgRepository()
        : createVersionsJsonRepository();
  }
  return defaultRepo;
}

/** 测试专用：重置单例 */
export function _resetVersionsRepositoryForTest(): void {
  defaultRepo = null;
}
