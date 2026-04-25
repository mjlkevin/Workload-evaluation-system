// ============================================================
// AI Assessment — 评估草稿辅助函数
// ============================================================
// P0.3 从 ai.service.ts 拆分出来的评估草稿垂直模块。
// 包含：Kimi 评估草稿生成、规则兜底、字段归一化、SKU 对齐等。

import { asString } from "../utils/helpers";
import {
  normalizeProductDomainName, normalizeProductModuleRows,
  requirementProductModuleRowsHaveMeaningfulContent,
} from "./ai-workbook";
import { defaultProviderRegistry, type ModelProvider } from "../ai/provider";

function getKimiProvider(): ModelProvider {
  const provider = defaultProviderRegistry.get("kimi");
  if (!provider) {
    throw new Error("kimi_provider_not_registered");
  }
  return provider;
}

// -------------------- 工具函数（避免循环导入）--------------------

function asModelObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asModelObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asModelObject(item))
    .filter((item) => Object.keys(item).length > 0);
}

function toNumberSafe(value: unknown): number {
  const text = asString(value).replace(/[^\d.-]/g, "");
  if (!text) return 0;
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function uniqueStringList(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = asString(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function pickModelField(input: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    if (!(key in input)) continue;
    const value = input[key];
    if (value === null || value === undefined) continue;
    if (typeof value === "boolean") continue;
    if (typeof value === "object") continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) continue;
      return String(value);
    }
    const s = asString(value);
    if (s) return s;
  }
  return "";
}

function pickNumberField(input: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = input[key];
    const text = asString(value).replace(/[^\d.-]/g, "");
    if (!text) continue;
    const parsed = Number(text);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}

// -------------------- 类型定义 --------------------

export type KimiAssessmentModuleItem = {
  cloudProduct?: string;
  skuName?: string;
  moduleName: string;
  standardDays: number;
  suggestedDays: number;
  reason: string;
};

export type KimiAssessmentDraft = {
  quoteMode: string;
  productLines: string[];
  userCount: number;
  orgCount: number;
  orgSimilarity: number;
  difficultyFactor: number;
  moduleItems: KimiAssessmentModuleItem[];
  risks: string[];
  assumptions: string[];
};

export type KimiAssessmentSnapshot = {
  basicInfo?: Record<string, unknown>;
  valuePropositionRows?: Array<Record<string, unknown>>;
  businessNeedRows?: Array<Record<string, unknown>>;
  devOverviewRows?: Array<Record<string, unknown>>;
  devTotalDays?: number;
  productModuleRows?: Array<Record<string, unknown>>;
  implementationScopeRows?: Array<Record<string, unknown>>;
  meetingNotes?: string;
  keyPointRows?: Array<Record<string, unknown>>;
};

export type KimiAssessmentPreviewInput = {
  source?: {
    globalVersionCode?: string;
    requirementVersionCode?: string;
  };
  requirementSnapshot?: KimiAssessmentSnapshot;
  ruleContext?: {
    promptProfile?: string;
  };
};

// -------------------- 评估草稿辅助函数 --------------------

/** 产品及模块表是否有任意一行有效（域/模块/子模块任一非空） */
export function snapshotHasProductModuleGrid(snapshot: KimiAssessmentSnapshot | undefined): boolean {
  if (!snapshot) return false;
  const rows = Array.isArray(snapshot.productModuleRows) ? snapshot.productModuleRows : [];
  return requirementProductModuleRowsHaveMeaningfulContent(
    rows.map((raw) => {
      const row = asModelObject(raw);
      return {
        productDomain: asString(row.productDomain),
        moduleName: asString(row.moduleName),
        subModule: asString(row.subModule),
        userCount: asString(row.userCount),
        implementationOrgCount: asString(row.implementationOrgCount),
        pilotOrgCount: asString(row.pilotOrgCount),
        partyBLead: asString(row.partyBLead),
        partyALead: asString(row.partyALead),
      };
    }),
  );
}

const KIMI_ASSESSMENT_NO_PRODUCT_MODULE_SYSTEM_SUPPLEMENT =
  "\n\n【无产品及模块表时的推断】若 requirementSnapshot.productModuleRows 为空或无有效行，不得因此只返回极少 moduleItems。你必须结合 businessNeedRows（业务需求）、keyPointRows（问题一览/关键点）、devOverviewRows、implementationScopeRows、meetingNotes 与 basicInfo.productLines（产品线），在遵守上文域级/平台级拆分规则的前提下，**语义推理**本次实施应纳入评估的 cloudProduct 与 skuName；每条 moduleItems.reason 须点名对应的业务需求或关键点依据，并在 assumptions 中说明「产品及模块表为空，模块清单由需求语义推断」。";

