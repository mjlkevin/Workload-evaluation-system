import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

import { config } from "../../config/env";
import { asString } from "../../utils/helpers";
import { normalizeKimiModelName } from "../../utils/model-name";
import { ok, fail } from "../../utils/response";
import { requireAuth, resolveBusinessRole } from "../../middleware/auth";
import { resolveActiveRequirementKimiApiKey, loadRequirementSystemConfigStore } from "../../modules/system/system.repository";
import type { AuthUser, BusinessRole } from "../../types";
import { defaultProviderRegistry, type ModelProvider } from "../../ai/provider";

function getKimiProvider(): ModelProvider {
  const provider = defaultProviderRegistry.get("kimi");
  if (!provider) throw new Error("kimi_provider_not_registered");
  return provider;
}
function asModelObject(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}; }
function pickModelField(input: Record<string, unknown>, keys: string[]): string { for (const key of keys) { const v = input[key]; if (v == null || typeof v === "boolean" || typeof v === "object") continue; const s = asString(v); if (s) return s; } return ""; }
function asModelObjectArray(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.map(asModelObject).filter((x) => Object.keys(x).length > 0) : []; }
function jsonTruth(value: unknown): boolean { return value === true || (typeof value === "string" && /^(true|yes|1|需要|是)$/i.test(value.trim())); }
function pickCompanyProfileField(parsed: Record<string, unknown>, keys: string[]): string { const direct = pickModelField(parsed, keys); if (direct) return direct; for (const nk of ["data", "company", "basicInfo", "result", "payload", "output", "summary"]) { const v = pickModelField(asModelObject(parsed[nk]), keys); if (v) return v; } return ""; }
function normalizeCompanyProfileDisambiguationCandidates(parsed: Record<string, unknown>): Array<{ displayName: string; summary: string }> { const arr = asModelObjectArray(parsed.candidates ?? parsed.options ?? parsed.choices ?? parsed.entities); const out: Array<{ displayName: string; summary: string }> = []; for (const item of arr) { const displayName = pickModelField(item, ["displayName", "name", "title", "companyName", "企业名称", "主体名称", "法定名称"]); const summary = pickModelField(item, ["summary", "brief", "description", "detail", "区别说明", "区分", "线索"]); if (!displayName.trim()) continue; out.push({ displayName: displayName.trim(), summary: (summary || "").trim() || "（暂无区分说明）" }); if (out.length >= 3) break; } return out; }
async function summarizeCompanyProfileByKimi(params: { apiUrl: string; apiKey: string; model: string; customerName: string; location?: string; customerIndustry?: string; enterpriseRevenue?: string; itStatus?: string; timeoutMs: number; disambiguationChoice?: { displayName: string; summary?: string }; }) {
  const knownContextLines = [`客户名称：${params.customerName}`, params.location ? `已知地点：${params.location}` : "", params.customerIndustry ? `已知行业：${params.customerIndustry}` : "", params.enterpriseRevenue ? `已知规模/营收：${params.enterpriseRevenue}` : "", params.itStatus ? `已知信息化现状：${params.itStatus}` : ""].filter(Boolean);
  const resolutionIntro = params.disambiguationChoice ? `【已选主体】用户已确认本次企业画像的唯一目标主体为「${params.disambiguationChoice.displayName}」。区分线索：${(params.disambiguationChoice.summary || "").trim() || "无"}。\n你必须以该主体为目标输出：needsDisambiguation=false、candidates=[]，并完整填充 enterpriseProfile 等五个字段。禁止再次输出待选列表或要求用户选择。\n\n` : "";
  const completion = await getKimiProvider().chatCompletion({ model: params.model, temperature: 0.1, responseFormat: "json_object", timeoutMs: params.timeoutMs, credentialsOverride: { apiKey: params.apiKey, apiBaseUrl: params.apiUrl }, messages: [{ role: "system", content: "你是企业经营分析与信息摘要助手。请只输出 JSON 对象，不要输出任何解释文字。\n\n【消歧】顶层必须包含 needsDisambiguation（布尔）与 candidates（数组，可为空）。" }, { role: "user", content: resolutionIntro + `请根据客户名称与已知信息，输出企业画像 JSON。\n\n已知信息：\n${knownContextLines.join("\n")}` }] });
  const parsed = JSON.parse(completion.content || "{}") as Record<string, unknown>;
  if (!params.disambiguationChoice) {
    const needs = jsonTruth(parsed.needsDisambiguation) || jsonTruth(parsed.needDisambiguation) || jsonTruth(parsed.disambiguation);
    const candidates = normalizeCompanyProfileDisambiguationCandidates(parsed);
    if (needs && candidates.length > 0) return { kind: "disambiguation", candidates: candidates.map((c, idx) => ({ id: String(idx + 1), ...c })), rawContent: completion.content };
  }
  return { kind: "profile", enterpriseProfile: pickCompanyProfileField(parsed, ["enterpriseProfile", "企业简介"]) || `${params.customerName}：待补充。`, location: pickCompanyProfileField(parsed, ["location", "地点", "所在地区", "地区", "城市"]) || asString(params.location) || "待补充地点", customerIndustry: pickCompanyProfileField(parsed, ["customerIndustry", "客户行业", "行业"]) || asString(params.customerIndustry) || "L 租赁和商务服务业 > 72 商务服务业 > 729 其他商务服务业 > 7299 其他未列明商务服务业", enterpriseRevenue: pickCompanyProfileField(parsed, ["enterpriseRevenue", "企业营收", "营收"]) || asString(params.enterpriseRevenue) || "未公开", itStatus: pickCompanyProfileField(parsed, ["itStatus", "信息化现状", "数字化现状", "信息化"]) || asString(params.itStatus) || "信息有限", rawContent: completion.content };
}
async function chatWithKimi(params: { apiUrl: string; apiKey: string; model: string; messages: Array<{ role: "user" | "assistant"; content: string }>; }): Promise<{ answer: string; rawContent: string }> { const safeMessages = params.messages.map((item) => ({ role: item.role, content: asString(item.content) })).filter((item) => item.content); const completion = await getKimiProvider().chatCompletion({ model: params.model, temperature: 0.3, credentialsOverride: { apiKey: params.apiKey, apiBaseUrl: params.apiUrl }, messages: [{ role: "system", content: "你是工作量评估系统内置助手（KIMI）。请用中文简洁回答，优先结合用户上下文，避免冗余。" }, ...safeMessages] }); return { answer: completion.content, rawContent: completion.rawContent }; }

