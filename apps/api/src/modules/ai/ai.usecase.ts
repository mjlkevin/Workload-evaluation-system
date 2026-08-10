// ============================================================
// O9 · AI Usecase — 业务编排层
// ============================================================
// 职责：意图路由、handler 调度、流式/非流式分支。
// - chat / companyProfileSummary / kimiAssessmentPreview / buildAssessmentMarkdown：
//   业务逻辑完整提取至本层，controller 仅做 HTTP 适配。
// - parseBasicInfo / parseBasicInfoStream / homeWorkbenchChat / homeWorkbenchChatStream /
//   exportKimiAssessmentPdf：流式或复杂操作，禁止碰实现（§3.4），
//   通过 handler 引用委托给 services/ai/，controller 直接使用。
// ============================================================

import { config } from "../../config/env";
import { asString, round1 } from "../../utils/helpers";
import { normalizeKimiModelName } from "../../utils/model-name";
import { getKimiProvider, asModelObject, pickModelField } from "../../services/ai/handlers/workbench-shared";
import { buildKimiAssessmentDraftMarkdown } from "../../utils/kimi-assessment-markdown";
import {
  estimateFallbackAssessmentDraft,
  buildCloudSkuModuleItemsFromSnapshot,
  mergeDevTotalModuleItem,
  generateAssessmentDraftByKimi,
  type KimiAssessmentPreviewInput,
  type KimiAssessmentSnapshot,
  type KimiAssessmentDraft,
} from "../../services/ai-assessment";

// 委托 handler 引用（流式/复杂操作，禁止碰实现）
import { parseBasicInfo, parseBasicInfoStream } from "../../services/ai/extractor.service";
import { homeWorkbenchChat, homeWorkbenchChatStream } from "../../services/ai/chat.service";
import { exportKimiAssessmentPdf } from "../../services/ai/assessment.service";
import type { Request, Response } from "express";

import { aiRepository } from "./ai.repository";

// ─── 类型定义 ──────────────────────────────────────────────

type ValidationError = { field: string; reason: string };

type ChatInput = {
  messages: Array<{ role?: string; content?: string }>;
};

type ChatResult =
  | { error: ValidationError }
  | { answer: string; model: string; rawContent: string };

type CompanyProfileInput = {
  customerName?: string;
  location?: string;
  customerIndustry?: string;
  enterpriseRevenue?: string;
  itStatus?: string;
  disambiguationChoice?: { displayName?: string; summary?: string };
};

type CompanyProfileResult =
  | { error: ValidationError }
  | { kind: "fallback"; customerName: string; enterpriseProfile: string; location: string; customerIndustry: string; enterpriseRevenue: string; itStatus: string }
  | { kind: "disambiguation"; customerName: string; rawContent: string; candidates: Array<{ id: string; displayName: string; summary: string }> }
  | { kind: "profile"; customerName: string; enterpriseProfile: string; location: string; customerIndustry: string; enterpriseRevenue: string; itStatus: string; rawContent: string };

type AssessmentPreviewInput = {
  requirementSnapshot?: Record<string, unknown>;
  source?: Record<string, unknown>;
  ruleContext?: Record<string, unknown>;
};

type AssessmentPreviewResult =
  | { error: ValidationError }
  | { meta: Record<string, unknown>; source: { globalVersionCode: string; requirementVersionCode: string }; assessmentDraft: KimiAssessmentDraft };

type MarkdownExportInput = {
  assessmentDraft?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  projectName?: string;
};

type MarkdownExportResult =
  | { error: ValidationError }
  | { markdown: string };

// ─── 辅助函数（从 company-profile.handler.ts 复制，行为零变更） ────

function asModelObjectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asModelObject).filter((x) => Object.keys(x).length > 0) : [];
}
function jsonTruth(value: unknown): boolean {
  return value === true || (typeof value === "string" && /^(true|yes|1|需要|是)$/i.test(value.trim()));
}

function pickCompanyProfileField(parsed: Record<string, unknown>, keys: string[]): string {
  const direct = pickModelField(parsed, keys);
  if (direct) return direct;
  for (const nk of ["data", "company", "basicInfo", "result", "payload", "output", "summary"]) {
    const v = pickModelField(asModelObject(parsed[nk]), keys);
    if (v) return v;
  }
  return "";
}