/** 实施域级「云产品」（与产品模块表 moduleName 一致），不得出现在平台产品线下的 skuName 中 */
const KINGDEE_DOMAIN_IMPLEMENTATION_CLOUDS = new Set<string>([
  "财务云",
  "供应链云",
  "制造云",
  "人力资源云",
  "全渠道云",
  "税务云",
  "流程服务云",
  "研发管理云",
  "电商与渠道云",
  "管理会计云",
  "制造协同云",
]);

function isKingdeeProductLineUmbrella(name: string): boolean {
  const t = asString(name).trim();
  if (!t) return false;
  return /金蝶AI星空|金蝶AI星瀚|^(星空|星瀚)$|云之家/.test(t);
}

function isKingdeeDomainImplementationCloud(name: string): boolean {
  const t = asString(name).trim();
  return Boolean(t && KINGDEE_DOMAIN_IMPLEMENTATION_CLOUDS.has(t));
}

/** 是否已有「云产品=domain + 具体 SKU」的明细行（用于去掉平台下错误的域级重复行） */
function hasConcreteSkuRowsUnderDomain(all: KimiAssessmentModuleItem[], domain: string): boolean {
  const d = asString(domain).trim();
  if (!d) return false;
  return all.some((it) => {
    const c = asString(it.cloudProduct).trim();
    const s = asString(it.skuName).trim();
    if (c !== d) return false;
    if (!s) return false;
    if (isKingdeeDomainImplementationCloud(s)) return false;
    return true;
  });
}

/**
 * 模型常把「财务云/供应链云」填在 skuName、cloudProduct 填「金蝶AI星空」。
 * 若已有该域下 SKU 明细则删除域级重复行；否则提升为云产品行并清空 skuName（非 SKU 人天）。
 */
export function realignKingdeeDomainCloudModuleItems(items: KimiAssessmentModuleItem[]): KimiAssessmentModuleItem[] {
  const out: KimiAssessmentModuleItem[] = [];
  for (const item of items) {
    const cloud = asString(item.cloudProduct).trim();
    const sku = asString(item.skuName).trim();
    if (isKingdeeProductLineUmbrella(cloud) && isKingdeeDomainImplementationCloud(sku)) {
      if (hasConcreteSkuRowsUnderDomain(items, sku)) {
        continue;
      }
      out.push({
        ...item,
        cloudProduct: sku,
        skuName: "",
        moduleName: sku || item.moduleName,
      });
      continue;
    }
    out.push(item);
  }
  return out;
}

function formatAssessmentEntityPrefix(item: KimiAssessmentModuleItem): string {
  const sku = asString(item.skuName).trim();
  const cloud = asString(item.cloudProduct).trim();
  if (sku) return `SKU「${sku}」`;
  if (cloud) return `云产品「${cloud}」`;
  const mod = asString(item.moduleName).trim();
  return `条目「${mod || "未命名"}」`;
}
function deriveDevTotalDays(snapshot: KimiAssessmentSnapshot): number {
  const explicit = Math.max(0, Number(snapshot.devTotalDays || 0));
  if (explicit > 0) return explicit;
  const rows = Array.isArray(snapshot.devOverviewRows) ? snapshot.devOverviewRows : [];
  const codingSum = rows.reduce((sum, row) => sum + toNumberSafe(asModelObject(row).codingDays), 0);
  return Math.max(0, Number((codingSum * 1.6).toFixed(1)));
}

function mergeDevTotalModuleItem(moduleItems: KimiAssessmentModuleItem[], snapshot: KimiAssessmentSnapshot): KimiAssessmentModuleItem[] {
  const devTotalDays = deriveDevTotalDays(snapshot);
  if (devTotalDays <= 0) return moduleItems;

  const rounded = Math.max(1, Math.round(devTotalDays));
  const merged = [...moduleItems];
  const matchIndex = merged.findIndex((item) => {
    const cloud = asString(item.cloudProduct);
    const sku = asString(item.skuName || item.moduleName);
    return /开发需求概要/.test(cloud) || /开发(总|汇)人天|开发需求/.test(sku);
  });
  const devItem: KimiAssessmentModuleItem = {
    cloudProduct: "开发需求概要",
    skuName: "合计行",
    moduleName: "开发总人天",
    standardDays: rounded,
    suggestedDays: rounded,
    reason: "取开发需求概要“合计”列总人天纳入评估范围，用于体现开发实施工作量基线。"
  };
  if (matchIndex >= 0) {
    merged[matchIndex] = devItem;
  } else {
    merged.push(devItem);
  }
  return merged;
}

