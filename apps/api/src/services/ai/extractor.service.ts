import { Request, Response } from "express";
import XLSX from "xlsx";
import { randomUUID } from "node:crypto";

import { BasicProjectInfo, RequirementImportData } from "../../types";
import { config } from "../../config/env";
import { asString, normalizeCellText } from "../../utils/helpers";
import { normalizeKimiModelName } from "../../utils/model-name";
import { ok, fail } from "../../utils/response";
import {
  loadRequirementSystemConfigStore,
  resolveActiveRequirementKimiApiKey,
} from "../../modules/system/system.repository";
import {
  buildWorkbookPreviewText,
  getSheetRows,
  inferProductLinesFromProductModules,
  mergeRequirementImportData,
  normalizeProductDomainName,
  normalizeProductModuleRows,
  parseRequirementImportFromWorkbook,
} from "../ai-workbook";
import { defaultProviderRegistry, type ModelProvider } from "../../ai/provider";
import { parseJsonFromModelText } from "./assessment.service";

function getKimiProvider(): ModelProvider {
  const provider = defaultProviderRegistry.get("kimi");
  if (!provider) throw new Error("kimi_provider_not_registered");
  return provider;
}

const REQUIREMENT_IMPORT_SYSTEM_PROMPT = [
  "你是企业项目评估信息抽取助手，任务是从 Excel 文本中抽取结构化需求导入数据。",
  "只输出一个合法 JSON 对象，不要输出解释、Markdown、代码块或多余文本。",
  "不得编造 Excel 中不存在的信息；缺失字段填空字符串，缺失数组填空数组，缺失数字填 0。",
  "必须过滤模板说明、填写说明、示例行、占位文案和重复占位内容。尤其遇到“本页粘贴会议纪要或调研纪要”“请提供项目需求相关资料”“请输入”“待填写”“示例”等模板文本时，不要写入结果。",
  "meetingNotes 只保留真实会议纪要、调研纪要、访谈结论、约束条件、风险提醒等业务内容；如果只有模板占位内容，返回空字符串。",
].join("\n");

function buildRequirementImportUserPrompt(workbookText: string): string {
  return [
    "请从以下 Excel 文本中提取【需求】全量信息，并按指定 JSON schema 返回。",
    "",
    "输出 schema：",
    "{",
    '  "basicInfo": {',
    '    "customerName": "",',
    '    "location": "",',
    '    "projectName": "",',
    '    "opportunityNo": "",',
    '    "productLines": [],',
    '    "customerIndustry": "",',
    '    "enterpriseRevenue": "",',
    '    "itStatus": "",',
    '    "expectedGoLive": "",',
    '    "enterpriseProfile": "",',
    '    "projectBackgroundNeeds": "",',
    '    "projectGoals": ""',
    "  },",
    '  "requirementImportData": {',
    '    "valuePropositionRows": [{ "summary": "", "refinedContent": "", "originalDemand": "", "interviewOutline": "" }],',
    '    "businessNeedRows": [{ "businessDomain": "", "category": "", "businessNeed": "", "proposer": "", "title": "", "preSalesIncluded": "", "standardImplemented": "", "solutionSuggestion": "", "requiresCustomDev": "" }],',
    '    "devOverviewRows": [{ "businessDomain": "", "moduleName": "", "moduleBrief": "", "functionDesc": "", "solutionSuggestion": "", "codingDays": 0, "estimateBasis": "" }],',
    '    "productModuleRows": [{ "productDomain": "", "moduleName": "", "subModule": "", "userCount": "", "implementationOrgCount": "", "pilotOrgCount": "", "partyBLead": "", "partyALead": "" }],',
    '    "implementationScopeRows": [{ "companyName": "", "companyType": "", "moduleScope": "", "location": "", "implementationMode": "", "note": "" }],',
    '    "meetingNotes": "",',
    '    "keyPointRows": [{ "analysisCategory": "", "subItem": "", "detail": "", "note": "" }]',
    "  }",
    "}",
    "",
    "抽取规则：",
    "1. 优先按 sheet 标题和表头归类，不要把“填写说明”里的流程说明当成业务数据。",
    "2. productLines 只填写产品线名称，例如“金蝶AI星空”“金蝶AI星瀚”；不要把模块名、版本名、云产品域误填为产品线。",
    "3. requiresCustomDev 保留 Excel 语义，优先输出“是”或“否”；无法判断时填空字符串。",
    "4. codingDays 必须是数字；无法从原文确定时填 0。",
    "5. 数组行必须至少有一个有效业务字段；全是空值、模板、示例、占位内容的行要丢弃。",
    "6. 输出必须能被 JSON.parse 直接解析。",
    "",
    "Excel 文本：",
    workbookText,
  ].join("\n");
}

