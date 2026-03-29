import fs from "node:fs";
import path from "node:path";

import { VersionRecord, VersionType, VersionsStore } from "../../types";
import { versionsStorePath } from "../../utils";
import { asString } from "../../utils/helpers";

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
    return { records: parsed.records };
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