function estimateFallbackAssessmentDraft(snapshot: KimiAssessmentSnapshot): KimiAssessmentDraft {
  const basicInfo = asModelObject(snapshot.basicInfo);
  const productModuleRows = Array.isArray(snapshot.productModuleRows) ? snapshot.productModuleRows : [];
  const devOverviewRows = Array.isArray(snapshot.devOverviewRows) ? snapshot.devOverviewRows : [];
  const businessNeedRows = Array.isArray(snapshot.businessNeedRows) ? snapshot.businessNeedRows : [];
  const scopeRows = Array.isArray(snapshot.implementationScopeRows) ? snapshot.implementationScopeRows : [];
  const keyPointRows = Array.isArray(snapshot.keyPointRows) ? snapshot.keyPointRows : [];
  const meetingNotes = asString(snapshot.meetingNotes);

  const productLines = uniqueStringList(
    Array.isArray(basicInfo.productLines) ? (basicInfo.productLines as unknown[]) : []
  );
  const orgCount = Math.max(1, scopeRows.length || 1);

  let summedUserCount = 0;
  for (const row of productModuleRows) {
    const o = asModelObject(row);
    summedUserCount += toNumberSafe(o.userCount);
  }
  const userCount = Math.max(0, Math.round(summedUserCount || 100));
  const orgSimilarity = orgCount <= 1 ? 0 : 0.6;

  const complexityScore =
    (businessNeedRows.length >= 8 ? 0.4 : businessNeedRows.length >= 3 ? 0.25 : 0.15) +
    (keyPointRows.length >= 4 ? 0.2 : keyPointRows.length >= 1 ? 0.1 : 0) +
    (!meetingNotes ? 0.15 : 0);
  const difficultyFactor = clampNumber(Number(complexityScore.toFixed(2)), 0, 1);

  const moduleItems: KimiAssessmentModuleItem[] = [];
  for (const row of productModuleRows.slice(0, 12)) {
    const o = asModelObject(row);
    const cloudProduct = normalizeProductDomainName(asString(o.moduleName));
    const skuName = asString(o.subModule);
    const moduleName = skuName || cloudProduct;
    if (!moduleName) continue;
    const base = clampNumber(Math.round(toNumberSafe(o.userCount) / 120) || 2, 1, 20);
    const suggested = clampNumber(Math.round(base * (1 + difficultyFactor * 0.6)), base, 30);
    moduleItems.push({
      cloudProduct: cloudProduct || undefined,
      skuName: skuName || undefined,
      moduleName,
      standardDays: base,
      suggestedDays: suggested,
      reason: "基于用户规模、需求复杂度与组织协同成本进行估算（规则兜底）。"
    });
  }

  if (!moduleItems.length) {
    for (const row of devOverviewRows.slice(0, 12)) {
      const o = asModelObject(row);
      const cloudProduct = asString(o.businessDomain);
      const skuName = asString(o.moduleName);
      const moduleName = skuName || cloudProduct;
      if (!moduleName) continue;
      const coding = Math.max(1, Math.round(toNumberSafe(o.codingDays)));
      moduleItems.push({
        cloudProduct: cloudProduct || undefined,
        skuName: skuName || undefined,
        moduleName,
        standardDays: coding,
        suggestedDays: clampNumber(Math.round(coding * 1.2), coding, 60),
        reason: "基于开发需求概要的编码人天做实施侧换算（规则兜底）。"
      });
    }
  }

  const risks: string[] = [];
  if (!meetingNotes) risks.push("未提供会议纪要，关键边界条件可能遗漏。");
  if (!scopeRows.length) risks.push("实施组织范围未明确，组织推广成本存在偏差风险。");
  if (!productLines.length) risks.push("未标注产品线，模块组合可能存在偏差。");
  if (!risks.length) risks.push("需在实施前确认主数据口径与组织推广策略。");

  return {
    quoteMode: "模块报价",
    productLines,
    userCount,
    orgCount,
    orgSimilarity,
    difficultyFactor,
    moduleItems: mergeDevTotalModuleItem(moduleItems, snapshot),
    risks,
    assumptions: [
      "当前结果为 AI 草稿，需人工校核后再作为正式评估输入。",
      "本次估算以需求页当前内容为边界，未纳入未记录的外部约束。"
    ]
  };
}