function buildRequirementImportMessages(workbookText: string) {
  return [
    { role: "system" as const, content: REQUIREMENT_IMPORT_SYSTEM_PROMPT },
    { role: "user" as const, content: buildRequirementImportUserPrompt(workbookText) },
  ];
}

function asModelObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function asModelObjectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asModelObject).filter((x) => Object.keys(x).length > 0) : [];
}
function pickModelField(input: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = input[key];
    if (v == null || typeof v === "boolean" || typeof v === "object") continue;
    const s = asString(v);
    if (s) return s;
  }
  return "";
}
function pickNumberField(input: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const text = asString(input[key]).replace(/[^\d.-]/g, "");
    if (!text) continue;
    const n = Number(text);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}
function normalizeIndustryTagText(input: string): string {
  const raw = asString(input);
  if (!raw) return "";
  return raw.replace(/[／/\\|，、;；]+/g, " > ").replace(/\s+/g, " ").trim();
}
function ensureIndustryCodeAndName(value: string): string {
  const t = normalizeIndustryTagText(value);
  return t.includes(" > ") ? t : "";
}
function normalizeBasicProjectInfo(input: Record<string, unknown>): BasicProjectInfo {
  const productLines = (Array.isArray(input.productLines) ? (input.productLines as unknown[]) : [])
    .filter((v): v is string => typeof v === "string")
    .map((v) => normalizeProductDomainName(v))
    .filter(Boolean);
  return {
    customerName: pickModelField(input, ["customerName", "客户名称"]),
    location: pickModelField(input, ["location", "地点", "所在地区", "地区", "城市"]),
    projectName: pickModelField(input, ["projectName", "项目名称"]),
    opportunityNo: pickModelField(input, ["opportunityNo", "商机号"]),
    productLines: Array.from(new Set(productLines)),
    customerIndustry: ensureIndustryCodeAndName(pickModelField(input, ["customerIndustry", "客户行业", "行业"])),
    enterpriseRevenue: pickModelField(input, ["enterpriseRevenue", "企业营收", "营收"]),
    itStatus: pickModelField(input, ["itStatus", "信息化现状"]),
    expectedGoLive: pickModelField(input, ["expectedGoLive", "预期上线时间"]),
    enterpriseProfile: pickModelField(input, ["enterpriseProfile", "企业简介"]),
    projectBackgroundNeeds: pickModelField(input, ["projectBackgroundNeeds", "项目背景和需求", "项目背景需求"]),
    projectGoals: pickModelField(input, ["projectGoals", "项目目标"]),
  };
}
function normalizeRequirementImportData(input: Record<string, unknown>): RequirementImportData {
  const root = asModelObject(input.requirementImportData);
  const source = Object.keys(root).length ? root : input;
  return {
    valuePropositionRows: asModelObjectArray(source.valuePropositionRows || source.valuePropositions || source["价值主张"]).map((row) => ({ summary: pickModelField(row, ["summary", "提炼总结", "总结"]), refinedContent: pickModelField(row, ["refinedContent", "提炼内容"]), originalDemand: pickModelField(row, ["originalDemand", "原始需求"]), interviewOutline: pickModelField(row, ["interviewOutline", "访谈提纲"]) })).filter((row) => Object.values(row).some((x) => asString(x))),
    businessNeedRows: asModelObjectArray(source.businessNeedRows || source.businessNeeds || source["业务需求"]).map((row) => ({ businessDomain: pickModelField(row, ["businessDomain", "业务领域"]), category: pickModelField(row, ["category", "类型"]), businessNeed: pickModelField(row, ["businessNeed", "业务需求"]), proposer: pickModelField(row, ["proposer", "提出方"]), title: pickModelField(row, ["title", "需求标题"]), preSalesIncluded: pickModelField(row, ["preSalesIncluded", "售前是否包含"]), standardImplemented: pickModelField(row, ["standardImplemented", "标准产品是否实现"]), solutionSuggestion: pickModelField(row, ["solutionSuggestion", "方案建议"]), requiresCustomDev: pickModelField(row, ["requiresCustomDev", "是否需要二开"]) })).filter((row) => Object.values(row).some((x) => asString(x))),
    devOverviewRows: asModelObjectArray(source.devOverviewRows || source.devOverviews || source["开发需求概要"]).map((row) => ({ businessDomain: pickModelField(row, ["businessDomain", "业务领域"]), moduleName: pickModelField(row, ["moduleName", "模块名称"]), moduleBrief: pickModelField(row, ["moduleBrief", "模块简述"]), functionDesc: pickModelField(row, ["functionDesc", "功能描述"]), solutionSuggestion: pickModelField(row, ["solutionSuggestion", "方案建议"]), codingDays: pickNumberField(row, ["codingDays", "开发工作量", "编码人天"]), estimateBasis: pickModelField(row, ["estimateBasis", "估算依据"]) })).filter((row) => Object.values(row).some((x) => typeof x === "number" ? x > 0 : asString(x))),
    productModuleRows: normalizeProductModuleRows(asModelObjectArray(source.productModuleRows || source.productModules || source["产品及模块信息"] || source["4.产品及模块信息"] || source["产品模块"]).map((row) => ({ productDomain: normalizeProductDomainName(pickModelField(row, ["productDomain", "产品领域", "产品分组", "产品组", "云产品"])), moduleName: pickModelField(row, ["moduleName", "模块名称", "应用", "模块", "SKU", "sku"]), subModule: pickModelField(row, ["subModule", "子模块"]), userCount: pickModelField(row, ["userCount", "用户数"]), implementationOrgCount: pickModelField(row, ["implementationOrgCount", "实施组织数量"]), pilotOrgCount: pickModelField(row, ["pilotOrgCount", "试点单位数量"]), partyBLead: pickModelField(row, ["partyBLead", "乙方负责人"]), partyALead: pickModelField(row, ["partyALead", "甲方负责人"]) }))),
    implementationScopeRows: asModelObjectArray(source.implementationScopeRows || source.implementationScopes || source["实施组织范围"]).map((row) => ({ companyName: pickModelField(row, ["companyName", "公司名称"]), companyType: pickModelField(row, ["companyType", "公司类型"]), moduleScope: pickModelField(row, ["moduleScope", "模块范围"]), location: pickModelField(row, ["location", "地点"]), implementationMode: pickModelField(row, ["implementationMode", "实施方式"]), note: pickModelField(row, ["note", "备注"]) })),
    meetingNotes: pickModelField(source, ["meetingNotes", "会议纪要", "meetingSummary", "调研纪要"]),
    keyPointRows: asModelObjectArray(source.keyPointRows || source.keyPoints || source["关键点"]).map((row) => ({ analysisCategory: pickModelField(row, ["analysisCategory", "分析类别"]), subItem: pickModelField(row, ["subItem", "子项"]), detail: pickModelField(row, ["detail", "内容明细"]), note: pickModelField(row, ["note", "备注"]) })),
  };
}
function mergeBasicInfo(primary: BasicProjectInfo, fallback: BasicProjectInfo): BasicProjectInfo {
  const merged: BasicProjectInfo = { ...fallback };
  const keys: Array<keyof Omit<BasicProjectInfo, "productLines">> = [
    "customerName",
    "location",
    "projectName",
    "opportunityNo",
    "customerIndustry",
    "enterpriseRevenue",
    "itStatus",
    "expectedGoLive",
    "enterpriseProfile",
    "projectBackgroundNeeds",
    "projectGoals",
  ];
  for (const key of keys) {
    const value = asString(primary[key]);
    if (value) {
      merged[key] = value;
    }
  }
  merged.productLines = primary.productLines?.length ? primary.productLines : fallback.productLines || [];
  return merged;
}

