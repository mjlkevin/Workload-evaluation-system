import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

import {
  VersionRecord,
  VersionType,
  VersionStatus,
  isVersionType,
  isVersionStatus,
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
  const versionCode = asString(body.versionCode);
  const templateId = asString(body.templateId) || "default";
  const status = asString(body.status) || "draft";
  const payload = body.payload && typeof body.payload === "object" ? body.payload : {};

  if (!isVersionType(type)) {
    return fail(res, 40001, "参数错误", [{ field: "type", reason: "invalid" }]);
  }
  if (!versionCode) {
    return fail(res, 40001, "参数错误", [{ field: "versionCode", reason: "required" }]);
  }
  if (!isVersionStatus(status)) {
    return fail(res, 40001, "参数错误", [{ field: "status", reason: "invalid" }]);
  }

  const store = loadVersionsStore();
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
