// ============================================================
// O4 搬迁：需求解析报告（v1/合并）构建与附件 Kimi 分析
// 内容逐字节搬迁自 chat.service.ts，零逻辑变更。
// ============================================================

import { config } from "../../../config/env";
import { asString } from "../../../utils/helpers";
import { resolveBusinessRole } from "../../../middleware/auth";
import { loadRequirementSystemConfigStore } from "../../../modules/system/system.repository";
import type { AuthUser } from "../../../types";
import {
  HOME_ROLE_PRESETS,
  asModelObject,
  getKimiProvider,
  pickModelField,
  type HomeAttachmentInput,
} from "./workbench-shared";

function extractSummaryLine(summary: string, label: string): string {
  const line = summary
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${label}：`) || item.startsWith(`${label}:`));
  return line ? line.replace(new RegExp(`^${label}[：:]\\s*`), "").trim() : "";
}

function extractNumberedSection(summary: string, heading: string): string[] {
  const lines = summary.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  const start = lines.findIndex((line) => line === `${heading}：` || line === `${heading}:` || line === heading);
  if (start < 0) return [];
  const result: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^[\u4e00-\u9fa5A-Za-z]+[：:]$/.test(line)) break;
    const match = line.match(/^\d+[.、]\s*(.+)$/);
    if (match?.[1]) result.push(match[1].trim());
  }
  return result.slice(0, 8);
}

export function buildRequirementAnalysisReport(attachment: HomeAttachmentInput) {
  const summary = asString(attachment.parsedSummary);
  const needs = extractNumberedSection(summary, "业务需求");
  const modules = extractNumberedSection(summary, "模块线索");
  return {
    sourceFile: attachment.name,
    projectName: extractSummaryLine(summary, "项目") || attachment.name.replace(/\.[^.]+$/, ""),
    customerName: extractSummaryLine(summary, "客户") || "待补充",
    industry: extractSummaryLine(summary, "行业") || "待补充",
    productLines: extractSummaryLine(summary, "产品线").split(/[、,，]/).map((item) => item.trim()).filter(Boolean).slice(0, 6),
    sourceSheets: extractSummaryLine(summary, "工作表").split(/[、,，]/).map((item) => item.trim()).filter(Boolean).slice(0, 10),
    needs,
    modules,
    missingItems: [
      "客户行业及业务背景是否完整",
      "各需求域的业务范围边界",
      "关键报表、接口、数据迁移数量",
      "实施组织范围与上线批次",
    ],
    risks: [
      "需求范围尚未锁定，粗评结果需在澄清后更新",
      "自定义报表、接口和数据迁移可能带来工作量增量",
    ],
    nextActions: ["补充项目信息", "生成待确认问题", "进入正式评估"],
    summary,
  };
}

function parseJsonFromText(text: string): Record<string, unknown> {
  const raw = asString(text).trim();
  if (!raw) throw new Error("model_empty_response");
  try {
    return asModelObject(JSON.parse(raw));
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
    if (fenced) return asModelObject(JSON.parse(fenced));
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return asModelObject(JSON.parse(raw.slice(start, end + 1)));
    throw new Error("model_invalid_json");
  }
}

function pickStringArrayField(input: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = input[key];
    if (Array.isArray(value)) {
      const rows = value.map((item) => asString(item)).filter(Boolean);
      if (rows.length > 0) return rows;
    }
    const text = asString(value);
    if (text) return text.split(/\r?\n|[；;]/).map((item) => item.replace(/^[-*\d.、\s]+/, "").trim()).filter(Boolean);
  }
  return [];
}

// RP-006: 多附件合并分析 — 并行单文件分析 + 合并 prompt 生成统一报告
export async function analyzeMultipleAttachmentsByKimi(params: {
  apiUrl: string;
  apiKey: string;
  model: string;
  user: AuthUser;
  workflowKey: string;
  attachments: HomeAttachmentInput[];
}): Promise<{ answer: string; report: ReturnType<typeof buildMergedRequirementAnalysisReport>; rawContent: string }> {
  const { attachments } = params;
  if (attachments.length <= 1) {
    // 单附件走原有路径，包装为合并格式
    const single = await analyzeRequirementAttachmentByKimi({ ...params, attachment: attachments[0] });
    const merged = buildMergedRequirementAnalysisReport(attachments, [single.report]);
    return { answer: single.answer, report: merged, rawContent: single.rawContent };
  }

  // 并行单文件分析
  const individualAnalyses = await Promise.all(
    attachments.map((attachment) =>
      analyzeRequirementAttachmentByKimi({ ...params, attachment }).catch((err) => ({
        answer: "",
        report: buildRequirementAnalysisReport(attachment),
        rawContent: "",
        error: err instanceof Error ? err.message : "analysis_failed",
      }))
    )
  );

  // 合并 prompt：将各文件分析结果合成为统一报告
  const mergeSystemPrompt = [
    "你是 WES 工作量评估系统中的售前需求分析 Agent。",
    "用户同时上传了多个附件，每个附件已独立分析。请将多份分析结果合并为一份统一的需求解析报告。",
    "请只输出 JSON 对象，不要输出 Markdown。",
    "JSON 字段：answer, projectName, customerName, industry, productLines, sourceSheets, needs, modules, missingItems, risks, nextActions, sourceFiles。",
    "needs/modules/missingItems/risks/nextActions/sourceFiles 必须是字符串数组。",
    "合并规则：",
    "- projectName/customerName/industry 取最完整的值",
    "- needs/modules 去重合并，标注来源文件",
    "- missingItems/risks 合并去重",
    "- sourceFiles 列出所有来源文件名",
  ].join("\n");

  const mergeUserContent = [
    `共 ${attachments.length} 个附件，以下是各文件的独立分析结果：`,
    "",
    ...individualAnalyses.flatMap((analysis, idx) => [
      `── 文件 ${idx + 1}：${attachments[idx].name} ──`,
      `项目：${analysis.report.projectName}`,
      `客户：${analysis.report.customerName}`,
      `行业：${analysis.report.industry}`,
      `需求：${analysis.report.needs.join("；")}`,
      `模块：${analysis.report.modules.join("；")}`,
      `缺失：${analysis.report.missingItems.join("；")}`,
      `风险：${analysis.report.risks.join("；")}`,
      "",
    ]),
    "请将以上多份分析合并为一份统一报告。",
  ].join("\n");

  const completion = await getKimiProvider().chatCompletion({
    model: params.model,
    temperature: 0.2,
    responseFormat: "json_object",
    promptCacheKey: "home-workbench-multi-attachment-merge-v1",
    timeoutMs: loadRequirementSystemConfigStore().active.kimiEvaluation.timeoutMs || 120000,
    credentialsOverride: { apiKey: params.apiKey, apiBaseUrl: params.apiUrl },
    messages: [
      { role: "system", content: mergeSystemPrompt },
      { role: "user", content: mergeUserContent },
    ],
  });

  const parsed = parseJsonFromText(completion.content);
  const mergedReport = buildMergedRequirementAnalysisReport(attachments, individualAnalyses.map((a) => a.report), parsed);
  const answer = pickModelField(parsed, ["answer", "回复", "message"]) || `已完成 ${attachments.length} 个附件的合并分析，生成统一《需求解析报告 v1》。`;
  return { answer, report: mergedReport, rawContent: completion.rawContent || completion.content };
}

export function buildMergedRequirementAnalysisReport(
  attachments: HomeAttachmentInput[],
  individualReports: ReturnType<typeof buildRequirementAnalysisReport>[],
  modelOverrides: Record<string, unknown> = {},
) {
  // 基础：取第一个文件的报告作为骨架
  const base = individualReports[0] || buildRequirementAnalysisReport(attachments[0]);
  const allNeeds = Array.from(new Set(individualReports.flatMap((r) => r.needs))).slice(0, 20);
  const allModules = Array.from(new Set(individualReports.flatMap((r) => r.modules))).slice(0, 20);
  const allMissing = Array.from(new Set(individualReports.flatMap((r) => r.missingItems))).slice(0, 12);
  const allRisks = Array.from(new Set(individualReports.flatMap((r) => r.risks))).slice(0, 10);
  const allSourceSheets = Array.from(new Set(individualReports.flatMap((r) => r.sourceSheets))).slice(0, 15);
  const allProductLines = Array.from(new Set(individualReports.flatMap((r) => r.productLines))).slice(0, 10);

  return {
    sourceFile: attachments.map((a) => a.name),
    sourceFiles: attachments.map((a) => a.name),
    projectName: pickModelField(modelOverrides, ["projectName", "项目名称"]) || base.projectName,
    customerName: pickModelField(modelOverrides, ["customerName", "客户名称"]) || individualReports.map((r) => r.customerName).find((n) => n && n !== "待补充") || "待补充",
    industry: pickModelField(modelOverrides, ["industry", "行业"]) || individualReports.map((r) => r.industry).find((n) => n && n !== "待补充") || "待补充",
    productLines: pickStringArrayField(modelOverrides, ["productLines", "产品线"]).length > 0 ? pickStringArrayField(modelOverrides, ["productLines"]) : allProductLines,
    sourceSheets: allSourceSheets,
    needs: pickStringArrayField(modelOverrides, ["needs"]).length > 0 ? pickStringArrayField(modelOverrides, ["needs"]) : allNeeds,
    modules: pickStringArrayField(modelOverrides, ["modules"]).length > 0 ? pickStringArrayField(modelOverrides, ["modules"]) : allModules,
    missingItems: pickStringArrayField(modelOverrides, ["missingItems"]).length > 0 ? pickStringArrayField(modelOverrides, ["missingItems"]) : allMissing,
    risks: pickStringArrayField(modelOverrides, ["risks"]).length > 0 ? pickStringArrayField(modelOverrides, ["risks"]) : allRisks,
    nextActions: pickStringArrayField(modelOverrides, ["nextActions"]).length > 0 ? pickStringArrayField(modelOverrides, ["nextActions"]) : ["补充项目信息", "生成待确认问题", "进入正式评估"],
    summary: individualReports.map((r) => r.summary).filter(Boolean).join("\n\n---\n\n"),
  };
}

export async function analyzeRequirementAttachmentByKimi(params: {
  apiUrl: string;
  apiKey: string;
  model: string;
  user: AuthUser;
  workflowKey: string;
  attachment: HomeAttachmentInput;
}): Promise<{ answer: string; report: ReturnType<typeof buildRequirementAnalysisReport>; rawContent: string }> {
  const businessRole = resolveBusinessRole(params.user);
  const preset = HOME_ROLE_PRESETS[businessRole];
  const parsedSeed = buildRequirementAnalysisReport(params.attachment);
  const completion = await getKimiProvider().chatCompletion({
    model: params.model,
    temperature: 0.2,
    responseFormat: "json_object",
    promptCacheKey: "home-workbench-attachment-analysis-v1",
    timeoutMs: loadRequirementSystemConfigStore().active.kimiEvaluation.timeoutMs || 120000,
    credentialsOverride: { apiKey: params.apiKey, apiBaseUrl: params.apiUrl },
    messages: [
      {
        role: "system",
        content: [
          "你是 WES 工作量评估系统中的售前需求分析 Agent。",
          "你必须基于用户上传文件的完整解析上下文做完整业务理解，而不是只复述字段。",
          preset.prompt,
          `当前工作流：${params.workflowKey || "parse_requirement_file"}`,
          "请只输出 JSON 对象，不要输出 Markdown。",
          "JSON 字段：answer, projectName, customerName, industry, productLines, sourceSheets, needs, modules, missingItems, risks, nextActions, summary。",
          "needs/modules/missingItems/risks/nextActions 必须是字符串数组。",
          "如果解析上下文信息不足，可以填“待补充”，但必须说明为什么缺失以及下一步需要向客户确认什么。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `文件名：${params.attachment.name}`,
          `文件类型：${params.attachment.type || "未知"}`,
          `文件大小：${typeof params.attachment.size === "number" ? params.attachment.size : "未知"}`,
          "",
          "【Excel 解析上下文】",
          asString(params.attachment.parsedSummary),
          "",
          "请完成：",
          "1. 识别项目、客户、行业、业务域和模块线索。",
          "2. 基于业务需求进行初步业务理解和风险假设。",
          "3. 标出缺失/模糊信息，不要假装已经确认。",
          "4. 给出进入澄清和正式评估前的下一步动作。",
        ].join("\n"),
      },
    ],
  });
  const parsed = parseJsonFromText(completion.content);
  const report = {
    ...parsedSeed,
    projectName: pickModelField(parsed, ["projectName", "项目名称", "项目"]) || parsedSeed.projectName,
    customerName: pickModelField(parsed, ["customerName", "客户名称", "客户"]) || parsedSeed.customerName,
    industry: pickModelField(parsed, ["industry", "客户行业", "行业"]) || parsedSeed.industry,
    productLines: pickStringArrayField(parsed, ["productLines", "产品线"]) || parsedSeed.productLines,
    sourceSheets: pickStringArrayField(parsed, ["sourceSheets", "工作表"]) || parsedSeed.sourceSheets,
    needs: pickStringArrayField(parsed, ["needs", "需求识别", "businessNeeds"]) || parsedSeed.needs,
    modules: pickStringArrayField(parsed, ["modules", "模块线索", "moduleClues"]) || parsedSeed.modules,
    missingItems: pickStringArrayField(parsed, ["missingItems", "缺失信息", "待补充信息"]) || parsedSeed.missingItems,
    risks: pickStringArrayField(parsed, ["risks", "风险假设", "riskAssumptions"]) || parsedSeed.risks,
    nextActions: pickStringArrayField(parsed, ["nextActions", "下一步动作"]) || parsedSeed.nextActions,
    summary: pickModelField(parsed, ["summary", "分析摘要"]) || parsedSeed.summary,
  };
  const answer = pickModelField(parsed, ["answer", "回复", "message"]) || "已完成 AI 深度需求分析，并生成《需求解析报告 v1》。";
  return { answer, report, rawContent: completion.rawContent || completion.content };
}
