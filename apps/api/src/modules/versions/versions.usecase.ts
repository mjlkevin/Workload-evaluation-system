import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

import {
  VersionRecord,
  VersionCodeRuleModuleKey,
  VersionType,
  VersionStatus,
  isVersionType,
  isVersionStatus,
  migrateVersionRecord,
} from "../../types";
import { asString } from "../../utils";
import { ok, fail } from "../../utils/response";
import { requireRoleWithAuth } from "../../middleware/auth";
import {
  isVersionReferencedByGlobal,
  loadVersionsStore,
  saveVersionsStore,
  toPublicVersionRecord
} from "./versions.repository";
import { loadVersionCodeRulesStore } from "../system/system.repository";

function mapTypeToRuleModuleKey(type: VersionType): VersionCodeRuleModuleKey {
  if (type === "global") return "global";
  if (type === "requirementImport") return "requirement";
  if (type === "assessment") return "implementation";
  if (type === "resource") return "resource";
  if (type === "dev") return "dev";
  return "wbs";
}

function padNumber(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function renderVersionCodeFromFormat(
  format: string,
  input: {
    prefix: string;
    moduleCode: string;
    globalCode: string;
    seq: number;
    now: Date;
  }
): string {
  const yyyy = String(input.now.getFullYear());
  const mm = padNumber(input.now.getMonth() + 1, 2);
  const dd = padNumber(input.now.getDate(), 2);
  const values: Record<string, string> = {
    "{PREFIX}": input.prefix,
    "{MODULE}": input.moduleCode,
    "{YYYYMMDD}": `${yyyy}${mm}${dd}`,
    "{YYYYMM}": `${yyyy}${mm}`,
    "{YYYY}": yyyy,
    "{GL}": input.globalCode,
    "{NNN}": padNumber(input.seq, 3),
    "{NN}": padNumber(input.seq, 2),
  };
  return Object.entries(values).reduce((result, [token, value]) => result.split(token).join(value), format);
}

function generateVersionCodeByRule(
  store: { records: VersionRecord[] },
  input: {
    ownerUserId: string;
    type: VersionType;
    templateId: string;
    payload: Record<string, unknown>;
  }
): { versionCode: string } | { errorCode: number; message: string; field: string; reason: string } {
  const moduleKey = mapTypeToRuleModuleKey(input.type);
  const rulesStore = loadVersionCodeRulesStore();
  const rule = rulesStore.rules.find((item) => item.moduleKey === moduleKey);
  if (!rule) {
    return {
      errorCode: 40401,
      message: "版本号编码规则不存在",
      field: "moduleKey",
      reason: "rule_not_found",
    };
  }
  if (rule.status !== "active") {
    return {
      errorCode: 40902,
      message: "当前模块编码规则未生效，请先在系统管理中生效",
      field: "moduleKey",
      reason: "rule_not_active",
    };
  }

  const format = rule.format || "{PREFIX}-{YYYYMMDD}-{NNN}";
  const hasSeqToken = format.includes("{NNN}") || format.includes("{NN}");
  const now = new Date();
  const rawGlobalCode = asString(input.payload.globalVersionCode) || "GL000";
  const globalCode = rawGlobalCode.split("-V")[0] || "GL000";

  for (let seq = 1; seq <= 9999; seq += 1) {
    if (!hasSeqToken && seq > 1) break;
    const candidate = renderVersionCodeFromFormat(format, {
      prefix: rule.prefix,
      moduleCode: rule.moduleCode,
      globalCode,
      seq,
      now,
    });
    const existed = store.records.find(
      (record) =>
        record.ownerUserId === input.ownerUserId &&
        record.type === input.type &&
        record.templateId === input.templateId &&
        record.versionCode === candidate
    );
    if (!existed) {
      return { versionCode: candidate };
    }
  }

  return {
    errorCode: 40901,
    message: hasSeqToken ? "版本号已存在，请重试" : "编码规则缺少序号占位符，无法保证版本号唯一",
    field: "versionCodeRule",
    reason: hasSeqToken ? "conflict" : "missing_sequence_placeholder",
  };
}

export function listVersions(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;

  const type = asString(req.query.type);
  const templateId = asString(req.query.templateId) || "default";

  if (!isVersionType(type)) {
    return fail(res, 40001, "参数错误", [{ field: "type", reason: "invalid" }]);
  }

  const store = loadVersionsStore();
  const items = store.records
    .filter((record) => record.ownerUserId === auth.user.id)
    .filter((record) => record.type === type)
    .filter((record) => record.templateId === templateId)
    .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)))
    .map(toPublicVersionRecord);

  return res.json(ok({ items }, randomUUID()));
}

