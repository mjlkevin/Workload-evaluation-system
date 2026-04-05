// ============================================================
// AI 服务 - Kimi API 调用
// ============================================================

import { Request, Response } from "express";
import XLSX from "xlsx";
import { randomUUID } from "node:crypto";

import { BasicProjectInfo, RequirementImportData } from "../types";
import { config } from "../config/env";
import { asString, normalizeCellText, parseCellNumber } from "../utils/helpers";
import { ok, fail } from "../utils/response";
import { requireRole } from "../middleware/auth";

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

function normalizeBasicProjectInfo(input: Record<string, unknown>): BasicProjectInfo {
  const rawIndustry = pickModelField(input, ["customerIndustry", "客户行业", "行业"]);
  return {
    customerName: pickModelField(input, ["customerName", "客户名称"]),
    projectName: pickModelField(input, ["projectName", "项目名称"]),
    opportunityNo: pickModelField(input, ["opportunityNo", "商机号"]),
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
      productDomain: pickModelField(row, ["productDomain", "产品领域"]),
      moduleName: pickModelField(row, ["moduleName", "模块名称"]),
      subModule: pickModelField(row, ["subModule", "子模块"]),
      userCount: pickModelField(row, ["userCount", "用户数"]),
      implementationOrgCount: pickModelField(row, ["implementationOrgCount", "实施组织数量"]),
      pilotOrgCount: pickModelField(row, ["pilotOrgCount", "试点单位数量"]),
      partyBLead: pickModelField(row, ["partyBLead", "乙方负责人"]),
      partyALead: pickModelField(row, ["partyALead", "甲方负责人"])
    }))
    .filter((row) => Object.values(row).some((x) => asString(x)));

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
    productModuleRows,
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
    projectName: primary.projectName || fallback.projectName,
    opportunityNo: primary.opportunityNo || fallback.opportunityNo,
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
  customerIndustry: string;
  enterpriseRevenue: string;
  itStatus: string;
}): { enterpriseProfile: string; customerIndustry: string; enterpriseRevenue: string; itStatus: string } {
  const customerIndustry = ensureIndustryCodeAndName(asString(params.customerIndustry)) || asString(params.customerIndustry) || "待补充行业";
  const enterpriseRevenue = asString(params.enterpriseRevenue) || "待补充规模";
  const itStatus = asString(params.itStatus) || "待补充信息化现状";
  const enterpriseProfile =
    `${params.customerName}是一家${customerIndustry}企业，当前企业规模/营收约为${enterpriseRevenue}。` +
    `从信息化现状看，${itStatus}。建议围绕“业务流程标准化、数据口径统一、关键场景数字化闭环”推进项目落地，` +
    `优先梳理主数据、核心业务流程与管理看板，形成可分阶段交付的实施路线。`;
  return { enterpriseProfile, customerIndustry, enterpriseRevenue, itStatus };
}

// -------------------- Kimi API 调用 --------------------

