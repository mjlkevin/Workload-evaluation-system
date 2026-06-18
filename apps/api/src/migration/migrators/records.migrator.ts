// ============================================================
// records.json → PG assessment_versions 表迁移器
// ============================================================
// 映射规则：
//   v1 id                  → v2 assessment_version_id
//   v1 versionCode         → v2 version_code
//   v1 ownerUserId         → v2 owner_user_id
//   v1 status              → v2 status (见 mapStatus)
//   v1 payload             → v2 payload（保留完整结构）
//   v1 createdAt           → v2 created_at
//   v1 updatedAt           → v2 updated_at
//   v1 type                → 写入 payload._v1Type 保留兼容
//   v1 checkoutStatus      → 写入 payload.checkoutStatus
//   v1 versionDocStatus    → 写入 payload.versionDocStatus
//   v1 isHistoricalArchive → 写入 payload.isHistoricalArchive
//   v1 checkedOutByUserId  → v2 checked_out_by_user_id
//
// 默认值（v2 新增字段）：
//   revisionType  = "initial"
//   ownerRole     = "IMPL"
//   deliveryMode  = "public_cloud"

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { db } from "../../db/client";
import { assessmentVersions } from "../../db/schema";

interface V1Record {
  id: string;
  type: string;
  versionCode: string;
  templateId?: string;
  ownerUserId?: string;
  status: string;
  payload?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  createdByUserId?: string;
  createdByUsername?: string;
  updatedByUserId?: string;
  updatedByUsername?: string;
  checkoutStatus?: string;
  versionDocStatus?: string;
  isHistoricalArchive?: boolean;
  checkedOutByUserId?: string;
  checkedOutByUsername?: string;
  checkoutAt?: string;
  archivedAt?: string;
  majorLetter?: string;
  minorNumber?: number;
  baseCode?: string;
  lastCheckinPayload?: Record<string, unknown>;
}

interface V1RecordsFile {
  records: V1Record[];
}

export interface RecordMigrationResult {
  sourceCount: number;
  inserted: number;
  skipped: number;
  errors: Array<{ versionCode: string; error: string }>;
}

function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function deterministicUuid(input: string): string {
  const hash = createHash("md5").update(input).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function resolveUuid(input: string): string {
  return isValidUuid(input) ? input : deterministicUuid(input);
}

const STATUS_MAP: Record<string, string> = {
  draft: "draft",
  reviewed: "checked_in",
  published: "promoted",
  archived: "sealed",
};

function mapStatus(v1Status: string): string {
  return STATUS_MAP[v1Status] ?? "draft";
}

function buildPayload(r: V1Record): Record<string, unknown> {
  // 以 v1 payload 为基底，叠加兼容性字段
  const base = (r.payload ?? {}) as Record<string, unknown>;

  return {
    ...base,
    // 前端兼容性字段
    projectName:
      (base.basicInfo as Record<string, unknown> | undefined)?.projectName
      ?? base.projectName
      ?? "",
    checkoutStatus: r.checkoutStatus ?? "checked_in",
    versionDocStatus: r.versionDocStatus ?? "draft",
    isHistoricalArchive: r.isHistoricalArchive ?? false,
    // 保留 v1 元数据以便回查
    _v1Type: r.type,
    _v1TemplateId: r.templateId,
    _v1CreatedByUserId: r.createdByUserId,
    _v1CreatedByUsername: r.createdByUsername,
    _v1UpdatedByUserId: r.updatedByUserId,
    _v1UpdatedByUsername: r.updatedByUsername,
    _v1MajorLetter: r.majorLetter,
    _v1MinorNumber: r.minorNumber,
    _v1BaseCode: r.baseCode,
  };
}

export async function migrateRecords(options: {
  dryRun?: boolean;
  configRoot?: string;
}): Promise<RecordMigrationResult> {
  const { dryRun = false, configRoot = path.resolve(process.cwd(), "../../config") } = options;
  const filePath = path.join(configRoot, "versions", "records.json");

  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as V1RecordsFile;
  const source = raw.records ?? [];

  const result: RecordMigrationResult = {
    sourceCount: source.length,
    inserted: 0,
    skipped: 0,
    errors: [],
  };

  if (source.length === 0) {
    console.log("[migrate:records] 源数据为空，跳过");
    return result;
  }

  const existingRows = await db
    .select({ versionCode: assessmentVersions.versionCode })
    .from(assessmentVersions);
  const existingSet = new Set(existingRows.map((r) => r.versionCode));
  const sourceSeen = new Set<string>();

  for (const r of source) {
    if (sourceSeen.has(r.versionCode)) {
      result.skipped++;
      console.log(`[migrate:records] 跳过源内重复 versionCode: ${r.versionCode} (id=${r.id})`);
      continue;
    }
    sourceSeen.add(r.versionCode);

    if (existingSet.has(r.versionCode)) {
      result.skipped++;
      console.log(`[migrate:records] 跳过已存在: ${r.versionCode}`);
      continue;
    }

    const row = {
      assessmentVersionId: resolveUuid(r.id),
      versionCode: r.versionCode,
      revisionType: "initial" as const,
      ownerRole: "IMPL" as const,
      deliveryMode: "public_cloud" as const,
      ownerUserId: r.ownerUserId ?? null,
      checkedOutByUserId: r.checkedOutByUserId ?? null,
      status: mapStatus(r.status) as any,
      payload: buildPayload(r),
      createdAt: new Date(r.createdAt),
      updatedAt: new Date(r.updatedAt),
    };

    if (dryRun) {
      console.log(`[migrate:records] [dry-run] 将插入: ${r.versionCode} (type=${r.type}, status=${row.status})`);
      result.inserted++;
      continue;
    }

    try {
      await db.insert(assessmentVersions).values(row);
      result.inserted++;
      console.log(`[migrate:records] 已插入: ${r.versionCode}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ versionCode: r.versionCode, error: message });
      console.error(`[migrate:records] 插入失败: ${r.versionCode} — ${message}`);
    }
  }

  return result;
}
