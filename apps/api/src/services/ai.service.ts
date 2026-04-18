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
import { requireRole } from "../middleware/auth";
import { loadRequirementSystemConfigStore } from "../modules/system/system.repository";
import { buildKimiAssessmentDraftMarkdown } from "../utils/kimi-assessment-markdown";

// -------------------- 解析辅助函数 --------------------

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

function pickModelField(input: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && asString(value)) return asString(value);
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

function normalizeProductDomainName(value: string): string {
  const text = asString(value);
  if (!text) return "";
  if (/星空旗舰版/.test(text)) {
    return text.replace(/星空旗舰版/g, "金蝶AI星空");
  }
  return text;
}

function mapProductDomainToProductLine(value: string): string {
  const text = normalizeProductDomainName(value);
  if (!text) return "";
  if (/金蝶AI星空|星空/.test(text)) return "金蝶AI星空";
  if (/金蝶AI星瀚|星瀚/.test(text)) return "金蝶AI星瀚";
  if (/云之家/.test(text)) return "云之家";
  if (/发票云/.test(text)) return "发票云";
  return "";
}

function inferProductLinesFromProductModules(
  rows: RequirementImportData["productModuleRows"]
): string[] {
  const picked = new Set<string>();
  for (const row of rows) {
    const line = mapProductDomainToProductLine(asString(row.productDomain));
    if (line) picked.add(line);
  }
  return Array.from(picked);
}

