// ============================================================
// Versions 域仓储（阶段 2 批 6 建立 · 第 4 步 S4 收敛为恒 PG）
// ============================================================
// 纯数据访问层：本文件不再自带实现，只保留单例选择器与双后端共用 helper
// （PG 实现在 versions-pg.repository.ts，五范式）。
// 不涉及业务逻辑，不包含权限校验。
//
// 阶段 2 S4（2026-08-30）：JSON 文件读写路径连同 config/versions/records.json
// 一并删除，选择器不再有分流分支（WES_STORE_VERSIONS_PG 在本批后续提交里
// 从 ci.yml / .env / 测试开关清单退役；自本提交起它已无可影响的路由分支）。
// 删除理由：九存储域已全部跑在 PostgreSQL 上，JSON 侧只剩「并发写静默丢数据」
// 的历史形态——本域的具体形态是「整存 load→改→save」的 RMW 丢失更新窗口，
// 以及读路径曾经带写（repairGlobalPlaceholderVersionCodes 读时修复并回写整份
// 文件，批 6 已剥离）。保留只会提供第二条可达写路径（阶段 2 立项根因）。
//
// 本批删除的 JSON 侧实现及其去向：
//  - loadVersionsStore / saveVersionsStore：records.json 的整存读 + 临时文件
//    + rename 原子写。「一次批量写不得留下部分落库的中间态」这一不变量改由
//    versions-pg.repository.test.ts「upsertVersionRecords：批量一次提交」的
//    全有或全无断言守护；「并发写不同记录互不覆盖」由同文件对应用例守护。
//  - createVersionsJsonRepository 及其 findInStore / applyPatch 内部 helper：
//    行级接口只是 JSON 整存的封装，PG 侧为同名接口的唯一实现。
//  - isVersionReferencedByGlobal：「被总方案引用不可删」的 JSON 侧口径实现。
//    PG 侧 deleteVersionRecord 自带等价检查（versions-pg.repository.ts 的
//    VERSION_REFERENCE_PAYLOAD_FIELDS + global 行扫描），回归防线见
//    versions-pg.repository.test.ts「deleteVersionRecord：被总方案引用时拒删且行保留」。
//
// 公开函数签名不变（调用点零改动）：versions.usecase.ts / team.usecase.ts /
// project-evaluations.repository.ts / routes/wbs.routes.ts 均经
// getVersionsRepository() 取仓储，本批只把分流收敛为常量。
//
// 遗留待裁（登记计划文档 §10，本批按 §十 B7 同口径只登记不顺手删）：
//  - types/index.ts 的 VersionsStore 与 migrateVersionRecord 在本批后全仓
//    零引用（migrateVersionRecord 原仅被 JSON 读路径调用；PG 路径写入恒为
//    完整字段，见 versions.usecase.ts:11-12）。二者属类型层公开导出。
// ============================================================

import { VersionRecord } from "../../types";
import { createVersionsPgRepository, type VersionsStoreRepository } from "./versions-pg.repository";

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

/** 出参裁剪（不暴露内部审计字段）；与后端实现无关，双后端共用。 */
export function toPublicVersionRecord(record: VersionRecord): VersionRecord {
  return { ...record };
}

// ============================================================
// 默认仓储（阶段 2 第 4 步 S4：恒 PG，选择器已无分流分支）
// ============================================================

let defaultRepo: VersionsStoreRepository | null = null;

/** 进程内默认 repository 单例（恒 PG）；S4 前依 WES_STORE_VERSIONS_PG 分流，现已退役 */
export function getVersionsRepository(): VersionsStoreRepository {
  if (!defaultRepo) {
    defaultRepo = createVersionsPgRepository();
  }
  return defaultRepo;
}

/** 测试专用：重置单例 */
export function _resetVersionsRepositoryForTest(): void {
  defaultRepo = null;
}