export function createVersion(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;

  const body = req.body as {
    type?: string;
    versionCode?: string;
    templateId?: string;
    status?: string;
    payload?: Record<string, unknown>;
  };

  const type = asString(body.type);
  let versionCode = asString(body.versionCode);
  const templateId = asString(body.templateId) || "default";
  const status = asString(body.status) || "draft";
  const payload = body.payload && typeof body.payload === "object" ? body.payload : {};

  if (!isVersionType(type)) {
    return fail(res, 40001, "参数错误", [{ field: "type", reason: "invalid" }]);
  }
  if (!isVersionStatus(status)) {
    return fail(res, 40001, "参数错误", [{ field: "status", reason: "invalid" }]);
  }

  const store = loadVersionsStore();
  if (!versionCode) {
    const generated = generateVersionCodeByRule(store, {
      ownerUserId: auth.user.id,
      type,
      templateId,
      payload: payload as Record<string, unknown>,
    });
    if ("errorCode" in generated) {
      return fail(res, generated.errorCode, generated.message, [{ field: generated.field, reason: generated.reason }]);
    }
    versionCode = generated.versionCode;
  }
  const existed = store.records.find(
    (record) =>
      record.ownerUserId === auth.user.id &&
      record.type === type &&
      record.templateId === templateId &&
      record.versionCode === versionCode
  );

  if (existed) {
    return fail(res, 40901, "版本号已存在，不可覆盖（不可变版本）", [{ field: "versionCode", reason: "already_exists" }]);
  }

  const nowIso = new Date().toISOString();
  const record: VersionRecord = {
    id: randomUUID(),
    type,
    versionCode,
    templateId,
    ownerUserId: auth.user.id,
    status: status as VersionStatus,
    payload: payload as Record<string, unknown>,
    createdAt: nowIso,
    updatedAt: nowIso,
    createdByUserId: auth.user.id,
    createdByUsername: auth.user.username,
    // 检入检出字段默认值（新建记录默认已检入草稿）
    checkoutStatus: "checked_in",
    versionDocStatus: "drafting",
    majorLetter: "A",
    minorNumber: 0,
    baseCode: versionCode,
    isHistoricalArchive: false,
    lastCheckinPayload: {},
  };

  if (record.status === "reviewed" || record.status === "published") {
    record.reviewedAt = nowIso;
    record.reviewedByUserId = auth.user.id;
  }

  store.records.push(record);
  saveVersionsStore(store);

  return res.json(ok({ record: toPublicVersionRecord(record) }, randomUUID()));
}

export function updateVersionStatus(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;

  const recordId = asString(req.params.recordId);
  const nextStatus = asString((req.body as { status?: string }).status);

  if (!recordId) {
    return fail(res, 40001, "参数错误", [{ field: "recordId", reason: "required" }]);
  }
  if (!isVersionStatus(nextStatus)) {
    return fail(res, 40001, "参数错误", [{ field: "status", reason: "invalid" }]);
  }

  const store = loadVersionsStore();
  const target = store.records.find((record) => record.id === recordId && record.ownerUserId === auth.user.id);

  if (!target) {
    return fail(res, 40404, "版本不存在", [{ field: "recordId", reason: "not_found" }]);
  }

  target.status = nextStatus;
  target.updatedAt = new Date().toISOString();

  if ((nextStatus === "reviewed" || nextStatus === "published") && !target.reviewedAt) {
    target.reviewedAt = target.updatedAt;
    target.reviewedByUserId = auth.user.id;
  }

  saveVersionsStore(store);
  return res.json(ok({ record: toPublicVersionRecord(target) }, randomUUID()));
}