async function parseRequirementImportByKimi(params: {
  apiUrl: string;
  apiKey: string;
  model: string;
  workbookText: string;
}): Promise<{ basicInfo: BasicProjectInfo; requirementImportData: RequirementImportData; rawContent: string }> {
  const baseUrl = asString(params.apiUrl).replace(/\/+$/, "") || "https://api.moonshot.cn/v1";
  const endpoint = `${baseUrl}/chat/completions`;
  const body = {
    model: asString(params.model) || "moonshot-v1-8k",
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
          `要求：basicInfo.customerIndustry 必须按《国民经济行业分类》（GB/T 4754）四级分类输出，且每一级都必须为“编码+名称”。` +
          `格式为："门类编码 门类名称 > 大类编码 大类名称 > 中类编码 中类名称 > 小类编码 小类名称"。` +
          `例如：I 信息传输、软件和信息技术服务业 > 65 软件和信息技术服务业 > 651 软件开发 > 6510 软件开发。\n\n` +
          `${params.workbookText}`
      }
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
    throw new Error(`kimi_request_failed:${response.status}:${errorText.slice(0, 240)}`);
  }
  
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = asString(json?.choices?.[0]?.message?.content);
  const parsed = parseJsonFromModelText(content);
  const basicInfoSource = asModelObject(parsed.basicInfo);
  
  const normalizedBasicInfo = normalizeBasicProjectInfo(Object.keys(basicInfoSource).length ? basicInfoSource : parsed);
  const strictIndustry = ensureIndustryCodeAndName(normalizedBasicInfo.customerIndustry);
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
  customerIndustry?: string;
  enterpriseRevenue?: string;
  itStatus?: string;
}): Promise<{
  enterpriseProfile: string;
  customerIndustry: string;
  enterpriseRevenue: string;
  itStatus: string;
  rawContent: string;
}> {
  const baseUrl = asString(params.apiUrl).replace(/\/+$/, "") || "https://api.moonshot.cn/v1";
  const endpoint = `${baseUrl}/chat/completions`;
  const knownContextLines = [
    `客户名称：${params.customerName}`,
    params.customerIndustry ? `已知行业：${params.customerIndustry}` : "",
    params.enterpriseRevenue ? `已知规模/营收：${params.enterpriseRevenue}` : "",
    params.itStatus ? `已知信息化现状：${params.itStatus}` : ""
  ].filter(Boolean);
  
  const body = {
    model: asString(params.model) || "moonshot-v1-8k",
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "你是企业经营分析与信息摘要助手。请只输出 JSON 对象，不要输出任何解释文字。必须返回且仅返回以下四个字段：enterpriseProfile、customerIndustry、enterpriseRevenue、itStatus。四个字段都必须是非空字符串。若公开信息不足，请基于行业公开口径与行业常识给出审慎估计，并在表述中标注“估计/区间/未公开”。"
      },
      {
        role: "user",
        content:
          `请根据客户名称与已知信息，输出该客户的企业画像并严格按指定 JSON 字段返回。\n\n` +
          `输出要求：\n` +
          `1) 仅输出 JSON，不要 Markdown，不要代码块。\n` +
          `2) 字段必须完整：enterpriseProfile、customerIndustry、enterpriseRevenue、itStatus。\n` +
          `3) 强调“高度提炼与总结”，避免空泛口号，优先写经营情况、营收情况、财务情况。\n` +
          `4) enterpriseProfile 为 120-220 字中文简介，要求至少包含 2 处可量化信息（如营收区间、增长率、利润率、资产规模、员工规模、门店/产能等），若无公开精确值可给区间并标注估计。\n` +
          `5) customerIndustry 必须按《国民经济行业分类》（GB/T 4754）四级分类返回，且每一级都必须为“编码+名称”，格式："门类编码 门类名称 > 大类编码 大类名称 > 中类编码 中类名称 > 小类编码 小类名称"。\n` +
          `6) enterpriseRevenue 必须包含数值或区间（例如“约50-80亿元”或“未公开，行业估计30-50亿元”），并尽量补充一条财务相关支撑信息（如毛利率区间/利润水平/资产规模/现金流特征）。\n` +
          `7) itStatus 描述信息化现状成熟度，并尽量给出具体系统或建设内容（如 ERP/CRM/MES/BI/主数据/集成平台等）；若信息可信度低请明确标注“信息有限”。\n` +
          `8) 数据支撑原则：优先公开数据；无公开数据时使用行业估计并显式说明“估计依据为行业均值/同规模企业区间”。\n\n` +
          `已知信息：\n${knownContextLines.join("\n")}\n\n` +
          `请按如下结构返回：\n` +
          `{"enterpriseProfile":"","customerIndustry":"","enterpriseRevenue":"","itStatus":""}`
      }
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
    throw new Error(`kimi_request_failed:${response.status}:${errorText.slice(0, 240)}`);
  }
  
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = asString(json?.choices?.[0]?.message?.content);
  const parsed = parseJsonFromModelText(content);
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
  return { enterpriseProfile: enterpriseProfileNormalized, customerIndustry, enterpriseRevenue, itStatus, rawContent: content };
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
    model: asString(params.model) || "moonshot-v1-8k",
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
  return XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, defval: "", raw: false });
}

