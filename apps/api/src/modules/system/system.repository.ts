import fs from "node:fs";
import path from "node:path";

import { VersionCodeRule, VersionCodeRulesStore } from "../../types";
import { versionCodeRulesStorePath } from "../../utils";

const EMPTY_TIME = "--";

function buildSample(format: string, prefix: string, moduleCode: string): string {
  const replacements: Array<[string, string]> = [
    ["{PREFIX}", prefix],
    ["{MODULE}", moduleCode],
    ["{YYYYMMDD}", "20260406"],
    ["{YYYYMM}", "202604"],
    ["{YYYY}", "2026"],
    ["{GL}", "GL001"],
    ["{NNN}", "001"],
    ["{NN}", "01"],
  ];
  return replacements.reduce((result, [token, value]) => result.split(token).join(value), format);
}

function createDefaultRules(): VersionCodeRule[] {
  const now = new Date().toISOString();
  const defaultRules: Array<Omit<VersionCodeRule, "sample" | "updatedAt">> = [
    {
      id: "rule-global",
      moduleKey: "global",
      moduleName: "总方案",
      moduleCode: "GL",
      prefix: "GL",
      format: "{PREFIX}-{YYYYMMDD}-{NNN}",
      status: "active",
      effectiveAt: now,
    },
    {
      id: "rule-requirement",
      moduleKey: "requirement",
      moduleName: "需求",
      moduleCode: "RQ",
      prefix: "RQ",
      format: "{PREFIX}-{GL}-{NN}",
      status: "active",
      effectiveAt: now,
    },
    {
      id: "rule-implementation",
      moduleKey: "implementation",
      moduleName: "实施评估",
      moduleCode: "IA",
      prefix: "IA",
      format: "{PREFIX}-{GL}-{NN}",
      status: "draft",
      effectiveAt: EMPTY_TIME,
    },
    {
      id: "rule-dev",
      moduleKey: "dev",
      moduleName: "开发评估",
      moduleCode: "DV",
      prefix: "DV",
      format: "{PREFIX}-{YYYY}-{NNN}",
      status: "disabled",
      effectiveAt: EMPTY_TIME,
    },
    {
      id: "rule-resource",
      moduleKey: "resource",
      moduleName: "资源人天及成本",
      moduleCode: "RS",
      prefix: "RS",
      format: "{PREFIX}-{YYYYMM}-{NNN}",
      status: "active",
      effectiveAt: now,
    },
    {
      id: "rule-wbs",
      moduleKey: "wbs",
      moduleName: "WBS",
      moduleCode: "WB",
      prefix: "WB",
      format: "{PREFIX}-{YYYYMM}-{NNN}",
      status: "draft",
      effectiveAt: EMPTY_TIME,
    },
  ];
  return defaultRules.map((item) => ({
    ...item,
    sample: buildSample(item.format, item.prefix, item.moduleCode),
    updatedAt: now,
  }));
}

function normalizeStore(input: unknown): VersionCodeRulesStore {
  const now = new Date().toISOString();
  const data = input as Partial<VersionCodeRulesStore>;
  if (!data || !Array.isArray(data.rules)) {
    return { rules: createDefaultRules() };
  }
  const normalized = data.rules
    .filter((item): item is VersionCodeRule => Boolean(item && typeof item.id === "string"))
    .map((item) => ({
      ...item,
      sample: buildSample(item.format, item.prefix, item.moduleCode),
      updatedAt: item.updatedAt || now,
      effectiveAt: item.effectiveAt || EMPTY_TIME,
    }));
  if (!normalized.length) return { rules: createDefaultRules() };
  return { rules: normalized };
}

export function loadVersionCodeRulesStore(): VersionCodeRulesStore {
  const filePath = versionCodeRulesStorePath();
  if (!fs.existsSync(filePath)) {
    const initStore: VersionCodeRulesStore = { rules: createDefaultRules() };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(initStore, null, 2), "utf-8");
    return initStore;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    const normalized = normalizeStore(parsed);
    fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), "utf-8");
    return normalized;
  } catch {
    const fallback: VersionCodeRulesStore = { rules: createDefaultRules() };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), "utf-8");
    return fallback;
  }
}

export function saveVersionCodeRulesStore(store: VersionCodeRulesStore): void {
  const filePath = versionCodeRulesStorePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const normalized = normalizeStore(store);
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), "utf-8");
}

export function buildVersionCodeSample(format: string, prefix: string, moduleCode: string): string {
  return buildSample(format, prefix, moduleCode);
}