const HOME_ROLE_PRESETS: Record<BusinessRole, { label: string; prompt: string }> = {
  sales: { label: "销售员", prompt: "你是销售员的 AI 工作助手。帮助用户从客户资料、会议纪要或口述中识别商机背景、客户痛点、初步需求范围和下一步跟进动作。" },
  pre_sales: { label: "售前顾问", prompt: "你是售前顾问的 AI 工作助手。帮助用户解析 Excel、Word、PDF 或访谈纪要，识别业务需求及问题，生成需求包、模块建议、风险假设和实施评估输入。" },
  delivery: { label: "交付顾问", prompt: "你是交付顾问的 AI 工作助手。帮助用户拉取待详细评估需求包，补充实施范围、人天、复杂度、依赖、风险和交付假设。" },
  pm: { label: "项目经理", prompt: "你是项目经理的 AI 工作助手。帮助用户接力评估包，检查范围、人天、WBS、交付物、项目风险和 PMO 审核准备。" },
  pmo: { label: "PMO", prompt: "你是 PMO 的 AI 工作助手。帮助用户审核交付物齐全性、规范性、方法论完整性，并生成驳回意见或封版检查建议。" },
  dev: { label: "开发顾问", prompt: "你是开发顾问的 AI 工作助手。帮助用户识别开发范围、接口、报表、集成复杂度和技术风险。" },
  admin: { label: "管理视角", prompt: "你是管理员的 AI 工作助手。帮助用户查看全局项目队列、异常流程、角色配置和系统治理建议。" },
};

function normalizeHomeMessages(value: unknown): Array<{ role: "user" | "assistant"; content: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = item && typeof item === "object" ? item as { role?: unknown; content?: unknown } : {};
      return {
        role: asString(record.role) === "assistant" ? "assistant" as const : "user" as const,
        content: asString(record.content),
      };
    })
    .filter((item) => item.content);
}

function currentUserFromRequest(req: Request, res: Response): AuthUser | null {
  if (req.user) return req.user;
  return requireAuth(req, res)?.user || null;
}

async function homeChatWithKimi(params: { apiUrl: string; apiKey: string; model: string; user: AuthUser; workflowKey: string; messages: Array<{ role: "user" | "assistant"; content: string }>; }): Promise<{ answer: string; rawContent: string; businessRole: BusinessRole; roleLabel: string }> {
  const businessRole = resolveBusinessRole(params.user);
  const preset = HOME_ROLE_PRESETS[businessRole];
  const workflowLine = params.workflowKey ? `当前工作流：${params.workflowKey}` : "当前工作流：自由对话";
  const systemPrompt = [
    "你是 WES 工作量评估系统首页 AI 工作台。",
    preset.prompt,
    workflowLine,
    "请用中文回答。回答要面向业务推进，优先给出下一步动作、需要确认的问题和可沉淀到系统的结果。",
    "当前阶段仅支持文本对话；如果用户提到附件或文件，请说明已收到文件意图，并提示后续会进入文件解析流程。",
  ].join("\n");
  const safeMessages = params.messages.slice(-12);
  const completion = await getKimiProvider().chatCompletion({
    model: params.model,
    temperature: 0.3,
    timeoutMs: loadRequirementSystemConfigStore().active.kimiEvaluation.timeoutMs || 120000,
    credentialsOverride: { apiKey: params.apiKey, apiBaseUrl: params.apiUrl },
    messages: [{ role: "system", content: systemPrompt }, ...safeMessages],
  });
  return { answer: completion.content, rawContent: completion.rawContent, businessRole, roleLabel: preset.label };
}