function allowsLocalWorkbookFallback(req: Request): boolean {
  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const query = req.query && typeof req.query === "object" ? req.query as Record<string, unknown> : {};
  const value = asString(body.allowLocalFallback || query.allowLocalFallback).toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

function buildLocalWorkbookParsePayload(params: {
  workbook: XLSX.WorkBook;
  workbookBasicInfo: BasicProjectInfo;
  workbookRequirementData: RequirementImportData;
  model: string;
  fallbackReason: string;
}) {
  const productLines = params.workbookBasicInfo.productLines?.length
    ? params.workbookBasicInfo.productLines
    : inferProductLinesFromProductModules(params.workbookRequirementData.productModuleRows);
  return {
    basicInfo: { ...params.workbookBasicInfo, productLines },
    requirementImportData: params.workbookRequirementData,
    sourceSheets: params.workbook.SheetNames,
    model: params.model,
    mode: "local_fallback",
    fallbackReason: params.fallbackReason,
    rawContent: "",
  };
}

async function parseRequirementImportByKimi(params: { apiUrl: string; apiKey: string; model: string; workbookText: string; timeoutMs: number; }) {
  const completion = await getKimiProvider().chatCompletion({ model: params.model, temperature: 0.1, responseFormat: "json_object", timeoutMs: params.timeoutMs, credentialsOverride: { apiKey: params.apiKey, apiBaseUrl: params.apiUrl }, messages: buildRequirementImportMessages(params.workbookText) });
  const parsed = parseJsonFromModelText(completion.content);
  return { basicInfo: normalizeBasicProjectInfo(asModelObject(parsed.basicInfo) || parsed), requirementImportData: normalizeRequirementImportData(parsed), rawContent: completion.content };
}

async function parseRequirementImportByKimiStream(
  params: {
    apiUrl: string;
    apiKey: string;
    model: string;
    workbookText: string;
    timeoutMs: number;
    onModelStart: () => void;
    onDelta: (info: { deltaChars: number; totalChars: number }) => void;
  },
) {
  const provider = getKimiProvider();
  if (!provider.streamChatCompletion) throw new Error("kimi_stream_not_supported");
  let rawContent = "";
  let started = false;
  for await (const chunk of provider.streamChatCompletion({
    model: params.model,
    temperature: 0.1,
    responseFormat: "json_object",
    timeoutMs: params.timeoutMs,
    credentialsOverride: { apiKey: params.apiKey, apiBaseUrl: params.apiUrl },
    messages: buildRequirementImportMessages(params.workbookText),
  })) {
    if (chunk.contentDelta) {
      rawContent = chunk.content;
      if (!started) {
        started = true;
        params.onModelStart();
      }
      params.onDelta({ deltaChars: chunk.contentDelta.length, totalChars: rawContent.length });
    }
  }
  if (!rawContent) throw new Error("model_empty_response");
  const parsed = parseJsonFromModelText(rawContent);
  return { basicInfo: normalizeBasicProjectInfo(asModelObject(parsed.basicInfo) || parsed), requirementImportData: normalizeRequirementImportData(parsed), rawContent };
}

function writeSse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function openSse(res: Response) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

function parseBasicInfoFromWorkbook(workbook: XLSX.WorkBook): BasicProjectInfo {
  const rows = getSheetRows(workbook, workbook.SheetNames.find((n) => asString(n).includes("项目概况")) || "");
  const result: BasicProjectInfo = { customerName: "", location: "", projectName: "", opportunityNo: "", customerIndustry: "", productLines: [], enterpriseRevenue: "", itStatus: "", expectedGoLive: "", enterpriseProfile: "", projectBackgroundNeeds: "", projectGoals: "" };
  for (const row of rows) {
    const key = normalizeCellText(row[0]);
    const value = asString(row[1] ?? "");
    if (!key || !value) continue;
    if (key.includes("客户名称")) result.customerName = value;
    if (key.includes("地点") || key.includes("所在地区") || key.includes("区域") || key.includes("城市")) result.location = value;
    if (key.includes("项目名称")) result.projectName = value;
    if (key.includes("商机号")) result.opportunityNo = value;
    if (key.includes("客户行业") || key.includes("行业")) result.customerIndustry = value;
    if (key.includes("企业营收") || key.includes("营收")) result.enterpriseRevenue = value;
    if (key.includes("信息化现状")) result.itStatus = value;
    if (key.includes("预期上线时间")) result.expectedGoLive = value;
    if (key.includes("企业简介")) result.enterpriseProfile = value;
    if (key.includes("项目背景和需求") || key.includes("项目背景需求")) result.projectBackgroundNeeds = value;
    if (key.includes("项目目标")) result.projectGoals = value;
  }
  return result;
}

export async function parseBasicInfo(req: Request, res: Response) {
  const requestId = randomUUID();
  if (!req.file) return fail(res, 40001, "参数错误", [{ field: "file", reason: "required" }]);
  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const workbookText = buildWorkbookPreviewText(workbook);
    const workbookBasicInfo = parseBasicInfoFromWorkbook(workbook);
    const workbookRequirementData = parseRequirementImportFromWorkbook(workbook);
    const { apiKey } = resolveActiveRequirementKimiApiKey();
    const requirementSettings = loadRequirementSystemConfigStore().active;
    const model = requirementSettings.fileParsing.model?.trim() || requirementSettings.kimiEvaluation.model?.trim() || config.kimi.model;
    const modelForClient = normalizeKimiModelName(model);
    const allowLocalFallback = allowsLocalWorkbookFallback(req);

    if (!apiKey) {
      if (allowLocalFallback) {
        return res.json(ok(buildLocalWorkbookParsePayload({
          workbook,
          workbookBasicInfo,
          workbookRequirementData,
          model: modelForClient,
          fallbackReason: "api_key_missing",
        }), requestId));
      }
      return fail(res, 40001, "参数错误", [{ field: "apiKey", reason: "required_or_env_missing" }]);
    }

    let parsed: Awaited<ReturnType<typeof parseRequirementImportByKimi>>;
    try {
      parsed = await parseRequirementImportByKimi({
        apiUrl: config.kimi.apiBaseUrl,
        apiKey,
        model,
        workbookText,
        timeoutMs: requirementSettings.kimiEvaluation.timeoutMs || 120000,
      });
    } catch (err) {
      if (allowLocalFallback) {
        return res.json(ok(buildLocalWorkbookParsePayload({
          workbook,
          workbookBasicInfo,
          workbookRequirementData,
          model: modelForClient,
          fallbackReason: err instanceof Error ? err.message : "model_parse_failed",
        }), requestId));
      }
      return fail(res, 40001, "参数错误", [{ field: "model", reason: err instanceof Error ? err.message : "model_parse_failed" }]);
    }

    const mergedBasic = mergeBasicInfo(parsed.basicInfo, workbookBasicInfo);
    const mergedRequirement = mergeRequirementImportData(parsed.requirementImportData, workbookRequirementData);
    return res.json(ok({ basicInfo: { ...mergedBasic, productLines: mergedBasic.productLines?.length ? mergedBasic.productLines : inferProductLinesFromProductModules(mergedRequirement.productModuleRows) }, requirementImportData: mergedRequirement, sourceSheets: workbook.SheetNames, model: modelForClient, mode: "model", fallbackReason: "", rawContent: parsed.rawContent }, requestId));
  } catch (err) {
    return fail(res, 40001, "参数错误", [{ field: "file/api", reason: err instanceof Error ? err.message : "parse_failed" }]);
  }
}

