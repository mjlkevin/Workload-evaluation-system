// ============================================================
// AI 服务 - Kimi API 调用
// ============================================================

import { Request, Response } from "express";
import XLSX from "xlsx";
import { randomUUID } from "node:crypto";

import { BasicProjectInfo, RequirementImportData } from "../types";
import { config } from "../config/env";
import { asString, normalizeCellText, parseCellNumber } from "../utils/helpers";
import { normalizeKimiModelName } from "../utils/model-name";
import { ok, fail } from "../utils/response";
import {
  loadRequirementSystemConfigStore,
  resolveActiveRequirementKimiApiKey,
} from "../modules/system/system.repository";
import { buildKimiAssessmentDraftMarkdown } from "../utils/kimi-assessment-markdown";
import { defaultProviderRegistry, type ModelProvider } from "../ai/provider";
import {
  buildWorkbookPreviewText,
  getSheetRows,
  inferProductLinesFromProductModules,
  mergeRequirementImportData,
  normalizeProductDomainName,
  normalizeProductModuleRows,
  parseRequirementImportFromWorkbook,
  requirementProductModuleRowsHaveMeaningfulContent,
} from "./ai-workbook";
import {
  estimateFallbackAssessmentDraft,
  normalizeKimiAssessmentDraft,
  buildCloudSkuModuleItemsFromSnapshot,
  mergeDevTotalModuleItem,
  realignKingdeeDomainCloudModuleItems,
  snapshotHasProductModuleGrid,
  generateAssessmentDraftByKimi,
  type KimiAssessmentModuleItem,
  type KimiAssessmentDraft,
  type KimiAssessmentSnapshot,
  type KimiAssessmentPreviewInput,
  parseJsonFromModelText,
} from "./ai-assessment";

// -------------------- AI Provider 取用（T4 起）--------------------
// 旧 requestKimiCompletion / fetchKimiCompletionOnce / buildKimiRequestError
// 已整体迁入 KimiProvider；本文件保留业务编排（prompt 组装、JSON 解析、
// 字段归一化）逻辑。Provider 在 createApp() 启动期注册到 defaultProviderRegistry。

function getKimiProvider(): ModelProvider {
  const provider = defaultProviderRegistry.get("kimi");
  if (!provider) {
    throw new Error("kimi_provider_not_registered");
  }
  return provider;
}

// -------------------- 解析辅助函数 --------------------

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

function normalizeBasicProjectInfo(input: Record<string, unknown>): BasicProjectInfo {
  const rawIndustry = pickModelField(input, ["customerIndustry", "客户行业", "行业"]);
  return {
    customerName: pickModelField(input, ["customerName", "客户名称"]),
    location: pickModelField(input, ["location", "地点", "所在地区", "地区", "城市"]),
    projectName: pickModelField(input, ["projectName", "项目名称"]),
    opportunityNo: pickModelField(input, ["opportunityNo", "商机号"]),
    productLines: uniqueStringList(
      Array.isArray(input.productLines) ? (input.productLines as unknown[]) : []
    ),
    customerIndustry: normalizeIndustryTagText(rawIndustry),
    enterpriseRevenue: pickModelField(input, ["enterpriseRevenue", "企业营收", "营收"]),
    itStatus: pickModelField(input, ["itStatus", "信息化现状"]),
    expectedGoLive: pickModelField(input, ["expectedGoLive", "预期上线时间"]),
    enterpriseProfile: pickModelField(input, ["enterpriseProfile", "企业简介"]),
    projectBackgroundNeeds: pickModelField(input, ["projectBackgroundNeeds", "项目背景和需求", "项目背景需求"]),
    projectGoals: pickModelField(input, ["projectGoals", "项目目标"])
  };
}

function normalizeIndustryTagText(input: string): string {
  const raw = asString(input);
  if (!raw) return "";
  const normalized = raw
    .replace(/[／/\\|]+/g, " > ")
    .replace(/[＞>]+/g, " > ")
    .replace(/[，、;；]+/g, " > ")
    .replace(/\s*-\s*/g, " > ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = normalized
    .split(">")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 4);
  if (parts.length >= 2) return parts.join(" > ");
  const inferred = inferIndustry4Level(raw);
  return inferred || raw;
}

const INDUSTRY_CODE_NAME_MAP: Record<string, string> = {
  // 门类（常见）
  I: "信息传输、软件和信息技术服务业",
  C: "制造业",
  F: "批发和零售业",
  E: "建筑业",
  L: "租赁和商务服务业",
  // 大类/中类/小类（按当前高频场景补充，可持续扩展）
  "61": "商务服务业",
  "611": "组织管理服务",
  "6110": "企业总部管理",
  "65": "软件和信息技术服务业",
  "651": "软件开发",
  "6510": "软件开发",
}

function enrichIndustrySegment(segment: string, idx: number): string {
  const text = asString(segment).trim();
  if (!text) return "";
  if (isIndustrySegmentCodeAndName(text, idx)) return text;

  const alphaCode = text.match(/\b([A-Z])\b/)?.[1] || "";
  const numCode = text.match(/\b(\d{2,4})\b/)?.[1] || "";
  const pureCode = idx === 0 ? (alphaCode || text.replace(/\s+/g, "")) : (numCode || text.replace(/\s+/g, ""));
  const name = INDUSTRY_CODE_NAME_MAP[pureCode] || "";
  if (!name) return text;
  return `${pureCode} ${name}`;
}

function isIndustrySegmentCodeAndName(segment: string, idx: number): boolean {
  const text = asString(segment);
  if (!text) return false;
  const hasName = /[\u4e00-\u9fa5]/.test(text);
  if (idx === 0) {
    const hasCode = /\b[A-Z]\b/.test(text);
    return hasCode && hasName;
  }
  const hasCode = /\b\d{2,4}\b/.test(text);
  return hasCode && hasName;
}

function ensureIndustryCodeAndName(value: string): string {
  const normalized = normalizeIndustryTagText(value);
  const rawParts = normalized
    .split(">")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 4);
  if (rawParts.length < 2) return "";
  const parts = rawParts.map((x, idx) => enrichIndustrySegment(x, idx));
  for (let idx = 0; idx < parts.length; idx += 1) {
    if (!isIndustrySegmentCodeAndName(parts[idx], idx)) return "";
  }
  return parts.join(" > ");
}