function normalizeCompanyProfileDisambiguationCandidates(parsed: Record<string, unknown>): Array<{ displayName: string; summary: string }> {
  const arr = asModelObjectArray(parsed.candidates ?? parsed.options ?? parsed.choices ?? parsed.entities);
  const out: Array<{ displayName: string; summary: string }> = [];
  for (const item of arr) {
    const displayName = pickModelField(item, ["displayName", "name", "title", "companyName", "企业名称", "主体名称", "法定名称"]);
    const summary = pickModelField(item, ["summary", "brief", "description", "detail", "区别说明", "区分", "线索"]);
    if (!displayName.trim()) continue;
    out.push({ displayName: displayName.trim(), summary: (summary || "").trim() || "（暂无区分说明）" });
    if (out.length >= 3) break;
  }
  return out;
}

async function summarizeCompanyProfileByKimi(params: {
  apiUrl: string; apiKey: string; model: string; customerName: string;
  location?: string; customerIndustry?: string; enterpriseRevenue?: string; itStatus?: string;
  timeoutMs: number; disambiguationChoice?: { displayName: string; summary?: string };
}) {
  const knownContextLines = [
    `客户名称：${params.customerName}`,
    params.location ? `已知地点：${params.location}` : "",
    params.customerIndustry ? `已知行业：${params.customerIndustry}` : "",
    params.enterpriseRevenue ? `已知规模/营收：${params.enterpriseRevenue}` : "",
    params.itStatus ? `已知信息化现状：${params.itStatus}` : "",
  ].filter(Boolean);

  const resolutionIntro = params.disambiguationChoice
    ? `【已选主体】用户已确认本次企业画像的唯一目标主体为「${params.disambiguationChoice.displayName}」。区分线索：${(params.disambiguationChoice.summary || "").trim() || "无"}。\n你必须以该主体为目标输出：needsDisambiguation=false、candidates=[]，并完整填充 enterpriseProfile 等五个字段。禁止再次输出待选列表或要求用户选择。\n\n`
    : "";

  const completion = await getKimiProvider().chatCompletion({
    model: params.model,
    temperature: 0.1,
    responseFormat: "json_object",
    promptCacheKey: "company-profile-summary-v1",
    timeoutMs: params.timeoutMs,
    credentialsOverride: { apiKey: params.apiKey, apiBaseUrl: params.apiUrl },
    messages: [
      { role: "system", content: "你是企业经营分析与信息摘要助手。请只输出 JSON 对象，不要输出任何解释文字。\n\n【消歧】顶层必须包含 needsDisambiguation（布尔）与 candidates（数组，可为空）。" },
      { role: "user", content: resolutionIntro + `请根据客户名称与已知信息，输出企业画像 JSON。\n\n已知信息：\n${knownContextLines.join("\n")}` },
    ],
  });

  const parsed = JSON.parse(completion.content || "{}") as Record<string, unknown>;

  if (!params.disambiguationChoice) {
    const needs = jsonTruth(parsed.needsDisambiguation) || jsonTruth(parsed.needDisambiguation) || jsonTruth(parsed.disambiguation);
    const candidates = normalizeCompanyProfileDisambiguationCandidates(parsed);
    if (needs && candidates.length > 0) {
      return { kind: "disambiguation" as const, candidates: candidates.map((c, idx) => ({ id: String(idx + 1), ...c })), rawContent: completion.content };
    }
  }

  return {
    kind: "profile" as const,
    enterpriseProfile: pickCompanyProfileField(parsed, ["enterpriseProfile", "企业简介"]) || `${params.customerName}：待补充。`,
    location: pickCompanyProfileField(parsed, ["location", "地点", "所在地区", "地区", "城市"]) || asString(params.location) || "待补充地点",
    customerIndustry: pickCompanyProfileField(parsed, ["customerIndustry", "客户行业", "行业"]) || asString(params.customerIndustry) || "L 租赁和商务服务业 > 72 商务服务业 > 729 其他商务服务业 > 7299 其他未列明商务服务业",
    enterpriseRevenue: pickCompanyProfileField(parsed, ["enterpriseRevenue", "企业营收", "营收"]) || asString(params.enterpriseRevenue) || "未公开",
    itStatus: pickCompanyProfileField(parsed, ["itStatus", "信息化现状", "数字化现状", "信息化"]) || asString(params.itStatus) || "信息有限",
    rawContent: completion.content,
  };
}

// ─── Usecase 类 ────────────────────────────────────────────

class AiUsecase {
  // === 数据访问（通过 repository） ===

  /** 加载需求评估配置 */
  getRequirementSettings() {
    return aiRepository.loadRequirementSettings().active;
  }

