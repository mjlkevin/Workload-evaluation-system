import fs from "node:fs";
import path from "node:path";

import { VersionRecord, VersionType, VersionsStore, migrateVersionRecord } from "../../types";
import { versionsStorePath } from "../../utils";
import { applyVersionCodeFormat, formatHasSequenceToken } from "../../utils/version-code-format";
import { asString } from "../../utils/helpers";
import { loadVersionCodeRulesStore } from "../system/system.repository";

/** 旧版编码引擎未替换占位符时写入的脏数据（如 GL-{YYMMDD}-{N}） */
function looksLikeUnexpandedTemplate(versionCode: string): boolean {
  return /\{[A-Za-z0-9]+\}/.test(versionCode);
}

/**
 * 将仍含 {TOKEN} 的总方案版本号按当前「总方案」编码规则重写为真实码，并持久化。
 * 仅在启动加载时运行一次，避免历史脏数据一直显示为模板串。
 */
function repairGlobalPlaceholderVersionCodes(records: VersionRecord[]): { records: VersionRecord[]; changed: boolean } {
  const store = loadVersionCodeRulesStore();
  const rule = store.rules.find((r) => r.moduleKey === "global" && r.status === "active");
  if (!rule) return { records, changed: false };

  const format = rule.format || "{PREFIX}-{YYYYMMDD}-{NNN}";
  let changed = false;
  const working = [...records];

  for (let i = 0; i < working.length; i += 1) {
    const record = working[i];
    if (record.type !== "global" || !looksLikeUnexpandedTemplate(record.versionCode)) continue;

    const now = new Date(record.createdAt || Date.now());
    const hasSeq = formatHasSequenceToken(format);
    let assigned: string | null = null;

    for (let seq = 1; seq <= 9999; seq += 1) {
      if (!hasSeq && seq > 1) break;
      const candidate = applyVersionCodeFormat(format, {
        prefix: rule.prefix,
        moduleCode: rule.moduleCode,
        globalCode: "GL000",
        seq,
        now,
      });
      const conflict = working.some(
        (other, j) =>
          j !== i &&
          other.ownerUserId === record.ownerUserId &&
          other.type === "global" &&
          other.templateId === record.templateId &&
          other.versionCode === candidate
      );
      if (!conflict) {
        assigned = candidate;
        break;
      }
    }

    if (assigned) {
      working[i] = { ...record, versionCode: assigned, baseCode: assigned };
      changed = true;
    }
  }

  return { records: working, changed };
}

export function loadVersionsStore(): VersionsStore {
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
    const records = parsed.records.map(migrateVersionRecord);
    const repaired = repairGlobalPlaceholderVersionCodes(records);
    if (repaired.changed) {
      saveVersionsStore({ records: repaired.records });
    }
    return { records: repaired.records };
  } catch {
    return { records: [] };
  }
}

export function saveVersionsStore(store: VersionsStore): void {
  const filePath = versionsStorePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf-8");
}

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
  const fieldMap: Record<Exclude<VersionType, "global">, string> = {
    assessment: "assessmentVersionCode",
    resource: "resourceVersionCode",
    requirementImport: "requirementImportVersionCode",
    dev: "devAssessmentVersionCode",
  };
  const targetField = fieldMap[targetType];
  return store.records.some((record) => {
    if (record.type !== "global") return false;
    if (record.ownerUserId !== ownerUserId) return false;
    if (record.templateId !== templateId) return false;
    const linked = asString(record.payload?.[targetField]);
    return linked === targetVersionCode;
  });
}