function inferIndustry4Level(text: string): string {
  const t = asString(text).toLowerCase();
  if (!t) return "";
  if (/软件|信息技术|it|saas|云服务|系统集成|数字化/.test(t)) {
    return "I 信息传输、软件和信息技术服务业 > 65 软件和信息技术服务业 > 651 软件开发 > 6510 软件开发";
  }
  if (/制造|工厂|生产|装备|零部件/.test(t)) {
    return "C 制造业 > 35 专用设备制造业 > 359 环保、邮政、社会公共服务及其他专用设备制造 > 3599 其他专用设备制造";
  }
  if (/批发|零售|商贸|门店|经销/.test(t)) {
    return "F 批发和零售业 > 52 零售业 > 521 综合零售 > 5211 百货零售";
  }
  if (/建筑|地产|工程|施工/.test(t)) {
    return "E 建筑业 > 47 房屋建筑业 > 471 住宅房屋建筑 > 4710 住宅房屋建筑";
  }
  if (/医疗|医院|诊所|诊疗|卫生院/.test(t)) {
    return "Q 卫生和社会工作 > 84 卫生 > 841 医院 > 8411 综合医院";
  }
  if (/医药|制药|生物医药|药品/.test(t)) {
    return "C 制造业 > 27 医药制造业 > 271 化学药品原料药制造 > 2710 化学药品原料药制造";
  }
  if (/物流|运输|仓储|供应链|快递/.test(t)) {
    return "G 交通运输、仓储和邮政业 > 59 仓储和邮政业 > 592 通用仓储 > 5920 通用仓储";
  }
  if (/教育|学校|培训|高校|大学/.test(t)) {
    return "P 教育 > 83 教育 > 831 学前教育 > 8310 学前教育";
  }
  return "";
}

function normalizeRequirementImportData(input: Record<string, unknown>): RequirementImportData {
  const root = asModelObject(input.requirementImportData);
  const source = Object.keys(root).length ? root : input;

  const valuePropositionRows = asModelObjectArray(source.valuePropositionRows || source.valuePropositions || source["价值主张"])
    .map((row) => ({
      summary: pickModelField(row, ["summary", "提炼总结", "总结"]),
      refinedContent: pickModelField(row, ["refinedContent", "提炼内容"]),
      originalDemand: pickModelField(row, ["originalDemand", "原始需求"]),
      interviewOutline: pickModelField(row, ["interviewOutline", "访谈提纲"])
    }))
    .filter((row) => Object.values(row).some((x) => asString(x)));

  const businessNeedRows = asModelObjectArray(source.businessNeedRows || source.businessNeeds || source["业务需求"])
    .map((row) => ({
      businessDomain: pickModelField(row, ["businessDomain", "业务领域"]),
      category: pickModelField(row, ["category", "类型"]),
      businessNeed: pickModelField(row, ["businessNeed", "业务需求"]),
      proposer: pickModelField(row, ["proposer", "提出方"]),
      title: pickModelField(row, ["title", "需求标题"]),
      preSalesIncluded: pickModelField(row, ["preSalesIncluded", "售前是否包含"]),
      standardImplemented: pickModelField(row, ["standardImplemented", "标准产品是否实现"]),
      solutionSuggestion: pickModelField(row, ["solutionSuggestion", "方案建议"]),
      requiresCustomDev: pickModelField(row, ["requiresCustomDev", "是否需要二开"])
    }))
    .filter((row) => Object.values(row).some((x) => asString(x)));

  const devOverviewRows = asModelObjectArray(source.devOverviewRows || source.devOverviews || source["开发需求概要"])
    .map((row) => ({
      businessDomain: pickModelField(row, ["businessDomain", "业务领域"]),
      moduleName: pickModelField(row, ["moduleName", "模块名称"]),
      moduleBrief: pickModelField(row, ["moduleBrief", "模块简述"]),
      functionDesc: pickModelField(row, ["functionDesc", "功能描述"]),
      solutionSuggestion: pickModelField(row, ["solutionSuggestion", "方案建议"]),
      codingDays: pickNumberField(row, ["codingDays", "开发工作量", "编码人天"]),
      estimateBasis: pickModelField(row, ["estimateBasis", "估算依据"])
    }))
    .filter((row) => Object.values(row).some((x) => (typeof x === "number" ? x > 0 : asString(x))));

  const productModuleRows = asModelObjectArray(
    source.productModuleRows ||
      source.productModules ||
      source["产品及模块信息"] ||
      source["4.产品及模块信息"] ||
      source["产品模块"]
  )
    .map((row) => ({
      productDomain: normalizeProductDomainName(
        pickModelField(row, ["productDomain", "产品领域", "产品分组", "产品组", "云产品"])
      ),
      moduleName: pickModelField(row, ["moduleName", "模块名称", "应用", "模块", "SKU", "sku"]),
      subModule: pickModelField(row, ["subModule", "子模块"]),
      userCount: pickModelField(row, ["userCount", "用户数"]),
      implementationOrgCount: pickModelField(row, ["implementationOrgCount", "实施组织数量"]),
      pilotOrgCount: pickModelField(row, ["pilotOrgCount", "试点单位数量"]),
      partyBLead: pickModelField(row, ["partyBLead", "乙方负责人"]),
      partyALead: pickModelField(row, ["partyALead", "甲方负责人"])
    }))
    .filter((row) => Object.values(row).some((x) => asString(x)));

  const normalizedProductModuleRows = normalizeProductModuleRows(productModuleRows);

  const implementationScopeRows = asModelObjectArray(source.implementationScopeRows || source.implementationScopes || source["实施组织范围"])
    .map((row) => ({
      companyName: pickModelField(row, ["companyName", "公司名称"]),
      companyType: pickModelField(row, ["companyType", "公司类型"]),
      moduleScope: pickModelField(row, ["moduleScope", "模块范围"]),
      location: pickModelField(row, ["location", "地点"]),
      implementationMode: pickModelField(row, ["implementationMode", "实施方式"]),
      note: pickModelField(row, ["note", "备注"])
    }))
    .filter((row) => Object.values(row).some((x) => asString(x)));

  const keyPointRows = asModelObjectArray(source.keyPointRows || source.keyPoints || source["关键点"])
    .map((row) => ({
      analysisCategory: pickModelField(row, ["analysisCategory", "分析类别"]),
      subItem: pickModelField(row, ["subItem", "子项"]),
      detail: pickModelField(row, ["detail", "内容明细"]),
      note: pickModelField(row, ["note", "备注"])
    }))
    .filter((row) => Object.values(row).some((x) => asString(x)));

  return {
    valuePropositionRows,
    businessNeedRows,
    devOverviewRows,
    productModuleRows: normalizedProductModuleRows,
    implementationScopeRows,
    meetingNotes: pickModelField(source, ["meetingNotes", "会议纪要", "meetingSummary", "调研纪要"]),
    keyPointRows
  };
}