function normalizeProductModuleRows(
  rows: RequirementImportData["productModuleRows"]
): RequirementImportData["productModuleRows"] {
  const result: RequirementImportData["productModuleRows"] = [];
  let lastProductDomain = "";
  let lastModuleName = "";
  let lastSubModule = "";
  let lastImplementationOrgCount = "";
  let lastPilotOrgCount = "";
  let lastPartyBLead = "";
  let lastPartyALead = "";
  const userCountByModule = new Map<string, string>();
  let sharedBusinessUserCount = "";

  for (const row of rows) {
    const productDomain = normalizeProductDomainName(asString(row.productDomain) || lastProductDomain);
    const moduleName = asString(row.moduleName) || lastModuleName;
    const subModule = asString(row.subModule) || lastSubModule;

    let userCount = asString(row.userCount);
    if (userCount) {
      userCountByModule.set(moduleName, userCount);
      if (/财务云|供应链云/.test(moduleName)) {
        sharedBusinessUserCount = userCount;
      }
    } else if (moduleName && userCountByModule.has(moduleName)) {
      userCount = userCountByModule.get(moduleName) || "";
    } else if (/财务云|供应链云/.test(moduleName) && sharedBusinessUserCount) {
      // 财务云与供应链云共用业务用户规模（如示例中的 10）。
      userCount = sharedBusinessUserCount;
    } else if (/流程服务云/.test(moduleName)) {
      // 工作流属于独立用户规模，不复用业务模块用户数。
      userCount = "";
    }

    const implementationOrgCount = asString(row.implementationOrgCount) || lastImplementationOrgCount;
    const pilotOrgCount = asString(row.pilotOrgCount) || lastPilotOrgCount;
    const partyBLead = asString(row.partyBLead) || lastPartyBLead;
    const partyALead = asString(row.partyALead) || lastPartyALead;

    result.push({
      productDomain,
      moduleName,
      subModule,
      userCount,
      implementationOrgCount,
      pilotOrgCount,
      partyBLead,
      partyALead
    });

    lastProductDomain = productDomain || lastProductDomain;
    lastModuleName = moduleName || lastModuleName;
    lastSubModule = subModule || lastSubModule;
    lastImplementationOrgCount = implementationOrgCount || lastImplementationOrgCount;
    lastPilotOrgCount = pilotOrgCount || lastPilotOrgCount;
    lastPartyBLead = partyBLead || lastPartyBLead;
    lastPartyALead = partyALead || lastPartyALead;
  }

  return result;
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

  const productModuleRows = asModelObjectArray(source.productModuleRows || source.productModules || source["产品及模块信息"])
    .map((row) => ({
      productDomain: normalizeProductDomainName(pickModelField(row, ["productDomain", "产品领域"])),
      moduleName: pickModelField(row, ["moduleName", "模块名称"]),
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

function buildWorkbookPreviewText(workbook: XLSX.WorkBook): string {
  const maxSheets = 8;
  const maxRowsPerSheet = 120;
  const maxCols = 12;
  const chunks: string[] = [];
  for (const sheetName of workbook.SheetNames.slice(0, maxSheets)) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, defval: "", raw: false });
    const lines = rows.slice(0, maxRowsPerSheet).map((row, idx) => {
      const cells = row.slice(0, maxCols).map((cell) => asString(cell)).filter(Boolean);
      return `${idx + 1}. ${cells.join(" | ")}`;
    });
    chunks.push(`【工作表】${sheetName}\n${lines.join("\n")}`);
  }
  const preview = chunks.join("\n\n");
  return preview.length > 45000 ? preview.slice(0, 45000) : preview;
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

function mergeRequirementImportData(primary: RequirementImportData, fallback: RequirementImportData): RequirementImportData {
  return {
    valuePropositionRows: primary.valuePropositionRows.length ? primary.valuePropositionRows : fallback.valuePropositionRows,
    businessNeedRows: primary.businessNeedRows.length ? primary.businessNeedRows : fallback.businessNeedRows,
    devOverviewRows: primary.devOverviewRows.length ? primary.devOverviewRows : fallback.devOverviewRows,
    productModuleRows: primary.productModuleRows.length ? primary.productModuleRows : fallback.productModuleRows,
    implementationScopeRows: primary.implementationScopeRows.length ? primary.implementationScopeRows : fallback.implementationScopeRows,
    meetingNotes: primary.meetingNotes || fallback.meetingNotes,
    keyPointRows: primary.keyPointRows.length ? primary.keyPointRows : fallback.keyPointRows
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

// -------------------- Kimi API 调用 --------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildKimiRequestError(status: number, errorText: string): string {
  const raw = asString(errorText);
  if (/engine_overloaded_error|overloaded|try again later/i.test(raw)) {
    return "kimi_engine_overloaded";
  }
  if (status === 429) return "kimi_rate_limited";
  if (status === 503 || status === 502) return "kimi_service_unavailable";
  if (status === 401 || status === 403) return "kimi_auth_failed";
  return `kimi_request_failed:${status}:${raw.slice(0, 240)}`;
}

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
  return key;
}

async function requestKimiCompletion(params: {
  endpoint: string;
  apiKey: string;
  body: Record<string, unknown>;
}): Promise<globalThis.Response> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(params.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`
      },
      body: JSON.stringify(params.body)
    });
    if (response.ok) return response;

    const errorText = await response.text();
    const reason = buildKimiRequestError(response.status, errorText);
    const retryable =
      reason === "kimi_engine_overloaded" ||
      reason === "kimi_rate_limited" ||
      reason === "kimi_service_unavailable";
    if (retryable && attempt < maxAttempts) {
      await sleep(350 * 2 ** (attempt - 1));
      continue;
    }
    throw new Error(reason);
  }
  throw new Error("kimi_request_failed:unknown");
}

async function parseRequirementImportByKimi(params: {
  apiUrl: string;
  apiKey: string;
  model: string;
  workbookText: string;
}): Promise<{ basicInfo: BasicProjectInfo; requirementImportData: RequirementImportData; rawContent: string }> {
  const baseUrl = asString(params.apiUrl).replace(/\/+$/, "") || "https://api.moonshot.cn/v1";
  const endpoint = `${baseUrl}/chat/completions`;
  const body = {
    model: asString(params.model) || "kimi-k2.5",
    temperature: 0.1,
    response_format: { type: "json_object" },
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
          `同时 basicInfo.customerIndustry 可为空字符串，不能输出非标准格式文本。\n\n` +
          `${params.workbookText}`
      }
    ]
  };
  
  const response = await requestKimiCompletion({
    endpoint,
    apiKey: params.apiKey,
    body
  });
  
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = asString(json?.choices?.[0]?.message?.content);
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

const PLACEHOLDER_REVENUE =
  "未公开：公开渠道未见可靠营收披露，请结合客户访谈、招投标或财报手工补充（模型未返回有效字段）。";
const PLACEHOLDER_IT =
  "信息有限：模型未返回可信信息化描述，请访谈确认是否已建设 ERP/CRM/主数据/集成平台及数据治理现状。";

async function summarizeCompanyProfileByKimi(params: {
  apiUrl: string;
  apiKey: string;
  model: string;
  customerName: string;
  location?: string;
  customerIndustry?: string;
  enterpriseRevenue?: string;
  itStatus?: string;
}): Promise<{
  enterpriseProfile: string;
  location: string;
  customerIndustry: string;
  enterpriseRevenue: string;
  itStatus: string;
  rawContent: string;
}> {
  const baseUrl = asString(params.apiUrl).replace(/\/+$/, "") || "https://api.moonshot.cn/v1";
  const endpoint = `${baseUrl}/chat/completions`;
  const knownContextLines = [
    `客户名称：${params.customerName}`,
    params.location ? `已知地点：${params.location}` : "",
    params.customerIndustry ? `已知行业：${params.customerIndustry}` : "",
    params.enterpriseRevenue ? `已知规模/营收：${params.enterpriseRevenue}` : "",
    params.itStatus ? `已知信息化现状：${params.itStatus}` : ""
  ].filter(Boolean);
  
  const body = {
    model: asString(params.model) || "kimi-k2.5",
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "你是企业经营分析与信息摘要助手。请只输出 JSON 对象，不要输出任何解释文字。必须返回且仅返回以下五个字段：enterpriseProfile、location、customerIndustry、enterpriseRevenue、itStatus。五个字段都必须是非空字符串。若公开信息不足，请基于行业公开口径与行业常识给出审慎估计，并在表述中标注“估计/区间/未公开”。"
      },
      {
        role: "user",
        content:
          `请根据客户名称与已知信息，输出该客户的企业画像并严格按指定 JSON 字段返回。\n\n` +
          `输出要求：\n` +
          `1) 仅输出 JSON，不要 Markdown，不要代码块。\n` +
          `2) 字段必须完整：enterpriseProfile、location、customerIndustry、enterpriseRevenue、itStatus。\n` +
          `3) 强调“高度提炼与总结”，避免空泛口号，优先写经营情况、营收情况、财务情况。\n` +
          `4) enterpriseProfile 为 120-220 字中文简介，要求至少包含 2 处可量化信息（如营收区间、增长率、利润率、资产规模、员工规模、门店/产能等），若无公开精确值可给区间并标注估计。\n` +
          `5) location 返回客户主要经营/实施所在地（省市或城市），若无公开信息可给出最可信地点并标注“待核实”。\n` +
          `6) customerIndustry 必须按《国民经济行业分类》（GB/T 4754）四级分类返回，且每一级都必须为“编码+名称”，格式："门类编码 门类名称 > 大类编码 大类名称 > 中类编码 中类名称 > 小类编码 小类名称"。\n` +
          `7) enterpriseRevenue 必须包含数值或区间（例如“约50-80亿元”或“未公开，行业估计30-50亿元”），并尽量补充一条财务相关支撑信息（如毛利率区间/利润水平/资产规模/现金流特征）。\n` +
          `8) itStatus 描述信息化现状成熟度，并尽量给出具体系统或建设内容（如 ERP/CRM/MES/BI/主数据/集成平台等）；若信息可信度低请明确标注“信息有限”。\n` +
          `9) 数据支撑原则：优先公开数据；无公开数据时使用行业估计并显式说明“估计依据为行业均值/同规模企业区间”。\n\n` +
          `已知信息：\n${knownContextLines.join("\n")}\n\n` +
          `请按如下结构返回：\n` +
          `{"enterpriseProfile":"","location":"","customerIndustry":"","enterpriseRevenue":"","itStatus":""}`
      }
    ]
  };
  
  const response = await requestKimiCompletion({
    endpoint,
    apiKey: params.apiKey,
    body
  });
  
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = asString(json?.choices?.[0]?.message?.content);
  const parsed = parseJsonFromModelText(content);
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
  return { enterpriseProfile: enterpriseProfileNormalized, location, customerIndustry, enterpriseRevenue, itStatus, rawContent: content };
}

async function chatWithKimi(params: {
  apiUrl: string;
  apiKey: string;
  model: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<{ answer: string; rawContent: string }> {
  const baseUrl = asString(params.apiUrl).replace(/\/+$/, "") || "https://api.moonshot.cn/v1";
  const endpoint = `${baseUrl}/chat/completions`;
  const safeMessages = params.messages
    .map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: asString(item.content)
    }))
    .filter((item) => item.content);
    
  const body = {
    model: asString(params.model) || "kimi-k2.5",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: "你是工作量评估系统内置助手（KIMI）。请用中文简洁回答，优先结合用户上下文，避免冗余。"
      },
      ...safeMessages
    ]
  };
  
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`
    },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`kimi_chat_failed:${response.status}:${errorText.slice(0, 240)}`);
  }
  
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = asString(json?.choices?.[0]?.message?.content);
  
  if (!content) {
    throw new Error("model_empty_chat_response");
  }
  
  return { answer: content, rawContent: content };
}

