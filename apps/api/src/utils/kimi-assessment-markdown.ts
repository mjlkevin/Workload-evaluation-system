// ============================================================
// Kimi 评估草稿 → Markdown（供外部 Agent 下载后转 PDF 或直接发送）
// ============================================================

import { asString } from "./helpers";

function escCell(value: unknown): string {
  return asString(value).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

export function buildKimiAssessmentDraftMarkdown(params: {
  projectName?: string;
  assessmentDraft: Record<string, unknown>;
  meta?: Record<string, unknown>;
}): string {
  const draft = params.assessmentDraft || {};
  const meta = params.meta || {};
  const moduleItems = Array.isArray(draft.moduleItems) ? (draft.moduleItems as unknown[]) : [];
  const risks = Array.isArray(draft.risks) ? (draft.risks as unknown[]) : [];
  const assumptions = Array.isArray(draft.assumptions) ? (draft.assumptions as unknown[]) : [];

  const lines: string[] = [];
  const title = params.projectName?.trim() ? `Kimi 实施评估草稿 — ${params.projectName.trim()}` : "Kimi 实施评估草稿";
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`- **生成时间**：${asString(meta.generatedAt) || new Date().toISOString()}`);
  lines.push(`- **模式**：${asString(meta.mode) || "—"}`);
  lines.push(`- **模型**：${asString(meta.model) || "—"}`);
  lines.push(`- **置信度**：${typeof meta.confidence === "number" ? Math.round(meta.confidence * 100) : "—"}%`);
  lines.push(`- **规则集**：${asString(meta.ruleSetId) || "—"}`);
  lines.push("");

  lines.push("## 报价参数");
  lines.push("");
  lines.push(`| 字段 | 值 |`);
  lines.push(`| --- | --- |`);
  lines.push(`| 报价模式 | ${escCell(draft.quoteMode)} |`);
  lines.push(`| 用户数 | ${escCell(draft.userCount)} |`);
  lines.push(`| 组织数 | ${escCell(draft.orgCount)} |`);
  lines.push(`| 组织相似度 | ${escCell(draft.orgSimilarity)} |`);
  lines.push(`| 难度系数 | ${escCell(draft.difficultyFactor)} |`);
  const pl = Array.isArray(draft.productLines) ? (draft.productLines as unknown[]).map((x) => asString(x)).filter(Boolean) : [];
  lines.push(`| 产品线 | ${escCell(pl.join(" / ") || "—")} |`);
  lines.push("");

  lines.push("## 模块估算建议");
  lines.push("");
  lines.push("| 云产品 | SKU | 标准人天 | 建议人天 | 原因 |");
  lines.push("| --- | --- | ---: | ---: | --- |");
  for (const raw of moduleItems) {
    const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    lines.push(
      `| ${escCell(row.cloudProduct)} | ${escCell(row.skuName || row.moduleName)} | ${escCell(row.standardDays)} | ${escCell(row.suggestedDays)} | ${escCell(row.reason)} |`,
    );
  }
  if (!moduleItems.length) {
    lines.push("| — | — | — | — | 暂无模块行 |");
  }
  lines.push("");

  lines.push("## 风险提示");
  lines.push("");
  risks.forEach((r, i) => {
    lines.push(`${i + 1}. ${asString(r)}`);
  });
  if (!risks.length) lines.push("_无_");
  lines.push("");

  lines.push("## 前提假设");
  lines.push("");
  assumptions.forEach((a, i) => {
    lines.push(`${i + 1}. ${asString(a)}`);
  });
  if (!assumptions.length) lines.push("_无_");
  lines.push("");

  lines.push("---");
  lines.push("_本文档由 Workload API 生成，可由 Agent 或用户用打印/工具链转为 PDF。_");
  return lines.join("\n");
}