function mergeBasicInfo(primary: BasicProjectInfo, fallback: BasicProjectInfo): BasicProjectInfo {
  return {
    customerName: primary.customerName || fallback.customerName,
    location: primary.location || fallback.location,
    projectName: primary.projectName || fallback.projectName,
    opportunityNo: primary.opportunityNo || fallback.opportunityNo,
    productLines:
      (primary.productLines && primary.productLines.length ? primary.productLines : fallback.productLines) || [],
    customerIndustry: primary.customerIndustry || fallback.customerIndustry,
    enterpriseRevenue: primary.enterpriseRevenue || fallback.enterpriseRevenue,
    itStatus: primary.itStatus || fallback.itStatus,
    expectedGoLive: primary.expectedGoLive || fallback.expectedGoLive,
    enterpriseProfile: primary.enterpriseProfile || fallback.enterpriseProfile,
    projectBackgroundNeeds: primary.projectBackgroundNeeds || fallback.projectBackgroundNeeds,
    projectGoals: primary.projectGoals || fallback.projectGoals
  };
}

function buildCompanyProfileFallback(params: {
  customerName: string;
  location?: string;
  customerIndustry: string;
  enterpriseRevenue: string;
  itStatus: string;
}): { enterpriseProfile: string; location: string; customerIndustry: string; enterpriseRevenue: string; itStatus: string } {
  const location = asString(params.location) || "待补充地点";
  const customerIndustry = ensureIndustryCodeAndName(asString(params.customerIndustry)) || asString(params.customerIndustry) || "待补充行业";
  const enterpriseRevenue = asString(params.enterpriseRevenue) || "待补充规模";
  const itStatus = asString(params.itStatus) || "待补充信息化现状";
  const enterpriseProfile =
    `${params.customerName}位于${location}，是一家${customerIndustry}企业，当前企业规模/营收约为${enterpriseRevenue}。` +
    `从信息化现状看，${itStatus}。建议围绕“业务流程标准化、数据口径统一、关键场景数字化闭环”推进项目落地，` +
    `优先梳理主数据、核心业务流程与管理看板，形成可分阶段交付的实施路线。`;
  return { enterpriseProfile, location, customerIndustry, enterpriseRevenue, itStatus };
}

// -------------------- Kimi 友好文案与超时（仍由 handler 直接使用）--------------------
// 注：底层稳定性逻辑（重试/超时/温度兼容/错误码映射）已整体迁入 KimiProvider；
// 本节仅保留两个 handler 直接消费的工具函数。

function toFriendlyFallbackReason(reason: string): string {
  const key = asString(reason);
  if (!key) return "";
  if (key === "api_key_missing") return "未配置 Kimi API Key，已按规则兜底";
  if (key === "industry_not_code_name_format") {
    return "客户行业未按国标四级“编码+名称”格式返回，已自动使用规则回填";
  }
  if (key === "kimi_engine_overloaded") return "Kimi 服务繁忙（引擎拥塞），已自动降级为规则回填";
  if (key === "kimi_rate_limited") return "Kimi 请求触发限流（429），已自动降级为规则回填";
  if (key === "kimi_service_unavailable") return "Kimi 服务暂不可用（5xx），已自动降级为规则回填";
  if (key === "kimi_auth_failed") return "Kimi 鉴权失败，请检查 API Key 配置";
  if (key.includes("engine_overloaded_error")) return "Kimi 服务繁忙（引擎拥塞），已自动降级为规则回填";
  if (key.startsWith("kimi_request_failed:429")) return "Kimi 请求触发限流（429），已自动降级为规则回填";
  if (key === "kimi_request_timeout") return "等待 Kimi 响应超时，已自动降级为规则回填";
  return key;
}

function resolveKimiCompletionTimeoutMs(value: unknown): number {
  const n = Number(value);
  const base = Number.isFinite(n) && n > 0 ? n : 120_000;
  return Math.min(120_000, Math.max(3_000, Math.floor(base)));
}

async function parseRequirementImportByKimi(params: {
  apiUrl: string;
  apiKey: string;
  model: string;
  workbookText: string;
  timeoutMs: number;
}): Promise<{ basicInfo: BasicProjectInfo; requirementImportData: RequirementImportData; rawContent: string }> {
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
      {
        role: "system",
        content: "你是企业项目评估信息抽取助手。请只输出 JSON 对象，不要输出额外解释。若字段缺失，字符串填空字符串、数组填空数组、数字填0。"
      },
      {
        role: "user",
        content:
          `请从以下 Excel 文本中提取【需求】全量信息，并输出 JSON。\n` +
          `要求：basicInfo.location 优先提取客户实施地点/所在地区（如省市区），缺失时返回空字符串。\n` +
          `要求：basicInfo.customerIndustry 必须按《国民经济行业分类》（GB/T 4754）四级分类输出，且每一级都必须为“编码+名称”。` +
          `格式为："门类编码 门类名称 > 大类编码 大类名称 > 中类编码 中类名称 > 小类编码 小类名称"。` +
          `例如：I 信息传输、软件和信息技术服务业 > 65 软件和信息技术服务业 > 651 软件开发 > 6510 软件开发。\n` +
          `若原文无法确定精确行业：仍需给出“最可能的建议国标四级分类”，并写入 basicInfo.customerIndustrySuggestion 字段（格式同上）。` +
          `同时 basicInfo.customerIndustry 可为空字符串，不能输出非标准格式文本。\n` +
          `要求：requirementImportData.productModuleRows 为数组；必须根据工作表「4.产品及模块信息」等同名/含「产品及模块」的表格逐行抽取。` +
          `每行对象字段：productDomain=「产品分组」或「产品领域」（合并单元格向下沿用上一分组），moduleName=「应用」或「模块名称」，userCount=「用户数」（可为数字）；` +
          `忽略 REC、RILHK、RILNS 等组织勾选列。若无该表则 productModuleRows 为 []。\n` +
          `顶层 JSON 须包含 basicInfo 与 requirementImportData（含各块 rows 与 meetingNotes 等），键名使用英文驼峰。\n\n` +
          `${params.workbookText}`
      }
    ]
  });

  const content = completion.content;
  const parsed = parseJsonFromModelText(content);
  const basicInfoSource = asModelObject(parsed.basicInfo);
  
  const normalizedBasicInfo = normalizeBasicProjectInfo(Object.keys(basicInfoSource).length ? basicInfoSource : parsed);
  const suggestedIndustry =
    pickModelField(basicInfoSource, ["customerIndustrySuggestion", "建议国标分类", "行业建议"]) ||
    pickModelField(parsed, ["customerIndustrySuggestion", "建议国标分类", "行业建议"]);
  const strictIndustry =
    ensureIndustryCodeAndName(normalizedBasicInfo.customerIndustry) ||
    ensureIndustryCodeAndName(suggestedIndustry) ||
    ensureIndustryCodeAndName(
      inferIndustry4Level(
        [
          normalizedBasicInfo.customerName,
          normalizedBasicInfo.customerIndustry,
          suggestedIndustry,
          normalizedBasicInfo.enterpriseProfile,
          normalizedBasicInfo.projectBackgroundNeeds,
        ]
          .filter(Boolean)
          .join(" "),
      ),
    );
  if (!strictIndustry) {
    throw new Error("industry_not_code_name_format");
  }
  return {
    basicInfo: {
      ...normalizedBasicInfo,
      customerIndustry: strictIndustry
    },
    requirementImportData: normalizeRequirementImportData(parsed),
    rawContent: content
  };
}

