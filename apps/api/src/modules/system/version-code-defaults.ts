import type { VersionCodeRule } from "../../types";
import { applyVersionCodeFormat } from "../../utils/version-code-format";

const EMPTY_TIME = "--";

/** 与生成真实版本号同一套占位符，固定参考时间便于示例列展示 */
export function buildSample(format: string, prefix: string, moduleCode: string): string {
  return applyVersionCodeFormat(format, {
    prefix,
    moduleCode,
    globalCode: "GL001",
    seq: 1,
    now: new Date("2026-04-06T08:00:00.000Z"),
  });
}

export function createDefaultRules(at: Date = new Date()): VersionCodeRule[] {
  const now = at.toISOString();
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
      moduleCode: "WBS",
      prefix: "WBS",
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