function normalizeKimiAssessmentDraft(input: Record<string, unknown>, fallback: KimiAssessmentDraft): KimiAssessmentDraft {
  const normalized = asModelObject(input.assessmentDraft);
  const source = Object.keys(normalized).length ? normalized : input;
  const moduleItemsRaw = Array.isArray(source.moduleItems) ? source.moduleItems : [];
  const moduleItems = moduleItemsRaw
    .map((row) => asModelObject(row))
    .map((row) => ({
      cloudProduct: normalizeProductDomainName(asString(row.cloudProduct)),
      skuName: asString(row.skuName),
      moduleName: asString(row.moduleName),
      standardDays: Math.max(0, Math.round(toNumberSafe(row.standardDays))),
      suggestedDays: Math.max(0, Math.round(toNumberSafe(row.suggestedDays))),
      reason: asString(row.reason)
    }))
    .filter((row) => row.moduleName);

  const productLines = uniqueStringList(Array.isArray(source.productLines) ? (source.productLines as unknown[]) : []);
  const risks = uniqueStringList(Array.isArray(source.risks) ? (source.risks as unknown[]) : []);
  const assumptions = uniqueStringList(Array.isArray(source.assumptions) ? (source.assumptions as unknown[]) : []);

  return {
    quoteMode: asString(source.quoteMode) || fallback.quoteMode,
    productLines: productLines.length ? productLines : fallback.productLines,
    userCount: Math.max(0, Math.round(toNumberSafe(source.userCount) || fallback.userCount)),
    orgCount: Math.max(1, Math.round(toNumberSafe(source.orgCount) || fallback.orgCount)),
    orgSimilarity: clampNumber(Number(source.orgSimilarity ?? fallback.orgSimilarity), 0, 1),
    difficultyFactor: clampNumber(Number(source.difficultyFactor ?? fallback.difficultyFactor), 0, 1),
    moduleItems: moduleItems.length ? moduleItems : fallback.moduleItems,
    risks: risks.length ? risks : fallback.risks,
    assumptions: assumptions.length ? assumptions : fallback.assumptions
  };
}

function isGenericAssessmentReason(reason: string): boolean {
  const text = asString(reason).trim();
  if (!text) return true;
  if (text.length < 8) return true;
  const patterns = [
    /重排后的估算建议/,
    /人工复核/,
    /规则兜底/,
    /基于用户规模、需求复杂度与组织协同成本进行估算/,
    /开发需求概要的编码人天做实施侧换算/
  ];
  return patterns.some((pattern) => pattern.test(text));
}

function buildDeviationReason(standardDays: number, suggestedDays: number): string {
  const standard = Math.max(0, Math.round(Number(standardDays) || 0));
  const suggested = Math.max(0, Math.round(Number(suggestedDays) || 0));
  if (standard <= 0) {
    return "标准人天缺少有效基线，建议人天按当前需求复杂度与实施范围估算，请人工复核。";
  }
  const delta = suggested - standard;
  if (delta === 0) {
    return "建议人天与标准人天一致，当前范围未识别到明显偏离因素。";
  }
  const pct = Math.round((Math.abs(delta) / standard) * 100);
  if (delta > 0) {
    return `建议人天较标准人天增加 ${delta} 天（约 +${pct}%），主要考虑需求复杂度、组织协同与推广范围带来的额外工作量。`;
  }
  return `建议人天较标准人天减少 ${Math.abs(delta)} 天（约 -${pct}%），当前实施范围较聚焦，标准交付能力可覆盖主要工作项。`;
}

function parseJsonFromModelText(text: string): Record<string, unknown> {
  const raw = asString(text);
  if (!raw) return {};
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return parsed || {};
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    return {};
  }
}

function buildHolisticSupplementReason(params: {
  businessNeedCount: number;
  devOverviewCount: number;
  scopeCount: number;
  hasMeetingNotes: boolean;
  hasKeyPoints: boolean;
}): string {
  const signals: string[] = [];
  if (params.businessNeedCount >= 8) signals.push("业务需求条目较多");
  if (params.devOverviewCount >= 5) signals.push("开发概要涉及模块较广");
  if (params.scopeCount >= 2) signals.push("实施组织范围跨多单位");
  if (params.hasMeetingNotes) signals.push("会议纪要存在额外约束");
  if (params.hasKeyPoints) signals.push("关键点中包含风险事项");
  if (!signals.length) signals.push("基于当前信息做审慎估算");
  return `该项由模型按综合评估补齐：${signals.join("、")}，并结合复杂度与协同成本给出建议人天。`;
}