export async function parseBasicInfoStream(req: Request, res: Response) {
  const requestId = randomUUID();
  openSse(res);
  if (!req.file) {
    writeSse(res, "error", { message: "参数错误", reason: "file_required", requestId });
    return res.end();
  }

  try {
    writeSse(res, "progress", { message: "已收到文件，正在读取 Excel…", progress: 8 });
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const workbookText = buildWorkbookPreviewText(workbook);
    const workbookBasicInfo = parseBasicInfoFromWorkbook(workbook);
    const workbookRequirementData = parseRequirementImportFromWorkbook(workbook);
    writeSse(res, "progress", {
      message: `规则解析完成，已读取 ${workbook.SheetNames.length} 个工作表。`,
      progress: 24,
    });

    const { apiKey } = resolveActiveRequirementKimiApiKey();
    const requirementSettings = loadRequirementSystemConfigStore().active;
    const model = requirementSettings.fileParsing.model?.trim() || requirementSettings.kimiEvaluation.model?.trim() || config.kimi.model;
    const modelForClient = normalizeKimiModelName(model);

    if (!apiKey) {
      writeSse(res, "error", { message: "参数错误", reason: "required_or_env_missing", requestId });
      return res.end();
    }

    writeSse(res, "progress", {
      message: `解析请求已发送，正在等待 ${modelForClient} 返回结果…`,
      progress: 40,
      model: modelForClient,
    });

    let parsed: Awaited<ReturnType<typeof parseRequirementImportByKimiStream>>;
    try {
      parsed = await parseRequirementImportByKimiStream({
        apiUrl: config.kimi.apiBaseUrl,
        apiKey,
        model,
        workbookText,
        timeoutMs: requirementSettings.kimiEvaluation.timeoutMs || 120000,
        onModelStart: () => {
          writeSse(res, "model_start", {
            message: `${modelForClient} 已开始返回内容…`,
            progress: 48,
            model: modelForClient,
          });
        },
        onDelta: ({ deltaChars, totalChars }) => {
          writeSse(res, "model_delta", {
            message: `已收到部分内容（累计 ${totalChars} 字符）…`,
            progress: Math.min(84, 48 + Math.floor(totalChars / 160)),
            model: modelForClient,
            deltaChars,
            totalChars,
          });
        },
      });
    } catch (err) {
      writeSse(res, "error", {
        message: `${modelForClient} 未能完成解析。`,
        reason: err instanceof Error ? err.message : "model_parse_failed",
        requestId,
      });
      return res.end();
    }

    writeSse(res, "progress", { message: "模型内容接收完成，正在合并回填结果…", progress: 88 });
    const mergedBasic = mergeBasicInfo(parsed.basicInfo, workbookBasicInfo);
    const mergedRequirement = mergeRequirementImportData(parsed.requirementImportData, workbookRequirementData);
    const data = {
      basicInfo: {
        ...mergedBasic,
        productLines: mergedBasic.productLines?.length
          ? mergedBasic.productLines
          : inferProductLinesFromProductModules(mergedRequirement.productModuleRows),
      },
      requirementImportData: mergedRequirement,
      sourceSheets: workbook.SheetNames,
      model: modelForClient,
      mode: "model",
      fallbackReason: "",
      rawContent: parsed.rawContent,
    };
    writeSse(res, "complete", { data, requestId });
    return res.end();
  } catch (err) {
    writeSse(res, "error", {
      message: "参数错误",
      reason: err instanceof Error ? err.message : "parse_failed",
      requestId,
    });
    return res.end();
  }
}