// ============================================================
// 检出 / 检入 / 升版
// ============================================================

/**
 * 生成新版本号： baseCode + -V + 字母 + 自然数
 */
function buildVersionCode(baseCode: string, majorLetter: string, minorNumber: number): string {
  return `${baseCode}-V${majorLetter}${minorNumber}`;
}

/**
 * 字母进位：A→B, Z→AA, AA→AB ...
 */
function nextMajorLetter(letter: string): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const chars = letter.split("");
  let carry = true;
  for (let i = chars.length - 1; i >= 0 && carry; i--) {
    const idx = letters.indexOf(chars[i]);
    if (idx < letters.length - 1) {
      chars[i] = letters[idx + 1];
      carry = false;
    } else {
      chars[i] = "A";
    }
  }
  if (carry) chars.unshift("A");
  return chars.join("");
}

/** POST /api/v1/versions/:id/checkout — 显式检出（排他锁） */
export function checkoutVersion(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;

  const recordId = asString(req.params.id);
  if (!recordId) return fail(res, 40001, "参数错误", [{ field: "id", reason: "required" }]);

  const store = loadVersionsStore();
  const target = store.records.find((r) => r.id === recordId && r.ownerUserId === auth.user.id);
  if (!target) return fail(res, 40404, "版本不存在", [{ field: "id", reason: "not_found" }]);

  migrateVersionRecord(target);

  if (target.isHistoricalArchive) {
    return fail(res, 40902, "历史归档版本不可检出", [{ field: "id", reason: "historical_archive" }]);
  }
  if (target.versionDocStatus === "reviewed") {
    return fail(res, 40902, "已审核版本不可检出，如需修改请先升版", [
      { field: "versionDocStatus", reason: "reviewed_readonly" }
    ]);
  }
  if (target.checkoutStatus === "checked_out") {
    return fail(res, 40902, `当前版本已被「${target.checkedOutByUsername}」检出，请先检入或撤销检出`, [
      { field: "checkoutStatus", reason: "already_checked_out" }
    ]);
  }

  const nowIso = new Date().toISOString();
  target.checkoutStatus = "checked_out";
  target.checkedOutByUserId = auth.user.id;
  target.checkedOutByUsername = auth.user.username;
  target.checkoutAt = nowIso;
  target.updatedAt = nowIso;
  // 保留当前检入快照，用于必要时撤销恢复
  target.lastCheckinPayload = target.payload ? { ...target.payload } : {};

  saveVersionsStore(store);
  return res.json(ok({ record: toPublicVersionRecord(target) }, randomUUID()));
}

