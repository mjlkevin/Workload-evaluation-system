import { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import PDFDocument from "pdfkit";

import { config } from "../../config/env";
import { asString, round1 } from "../../utils/helpers";
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

const PDF_FONT_PATH = "/Library/Fonts/Arial Unicode.ttf";
const PDF_FONT_BOLD_PATH = "/System/Library/Fonts/STHeiti Medium.ttc";

function drawPdfTable(doc: PDFKit.PDFDocument, rows: string[][], colWidths: number[], startX: number, rowH: number) {
  let y = doc.y;
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  for (const [ri, row] of rows.entries()) {
    if (y + rowH > doc.page.height - doc.page.margins.bottom) { doc.addPage(); y = doc.page.margins.top; }
    let x = startX;
    for (const [ci, cell] of row.entries()) {
      const w = colWidths[ci] ?? 60;
      if (ri === 0) {
        doc.font("PdfBold").rect(x, y, w, rowH).fill("#2563EB").fillColor("white").text(cell, x + 4, y + 4, { width: w - 8, height: rowH - 8, align: "center" }).fillColor("black");
      } else {
        doc.font("PdfFont").rect(x, y, w, rowH).fill(ri % 2 === 0 ? "#F3F4F6" : "white").fillColor("black").text(cell, x + 4, y + 4, { width: w - 8, height: rowH - 8, align: ci === 0 || ci >= 3 ? "left" : "center" });
      }
      x += w;
    }
    y += rowH;
  }
  doc.y = y + 8;
}

function wrapPdfText(doc: PDFKit.PDFDocument, text: string, width: number, fontSize: number): string[] {
  doc.font("PdfFont").fontSize(fontSize);
  const lines: string[] = [];
  let cur = "";
  for (const ch of text) {
    const test = cur + ch;
    if (doc.widthOfString(test) > width) { lines.push(cur); cur = ch; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

export async function exportKimiAssessmentPdf(req: Request, res: Response) {
  const body = (req.body || {}) as { assessmentDraft?: Record<string, unknown>; meta?: Record<string, unknown>; projectName?: string; };
  const draft = body.assessmentDraft && typeof body.assessmentDraft === "object" ? (body.assessmentDraft as Record<string, unknown>) : {};
  if (!Object.keys(draft).length) return fail(res, 40001, "参数错误", [{ field: "assessmentDraft", reason: "required" }]);
  const projectName = asString(body.projectName) || "未命名项目";
  const meta = body.meta && typeof body.meta === "object" ? (body.meta as Record<string, unknown>) : {};

  const quoteMode = asString(draft.quoteMode) || "";
  const productLines = (Array.isArray(draft.productLines) ? draft.productLines : []) as string[];
  const userCount = Number(draft.userCount) || 0;
  const orgCount = Number(draft.orgCount) || 0;
  const orgSimilarity = Number(draft.orgSimilarity) || 0;
  const difficultyFactor = Number(draft.difficultyFactor) || 0;
  const moduleItems = (Array.isArray(draft.moduleItems) ? draft.moduleItems : []) as Array<Record<string, unknown>>;
  const risks = (Array.isArray(draft.risks) ? draft.risks : []) as string[];
  const assumptions = (Array.isArray(draft.assumptions) ? draft.assumptions : []) as string[];

  const totalStandardDays = moduleItems.reduce((sum, m) => sum + (Number(m.standardDays) || 0), 0);
  const totalSuggestedDays = moduleItems.reduce((sum, m) => sum + (Number(m.suggestedDays) || 0), 0);
  const modelName = asString(meta.model) || asString(meta.mode) || "—";
  const generatedAt = asString(meta.generatedAt) || "";
  const date = generatedAt ? new Date(generatedAt).toLocaleDateString("zh-CN") : new Date().toLocaleDateString("zh-CN");

  const doc = new PDFDocument({ margin: 44, size: "A4", bufferPages: true });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const pdfPromise = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  try {
    doc.registerFont("PdfFont", PDF_FONT_PATH);
    doc.registerFont("PdfBold", PDF_FONT_PATH);

    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Header
    doc.font("PdfBold").fontSize(20).fillColor("#1E3A5F").text("Kimi 实施评估报告", { align: "center" });
    doc.moveDown(0.4);
    doc.font("PdfFont").fontSize(10).fillColor("#6B7280").text(`${projectName}  |  ${date}`, { align: "center" });
    doc.moveDown(0.8);

    // --- Quote parameters ---
    doc.font("PdfBold").fontSize(13).fillColor("#1E3A5F").text("评估参数");
    doc.moveDown(0.3);
    doc.font("PdfFont").fontSize(10).fillColor("black");
    const metaRows = [
      ["模型/模式", modelName, "报价模式", quoteMode || "—"],
      ["产品线", productLines.join("、") || "—", "用户数", String(userCount)],
      ["组织数", String(orgCount), "组织相似度", String(orgSimilarity)],
      ["难度系数", String(difficultyFactor), "模块数", String(moduleItems.length)],
      ["标准人天合计", String(round1(totalStandardDays)), "建议人天合计", String(round1(totalSuggestedDays))],
    ];
    const metaColW = [90, (pageW - 196) / 2, 90, (pageW - 196) / 2];
    let rowY = doc.y;
    for (const [ri, row] of metaRows.entries()) {
      let x = doc.page.margins.left;
      for (const [ci, cell] of row.entries()) {
        const w = metaColW[ci] ?? 80;
        doc.rect(x, rowY, w, 20).fill(ci === 0 || ci === 2 ? "#E8EDF4" : "#FAFBFC");
        doc.fillColor(ci === 0 || ci === 2 ? "#374151" : "#111827").font(ci === 0 || ci === 2 ? "PdfBold" : "PdfFont").fontSize(9)
          .text(cell, x + 4, rowY + 4, { width: w - 8, height: 12, align: "left" });
        doc.fillColor("black");
        x += w;
      }
      rowY += 20;
    }
    doc.y = rowY + 12;

    // --- Module items table ---
    if (moduleItems.length > 0) {
      doc.font("PdfBold").fontSize(13).fillColor("#1E3A5F").text("模块明细");
      doc.moveDown(0.4);
      const tblColW = [84, 84, 56, 60, pageW - 84 - 84 - 56 - 60 - 72, 72];
      const tblRows: string[][] = [["云产品", "SKU", "标准人天", "建议人天", "评估理由", "差异"]];
      for (const item of moduleItems) {
        const sd = Number(item.standardDays) || 0;
        const sg = Number(item.suggestedDays) || 0;
        const diff = round1(sd - sg);
        tblRows.push([
          asString(item.cloudProduct) || "—",
          asString(item.skuName || item.moduleName) || "—",
          String(round1(sd)),
          String(round1(sg)),
          asString(item.reason) || "—",
          diff > 0 ? `+${diff}` : String(diff),
        ]);
      }
      drawPdfTable(doc, tblRows, tblColW, doc.page.margins.left, 26);
    }

    // --- Risks ---
    doc.moveDown(0.6);
    doc.font("PdfBold").fontSize(13).fillColor("#1E3A5F").text("风险提示");
    doc.moveDown(0.3);
    doc.font("PdfFont").fontSize(10).fillColor("black");
    if (risks.length > 0) {
      for (let i = 0; i < risks.length; i++) {
        const r = risks[i];
        const lines = wrapPdfText(doc, `${i + 1}. ${r}`, pageW, 10);
        for (const line of lines) {
          if (doc.y + 16 > doc.page.height - doc.page.margins.bottom) doc.addPage();
          doc.text(line, { indent: 0, lineBreak: false });
          doc.y += 16;
        }
      }
    } else {
      doc.fillColor("#9CA3AF").text("暂无识别风险"); doc.fillColor("black"); doc.y += 16;
    }

    // --- Assumptions ---
    doc.moveDown(0.4);
    doc.font("PdfBold").fontSize(13).fillColor("#1E3A5F").text("前提假设");
    doc.moveDown(0.3);
    doc.font("PdfFont").fontSize(10).fillColor("black");
    if (assumptions.length > 0) {
      for (let i = 0; i < assumptions.length; i++) {
        const a = assumptions[i];
        const lines = wrapPdfText(doc, `${i + 1}. ${a}`, pageW, 10);
        for (const line of lines) {
          if (doc.y + 16 > doc.page.height - doc.page.margins.bottom) doc.addPage();
          doc.text(line, { indent: 0, lineBreak: false });
          doc.y += 16;
        }
      }
    } else {
      doc.fillColor("#9CA3AF").text("暂无假设"); doc.fillColor("black"); doc.y += 16;
    }

    // Footer on each page
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.font("PdfFont").fontSize(8).fillColor("#9CA3AF")
        .text(`Kimi 实施评估报告 — ${projectName}  |  ${i + 1}/${pages.count}`, doc.page.margins.left, doc.page.height - 32, { align: "center", width: pageW });
    }

    doc.end();
    const pdfBuffer = await pdfPromise;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="kimi-assessment-${dateStr}.pdf"; filename*=UTF-8''${encodeURIComponent(`Kimi评估报告-${projectName}-${dateStr}.pdf`)}`);
    res.status(200).send(pdfBuffer);
  } catch (err) {
    if (!res.headersSent) {
      return fail(res, 50001, "PDF生成失败", [{ field: "pdf", reason: err instanceof Error ? err.message : "unknown" }]);
    }
  }
}

export { estimateFallbackAssessmentDraft, normalizeKimiAssessmentDraft, buildCloudSkuModuleItemsFromSnapshot, mergeDevTotalModuleItem, generateAssessmentDraftByKimi, parseJsonFromModelText, snapshotHasProductModuleGrid };