  /** 解析 API Key（代理 repository，不持有明文） */
  getApiKey(): { apiKey: string } {
    return aiRepository.resolveApiKey();
  }

  // === 完整提取：基础对话 ===

  async chat(input: ChatInput): Promise<ChatResult> {
    const messages = (Array.isArray(input.messages) ? input.messages : [])
      .map((item) => ({
        role: asString(item?.role) === "assistant" ? "assistant" as const : "user" as const,
        content: asString(item?.content),
      }))
      .filter((item) => item.content);

    if (messages.length === 0) {
      return { error: { field: "messages", reason: "required" } };
    }

    const apiKey = config.kimi.apiKey;
    if (!apiKey) {
      return { error: { field: "apiKey", reason: "required_or_env_missing" } };
    }

    try {
      const safeMessages = messages
        .map((item) => ({ role: item.role, content: asString(item.content) }))
        .filter((item) => item.content);

      const completion = await getKimiProvider().chatCompletion({
        model: config.kimi.model,
        temperature: 0.3,
        promptCacheKey: "kimi-basic-chat-v1",
        credentialsOverride: { apiKey, apiBaseUrl: config.kimi.apiBaseUrl },
        messages: [
          { role: "system", content: "你是工作量评估系统内置助手（KIMI）。请用中文简洁回答，优先结合用户上下文，避免冗余。" },
          ...safeMessages.slice(-12),
        ],
      });

      return {
        answer: completion.content,
        model: normalizeKimiModelName(config.kimi.model),
        rawContent: completion.rawContent,
      };
    } catch (err) {
      return { error: { field: "messages/api", reason: err instanceof Error ? err.message : "chat_failed" } };
    }
  }

  // === 完整提取：企业画像摘要 ===

  async companyProfileSummary(input: CompanyProfileInput): Promise<CompanyProfileResult> {
    const customerName = asString(input.customerName);
    if (!customerName) {
      return { error: { field: "customerName", reason: "required" } };
    }

    const choiceObj = asModelObject(input.disambiguationChoice);
    const disambiguationChoice = Object.keys(choiceObj).length
      ? { displayName: asString(choiceObj.displayName).trim(), summary: asString(choiceObj.summary).trim() }
      : undefined;

    if (disambiguationChoice && !disambiguationChoice.displayName) {
      return { error: { field: "disambiguationChoice.displayName", reason: "required" } };
    }

    const { apiKey } = this.getApiKey();
    if (!apiKey) {
      return {
        kind: "fallback",
        customerName,
        enterpriseProfile: "待补充",
        location: "待补充地点",
        customerIndustry: "L 租赁和商务服务业 > 72 商务服务业 > 729 其他商务服务业 > 7299 其他未列明商务服务业",
        enterpriseRevenue: "未公开",
        itStatus: "信息有限",
      };
    }

    try {
      const requirementSettings = this.getRequirementSettings();
      const parsed = await summarizeCompanyProfileByKimi({
        apiUrl: config.kimi.apiBaseUrl,
        apiKey,
        model: config.kimi.model,
        customerName,
        location: asString(input.location),
        customerIndustry: asString(input.customerIndustry),
        enterpriseRevenue: asString(input.enterpriseRevenue),
        itStatus: asString(input.itStatus),
        timeoutMs: requirementSettings.kimiEvaluation.timeoutMs || 120000,
        disambiguationChoice: disambiguationChoice
          ? { displayName: disambiguationChoice.displayName, summary: disambiguationChoice.summary }
          : undefined,
      });

      if (parsed.kind === "disambiguation") {
        return {
          kind: "disambiguation",
          customerName,
          rawContent: parsed.rawContent,
          candidates: parsed.candidates,
        };
      }

      return {
        kind: "profile",
        customerName,
        enterpriseProfile: parsed.enterpriseProfile,
        location: parsed.location,
        customerIndustry: parsed.customerIndustry,
        enterpriseRevenue: parsed.enterpriseRevenue,
        itStatus: parsed.itStatus,
        rawContent: parsed.rawContent,
      };
    } catch (err) {
      return { error: { field: "messages/api", reason: err instanceof Error ? err.message : "summary_failed" } };
    }
  }

  // === 完整提取：Kimi 评估预览 ===