type KimiAssessmentModuleItem = {
  cloudProduct?: string;
  skuName?: string;
  moduleName: string;
  standardDays: number;
  suggestedDays: number;
  reason: string;
};

type KimiAssessmentDraft = {
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

type KimiAssessmentSnapshot = {
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

type KimiAssessmentPreviewInput = {
  source?: {
    globalVersionCode?: string;
    requirementVersionCode?: string;
  };
  requirementSnapshot?: KimiAssessmentSnapshot;
  ruleContext?: {
    promptProfile?: string;
  };
};

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
function realignKingdeeDomainCloudModuleItems(items: KimiAssessmentModuleItem[]): KimiAssessmentModuleItem[] {
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

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function toNumberSafe(value: unknown): number {
  const text = asString(value).replace(/[^\d.-]/g, "");
  if (!text) return 0;
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
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
}): Promise<{ draft: KimiAssessmentDraft; rawContent: string }> {
  const baseUrl = asString(params.apiUrl).replace(/\/+$/, "") || "https://api.moonshot.cn/v1";
  const endpoint = `${baseUrl}/chat/completions`;
  const body = {
    model: asString(params.model) || "kimi-k2.5",
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          asString(params.promptTemplate) ||
          "你是资深项目经理 + 资深实施顾问。你不是做简单 SKU 对照，而是要基于需求全量信息做综合实施评估。必须只返回 JSON。字段固定：assessmentDraft.quoteMode/productLines/userCount/orgCount/orgSimilarity/difficultyFactor/moduleItems/risks/assumptions。moduleItems 每项字段：cloudProduct/skuName/moduleName/standardDays/suggestedDays/reason。所有数值字段必须为非负数，orgSimilarity 和 difficultyFactor 范围 0-1。评估时必须综合：basicInfo（行业、规模、上线目标）、businessNeedRows（业务复杂度）、devOverviewRows（开发基线）、implementationScopeRows（组织范围与地域）、meetingNotes（隐性约束）、keyPointRows（重点风险）。reason 必须体现增加/减少人天的业务原因与实施原因，不能仅写“按模板匹配”。禁止把“产品名/版本名/平台名（如金蝶AI星空、旗舰版）”直接当成 SKU，必须下钻到可实施功能项。财务云、供应链云等是实施域级云产品，不得填入 skuName 并挂在金蝶AI星空下冒充 SKU；域级人天归 cloudProduct=该域名，skuName 仅写子模块。若信息不足，给出审慎估算并在 risks/assumptions 明确不确定性来源。严禁仅凭业务需求正文中出现与 SKU 同名的词、或「总账、报表、出纳」类标准功能并列枚举，就认定 suggestedDays 必须高于 standardDays；须结合该条需求完整语义与实施顾问角色做专业判断，只有存在相对标准产品交付的明确增量（如二开、深度集成、多组织推广、性能/迁移、额外培训与方案等）时才上调，并在 reason 中写清增量内容而非复述关键词。"
      },
      {
        role: "user",
        content:
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
          `9) cloudProduct 表示产品线或实施域云产品（如金蝶AI星空、财务云）；skuName 仅填可交付子模块/SKU（如总账、采购管理）。禁止把财务云、供应链云等「实施域云」写进 skuName 又挂在金蝶AI星空下；域级人天应归在云产品行，SKU 列留空或仅列真实子模块。\n\n` +
          `${JSON.stringify(params.payload)}`
      }
    ]
  };

  const response = await requestKimiCompletion({
    endpoint,
    apiKey: params.apiKey,
    body
  });

  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = asString(json?.choices?.[0]?.message?.content);
  if (!content) {
    throw new Error("model_empty_assessment_response");
  }
  const parsed = parseJsonFromModelText(content);
  if (!Object.keys(parsed).length) {
    throw new Error("model_invalid_assessment_json");
  }
  const draft = normalizeKimiAssessmentDraft(parsed, params.fallback);
  return { draft, rawContent: content };
}