/** 从 Kimi 返回体中读取字段（支持嵌套在 data / company 等对象内） */
function pickCompanyProfileField(parsed: Record<string, unknown>, keys: string[]): string {
  const direct = pickModelField(parsed, keys);
  if (direct) return direct;
  const nestKeys = ["data", "company", "basicInfo", "result", "payload", "output", "summary"] as const;
  for (const nk of nestKeys) {
    const sub = asModelObject(parsed[nk]);
    const v = pickModelField(sub, keys);
    if (v) return v;
  }
  return "";
}

function jsonTruth(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string" && /^(true|yes|1|需要|是)$/i.test(value.trim())) return true;
  return false;
}

function normalizeCompanyProfileDisambiguationCandidates(
  parsed: Record<string, unknown>
): Array<{ displayName: string; summary: string }> {
  const raw = parsed.candidates ?? parsed.options ?? parsed.choices ?? parsed.entities;
  const arr = asModelObjectArray(raw);
  const out: Array<{ displayName: string; summary: string }> = [];
  for (const item of arr) {
    const displayName = pickModelField(item, [
      "displayName",
      "name",
      "title",
      "companyName",
      "企业名称",
      "主体名称",
      "法定名称"
    ]);
    const summary = pickModelField(item, ["summary", "brief", "description", "detail", "区别说明", "区分", "线索"]);
    if (!displayName.trim()) continue;
    out.push({
      displayName: displayName.trim(),
      summary: (summary || "").trim() || "（暂无区分说明）"
    });
    if (out.length >= 3) break;
  }
  return out;
}

const PLACEHOLDER_REVENUE =
  "未公开：公开渠道未见可靠营收披露，请结合客户访谈、招投标或财报手工补充（模型未返回有效字段）。";
const PLACEHOLDER_IT =
  "信息有限：模型未返回可信信息化描述，请访谈确认是否已建设 ERP/CRM/主数据/集成平台及数据治理现状。";

type CompanyProfileKimiResult =
  | {
      kind: "profile";
      enterpriseProfile: string;
      location: string;
      customerIndustry: string;
      enterpriseRevenue: string;
      itStatus: string;
      rawContent: string;
    }
  | {
      kind: "disambiguation";
      candidates: Array<{ id: string; displayName: string; summary: string }>;
      rawContent: string;
    };