function resolveAssessmentReason(rawReason: string, standardDays: number, suggestedDays: number): string {
  const reason = asString(rawReason).trim();
  if (!isGenericAssessmentReason(reason)) return reason;
  return buildDeviationReason(standardDays, suggestedDays);
}

/** 实施侧“明显加工作量”语义：禁止把单独出现的「报表」等标准产品词当作加严信号（易与「总账、报表」类枚举误配）。 */
function containsWorkloadEscalationSignal(text: string): boolean {
  return /二开|定开|改造|复杂|高并发|多组织|跨组织|接口|集成|主数据|流程重构|性能|迁移|联调|审批链|深度定制|定制开发|个性化|二次开发|报表(?:定制|二开|开发|对接|改造|实施)|自定义报表|开发报表|报表.{0,10}(?:对接|集成|二开|改造)/.test(
    asString(text),
  );
}

/** 业务需求单元格内多为顿号/逗号分隔的模块范围枚举，不等同于该 SKU 需额外实施人天。 */
function looksLikeWeakModuleEnumerationInBusinessNeed(text: string): boolean {
  const t = asString(text).trim();
  if (t.length < 12) return false;
  const segments = t
    .split(/[、，,;/；]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length >= 4) return true;
  if (segments.length >= 3) return true;
  if (segments.length >= 2 && t.length >= 36) return true;
  return false;
}

function buildSkuEvidence(snapshot: KimiAssessmentSnapshot, item: KimiAssessmentModuleItem): {
  hasStrongEvidence: boolean;
  summary: string;
} {
  const sku = asString(item.skuName || item.moduleName);
  const moduleName = asString(item.moduleName);
  const cloud = asString(item.cloudProduct);
  const keys = [sku, moduleName, cloud].filter(Boolean);
  const normalize = (text: string) => asString(text).toLowerCase();
  const hit = (text: string) => {
    const source = normalize(text);
    return keys.some((k) => normalize(k) && source.includes(normalize(k)));
  };

  const evidence: string[] = [];
  let score = 0;

  const businessNeedRows = Array.isArray(snapshot.businessNeedRows) ? snapshot.businessNeedRows : [];
  businessNeedRows.forEach((row, idx) => {
    const obj = asModelObject(row);
    const packed = `${asString(obj.businessNeed)} ${asString(obj.solutionSuggestion)} ${asString(obj.title)} ${asString(obj.requiresCustomDev)}`;
    if (!hit(packed)) return;
    const bizNeedOnly = asString(obj.businessNeed);
    const requiresDev = asString(obj.requiresCustomDev) === "是";
    const enumerationHit =
      looksLikeWeakModuleEnumerationInBusinessNeed(bizNeedOnly) && !requiresDev && !containsWorkloadEscalationSignal(packed);
    if (enumerationHit) {
      return;
    }
    if (requiresDev || containsWorkloadEscalationSignal(packed)) {
      score += 2;
    } else {
      score += 1;
    }
    if (evidence.length < 2) {
      evidence.push(`业务需求#${idx + 1}：${asString(obj.businessNeed).slice(0, 26) || "匹配到该SKU需求"}`);
    }
  });

  const devRows = Array.isArray(snapshot.devOverviewRows) ? snapshot.devOverviewRows : [];
  devRows.forEach((row, idx) => {
    const obj = asModelObject(row);
    const packed = `${asString(obj.moduleName)} ${asString(obj.functionDesc)} ${asString(obj.solutionSuggestion)}`;
    if (!hit(packed)) return;
    const coding = toNumberSafe(obj.codingDays);
    if (coding > Number(item.standardDays || 0)) {
      score += 2;
      if (evidence.length < 3) {
        evidence.push(`开发概要#${idx + 1}：编码人天${coding}高于标准${item.standardDays}`);
      }
    } else {
      score += 1;
      if (evidence.length < 3) {
        evidence.push(`开发概要#${idx + 1}：${asString(obj.functionDesc).slice(0, 24) || "匹配到该SKU模块"}`);
      }
    }
  });

  const keyPointRows = Array.isArray(snapshot.keyPointRows) ? snapshot.keyPointRows : [];
  keyPointRows.forEach((row, idx) => {
    const obj = asModelObject(row);
    const packed = `${asString(obj.subItem)} ${asString(obj.detail)} ${asString(obj.note)}`;
    if (!hit(packed)) return;
    score += containsWorkloadEscalationSignal(packed) ? 2 : 1;
    if (evidence.length < 4) {
      evidence.push(`关键点#${idx + 1}：${asString(obj.detail).slice(0, 24) || "存在相关风险约束"}`);
    }
  });

  const notes = asString(snapshot.meetingNotes);
  if (notes && hit(notes)) {
    score += containsWorkloadEscalationSignal(notes) ? 2 : 1;
    if (evidence.length < 4) {
      evidence.push("会议纪要：存在该SKU相关范围/约束描述");
    }
  }

  return {
    hasStrongEvidence: score >= 2,
    summary: evidence.length ? evidence.join("；") : "未命中该SKU的明确超标证据",
  };
}