// -------------------- 工作簿解析（规则回退） --------------------

function findSheetByKeyword(workbook: XLSX.WorkBook, keyword: string): string {
  const exact = workbook.SheetNames.find((name) => asString(name) === keyword);
  if (exact) return exact;
  return workbook.SheetNames.find((name) => asString(name).includes(keyword)) || "";
}

function getSheetRows(workbook: XLSX.WorkBook, sheetName: string): (string | number)[][] {
  if (!sheetName) return [];
  const ws = workbook.Sheets[sheetName];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, defval: "", raw: false });
  try {
    const merges = Array.isArray(ws["!merges"]) ? (ws["!merges"] as XLSX.Range[]) : [];
    if (!merges.length) return rows;
    if (!rows.length) return rows;

    const rowCount = rows.length;
    const maxColCount = Math.max(1, ...rows.map((r) => (Array.isArray(r) ? r.length : 0)));
    let expandedCellBudget = 0;
    const maxExpandedCells = 120000;

    for (const merge of merges) {
      const rawStartRow = merge?.s?.r ?? -1;
      const rawEndRow = merge?.e?.r ?? -1;
      const rawStartCol = merge?.s?.c ?? -1;
      const rawEndCol = merge?.e?.c ?? -1;
      if (rawStartRow < 0 || rawEndRow < rawStartRow || rawStartCol < 0 || rawEndCol < rawStartCol) continue;

      // 仅在当前已解析出的可见数据范围内做合并展开，避免超大坐标导致性能/内存问题。
      const startRow = Math.min(rowCount - 1, rawStartRow);
      const endRow = Math.min(rowCount - 1, rawEndRow);
      const startCol = Math.min(maxColCount - 1, rawStartCol);
      const endCol = Math.min(maxColCount - 1, rawEndCol);
      if (endRow < startRow || endCol < startCol) continue;
      const area = (endRow - startRow + 1) * (endCol - startCol + 1);
      if (area > 20000) continue;
      if (expandedCellBudget + area > maxExpandedCells) break;

      const startCellAddress = XLSX.utils.encode_cell({ r: startRow, c: startCol });
      const mergedValue = asString(rows[startRow]?.[startCol] ?? ws[startCellAddress]?.v ?? "");
      if (!mergedValue) continue;
      for (let r = startRow; r <= endRow; r += 1) {
        if (!rows[r]) rows[r] = [];
        for (let c = startCol; c <= endCol; c += 1) {
          if (!asString(rows[r][c])) {
            rows[r][c] = mergedValue;
          }
        }
      }
      expandedCellBudget += area;
    }
    return rows;
  } catch {
    // 解析异常时回退原始行数据，避免影响整体导入流程。
    return rows;
  }
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

