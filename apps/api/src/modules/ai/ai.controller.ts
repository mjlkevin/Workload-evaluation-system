// ============================================================
// O9 · AI Controller — HTTP 适配层
// ============================================================
// 职责：从 Express req 提取参数，调用 aiUsecase，格式化 res。
// 流式/复杂操作直接委托 services/ai/ handler（禁止碰实现 §3.4）。
// 契约零变更：URL / 请求体 / 响应体与 base 完全一致。
// ============================================================

import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

import { config } from "../../config/env";
import { asString } from "../../utils/helpers";
import { normalizeKimiModelName } from "../../utils/model-name";
import { ok, fail } from "../../utils/response";

import { aiUsecase } from "./ai.usecase";

class AiController {
  // === 基础对话（完整提取） ===

  async chat(req: Request, res: Response) {
    const requestId = randomUUID();
    const body = (req.body || {}) as { messages?: Array<{ role?: string; content?: string }> };
    const messages = Array.isArray(body.messages) ? body.messages : [];

    const result = await aiUsecase.chat({ messages });

    if ("error" in result) {
      return fail(res, 40001, "参数错误", [result.error]);
    }
    return res.json(ok({ answer: result.answer, model: result.model }, requestId));
  }

  // === 企业画像摘要（完整提取） ===

  async companyProfileSummary(req: Request, res: Response) {
    const requestId = randomUUID();
    const body = (req.body || {}) as {
      customerName?: string;
      location?: string;
      customerIndustry?: string;
      enterpriseRevenue?: string;
      itStatus?: string;
      disambiguationChoice?: { displayName?: string; summary?: string };
    };

    const result = await aiUsecase.companyProfileSummary({
      customerName: body.customerName,
      location: body.location,
      customerIndustry: body.customerIndustry,
      enterpriseRevenue: body.enterpriseRevenue,
      itStatus: body.itStatus,
      disambiguationChoice: body.disambiguationChoice,
    });

    if ("error" in result) {
      return fail(res, 40001, "参数错误", [result.error]);
    }

    if (result.kind === "fallback") {
      return res.json(ok({
        customerName: result.customerName,
        enterpriseProfile: result.enterpriseProfile,
        location: result.location,
        customerIndustry: result.customerIndustry,
        enterpriseRevenue: result.enterpriseRevenue,
        itStatus: result.itStatus,
        model: "rule-fallback",
        mode: "rule_fallback",
        fallbackReason: "api_key_missing",
        rawContent: "",
      }, requestId));
    }

    if (result.kind === "disambiguation") {
      return res.json(ok({
        customerName: result.customerName,
        enterpriseProfile: "",
        location: "",
        customerIndustry: "",
        enterpriseRevenue: "",
        itStatus: "",
        model: normalizeKimiModelName(config.kimi.model),
        mode: "disambiguation",
        fallbackReason: "",
        rawContent: result.rawContent,
        disambiguationCandidates: result.candidates,
      }, requestId));
    }

    // kind === "profile"
    return res.json(ok({
      customerName: result.customerName,
      enterpriseProfile: result.enterpriseProfile,
      location: result.location,
      customerIndustry: result.customerIndustry,
      enterpriseRevenue: result.enterpriseRevenue,
      itStatus: result.itStatus,
      model: normalizeKimiModelName(config.kimi.model),
      mode: "model",
      fallbackReason: "",
      rawContent: result.rawContent,
    }, requestId));
  }

  // === Kimi 评估预览（完整提取） ===

  async kimiAssessmentPreview(req: Request, res: Response) {
    const requestId = randomUUID();
    const body = (req.body || {}) as {
      requirementSnapshot?: Record<string, unknown>;
      source?: Record<string, unknown>;
      ruleContext?: Record<string, unknown>;
    };

    const result = await aiUsecase.kimiAssessmentPreview({
      requirementSnapshot: body.requirementSnapshot,
      source: body.source,
      ruleContext: body.ruleContext,
    });

    if ("error" in result) {
      return fail(res, 40001, "参数错误", [result.error]);
    }
    return res.json(ok({
      meta: result.meta,
      source: result.source,
      assessmentDraft: result.assessmentDraft,
    }, requestId));
  }

  // === 导出 Markdown（完整提取） ===

  async exportKimiAssessmentMarkdown(req: Request, res: Response) {
    const body = (req.body || {}) as {
      assessmentDraft?: Record<string, unknown>;
      meta?: Record<string, unknown>;
      projectName?: string;
    };

    const result = aiUsecase.buildAssessmentMarkdown({
      assessmentDraft: body.assessmentDraft,
      meta: body.meta,
      projectName: body.projectName,
    });

    if ("error" in result) {
      return fail(res, 40001, "参数错误", [result.error]);
    }

    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="kimi-assessment-draft-${date}.md"; filename*=UTF-8''${encodeURIComponent(`Kimi评估草稿-${date}.md`)}`);
    res.status(200).send(result.markdown);
  }

  // === 委托：流式/复杂操作（禁止碰实现 §3.4） ===
  // 以下方法直接引用 services/ai/ 的 Express handler，
  // 不经过 usecase 逻辑，保证流式通道和复杂解析行为零变更。

  parseBasicInfo = aiUsecase.parseBasicInfoHandler;
  parseBasicInfoStream = aiUsecase.parseBasicInfoStreamHandler;
  exportKimiAssessmentPdf = aiUsecase.exportKimiAssessmentPdfHandler;
  homeWorkbenchChat = aiUsecase.homeWorkbenchChatHandler;
  homeWorkbenchChatStream = aiUsecase.homeWorkbenchChatStreamHandler;
}

export const aiController = new AiController();