async function summarizeCompanyProfileByKimi(params: {
  apiUrl: string;
  apiKey: string;
  model: string;
  customerName: string;
  location?: string;
  customerIndustry?: string;
  enterpriseRevenue?: string;
  itStatus?: string;
  timeoutMs: number;
  disambiguationChoice?: { displayName: string; summary?: string };
}): Promise<CompanyProfileKimiResult> {
  const knownContextLines = [
    `客户名称：${params.customerName}`,
    params.location ? `已知地点：${params.location}` : "",
    params.customerIndustry ? `已知行业：${params.customerIndustry}` : "",
    params.enterpriseRevenue ? `已知规模/营收：${params.enterpriseRevenue}` : "",
    params.itStatus ? `已知信息化现状：${params.itStatus}` : ""
  ].filter(Boolean);

  const resolutionIntro = params.disambiguationChoice
    ? `【已选主体】用户已确认本次企业画像的唯一目标主体为「${params.disambiguationChoice.displayName}」。` +
      `区分线索：${(params.disambiguationChoice.summary || "").trim() || "无"}。\n` +
      `你必须以该主体为目标输出：needsDisambiguation=false、candidates=[]，并完整填充 enterpriseProfile 等五个字段。禁止再次输出待选列表或要求用户选择。\n\n`
    : "";

  const systemPrompt =
    "你是企业经营分析与信息摘要助手。请只输出 JSON 对象，不要输出任何解释文字。\n\n" +
    "【消歧】顶层必须包含 needsDisambiguation（布尔）与 candidates（数组，可为空）。\n" +
    "- 若公开信息足以唯一确定「客户名称」对应的企业主体：needsDisambiguation=false、candidates=[]，并正常填充 enterpriseProfile、location、customerIndustry、enterpriseRevenue、itStatus（均需非空字符串，口径见用户消息）。\n" +
    "- 若存在多个名称相近、易混淆且无法可靠唯一匹配的不同主体：needsDisambiguation=true，candidates 最多 3 项，每项含 displayName（完整常用名称）与 summary（不超过 80 字的关键区分信息）。此时五个画像字段必须均为空字符串 \"\"。禁止编造画像字段。\n\n" +
    "【画像字段口径】（仅当 needsDisambiguation=false 时）若公开信息不足，请基于行业公开口径与行业常识给出审慎估计，并在表述中标注“估计/区间/未公开”。enterpriseProfile 为 120-220 字中文简介，至少 2 处可量化信息。customerIndustry 按 GB/T 4754 四级「编码+名称」链。";

  const userPrompt =
    resolutionIntro +
    `请根据客户名称与已知信息，输出企业画像 JSON。\n\n` +
    `输出要求：\n` +
    `1) 仅输出 JSON，不要 Markdown，不要代码块。\n` +
    `2) 顶层字段顺序建议：needsDisambiguation、candidates、enterpriseProfile、location、customerIndustry、enterpriseRevenue、itStatus。\n` +
    `3) 当 needsDisambiguation=false 时：五个画像字段必须完整、非空（按下列口径）。\n` +
    `4) 强调“高度提炼与总结”，避免空泛口号，优先写经营情况、营收情况、财务情况。\n` +
    `5) enterpriseProfile 为 120-220 字中文简介，要求至少包含 2 处可量化信息（如营收区间、增长率、利润率、资产规模、员工规模、门店/产能等），若无公开精确值可给区间并标注估计。\n` +
    `6) location 返回客户主要经营/实施所在地（省市或城市），若无公开信息可给出最可信地点并标注“待核实”。\n` +
    `7) customerIndustry 必须按《国民经济行业分类》（GB/T 4754）四级分类返回，且每一级都必须为“编码+名称”，格式："门类编码 门类名称 > 大类编码 大类名称 > 中类编码 中类名称 > 小类编码 小类名称"。\n` +
    `8) enterpriseRevenue 必须包含数值或区间（例如“约50-80亿元”或“未公开，行业估计30-50亿元”），并尽量补充一条财务相关支撑信息（如毛利率区间/利润水平/资产规模/现金流特征）。\n` +
    `9) itStatus 描述信息化现状成熟度，并尽量给出具体系统或建设内容（如 ERP/CRM/MES/BI/主数据/集成平台等）；若信息可信度低请明确标注“信息有限”。\n` +
    `10) 数据支撑原则：优先公开数据；无公开数据时使用行业估计并显式说明“估计依据为行业均值/同规模企业区间”。\n\n` +
    `已知信息：\n${knownContextLines.join("\n")}\n\n` +
    `结构示例（唯一主体）：` +
    `{"needsDisambiguation":false,"candidates":[],"enterpriseProfile":"","location":"","customerIndustry":"","enterpriseRevenue":"","itStatus":""}\n` +
    `结构示例（需用户选择，画像字段必须为空字符串）：` +
    `{"needsDisambiguation":true,"candidates":[{"displayName":"","summary":""}],"enterpriseProfile":"","location":"","customerIndustry":"","enterpriseRevenue":"","itStatus":""}`;

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
  const parsed = parseJsonFromModelText(content);

  if (!params.disambiguationChoice) {
    const needs =
      jsonTruth(parsed.needsDisambiguation) ||
      jsonTruth(parsed.needDisambiguation) ||
      jsonTruth(parsed.disambiguation);
    const candidates = normalizeCompanyProfileDisambiguationCandidates(parsed);
    if (needs && candidates.length > 0) {
      return {
        kind: "disambiguation",
        candidates: candidates.map((c, idx) => ({
          id: String(idx + 1),
          displayName: c.displayName,
          summary: c.summary
        })),
        rawContent: content
      };
    }
  }

  let location =
    pickCompanyProfileField(parsed, ["location", "地点", "所在地区", "地区", "城市"]) || asString(params.location);
  const rawIndustry = pickCompanyProfileField(parsed, ["customerIndustry", "客户行业", "行业"]);
  let enterpriseProfile = asString(
    pickCompanyProfileField(parsed, ["enterpriseProfile", "企业简介"]) ||
      pickModelField(parsed, ["profile"]) ||
      pickModelField(parsed, ["企业简介"])
  );
  const inferBlob = [rawIndustry, params.customerIndustry, enterpriseProfile, params.customerName].filter(Boolean).join(" ");
  let customerIndustry =
    ensureIndustryCodeAndName(rawIndustry) ||
    ensureIndustryCodeAndName(asString(params.customerIndustry)) ||
    ensureIndustryCodeAndName(inferIndustry4Level(inferBlob));
  if (!customerIndustry) {
    customerIndustry = ensureIndustryCodeAndName(
      "L 租赁和商务服务业 > 72 商务服务业 > 729 其他商务服务业 > 7299 其他未列明商务服务业"
    );
  }
  let enterpriseRevenue =
    pickCompanyProfileField(parsed, ["enterpriseRevenue", "企业营收", "营收"]) || asString(params.enterpriseRevenue);
  let itStatus =
    pickCompanyProfileField(parsed, ["itStatus", "信息化现状", "数字化现状", "信息化"]) || asString(params.itStatus);

  if (!enterpriseRevenue.trim()) {
    enterpriseRevenue = PLACEHOLDER_REVENUE;
  }
  if (!itStatus.trim()) {
    itStatus = PLACEHOLDER_IT;
  }
  if (!location.trim()) {
    location = "待补充地点";
  }
  if (!enterpriseProfile.trim()) {
    enterpriseProfile =
      `${params.customerName}：公开可核资料有限，模型未返回企业简介正文。` +
      `建议结合工商登记信息、年报、招投标与客户访谈补充主营业务、规模区间、财务与信息化投入；` +
      `下方「客户行业」等字段已尽量根据名称与上下文推断或保留占位，插入后请务必人工核对。`;
  }

  if (!customerIndustry) {
    throw new Error("model_missing_required_fields");
  }

  const enterpriseProfileNormalized = enterpriseProfile.replace(
    /\b[A-Z]\s*>\s*\d{2}\s*>\s*\d{3}\s*>\s*\d{4}\b/g,
    customerIndustry,
  );
  return {
    kind: "profile",
    enterpriseProfile: enterpriseProfileNormalized,
    location,
    customerIndustry,
    enterpriseRevenue,
    itStatus,
    rawContent: content
  };
}