function normalizeSkuReason(snapshot: KimiAssessmentSnapshot, item: KimiAssessmentModuleItem): KimiAssessmentModuleItem {
  const standard = Math.max(1, Math.round(Number(item.standardDays || 0)));
  const suggestedRaw = Math.max(0, Math.round(Number(item.suggestedDays || 0)));
  const evidence = buildSkuEvidence(snapshot, item);
  const entity = formatAssessmentEntityPrefix(item);

  if (suggestedRaw > standard && !evidence.hasStrongEvidence) {
    return {
      ...item,
      standardDays: standard,
      suggestedDays: standard,
      reason: `${entity}未在需求记录中发现明确超标证据（${evidence.summary}），建议人天回落至标准人天 ${standard}。`,
    };
  }

  if (suggestedRaw > standard) {
    const delta = suggestedRaw - standard;
    return {
      ...item,
      standardDays: standard,
      suggestedDays: suggestedRaw,
      reason: `${entity}建议人天 +${delta}（${standard} -> ${suggestedRaw}），依据：${evidence.summary}。`,
    };
  }

  if (suggestedRaw < standard) {
    const delta = standard - suggestedRaw;
    const rawReason = resolveAssessmentReason(asString(item.reason), standard, suggestedRaw);
    return {
      ...item,
      standardDays: standard,
      suggestedDays: suggestedRaw,
      reason: `${entity}建议人天 -${delta}（${standard} -> ${suggestedRaw}），${rawReason}`,
    };
  }

  return {
    ...item,
    standardDays: standard,
    suggestedDays: standard,
    reason: `${entity}建议人天与标准一致（${standard}），依据：${evidence.summary}。`,
  };
}

function isDevTotalItem(item: KimiAssessmentModuleItem): boolean {
  const cloud = asString(item.cloudProduct);
  const sku = asString(item.skuName || item.moduleName);
  return /开发需求概要/.test(cloud) || /开发总人天|合计行/.test(sku);
}

function isCoarseGrainedAssessmentItem(item: KimiAssessmentModuleItem): boolean {
  if (isDevTotalItem(item)) return false;
  const cloud = asString(item.cloudProduct).trim();
  const sku = asString(item.skuName || "").trim();
  const moduleName = asString(item.moduleName || "").trim();
  const coarseKeywords = [
    "金蝶AI星空",
    "金蝶AI星瀚",
    "云之家",
    "发票云",
    "旗舰版",
    "标准版",
    "专业版",
    "企业版",
    "集团版",
    "系统",
    "平台",
    "整体",
    "全模块",
    "全部模块",
  ];
  const text = `${cloud}|${sku}|${moduleName}`;
  const hitKeyword = coarseKeywords.some((keyword) => text.includes(keyword));
  if (!hitKeyword) return false;
  if (sku && sku === cloud) return true;
  if (!sku && moduleName && moduleName === cloud) return true;
  if (/旗舰版|标准版|专业版|企业版|集团版/.test(sku || moduleName)) return true;
  return /(^|[-_])?(系统|平台|整体|全模块|全部模块)$/.test(sku || moduleName);
}

