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

/** 项目创建时绕过编码规则引擎写入的 PROJECT-{uuid} 脏数据 */
function looksLikeRawProjectUuid(versionCode: string): boolean {
  return /^PROJECT-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(versionCode);
}

/**
 * 将仍含 {TOKEN} 的总方案版本号按当前「总方案」编码规则重写为真实码，并持久化。
 * 仅在启动加载时运行一次，避免历史脏数据一直显示为模板串。
 */
async function repairGlobalPlaceholderVersionCodes(records: VersionRecord[]): Promise<{ records: VersionRecord[]; changed: boolean }> {
  // 阶段 1 批 4：loadVersionCodeRulesStore 属 system 域（批 5 范围），当前仍为同步函数，
  // 此处 await 不改变行为；批 5 改异步后该 await 才真正生效。
  const store = await loadVersionCodeRulesStore();
  const rule = store.rules.find((r) => r.moduleKey === "global" && r.status === "active");
  if (!rule) return { records, changed: false };

  const format = rule.format || "{PREFIX}-{YYYYMMDD}-{NNN}";
  let changed = false;
  const working = [...records];

  for (let i = 0; i < working.length; i += 1) {
    const record = working[i];
    if (record.type !== "global" || (!looksLikeUnexpandedTemplate(record.versionCode) && !looksLikeRawProjectUuid(record.versionCode))) continue;

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

/**
 * 阶段 1 批 4：签名改 async，实现不动（仍为 readFileSync/writeFileSync），阶段 2 替换实现。
 * 注意：本函数读中带写——repair 命中时会回写整个 store（回写失败仍走下方 catch，与同步版一致）。
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
    const records = parsed.records.map(migrateVersionRecord);
    const repaired = await repairGlobalPlaceholderVersionCodes(records);
    if (repaired.changed) {
      await saveVersionsStore({ records: repaired.records });
    }
    return { records: repaired.records };
  } catch {
    return { records: [] };
  }
}

/** 阶段 1 批 4：签名改 async，实现不动（仍为 writeFileSync + renameSync 原子写），阶段 2 替换实现。 */
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