async function chatWithKimi(params: {
  apiUrl: string;
  apiKey: string;
  model: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<{ answer: string; rawContent: string }> {
  const safeMessages = params.messages
    .map((item) => ({
      role: item.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: asString(item.content),
    }))
    .filter((item) => item.content);

  const provider = getKimiProvider();
  const completion = await provider.chatCompletion({
    model: params.model,
    temperature: 0.3,
    credentialsOverride: {
      apiKey: params.apiKey,
      apiBaseUrl: params.apiUrl,
    },
    messages: [
      {
        role: "system",
        content: "你是工作量评估系统内置助手（KIMI）。请用中文简洁回答，优先结合用户上下文，避免冗余。",
      },
      ...safeMessages,
    ],
  });

  return { answer: completion.content, rawContent: completion.rawContent };
}
// -------------------- 工作簿解析（规则回退） --------------------

function findSheetByKeyword(workbook: XLSX.WorkBook, keyword: string): string {
  const exact = workbook.SheetNames.find((name) => asString(name) === keyword);
  if (exact) return exact;
  return workbook.SheetNames.find((name) => asString(name).includes(keyword)) || "";
}

function parseBasicInfoFromWorkbook(workbook: XLSX.WorkBook): BasicProjectInfo {
  const rows = getSheetRows(workbook, findSheetByKeyword(workbook, "项目概况"));
  const result: BasicProjectInfo = {
    customerName: "", location: "", projectName: "", opportunityNo: "", customerIndustry: "",
    productLines: [],
    enterpriseRevenue: "", itStatus: "", expectedGoLive: "", enterpriseProfile: "",
    projectBackgroundNeeds: "", projectGoals: ""
  };
  const fieldMap: Array<{ keys: string[]; target: Exclude<keyof BasicProjectInfo, "productLines"> }> = [
    { keys: ["客户名称"], target: "customerName" },
    { keys: ["地点", "所在地区", "区域", "城市"], target: "location" },
    { keys: ["项目名称"], target: "projectName" },
    { keys: ["商机号"], target: "opportunityNo" },
    { keys: ["客户行业", "行业"], target: "customerIndustry" },
    { keys: ["企业营收", "营收"], target: "enterpriseRevenue" },
    { keys: ["信息化现状"], target: "itStatus" },
    { keys: ["预期上线时间"], target: "expectedGoLive" },
    { keys: ["企业简介"], target: "enterpriseProfile" },
    { keys: ["项目背景和需求", "项目背景需求"], target: "projectBackgroundNeeds" },
    { keys: ["项目目标"], target: "projectGoals" }
  ];
  for (const row of rows) {
    const key = normalizeCellText(row[0]);
    if (!key) continue;
    const value = asString(row[1] ?? "");
    if (!value) continue;
    const matched = fieldMap.find((x) => x.keys.some((k) => key.includes(normalizeCellText(k))));
    if (!matched) continue;
    result[matched.target] = value;
  }
  return result;
}

function scoreHumanReadableChinese(text: string): number {
  const value = asString(text);
  if (!value) return -1;
  const chineseCount = (value.match(/[\u4e00-\u9fa5]/g) || []).length;
  const mojibakeCount = (value.match(/[ÃÂÐÕÊÖ×ÓÆðÖÞÑÍË]{1}/g) || []).length;
  return chineseCount * 2 - mojibakeCount;
}

function normalizeUploadedFileName(fileName: string): string {
  const raw = asString(fileName).trim();
  if (!raw) return "";
  const latin1Decoded = Buffer.from(raw, "latin1").toString("utf8").trim();
  const candidates = [raw, latin1Decoded].filter(Boolean);
  if (!candidates.length) return "";
  return candidates.sort((a, b) => scoreHumanReadableChinese(b) - scoreHumanReadableChinese(a))[0] || raw;
}

function inferCustomerNameFromFileName(fileName: string): string {
  const raw = normalizeUploadedFileName(fileName);
  if (!raw) return "";
  const withoutExt = raw.replace(/\.[^.]+$/, "");
  const normalized = withoutExt
    .replace(/[（(][^)）]*[)）]/g, " ")
    .replace(/[_\-—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";

  const blocked = [
    "工作量评估申请表",
    "评估申请表",
    "评估",
    "实施",
    "需求",
    "导入",
    "模板",
    "附件",
    "excel",
    "xlsx",
    "xls",
    "副本",
    "最终版",
    "终版"
  ];

  const dateLike = /^(?:19|20)\d{2}(?:[./-]?\d{1,2}){0,2}$/;
  const numericLike = /^\d{4,}$/;
  const candidates = normalized
    .split(/[ \t]+/)
    .map((x) => asString(x))
    .filter(Boolean)
    .filter((x) => !dateLike.test(x))
    .filter((x) => !numericLike.test(x))
    .filter((x) => !blocked.some((k) => x.includes(k)));

  if (!candidates.length) return "";
  const withChinese = candidates.filter((x) => /[\u4e00-\u9fa5]/.test(x));
  const picked = (withChinese.length ? withChinese : candidates)
    .sort((a, b) => b.length - a.length)[0] || "";
  return picked.trim();
}

// -------------------- 路由处理函数 --------------------

export async function parseBasicInfo(req: Request, res: Response) {
  const requestId = randomUUID();
  if (!req.file) {
    return fail(res, 40001, "参数错误", [{ field: "file", reason: "required" }]);
  }
  
  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const workbookText = buildWorkbookPreviewText(workbook);
    const workbookBasicInfo = parseBasicInfoFromWorkbook(workbook);
    const fileNameCustomerName = inferCustomerNameFromFileName(req.file.originalname || "");
    const workbookBasicInfoWithFileName: BasicProjectInfo = {
      ...workbookBasicInfo,
      customerName: workbookBasicInfo.customerName || fileNameCustomerName
    };
    const workbookRequirementData = parseRequirementImportFromWorkbook(workbook);
    const { apiKey } = resolveActiveRequirementKimiApiKey();
    const requirementSettings = loadRequirementSystemConfigStore().active;
    const parseModelRaw =
      requirementSettings.fileParsing.model?.trim() ||
      requirementSettings.kimiEvaluation.model?.trim() ||
      config.kimi.model;
    const model = parseModelRaw;
    const modelForClient = normalizeKimiModelName(model);

    if (!apiKey) {
      const inferredLines = inferProductLinesFromProductModules(workbookRequirementData.productModuleRows);
      return res.json(
        ok(
          {
            basicInfo: {
              ...workbookBasicInfoWithFileName,
              productLines:
                (workbookBasicInfoWithFileName.productLines && workbookBasicInfoWithFileName.productLines.length
                  ? workbookBasicInfoWithFileName.productLines
                  : inferredLines),
            },
            requirementImportData: workbookRequirementData,
            sourceSheets: workbook.SheetNames,
            model: "rule-fallback",
            mode: "rule_fallback",
            fallbackReason: toFriendlyFallbackReason("api_key_missing"),
            rawContent: ""
          },
          requestId
        )
      );
    }

    try {
      const parsed = await parseRequirementImportByKimi({
        apiUrl: config.kimi.apiBaseUrl,
        apiKey,
        model,
        workbookText,
        timeoutMs: resolveKimiCompletionTimeoutMs(requirementSettings.kimiEvaluation.timeoutMs),
      });

      const mergedBasic = mergeBasicInfo(parsed.basicInfo, workbookBasicInfoWithFileName);
      const mergedRequirement = mergeRequirementImportData(parsed.requirementImportData, workbookRequirementData);
      const inferredLines = inferProductLinesFromProductModules(mergedRequirement.productModuleRows);
      return res.json(
        ok(
          {
            basicInfo: {
              ...mergedBasic,
              productLines:
                (mergedBasic.productLines && mergedBasic.productLines.length
                  ? mergedBasic.productLines
                  : inferredLines),
            },
            requirementImportData: mergedRequirement,
            sourceSheets: workbook.SheetNames,
            model: modelForClient,
            mode: "model",
            fallbackReason: "",
            rawContent: parsed.rawContent
          },
          requestId
        )
      );
    } catch (modelErr) {
      const fallbackReasonRaw = modelErr instanceof Error ? modelErr.message : "model_parse_failed";
      const fallbackReason = toFriendlyFallbackReason(fallbackReasonRaw);
      const inferredLines = inferProductLinesFromProductModules(workbookRequirementData.productModuleRows);
      return res.json(
        ok(
          {
            basicInfo: {
              ...workbookBasicInfoWithFileName,
              productLines:
                (workbookBasicInfoWithFileName.productLines && workbookBasicInfoWithFileName.productLines.length
                  ? workbookBasicInfoWithFileName.productLines
                  : inferredLines),
            },
            requirementImportData: workbookRequirementData,
            sourceSheets: workbook.SheetNames,
            model: "rule-fallback",
            mode: "rule_fallback",
            fallbackReason,
            rawContent: ""
          },
          requestId
        )
      );
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : "parse_failed";
    return fail(res, 40001, "参数错误", [{ field: "file/api", reason }]);
  }
}

export async function companyProfileSummary(req: Request, res: Response) {
  const requestId = randomUUID();
  const body = (req.body || {}) as {
    customerName?: string;
    location?: string;
    customerIndustry?: string;
    enterpriseRevenue?: string;
    itStatus?: string;
    disambiguationChoice?: { displayName?: string; summary?: string };
  };

  const customerName = asString(body.customerName);
  if (!customerName) {
    return fail(res, 40001, "参数错误", [{ field: "customerName", reason: "required" }]);
  }

  const choiceObj = asModelObject(body.disambiguationChoice);
  const disambiguationChoice =
    choiceObj && Object.keys(choiceObj).length > 0
      ? {
          displayName: asString(choiceObj.displayName).trim(),
          summary: asString(choiceObj.summary).trim()
        }
      : undefined;
  if (disambiguationChoice && !disambiguationChoice.displayName) {
    return fail(res, 40001, "参数错误", [{ field: "disambiguationChoice.displayName", reason: "required" }]);
  }

  const location = asString(body.location);
  const customerIndustry = asString(body.customerIndustry);
  const enterpriseRevenue = asString(body.enterpriseRevenue);
  const itStatus = asString(body.itStatus);
  const { apiKey } = resolveActiveRequirementKimiApiKey();

  if (!apiKey) {
    const fallback = buildCompanyProfileFallback({ customerName, location, customerIndustry, enterpriseRevenue, itStatus });
    return res.json(
      ok(
        {
          customerName,
          ...fallback,
          model: "rule-fallback",
          mode: "rule_fallback",
          fallbackReason: toFriendlyFallbackReason("api_key_missing"),
          rawContent: ""
        },
        requestId
      )
    );
  }

  try {
    const requirementSettings = loadRequirementSystemConfigStore().active;
    const model = config.kimi.model;
    const modelForClient = normalizeKimiModelName(model);
    const parsed = await summarizeCompanyProfileByKimi({
      apiUrl: config.kimi.apiBaseUrl,
      apiKey,
      model,
      customerName,
      location,
      customerIndustry,
      enterpriseRevenue,
      itStatus,
      timeoutMs: resolveKimiCompletionTimeoutMs(requirementSettings.kimiEvaluation.timeoutMs),
      disambiguationChoice: disambiguationChoice
        ? { displayName: disambiguationChoice.displayName, summary: disambiguationChoice.summary }
        : undefined
    });

    if (parsed.kind === "disambiguation") {
      return res.json(
        ok(
          {
            customerName,
            enterpriseProfile: "",
            location: "",
            customerIndustry: "",
            enterpriseRevenue: "",
            itStatus: "",
            model: modelForClient,
            mode: "disambiguation",
            fallbackReason: "",
            rawContent: parsed.rawContent,
            disambiguationCandidates: parsed.candidates
          },
          requestId
        )
      );
    }

    return res.json(
      ok(
        {
          customerName,
          enterpriseProfile: parsed.enterpriseProfile,
          location: parsed.location,
          customerIndustry: parsed.customerIndustry,
          enterpriseRevenue: parsed.enterpriseRevenue,
          itStatus: parsed.itStatus,
          model: modelForClient,
          mode: "model",
          fallbackReason: "",
          rawContent: parsed.rawContent
        },
        requestId
      )
    );
  } catch (err) {
    const fallbackReasonRaw = err instanceof Error ? err.message : "summary_failed";
    const fallbackReason = toFriendlyFallbackReason(fallbackReasonRaw);
    const fallback = buildCompanyProfileFallback({ customerName, location, customerIndustry, enterpriseRevenue, itStatus });
    return res.json(
      ok(
        {
          customerName,
          ...fallback,
          model: "rule-fallback",
          mode: "rule_fallback",
          fallbackReason,
          rawContent: ""
        },
        requestId
      )
    );
  }
}

export async function kimiAssessmentPreview(req: Request, res: Response) {
  const requestId = randomUUID();
  const body = (req.body || {}) as KimiAssessmentPreviewInput;
  const snapshot = asModelObject(body.requirementSnapshot) as KimiAssessmentSnapshot;
  const source = asModelObject(body.source);
  const globalVersionCode = asString(source.globalVersionCode);
  const requirementVersionCode = asString(source.requirementVersionCode);

  if (!snapshot || Object.keys(snapshot).length === 0) {
    return fail(res, 40001, "参数错误", [{ field: "requirementSnapshot", reason: "required" }]);
  }

  const fallbackDraft = estimateFallbackAssessmentDraft(snapshot);
  const fallbackCloudSku = buildCloudSkuModuleItemsFromSnapshot(snapshot, fallbackDraft);
  const fallbackDraftAligned: KimiAssessmentDraft = {
    ...fallbackDraft,
    moduleItems: mergeDevTotalModuleItem(fallbackCloudSku.items, snapshot)
  };
  const { apiKey } = resolveActiveRequirementKimiApiKey();
  const model = config.kimi.model;
  const modelForClient = normalizeKimiModelName(model);
  const requirementSettings = loadRequirementSystemConfigStore().active;
  const promptProfile =
    asString(asModelObject(body.ruleContext).promptProfile) ||
    asString(requirementSettings.kimiEvaluation.promptProfile) ||
    "assessment_default_v1";
  const promptTemplate =
    asString(requirementSettings.kimiEvaluation.promptTemplate) ||
    "你是资深项目经理 + 资深实施顾问。你不是做简单 SKU 对照，而是要基于需求全量信息做综合实施评估。必须只返回 JSON。字段固定：assessmentDraft.quoteMode/productLines/userCount/orgCount/orgSimilarity/difficultyFactor/moduleItems/risks/assumptions。moduleItems 每项字段：cloudProduct/skuName/moduleName/standardDays/suggestedDays/reason。所有数值字段必须为非负数，orgSimilarity 和 difficultyFactor 范围 0-1。评估时必须综合：basicInfo（行业、规模、上线目标）、businessNeedRows（业务复杂度）、devOverviewRows（开发基线）、implementationScopeRows（组织范围与地域）、meetingNotes（隐性约束）、keyPointRows（重点风险）。reason 必须体现增加/减少人天的业务原因与实施原因，不能仅写“按模板匹配”。禁止把产品名/版本名/平台名（如金蝶AI星空、旗舰版）直接当成 SKU，必须下钻到可实施功能项。财务云、供应链云等是实施域级云产品，不得填入 skuName 并挂在金蝶AI星空下冒充 SKU；域级人天归 cloudProduct=该域名，skuName 仅写子模块。若信息不足，给出审慎估算并在 risks/assumptions 明确不确定性来源。严禁仅凭业务需求正文中出现与 SKU 同名的词、或「总账、报表、出纳」类标准功能并列枚举，就认定 suggestedDays 必须高于 standardDays；须结合该条需求完整语义与实施顾问角色做专业判断，只有存在相对标准产品交付的明确增量（如二开、深度集成、多组织推广、性能/迁移、额外培训与方案等）时才上调，并在 reason 中写清增量内容而非复述关键词。";
  const startedAt = Date.now();

  if (!apiKey) {
    return res.json(
      ok(
        {
          meta: {
            model: "rule-fallback",
            generatedAt: new Date().toISOString(),
            confidence: 0.62,
            promptVersion: promptProfile,
            ruleSetId: "fallback-rules-v1",
            mode: "rule_fallback",
            fallbackReason: toFriendlyFallbackReason("api_key_missing"),
            elapsedMs: Date.now() - startedAt,
            coarseFilteredCount: fallbackCloudSku.coarseFilteredCount
          },
          source: { globalVersionCode, requirementVersionCode },
          assessmentDraft: fallbackDraftAligned
        },
        requestId
      )
    );
  }

  try {
    const result = await generateAssessmentDraftByKimi({
      apiUrl: config.kimi.apiBaseUrl,
      apiKey,
      model,
      promptTemplate,
      payload: body,
      fallback: fallbackDraftAligned,
      timeoutMs: resolveKimiCompletionTimeoutMs(requirementSettings.kimiEvaluation.timeoutMs),
    });
    const alignedCloudSku = buildCloudSkuModuleItemsFromSnapshot(snapshot, result.draft);
    const alignedDraft: KimiAssessmentDraft = {
      ...result.draft,
      moduleItems: mergeDevTotalModuleItem(alignedCloudSku.items, snapshot)
    };

    return res.json(
      ok(
        {
          meta: {
            model: modelForClient,
            generatedAt: new Date().toISOString(),
            confidence: 0.78,
            promptVersion: promptProfile,
            ruleSetId: "assessment-rules-v1",
            mode: "model",
            fallbackReason: "",
            elapsedMs: Date.now() - startedAt,
            rawContent: result.rawContent,
            coarseFilteredCount: alignedCloudSku.coarseFilteredCount
          },
          source: { globalVersionCode, requirementVersionCode },
          assessmentDraft: alignedDraft
        },
        requestId
      )
    );
  } catch (err) {
    const fallbackReasonRaw = err instanceof Error ? err.message : "model_generate_failed";
    const fallbackReason = toFriendlyFallbackReason(fallbackReasonRaw);
    return res.json(
      ok(
        {
          meta: {
            model: "rule-fallback",
            generatedAt: new Date().toISOString(),
            confidence: 0.62,
            promptVersion: promptProfile,
            ruleSetId: "fallback-rules-v1",
            mode: "rule_fallback",
            fallbackReason,
            elapsedMs: Date.now() - startedAt,
            coarseFilteredCount: fallbackCloudSku.coarseFilteredCount
          },
          source: { globalVersionCode, requirementVersionCode },
          assessmentDraft: fallbackDraftAligned
        },
        requestId
      )
    );
  }
}

/** 将 `POST /api/v1/ai/kimi-assessment/preview` 返回的 `assessmentDraft`（及可选 `meta`）导出为 Markdown，便于 Kimiclaw 等 Agent 转 PDF 或作为附件发送。 */
export async function exportKimiAssessmentMarkdown(req: Request, res: Response) {
  const body = (req.body || {}) as {
    assessmentDraft?: Record<string, unknown>;
    meta?: Record<string, unknown>;
    projectName?: string;
  };
  const draft =
    body.assessmentDraft && typeof body.assessmentDraft === "object" ? (body.assessmentDraft as Record<string, unknown>) : {};
  if (!Object.keys(draft).length) {
    return fail(res, 40001, "参数错误", [{ field: "assessmentDraft", reason: "required" }]);
  }

  const meta =
    body.meta && typeof body.meta === "object" ? (body.meta as Record<string, unknown>) : {};
  const md = buildKimiAssessmentDraftMarkdown({
    projectName: asString(body.projectName),
    assessmentDraft: draft,
    meta,
  });

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filenameAscii = `kimi-assessment-draft-${date}.md`;
  const filenameUtf = `Kimi评估草稿-${date}.md`;
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filenameAscii}"; filename*=UTF-8''${encodeURIComponent(filenameUtf)}`,
  );
  res.status(200).send(md);
}

export async function chat(req: Request, res: Response) {
  const requestId = randomUUID();
  const body = (req.body || {}) as {
    messages?: Array<{ role?: string; content?: string }>;
  };
  
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const messages = rawMessages
    .map((item) => ({
      role: asString(item?.role) === "assistant" ? "assistant" : "user",
      content: asString(item?.content)
    }))
    .filter((item) => item.content) as Array<{ role: "user" | "assistant"; content: string }>;
    
  if (messages.length === 0) {
    return fail(res, 40001, "参数错误", [{ field: "messages", reason: "required" }]);
  }
  
  const apiKey = config.kimi.apiKey;
  if (!apiKey) {
    return fail(res, 40001, "参数错误", [{ field: "apiKey", reason: "required_or_env_missing" }]);
  }
  
  try {
    const model = config.kimi.model;
    const modelForClient = normalizeKimiModelName(model);
    const result = await chatWithKimi({
      apiUrl: config.kimi.apiBaseUrl,
      apiKey,
      model,
      messages: messages.slice(-12)
    });
    
    res.json(ok({ answer: result.answer, model: modelForClient }, requestId));
  } catch (err) {
    const reason = err instanceof Error ? err.message : "chat_failed";
    return fail(res, 40001, "参数错误", [{ field: "messages/api", reason }]);
  }
}