function buildCloudSkuModuleItemsFromSnapshot(
  snapshot: KimiAssessmentSnapshot,
  draft: KimiAssessmentDraft
): { items: KimiAssessmentModuleItem[]; coarseFilteredCount: number } {
  const draftForCloudSku: KimiAssessmentDraft = {
    ...draft,
    moduleItems: realignKingdeeDomainCloudModuleItems(draft.moduleItems),
  };
  const productModuleRows = normalizeProductModuleRows(
    Array.isArray(snapshot.productModuleRows)
      ? (snapshot.productModuleRows.map((x) => asModelObject(x)) as RequirementImportData["productModuleRows"])
      : []
  );
  if (!productModuleRows.length) {
    const normalized = draftForCloudSku.moduleItems.map((item) => normalizeSkuReason(snapshot, item));
    const filtered = normalized.filter((item) => !isCoarseGrainedAssessmentItem(item));
    return {
      items: filtered.length ? filtered : normalized,
      coarseFilteredCount: Math.max(0, normalized.length - filtered.length),
    };
  }

  const normalize = (value: unknown) => asString(value).toLowerCase();
  const merged: KimiAssessmentModuleItem[] = draftForCloudSku.moduleItems.map((item) => normalizeSkuReason(snapshot, item));

  const covered = new Set<string>();
  for (const item of merged) {
    covered.add(normalize(item.moduleName));
    covered.add(normalize(item.skuName));
    covered.add(normalize(`${item.cloudProduct}-${item.skuName}`));
  }

  const businessNeedCount = Array.isArray(snapshot.businessNeedRows) ? snapshot.businessNeedRows.length : 0;
  const devOverviewCount = Array.isArray(snapshot.devOverviewRows) ? snapshot.devOverviewRows.length : 0;
  const scopeCount = Array.isArray(snapshot.implementationScopeRows) ? snapshot.implementationScopeRows.length : 0;
  const hasMeetingNotes = Boolean(asString(snapshot.meetingNotes));
  const hasKeyPoints = Array.isArray(snapshot.keyPointRows) && snapshot.keyPointRows.length > 0;

  for (const row of productModuleRows) {
    const cloudProduct = asString(row.moduleName);
    const skuName = asString(row.subModule);
    if (!cloudProduct || !skuName) continue;
    const key = normalize(`${cloudProduct}-${skuName}`);
    if (covered.has(key) || covered.has(normalize(skuName))) continue;

    const userCount = Math.max(0, toNumberSafe(row.userCount));
    const inferredStandard = clampNumber(Math.round(userCount / 120) || 2, 1, 20);
    const extraComplexity =
      (businessNeedCount >= 8 ? 0.2 : 0.1) +
      (devOverviewCount >= 5 ? 0.15 : 0.05) +
      (scopeCount >= 2 ? 0.15 : 0) +
      (hasMeetingNotes ? 0.08 : 0) +
      (hasKeyPoints ? 0.12 : 0);
    const suggestedDays = Math.max(
      inferredStandard,
      Math.round(
        inferredStandard * (1 + clampNumber(Number(draftForCloudSku.difficultyFactor || 0), 0, 1) * 0.45 + extraComplexity),
      ),
    );

    merged.push(normalizeSkuReason(snapshot, {
      cloudProduct,
      skuName,
      moduleName: `${cloudProduct}-${skuName}`,
      standardDays: inferredStandard,
      suggestedDays,
      reason: buildHolisticSupplementReason({
        businessNeedCount,
        devOverviewCount,
        scopeCount,
        hasMeetingNotes,
        hasKeyPoints,
      }),
    }));
    covered.add(key);
  }

  const filtered = merged.filter((item) => !isCoarseGrainedAssessmentItem(item));
  const fallbackItems = merged.length ? merged : draftForCloudSku.moduleItems;
  return {
    items: filtered.length ? filtered : fallbackItems,
    coarseFilteredCount: Math.max(0, merged.length - filtered.length),
  };
}