function parseRequirementImportFromWorkbook(workbook: XLSX.WorkBook): RequirementImportData {
  const sectionData: RequirementImportData = {
    valuePropositionRows: [],
    businessNeedRows: [],
    devOverviewRows: [],
    productModuleRows: [],
    implementationScopeRows: [],
    meetingNotes: "",
    keyPointRows: []
  };
  const collectedMeetingNotes: string[] = [];

  const parseTable = (
    rows: (string | number)[][],
    headerAliases: Record<string, string[]>,
    rowBuilder: (pick: (field: string) => string, pickNumber: (field: string) => number) => Record<string, unknown>,
    isMeaningfulRow: (row: Record<string, unknown>) => boolean
  ): Array<Record<string, unknown>> => {
    let headerIndex = -1;
    let headerMap: Record<string, number> = {};
    const fields = Object.keys(headerAliases);
    for (let idx = 0; idx < rows.length; idx += 1) {
      const row = rows[idx];
      const candidateMap: Record<string, number> = {};
      for (const field of fields) {
        const aliases = headerAliases[field] || [];
        const col = row.findIndex((cell) => aliases.some((alias) => normalizeCellText(cell).includes(normalizeCellText(alias))));
        if (col >= 0) {
          candidateMap[field] = col;
        }
      }
      if (Object.keys(candidateMap).length >= Math.max(2, Math.ceil(fields.length / 3))) {
        headerIndex = idx;
        headerMap = candidateMap;
        break;
      }
    }
    if (headerIndex < 0) return [];

    const result: Array<Record<string, unknown>> = [];
    let consecutiveBlank = 0;
    for (let idx = headerIndex + 1; idx < rows.length; idx += 1) {
      const source = rows[idx];
      const pick = (field: string): string => {
        const col = headerMap[field];
        return col === undefined ? "" : asString(source[col]);
      };
      const pickNumber = (field: string): number => {
        const col = headerMap[field];
        return col === undefined ? 0 : parseCellNumber(source[col]);
      };
      const built = rowBuilder(pick, pickNumber);
      const meaningful = isMeaningfulRow(built);
      if (!meaningful) {
        const isWholeRowBlank = source.every((cell) => !asString(cell));
        consecutiveBlank = isWholeRowBlank ? consecutiveBlank + 1 : 0;
        if (consecutiveBlank >= 2) break;
        continue;
      }
      consecutiveBlank = 0;
      result.push(built);
    }
    return result;
  };

  for (const sheetName of workbook.SheetNames) {
    const rows = getSheetRows(workbook, sheetName);
    if (!rows.length) continue;
    const normalizedSheetName = normalizeCellText(sheetName);

    if (normalizedSheetName.includes("会议纪要") || normalizedSheetName.includes("调研纪要")) {
      const text = rows
        .map((row) => row.map((cell) => asString(cell)).filter(Boolean).join(" "))
        .filter(Boolean)
        .join("\n")
        .trim();
      if (text) {
        collectedMeetingNotes.push(text);
      }
    } else {
      for (const row of rows) {
        const key = normalizeCellText(row[0]);
        if (key.includes("会议纪要") || key.includes("调研纪要")) {
          const maybeText = [asString(row[1]), asString(row[2]), asString(row[3])].filter(Boolean).join(" ").trim();
          if (maybeText) collectedMeetingNotes.push(maybeText);
        }
      }
    }

    if (sectionData.valuePropositionRows.length === 0) {
      const list = parseTable(
        rows,
        {
          summary: ["简要内容", "提炼总结", "总结"],
          refinedContent: ["具体内容", "提炼内容"],
          originalDemand: ["访谈原始诉求", "原始诉求", "原始需求"],
          interviewOutline: ["访谈提纲"]
        },
        (pick) => ({
          summary: pick("summary"),
          refinedContent: pick("refinedContent"),
          originalDemand: pick("originalDemand"),
          interviewOutline: pick("interviewOutline")
        }),
        (row) => Object.values(row).some((value) => asString(value))
      );
      sectionData.valuePropositionRows = list as RequirementImportData["valuePropositionRows"];
    }

    if (sectionData.businessNeedRows.length === 0) {
      const list = parseTable(
        rows,
        {
          businessDomain: ["业务领域"],
          category: ["分类", "类型"],
          businessNeed: ["业务需求及问题", "业务需求", "问题"],
          proposer: ["提出人", "提出方"],
          title: ["职务", "岗位"],
          preSalesIncluded: ["售前方案包含", "售前是否包含"],
          standardImplemented: ["标准产品是否实现"],
          solutionSuggestion: ["建议解决方案", "方案建议"],
          requiresCustomDev: ["是否需二次开发", "是否需要二开"]
        },
        (pick) => ({
          businessDomain: pick("businessDomain"),
          category: pick("category"),
          businessNeed: pick("businessNeed"),
          proposer: pick("proposer"),
          title: pick("title"),
          preSalesIncluded: pick("preSalesIncluded"),
          standardImplemented: pick("standardImplemented"),
          solutionSuggestion: pick("solutionSuggestion"),
          requiresCustomDev: pick("requiresCustomDev")
        }),
        (row) => Object.values(row).some((value) => asString(value))
      );
      sectionData.businessNeedRows = list as RequirementImportData["businessNeedRows"];
    }

    if (sectionData.devOverviewRows.length === 0) {
      const list = parseTable(
        rows,
        {
          businessDomain: ["业务领域"],
          moduleName: ["模块名称", "模块"],
          moduleBrief: ["模块简述"],
          functionDesc: ["功能说明", "功能描述"],
          solutionSuggestion: ["建议解决方案", "方案建议"],
          codingDays: ["基准编码人天", "开发工作量", "编码人天"],
          estimateBasis: ["估算依据"]
        },
        (pick, pickNumber) => ({
          businessDomain: pick("businessDomain"),
          moduleName: pick("moduleName"),
          moduleBrief: pick("moduleBrief"),
          functionDesc: pick("functionDesc"),
          solutionSuggestion: pick("solutionSuggestion"),
          codingDays: pickNumber("codingDays"),
          estimateBasis: pick("estimateBasis")
        }),
        (row) =>
          Object.entries(row).some(([key, value]) => {
            if (key === "codingDays") return Number(value) > 0;
            return asString(value);
          })
      );
      sectionData.devOverviewRows = list as RequirementImportData["devOverviewRows"];
    }

    if (sectionData.productModuleRows.length === 0) {
      const list = parseTable(
        rows,
        {
          productDomain: ["产品领域"],
          moduleName: ["模块"],
          subModule: ["子模块"],
          userCount: ["用户数"],
          implementationOrgCount: ["实施组织数", "实施组织数量"],
          pilotOrgCount: ["试点家数", "试点单位数量"],
          partyBLead: ["乙方主导推广"],
          partyALead: ["甲方主导推广"]
        },
        (pick) => ({
          productDomain: pick("productDomain"),
          moduleName: pick("moduleName"),
          subModule: pick("subModule"),
          userCount: pick("userCount"),
          implementationOrgCount: pick("implementationOrgCount"),
          pilotOrgCount: pick("pilotOrgCount"),
          partyBLead: pick("partyBLead"),
          partyALead: pick("partyALead")
        }),
        (row) => Object.values(row).some((value) => asString(value))
      );
      sectionData.productModuleRows = normalizeProductModuleRows(
        list as RequirementImportData["productModuleRows"]
      );
    }

    if (sectionData.implementationScopeRows.length === 0) {
      const list = parseTable(
        rows,
        {
          companyName: ["公司名称"],
          companyType: ["公司性质", "公司类型"],
          moduleScope: ["实施模块范围说明", "模块范围"],
          location: ["实施地点", "地点"],
          implementationMode: ["实施/推广模式", "实施方式"],
          note: ["备注"]
        },
        (pick) => ({
          companyName: pick("companyName"),
          companyType: pick("companyType"),
          moduleScope: pick("moduleScope"),
          location: pick("location"),
          implementationMode: pick("implementationMode"),
          note: pick("note")
        }),
        (row) => Object.values(row).some((value) => asString(value))
      );
      sectionData.implementationScopeRows = list as RequirementImportData["implementationScopeRows"];
    }

    if (sectionData.keyPointRows.length === 0) {
      const list = parseTable(
        rows,
        {
          analysisCategory: ["分析项目", "分析类别"],
          subItem: ["子项"],
          detail: ["明细内容", "内容明细"],
          note: ["备注"]
        },
        (pick) => ({
          analysisCategory: pick("analysisCategory"),
          subItem: pick("subItem"),
          detail: pick("detail"),
          note: pick("note")
        }),
        (row) => Object.values(row).some((value) => asString(value))
      );
      sectionData.keyPointRows = list as RequirementImportData["keyPointRows"];
    }
  }

  sectionData.meetingNotes = collectedMeetingNotes.join("\n").trim();
  sectionData.productModuleRows = normalizeProductModuleRows(sectionData.productModuleRows);
  return sectionData;
}

