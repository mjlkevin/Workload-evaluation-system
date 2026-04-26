import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

import { config } from "../../config/env";
import { asString } from "../../utils/helpers";
import { normalizeKimiModelName } from "../../utils/model-name";
import { ok, fail } from "../../utils/response";
import { loadRequirementSystemConfigStore, resolveActiveRequirementKimiApiKey } from "../../modules/system/system.repository";
import { buildKimiAssessmentDraftMarkdown } from "../../utils/kimi-assessment-markdown";
import {
  estimateFallbackAssessmentDraft,
  normalizeKimiAssessmentDraft,
  buildCloudSkuModuleItemsFromSnapshot,
  mergeDevTotalModuleItem,
  generateAssessmentDraftByKimi,
  parseJsonFromModelText,
  snapshotHasProductModuleGrid,
  type KimiAssessmentPreviewInput,
  type KimiAssessmentSnapshot,
  type KimiAssessmentDraft,
} from "../ai-assessment";

function asModelObject(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}; }

export async function kimiAssessmentPreview(req: Request, res: Response) {
  const requestId = randomUUID();
  const body = (req.body || {}) as KimiAssessmentPreviewInput;
  const snapshot = asModelObject(body.requirementSnapshot) as KimiAssessmentSnapshot;
  const source = asModelObject(body.source);
  const globalVersionCode = asString(source.globalVersionCode);
  const requirementVersionCode = asString(source.requirementVersionCode);
  if (!snapshot || Object.keys(snapshot).length === 0) return fail(res, 40001, "参数错误", [{ field: "requirementSnapshot", reason: "required" }]);
  const fallbackDraft = estimateFallbackAssessmentDraft(snapshot);
  const fallbackCloudSku = buildCloudSkuModuleItemsFromSnapshot(snapshot, fallbackDraft);
  const fallbackDraftAligned: KimiAssessmentDraft = { ...fallbackDraft, moduleItems: mergeDevTotalModuleItem(fallbackCloudSku.items, snapshot) };
  const { apiKey } = resolveActiveRequirementKimiApiKey();
  const model = config.kimi.model;
  const modelForClient = normalizeKimiModelName(model);
  const requirementSettings = loadRequirementSystemConfigStore().active;
  const promptProfile = asString(asModelObject(body.ruleContext).promptProfile) || asString(requirementSettings.kimiEvaluation.promptProfile) || "assessment_default_v1";
  const promptTemplate = asString(requirementSettings.kimiEvaluation.promptTemplate) || "你是资深项目经理 + 资深实施顾问。你不是做简单 SKU 对照，而是要基于需求全量信息做综合实施评估。必须只返回 JSON。";
  const startedAt = Date.now();
  if (!apiKey) return res.json(ok({ meta: { model: "rule-fallback", generatedAt: new Date().toISOString(), confidence: 0.62, promptVersion: promptProfile, ruleSetId: "fallback-rules-v1", mode: "rule_fallback", fallbackReason: "api_key_missing", elapsedMs: Date.now() - startedAt, coarseFilteredCount: fallbackCloudSku.coarseFilteredCount }, source: { globalVersionCode, requirementVersionCode }, assessmentDraft: fallbackDraftAligned }, requestId));
  try { const result = await generateAssessmentDraftByKimi({ apiUrl: config.kimi.apiBaseUrl, apiKey, model, promptTemplate, payload: body, fallback: fallbackDraftAligned, timeoutMs: requirementSettings.kimiEvaluation.timeoutMs || 120000 }); const alignedCloudSku = buildCloudSkuModuleItemsFromSnapshot(snapshot, result.draft); const alignedDraft: KimiAssessmentDraft = { ...result.draft, moduleItems: mergeDevTotalModuleItem(alignedCloudSku.items, snapshot) }; return res.json(ok({ meta: { model: modelForClient, generatedAt: new Date().toISOString(), confidence: 0.78, promptVersion: promptProfile, ruleSetId: "assessment-rules-v1", mode: "model", fallbackReason: "", elapsedMs: Date.now() - startedAt, rawContent: result.rawContent, coarseFilteredCount: alignedCloudSku.coarseFilteredCount }, source: { globalVersionCode, requirementVersionCode }, assessmentDraft: alignedDraft }, requestId)); } catch (err) { const fallbackReason = err instanceof Error ? err.message : "model_generate_failed"; return res.json(ok({ meta: { model: "rule-fallback", generatedAt: new Date().toISOString(), confidence: 0.62, promptVersion: promptProfile, ruleSetId: "fallback-rules-v1", mode: "rule_fallback", fallbackReason, elapsedMs: Date.now() - startedAt, coarseFilteredCount: fallbackCloudSku.coarseFilteredCount }, source: { globalVersionCode, requirementVersionCode }, assessmentDraft: fallbackDraftAligned }, requestId)); }
}

export async function exportKimiAssessmentMarkdown(req: Request, res: Response) {
  const body = (req.body || {}) as { assessmentDraft?: Record<string, unknown>; meta?: Record<string, unknown>; projectName?: string; };
  const draft = body.assessmentDraft && typeof body.assessmentDraft === "object" ? (body.assessmentDraft as Record<string, unknown>) : {};
  if (!Object.keys(draft).length) return fail(res, 40001, "参数错误", [{ field: "assessmentDraft", reason: "required" }]);
  const meta = body.meta && typeof body.meta === "object" ? (body.meta as Record<string, unknown>) : {};
  const md = buildKimiAssessmentDraftMarkdown({ projectName: asString(body.projectName), assessmentDraft: draft, meta });
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="kimi-assessment-draft-${date}.md"; filename*=UTF-8''${encodeURIComponent(`Kimi评估草稿-${date}.md`)}`);
  res.status(200).send(md);
}

export { estimateFallbackAssessmentDraft, normalizeKimiAssessmentDraft, buildCloudSkuModuleItemsFromSnapshot, mergeDevTotalModuleItem, generateAssessmentDraftByKimi, parseJsonFromModelText, snapshotHasProductModuleGrid };