async function generateAssessmentDraftByKimi(params: {
  apiUrl: string;
  apiKey: string;
  model: string;
  promptTemplate: string;
  payload: KimiAssessmentPreviewInput;
  fallback: KimiAssessmentDraft;
  timeoutMs: number;
}): Promise<{ draft: KimiAssessmentDraft; rawContent: string }> {
  const assessSnap = asModelObject(params.payload.requirementSnapshot) as KimiAssessmentSnapshot;
  const noProductModuleGrid = !snapshotHasProductModuleGrid(assessSnap);
  const defaultSystemPrompt =
    "你是资深项目经理 + 资深实施顾问。你不是做简单 SKU 对照，而是要基于需求全量信息做综合实施评估。必须只返回 JSON。字段固定：assessmentDraft.quoteMode/productLines/userCount/orgCount/orgSimilarity/difficultyFactor/moduleItems/risks/assumptions。moduleItems 每项字段：cloudProduct/skuName/moduleName/standardDays/suggestedDays/reason。所有数值字段必须为非负数，orgSimilarity 和 difficultyFactor 范围 0-1。评估时必须综合：basicInfo（行业、规模、上线目标）、businessNeedRows（业务复杂度）、devOverviewRows（开发基线）、implementationScopeRows（组织范围与地域）、meetingNotes（隐性约束）、keyPointRows（重点风险）。reason 必须体现增加/减少人天的业务原因与实施原因，不能仅写“按模板匹配”。禁止把“产品名/版本名/平台名（如金蝶AI星空、旗舰版）”直接当成 SKU，必须下钻到可实施功能项。财务云、供应链云等是实施域级云产品，不得填入 skuName 并挂在金蝶AI星空下冒充 SKU；域级人天归 cloudProduct=该域名，skuName 仅写子模块。若信息不足，给出审慎估算并在 risks/assumptions 明确不确定性来源。严禁仅凭业务需求正文中出现与 SKU 同名的词、或「总账、报表、出纳」类标准功能并列枚举，就认定 suggestedDays 必须高于 standardDays；须结合该条需求完整语义与实施顾问角色做专业判断，只有存在相对标准产品交付的明确增量（如二开、深度集成、多组织推广、性能/迁移、额外培训与方案等）时才上调，并在 reason 中写清增量内容而非复述关键词。";
  const systemPromptCore = asString(params.promptTemplate) || defaultSystemPrompt;
  const systemPrompt = noProductModuleGrid ? systemPromptCore + KIMI_ASSESSMENT_NO_PRODUCT_MODULE_SYSTEM_SUPPLEMENT : systemPromptCore;
  const userNoGridClause = noProductModuleGrid
    ? `10) 当前快照无有效的「产品及模块」表数据：你必须根据业务需求、问题一览（keyPointRows）、开发概要、实施范围、会议纪要与 basicInfo.productLines，按 system 中域级/平台级规则**推理**应评估的模块清单；moduleItems 须覆盖推断到的主要交付域/子模块，每条 reason 写明对应需求或关键点；assumptions 须声明模块范围由语义推断。\n`
    : "";
  const userPrompt =
    `请基于以下需求快照输出实施评估草稿。\n` +
    `要求：\n` +
    `1) 只输出 JSON 对象；\n` +
    `2) quoteMode 默认优先“模块报价”；\n` +
    `3) 若信息不足，给出审慎估算并在 risks/assumptions 说明；\n` +
    `4) moduleItems 至少返回 1 条；\n` +
    `5) 若 requirementSnapshot.devTotalDays > 0，请将其作为“开发总人天”纳入 moduleItems；\n` +
    `6) 对每个 SKU 必须给出“该 SKU 专属”的 reason，禁止全表复用同一条模糊理由；\n` +
    `7) 当 suggestedDays > standardDays 时，reason 必须明确写出该 SKU 的超标证据来源（对应业务需求/开发概要/关键点/会议纪要中的具体记录），且须说明相对标准交付的增量工作，不得仅复述需求中与 SKU 同名的词或并列功能清单；\n` +
    `8) 业务需求里用顿号/逗号并列多个标准模块名称（如出纳、存货、成本、总账、报表）通常只表示实施范围而非单项加人天，不得据此对其中每个 SKU 自动做同幅度上调；\n` +
    `9) cloudProduct 表示产品线或实施域云产品（如金蝶AI星空、财务云）；skuName 仅填可交付子模块/SKU（如总账、采购管理）。禁止把财务云、供应链云等「实施域云」写进 skuName 又挂在金蝶AI星空下；域级人天应归在云产品行，SKU 列留空或仅列真实子模块。\n` +
    userNoGridClause +
    `\n${JSON.stringify(params.payload)}`;

  const provider = getKimiProvider();
  const completion = await provider.chatCompletion({
    model: params.model,
    temperature: 0.1,
    responseFormat: "json_object",
    timeoutMs: params.timeoutMs,
    credentialsOverride: {
      apiKey: params.apiKey,
      apiBaseUrl: params.apiUrl,
    },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const content = completion.content;
  // 注：KimiProvider 在 content 为空时已抛 ProviderError("empty_response", "model_empty_response")，
  // 此处不再重复检查；保留 JSON 字段级校验。
  const parsed = parseJsonFromModelText(content);
  if (!Object.keys(parsed).length) {
    throw new Error("model_invalid_assessment_json");
  }
  const draft = normalizeKimiAssessmentDraft(parsed, params.fallback);
  return { draft, rawContent: content };
}

export { estimateFallbackAssessmentDraft, normalizeKimiAssessmentDraft, buildCloudSkuModuleItemsFromSnapshot, mergeDevTotalModuleItem, generateAssessmentDraftByKimi, getKimiProvider, parseJsonFromModelText };
export type { KimiAssessmentModuleItem, KimiAssessmentDraft, KimiAssessmentSnapshot, KimiAssessmentPreviewInput };