// -------------------- 路由处理函数 --------------------

export async function parseBasicInfo(req: Request, res: Response) {
  if (!requireRole(req, res, ["admin", "operator"])) return;
  
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
    const apiKey = config.kimi.apiKey;
    const model = config.kimi.model;
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
        workbookText
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
  if (!requireRole(req, res, ["admin", "operator"])) return;
  
  const requestId = randomUUID();
  const body = (req.body || {}) as {
    customerName?: string;
    location?: string;
    customerIndustry?: string;
    enterpriseRevenue?: string;
    itStatus?: string;
  };
  
  const customerName = asString(body.customerName);
  if (!customerName) {
    return fail(res, 40001, "参数错误", [{ field: "customerName", reason: "required" }]);
  }

  const location = asString(body.location);
  const customerIndustry = asString(body.customerIndustry);
  const enterpriseRevenue = asString(body.enterpriseRevenue);
  const itStatus = asString(body.itStatus);
  const apiKey = config.kimi.apiKey;

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
      itStatus
    });

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
  if (!requireRole(req, res, ["admin", "operator"])) return;

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
  const apiKey = config.kimi.apiKey;
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
      fallback: fallbackDraftAligned
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
  if (!requireRole(req, res, ["admin", "operator"])) return;

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
  if (!requireRole(req, res, ["admin", "operator"])) return;
  
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