export async function companyProfileSummary(req: Request, res: Response) { const requestId = randomUUID(); const body = (req.body || {}) as { customerName?: string; location?: string; customerIndustry?: string; enterpriseRevenue?: string; itStatus?: string; disambiguationChoice?: { displayName?: string; summary?: string } }; const customerName = asString(body.customerName); if (!customerName) return fail(res, 40001, "参数错误", [{ field: "customerName", reason: "required" }]); const choiceObj = asModelObject(body.disambiguationChoice); const disambiguationChoice = Object.keys(choiceObj).length ? { displayName: asString(choiceObj.displayName).trim(), summary: asString(choiceObj.summary).trim() } : undefined; if (disambiguationChoice && !disambiguationChoice.displayName) return fail(res, 40001, "参数错误", [{ field: "disambiguationChoice.displayName", reason: "required" }]); const { apiKey } = resolveActiveRequirementKimiApiKey(); if (!apiKey) return res.json(ok({ customerName, enterpriseProfile: `待补充`, location: "待补充地点", customerIndustry: "L 租赁和商务服务业 > 72 商务服务业 > 729 其他商务服务业 > 7299 其他未列明商务服务业", enterpriseRevenue: "未公开", itStatus: "信息有限", model: "rule-fallback", mode: "rule_fallback", fallbackReason: "api_key_missing", rawContent: "" }, requestId)); try { const requirementSettings = loadRequirementSystemConfigStore().active; const parsed = await summarizeCompanyProfileByKimi({ apiUrl: config.kimi.apiBaseUrl, apiKey, model: config.kimi.model, customerName, location: asString(body.location), customerIndustry: asString(body.customerIndustry), enterpriseRevenue: asString(body.enterpriseRevenue), itStatus: asString(body.itStatus), timeoutMs: requirementSettings.kimiEvaluation.timeoutMs || 120000, disambiguationChoice: disambiguationChoice ? { displayName: disambiguationChoice.displayName, summary: disambiguationChoice.summary } : undefined }); if (parsed.kind === "disambiguation") return res.json(ok({ customerName, enterpriseProfile: "", location: "", customerIndustry: "", enterpriseRevenue: "", itStatus: "", model: normalizeKimiModelName(config.kimi.model), mode: "disambiguation", fallbackReason: "", rawContent: parsed.rawContent, disambiguationCandidates: parsed.candidates }, requestId)); return res.json(ok({ customerName, enterpriseProfile: parsed.enterpriseProfile, location: parsed.location, customerIndustry: parsed.customerIndustry, enterpriseRevenue: parsed.enterpriseRevenue, itStatus: parsed.itStatus, model: normalizeKimiModelName(config.kimi.model), mode: "model", fallbackReason: "", rawContent: parsed.rawContent }, requestId)); } catch (err) { return fail(res, 40001, "参数错误", [{ field: "messages/api", reason: err instanceof Error ? err.message : "summary_failed" }]); } }

export async function chat(req: Request, res: Response) { const requestId = randomUUID(); const body = (req.body || {}) as { messages?: Array<{ role?: string; content?: string }> }; const messages = Array.isArray(body.messages) ? body.messages.map((item) => ({ role: asString(item?.role) === "assistant" ? "assistant" as const : "user" as const, content: asString(item?.content) })).filter((item) => item.content) : []; if (messages.length === 0) return fail(res, 40001, "参数错误", [{ field: "messages", reason: "required" }]); const apiKey = config.kimi.apiKey; if (!apiKey) return fail(res, 40001, "参数错误", [{ field: "apiKey", reason: "required_or_env_missing" }]); try { const result = await chatWithKimi({ apiUrl: config.kimi.apiBaseUrl, apiKey, model: config.kimi.model, messages: messages.slice(-12) }); return res.json(ok({ answer: result.answer, model: normalizeKimiModelName(config.kimi.model) }, requestId)); } catch (err) { return fail(res, 40001, "参数错误", [{ field: "messages/api", reason: err instanceof Error ? err.message : "chat_failed" }]); } }

export async function homeWorkbenchChat(req: Request, res: Response) {
  const requestId = randomUUID();
  const user = currentUserFromRequest(req, res);
  if (!user) return;

  const body = (req.body || {}) as { messages?: unknown; workflowKey?: unknown };
  const messages = normalizeHomeMessages(body.messages);
  if (messages.length === 0) return fail(res, 40001, "参数错误", [{ field: "messages", reason: "required" }]);

  const { apiKey } = resolveActiveRequirementKimiApiKey();
  if (!apiKey) return fail(res, 40001, "参数错误", [{ field: "apiKey", reason: "required_or_env_missing" }]);

  try {
    const result = await homeChatWithKimi({
      apiUrl: config.kimi.apiBaseUrl,
      apiKey,
      model: config.kimi.model,
      user,
      workflowKey: asString(body.workflowKey),
      messages,
    });
    return res.json(ok({
      answer: result.answer,
      businessRole: result.businessRole,
      roleLabel: result.roleLabel,
      model: normalizeKimiModelName(config.kimi.model),
    }, requestId));
  } catch (err) {
    return fail(res, 40001, "参数错误", [{ field: "messages/api", reason: err instanceof Error ? err.message : "home_workbench_chat_failed" }]);
  }
}