  async kimiAssessmentPreview(input: AssessmentPreviewInput): Promise<AssessmentPreviewResult> {
    const snapshot = asModelObject(input.requirementSnapshot) as KimiAssessmentSnapshot;
    if (!snapshot || Object.keys(snapshot).length === 0) {
      return { error: { field: "requirementSnapshot", reason: "required" } };
    }

    const source = asModelObject(input.source);
    const globalVersionCode = asString(source.globalVersionCode);
    const requirementVersionCode = asString(source.requirementVersionCode);

    const fallbackDraft = estimateFallbackAssessmentDraft(snapshot);
    const fallbackCloudSku = buildCloudSkuModuleItemsFromSnapshot(snapshot, fallbackDraft);
    const fallbackDraftAligned: KimiAssessmentDraft = {
      ...fallbackDraft,
      moduleItems: mergeDevTotalModuleItem(fallbackCloudSku.items, snapshot),
    };

    const { apiKey } = this.getApiKey();
    const model = config.kimi.model;
    const modelForClient = normalizeKimiModelName(model);
    const requirementSettings = this.getRequirementSettings();
    const promptProfile = asString(asModelObject(input.ruleContext).promptProfile)
      || asString(requirementSettings.kimiEvaluation.promptProfile)
      || "assessment_default_v1";
    const promptTemplate = asString(requirementSettings.kimiEvaluation.promptTemplate)
      || "你是资深项目经理 + 资深实施顾问。你不是做简单 SKU 对照，而是要基于需求全量信息做综合实施评估。必须只返回 JSON。";

    const startedAt = Date.now();
    if (!apiKey) {
      return { error: { field: "apiKey", reason: "required_or_env_missing" } };
    }

    try {
      const result = await generateAssessmentDraftByKimi({
        apiUrl: config.kimi.apiBaseUrl,
        apiKey,
        model,
        promptTemplate,
        payload: input as KimiAssessmentPreviewInput,
        fallback: fallbackDraftAligned,
        timeoutMs: requirementSettings.kimiEvaluation.timeoutMs || 120000,
        maxTokens: requirementSettings.kimiEvaluation.maxTokens,
      });

      const alignedCloudSku = buildCloudSkuModuleItemsFromSnapshot(snapshot, result.draft);
      const alignedDraft: KimiAssessmentDraft = {
        ...result.draft,
        moduleItems: mergeDevTotalModuleItem(alignedCloudSku.items, snapshot),
      };

      return {
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
          coarseFilteredCount: alignedCloudSku.coarseFilteredCount,
        },
        source: { globalVersionCode, requirementVersionCode },
        assessmentDraft: alignedDraft,
      };
    } catch (err) {
      return { error: { field: "model", reason: err instanceof Error ? err.message : "model_generate_failed" } };
    }
  }

  // === 完整提取：导出 Markdown ===

  buildAssessmentMarkdown(input: MarkdownExportInput): MarkdownExportResult {
    const draft = input.assessmentDraft && typeof input.assessmentDraft === "object"
      ? (input.assessmentDraft as Record<string, unknown>)
      : {};

    if (!Object.keys(draft).length) {
      return { error: { field: "assessmentDraft", reason: "required" } };
    }

    const meta = input.meta && typeof input.meta === "object"
      ? (input.meta as Record<string, unknown>)
      : {};

    const md = buildKimiAssessmentDraftMarkdown({
      projectName: asString(input.projectName),
      assessmentDraft: draft,
      meta,
    });

    return { markdown: md };
  }

  // === 委托：流式/复杂操作（禁止碰实现 §3.4） ===
  // 以下属性暴露 services/ai/ 的 Express handler 引用，
  // controller 直接使用，不经过 usecase 逻辑。

  get parseBasicInfoHandler() { return parseBasicInfo; }
  get parseBasicInfoStreamHandler() { return parseBasicInfoStream; }
  get homeWorkbenchChatHandler() { return homeWorkbenchChat; }
  get homeWorkbenchChatStreamHandler() { return homeWorkbenchChatStream; }
  get exportKimiAssessmentPdfHandler() { return exportKimiAssessmentPdf; }
}

// ─── 向后兼容 re-export ────────────────────────────────────
// modules.handlers.test.ts 等旧测试直接从 ai.usecase 导入 service handler。
// 三层 facade 迁移后，这些导入指向原始 service handler（行为不变）。
// 新代码应通过 aiController / aiUsecase 实例访问。
export { parseBasicInfo, parseBasicInfoStream } from "../../services/ai/extractor.service";
export { homeWorkbenchChat, homeWorkbenchChatStream } from "../../services/ai/chat.service";
export { kimiAssessmentPreview, exportKimiAssessmentMarkdown, exportKimiAssessmentPdf } from "../../services/ai/assessment.service";

export const aiUsecase = new AiUsecase();