/** POST /api/v1/versions/:id/checkin — 检入（释放锁，版本号自然数+1） */
export function checkinVersion(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;

  const recordId = asString(req.params.id);
  if (!recordId) return fail(res, 40001, "参数错误", [{ field: "id", reason: "required" }]);

  const body = req.body as { payload?: Record<string, unknown> };
  const newPayload = body.payload && typeof body.payload === "object" ? body.payload : null;

  const store = loadVersionsStore();
  const target = store.records.find((r) => r.id === recordId && r.ownerUserId === auth.user.id);
  if (!target) return fail(res, 40404, "版本不存在", [{ field: "id", reason: "not_found" }]);

  migrateVersionRecord(target);

  if (target.checkoutStatus !== "checked_out") {
    return fail(res, 40902, "当前版本未检出，无需检入", [{ field: "checkoutStatus", reason: "not_checked_out" }]);
  }
  if (target.checkedOutByUserId !== auth.user.id) {
    return fail(res, 40301, "只有检出人才能检入", [{ field: "checkedOutByUserId", reason: "not_owner" }]);
  }

  const nowIso = new Date().toISOString();
  const nextMinor = (target.minorNumber || 0) + 1;
  const majorLetter = target.majorLetter || "A";
  const baseCode = target.baseCode || target.versionCode;
  const newVersionCode = buildVersionCode(baseCode, majorLetter, nextMinor);

  // 更新字段
  target.versionCode = newVersionCode;
  target.minorNumber = nextMinor;
  target.baseCode = baseCode;
  target.majorLetter = majorLetter;
  target.checkoutStatus = "checked_in";
  target.checkedOutByUserId = undefined;
  target.checkedOutByUsername = undefined;
  target.checkoutAt = undefined;
  target.updatedAt = nowIso;
  if (newPayload) {
    target.payload = newPayload;
    target.lastCheckinPayload = { ...newPayload };
  } else {
    target.lastCheckinPayload = target.payload ? { ...target.payload } : {};
  }

  saveVersionsStore(store);
  return res.json(ok({ record: toPublicVersionRecord(target), versionCode: newVersionCode }, randomUUID()));
}

/** POST /api/v1/versions/:id/undo-checkout — 撤销检出（丢弃修改，恢复到上次检入状态） */
export function undoCheckout(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;

  const recordId = asString(req.params.id);
  if (!recordId) return fail(res, 40001, "参数错误", [{ field: "id", reason: "required" }]);

  const store = loadVersionsStore();
  const target = store.records.find((r) => r.id === recordId && r.ownerUserId === auth.user.id);
  if (!target) return fail(res, 40404, "版本不存在", [{ field: "id", reason: "not_found" }]);

  migrateVersionRecord(target);

  if (target.checkoutStatus !== "checked_out") {
    return fail(res, 40902, "当前版本未检出", [{ field: "checkoutStatus", reason: "not_checked_out" }]);
  }
  if (target.checkedOutByUserId !== auth.user.id) {
    return fail(res, 40301, "只有检出人才能撤销检出", [{ field: "checkedOutByUserId", reason: "not_owner" }]);
  }

  const nowIso = new Date().toISOString();
  // 恢复到上次检入的 payload
  if (target.lastCheckinPayload) {
    target.payload = { ...target.lastCheckinPayload };
  }
  target.checkoutStatus = "checked_in";
  target.checkedOutByUserId = undefined;
  target.checkedOutByUsername = undefined;
  target.checkoutAt = undefined;
  target.updatedAt = nowIso;

  saveVersionsStore(store);
  return res.json(ok({ record: toPublicVersionRecord(target) }, randomUUID()));
}

/** POST /api/v1/versions/:id/promote — 升版（当前版本归档，创建新版本 VX1） */
export function promoteVersion(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;

  const recordId = asString(req.params.id);
  if (!recordId) return fail(res, 40001, "参数错误", [{ field: "id", reason: "required" }]);

  const store = loadVersionsStore();
  const target = store.records.find((r) => r.id === recordId && r.ownerUserId === auth.user.id);
  if (!target) return fail(res, 40404, "版本不存在", [{ field: "id", reason: "not_found" }]);

  migrateVersionRecord(target);

  if (target.checkoutStatus !== "checked_in") {
    return fail(res, 40902, "必须检入后才能升版", [{ field: "checkoutStatus", reason: "must_be_checked_in" }]);
  }
  if (target.versionDocStatus !== "drafting") {
    return fail(res, 40902, "当前版本状态不允许升版", [{ field: "versionDocStatus", reason: "must_be_drafting" }]);
  }
  if (target.isHistoricalArchive) {
    return fail(res, 40902, "历史归档版本不可升版", [{ field: "id", reason: "historical_archive" }]);
  }

  const nowIso = new Date().toISOString();
  const baseCode = target.baseCode || target.versionCode;
  const newMajorLetter = nextMajorLetter(target.majorLetter || "A");
  const newVersionCode = buildVersionCode(baseCode, newMajorLetter, 1);

  // 将当前记录标记为历史归档
  target.isHistoricalArchive = true;
  target.archivedAt = nowIso;
  target.updatedAt = nowIso;

  // 创建新版本记录（已检出状态—升版后需要用户检入）
  const newRecord: VersionRecord = {
    id: randomUUID(),
    type: target.type,
    versionCode: newVersionCode,
    templateId: target.templateId,
    ownerUserId: target.ownerUserId,
    status: "draft",
    payload: target.payload ? { ...target.payload } : {},
    createdAt: nowIso,
    updatedAt: nowIso,
    createdByUserId: auth.user.id,
    createdByUsername: auth.user.username,
    // 检入检出字段
    checkoutStatus: "checked_out",
    versionDocStatus: "drafting",
    checkedOutByUserId: auth.user.id,
    checkedOutByUsername: auth.user.username,
    checkoutAt: nowIso,
    majorLetter: newMajorLetter,
    minorNumber: 0, // 检入后变为 1
    baseCode,
    isHistoricalArchive: false,
    lastCheckinPayload: {},
  };

  store.records.push(newRecord);
  saveVersionsStore(store);
  return res.json(ok({ archived: toPublicVersionRecord(target), newRecord: toPublicVersionRecord(newRecord) }, randomUUID()));
}

