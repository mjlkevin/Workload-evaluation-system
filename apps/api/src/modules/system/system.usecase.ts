import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

import { VersionCodeRule, VersionCodeRuleModuleKey, VersionCodeRuleStatus } from "../../types";
import { requireAuth, isAdminUser } from "../../middleware/auth";
import { fail, ok } from "../../utils/response";
import {
  buildVersionCodeSample,
  loadVersionCodeRulesStore,
  saveVersionCodeRulesStore,
} from "./system.repository";

const MODULE_KEYS: VersionCodeRuleModuleKey[] = [
  "global",
  "requirement",
  "implementation",
  "dev",
  "resource",
  "wbs",
];

function isValidModuleKey(value: string): value is VersionCodeRuleModuleKey {
  return MODULE_KEYS.includes(value as VersionCodeRuleModuleKey);
}

function isValidStatus(value: string): value is VersionCodeRuleStatus {
  return ["active", "draft", "disabled"].includes(value);
}

function requireAdmin(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return null;
  if (!isAdminUser(auth.user)) {
    fail(res, 40301, "权限不足", [{ field: "role", reason: "admin_required" }]);
    return null;
  }
  return auth;
}

function sanitizeRule(rule: VersionCodeRule): VersionCodeRule {
  const nextPrefix = rule.prefix.trim().toUpperCase();
  const nextFormat = rule.format.trim();
  return {
    ...rule,
    prefix: nextPrefix,
    format: nextFormat,
    sample: buildVersionCodeSample(nextFormat, nextPrefix, rule.moduleCode),
  };
}

export function listVersionCodeRules(req: Request, res: Response) {
  if (!requireAdmin(req, res)) return;

  const moduleKey = String(req.query.moduleKey || "").trim();
  const keyword = String(req.query.keyword || "").trim().toLowerCase();
  const status = String(req.query.status || "").trim();

  if (moduleKey && !isValidModuleKey(moduleKey)) {
    return fail(res, 40001, "参数错误", [{ field: "moduleKey", reason: "invalid_module_key" }]);
  }
  if (status && !isValidStatus(status)) {
    return fail(res, 40001, "参数错误", [{ field: "status", reason: "invalid_status" }]);
  }

  const store = loadVersionCodeRulesStore();
  const items = store.rules
    .map(sanitizeRule)
    .filter((item) => {
      if (moduleKey && item.moduleKey !== moduleKey) return false;
      if (status && item.status !== status) return false;
      if (!keyword) return true;
      return (
        item.moduleName.toLowerCase().includes(keyword) ||
        item.moduleCode.toLowerCase().includes(keyword) ||
        item.prefix.toLowerCase().includes(keyword) ||
        item.format.toLowerCase().includes(keyword)
      );
    })
    .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)));

  return res.json(ok({ items }, randomUUID()));
}

export function updateVersionCodeRuleConfig(req: Request, res: Response) {
  if (!requireAdmin(req, res)) return;

  const ruleId = String(req.params.ruleId || "").trim();
  const prefix = String(req.body?.prefix || "").trim().toUpperCase();
  const format = String(req.body?.format || "").trim();

  if (!ruleId) return fail(res, 40001, "参数错误", [{ field: "ruleId", reason: "required" }]);
  if (!prefix) return fail(res, 40001, "参数错误", [{ field: "prefix", reason: "required" }]);
  if (!/^[A-Z0-9-]{1,12}$/.test(prefix)) {
    return fail(res, 40001, "参数错误", [{ field: "prefix", reason: "invalid_prefix" }]);
  }
  if (!format || format.length > 80) {
    return fail(res, 40001, "参数错误", [{ field: "format", reason: "invalid_format" }]);
  }
  if (!format.includes("{PREFIX}")) {
    return fail(res, 40001, "参数错误", [{ field: "format", reason: "missing_prefix_placeholder" }]);
  }

  const now = new Date().toISOString();
  const store = loadVersionCodeRulesStore();
  const target = store.rules.find((item) => item.id === ruleId);
  if (!target) {
    return fail(res, 40401, "资源不存在", [{ field: "ruleId", reason: "not_found" }]);
  }

  target.prefix = prefix;
  target.format = format;
  target.status = target.status === "disabled" ? "draft" : target.status;
  target.updatedAt = now;
  target.sample = buildVersionCodeSample(target.format, target.prefix, target.moduleCode);
  saveVersionCodeRulesStore(store);

  return res.json(ok({ item: sanitizeRule(target) }, randomUUID()));
}

export function activateVersionCodeRule(req: Request, res: Response) {
  if (!requireAdmin(req, res)) return;

  const ruleId = String(req.params.ruleId || "").trim();
  if (!ruleId) return fail(res, 40001, "参数错误", [{ field: "ruleId", reason: "required" }]);

  const now = new Date().toISOString();
  const store = loadVersionCodeRulesStore();
  const target = store.rules.find((item) => item.id === ruleId);
  if (!target) {
    return fail(res, 40401, "资源不存在", [{ field: "ruleId", reason: "not_found" }]);
  }

  target.status = "active";
  target.effectiveAt = now;
  target.updatedAt = now;
  target.sample = buildVersionCodeSample(target.format, target.prefix, target.moduleCode);
  saveVersionCodeRulesStore(store);

  return res.json(ok({ item: sanitizeRule(target) }, randomUUID()));
}

export function disableVersionCodeRule(req: Request, res: Response) {
  if (!requireAdmin(req, res)) return;

  const ruleId = String(req.params.ruleId || "").trim();
  if (!ruleId) return fail(res, 40001, "参数错误", [{ field: "ruleId", reason: "required" }]);

  const now = new Date().toISOString();
  const store = loadVersionCodeRulesStore();
  const target = store.rules.find((item) => item.id === ruleId);
  if (!target) {
    return fail(res, 40401, "资源不存在", [{ field: "ruleId", reason: "not_found" }]);
  }

  target.status = "disabled";
  target.updatedAt = now;
  target.sample = buildVersionCodeSample(target.format, target.prefix, target.moduleCode);
  saveVersionCodeRulesStore(store);

  return res.json(ok({ item: sanitizeRule(target) }, randomUUID()));
}