function parseBasicInfoFromWorkbook(workbook: XLSX.WorkBook): BasicProjectInfo {
  const rows = getSheetRows(workbook, findSheetByKeyword(workbook, "项目概况"));
  const result: BasicProjectInfo = {
    customerName: "", projectName: "", opportunityNo: "", customerIndustry: "",
    enterpriseRevenue: "", itStatus: "", expectedGoLive: "", enterpriseProfile: "",
    projectBackgroundNeeds: "", projectGoals: ""
  };
  const fieldMap: Array<{ keys: string[]; target: keyof BasicProjectInfo }> = [
    { keys: ["客户名称"], target: "customerName" },
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
      sectionData.productModuleRows = list as RequirementImportData["productModuleRows"];
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
    const workbookRequirementData = parseRequirementImportFromWorkbook(workbook);
    const apiKey = config.kimi.apiKey;
    const model = config.kimi.model;

    if (!apiKey) {
      return res.json(
        ok(
          {
            basicInfo: workbookBasicInfo,
            requirementImportData: workbookRequirementData,
            sourceSheets: workbook.SheetNames,
            model: "rule-fallback",
            mode: "rule_fallback",
            fallbackReason: "api_key_missing",
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

      return res.json(
        ok(
          {
            basicInfo: mergeBasicInfo(parsed.basicInfo, workbookBasicInfo),
            requirementImportData: mergeRequirementImportData(parsed.requirementImportData, workbookRequirementData),
            sourceSheets: workbook.SheetNames,
            model,
            mode: "model",
            fallbackReason: "",
            rawContent: parsed.rawContent
          },
          requestId
        )
      );
    } catch (modelErr) {
      const fallbackReason = modelErr instanceof Error ? modelErr.message : "model_parse_failed";
      return res.json(
        ok(
          {
            basicInfo: workbookBasicInfo,
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
    customerIndustry?: string;
    enterpriseRevenue?: string;
    itStatus?: string;
  };
  
  const customerName = asString(body.customerName);
  if (!customerName) {
    return fail(res, 40001, "参数错误", [{ field: "customerName", reason: "required" }]);
  }

  const customerIndustry = asString(body.customerIndustry);
  const enterpriseRevenue = asString(body.enterpriseRevenue);
  const itStatus = asString(body.itStatus);
  const apiKey = config.kimi.apiKey;

  if (!apiKey) {
    const fallback = buildCompanyProfileFallback({ customerName, customerIndustry, enterpriseRevenue, itStatus });
    return res.json(
      ok(
        {
          customerName,
          ...fallback,
          model: "rule-fallback",
          mode: "rule_fallback",
          fallbackReason: "api_key_missing",
          rawContent: ""
        },
        requestId
      )
    );
  }

  try {
    const model = config.kimi.model;
    const parsed = await summarizeCompanyProfileByKimi({
      apiUrl: config.kimi.apiBaseUrl,
      apiKey,
      model,
      customerName,
      customerIndustry,
      enterpriseRevenue,
      itStatus
    });

    return res.json(
      ok(
        {
          customerName,
          enterpriseProfile: parsed.enterpriseProfile,
          customerIndustry: parsed.customerIndustry,
          enterpriseRevenue: parsed.enterpriseRevenue,
          itStatus: parsed.itStatus,
          model,
          mode: "model",
          fallbackReason: "",
          rawContent: parsed.rawContent
        },
        requestId
      )
    );
  } catch (err) {
    const fallbackReason = err instanceof Error ? err.message : "summary_failed";
    const fallback = buildCompanyProfileFallback({ customerName, customerIndustry, enterpriseRevenue, itStatus });
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
    const result = await chatWithKimi({
      apiUrl: config.kimi.apiBaseUrl,
      apiKey,
      model,
      messages: messages.slice(-12)
    });
    
    res.json(ok({ answer: result.answer, model }, requestId));
  } catch (err) {
    const reason = err instanceof Error ? err.message : "chat_failed";
    return fail(res, 40001, "参数错误", [{ field: "messages/api", reason }]);
  }
}