/** PATCH /api/v1/versions/:id/force-unlock — 管理员强制解锁 */
export function forceUnlockVersion(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin"]);
  if (!auth) return;

  const recordId = asString(req.params.id);
  if (!recordId) return fail(res, 40001, "参数错误", [{ field: "id", reason: "required" }]);

  const store = loadVersionsStore();
  // 管理员可解锁任意用户的记录
  const target = store.records.find((r) => r.id === recordId);
  if (!target) return fail(res, 40404, "版本不存在", [{ field: "id", reason: "not_found" }]);

  migrateVersionRecord(target);

  if (target.checkoutStatus !== "checked_out") {
    return fail(res, 40902, "当前版本未检出，无需解锁", [{ field: "checkoutStatus", reason: "not_checked_out" }]);
  }

  const nowIso = new Date().toISOString();
  target.checkoutStatus = "checked_in";
  target.checkedOutByUserId = undefined;
  target.checkedOutByUsername = undefined;
  target.checkoutAt = undefined;
  target.updatedAt = nowIso;

  saveVersionsStore(store);
  return res.json(ok({ record: toPublicVersionRecord(target), unlockedBy: auth.user.username }, randomUUID()));
}

export function deleteVersion(req: Request, res: Response) {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;

  const type = asString(req.params.type);
  const versionCode = asString(req.params.versionCode);
  const templateId = asString(req.query.templateId) || "default";

  if (!isVersionType(type)) {
    return fail(res, 40001, "参数错误", [{ field: "type", reason: "invalid" }]);
  }
  if (!versionCode) {
    return fail(res, 40001, "参数错误", [{ field: "versionCode", reason: "required" }]);
  }

  const store = loadVersionsStore();
  const targetIdx = store.records.findIndex(
    (record) =>
      record.ownerUserId === auth.user.id &&
      record.type === type &&
      record.templateId === templateId &&
      record.versionCode === versionCode
  );

  if (targetIdx < 0) {
    return fail(res, 40404, "版本不存在", [{ field: "versionCode", reason: "not_found" }]);
  }

  if (type !== "global") {
    const referenced = isVersionReferencedByGlobal(
      store,
      auth.user.id,
      templateId,
      type as Exclude<VersionType, "global">,
      versionCode
    );
    if (referenced) {
      return fail(res, 40902, "版本已被总方案引用，不能删除", [{ field: "versionCode", reason: "referenced_by_global_plan" }]);
    }
  }

  const [removed] = store.records.splice(targetIdx, 1);
  saveVersionsStore(store);

  return res.json(ok({ deleted: true, record: toPublicVersionRecord(removed) }, randomUUID()));
}
