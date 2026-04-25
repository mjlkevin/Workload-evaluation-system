// ============================================================
// DevAssessment AI — 开发评估草稿生成（P2-2 Agent）
// ============================================================
// 为每个开发条目估算编码人天 + 依据。
// 模式：Kimi 调用 → 规则兜底 fallback。

import { defaultProviderRegistry } from "../../ai/provider";
import type { DevAssessmentItem } from "../../db/schema";
import type { DevAssessmentItemInput } from "./dev-assessment";

function getKimiProvider() {
  const provider = defaultProviderRegistry.get("kimi");
  if (!provider) throw new Error("kimi_provider_not_registered");
  return provider;
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function parseJsonFromModelText(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch { /* ignore */ }
  }
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock?.[1]) {
    try {
      return JSON.parse(codeBlock[1].trim()) as Record<string, unknown>;
    } catch { /* ignore */ }
  }
  return null;
}

// ------------------------------------------------------------------
// Prompt 组装
// ------------------------------------------------------------------

function buildSystemPrompt(): string {
  return `你是一名金蝶 ERP 二次开发顾问，擅长评估开发人天。
请根据需求描述和开发类型，为每个条目估算「编码人天」并给出依据。

开发类型说明：
- feature（功能开发）：标准二开插件、单据改造、逻辑扩展
- report（报表开发）：报表设计、数据提取、打印模板
- integration（集成开发）：接口对接、第三方系统打通、数据同步

估算规则：
- 编码人天只计纯开发时间（不含需求规划和测试）
- 需求规划 = 编码人天 × 0.2（自动计算）
- 功能测试 = 编码人天 × 0.4（自动计算）
- 一般功能开发 2~5 天；报表 1~3 天；集成 3~8 天

请严格按以下 JSON 格式输出，不要添加额外说明：
{
  "items": [
    { "index": 0, "codingDays": 3, "basis": "标准单据改造，含校验与反写逻辑" }
  ]
}`;
}

function buildUserPrompt(items: DevAssessmentItemInput[], context?: Record<string, unknown>): string {
  const contextText = context
    ? `【项目上下文】\n${JSON.stringify(context, null, 2)}\n\n`
    : "";

  const itemsText = items
    .map((it, idx) => {
      return `[${idx}] 领域：${it.domain} | 模块：${it.module} | 类型：${it.devType}\n功能说明：${it.description}`;
    })
    .join("\n\n");

  return `${contextText}【待评估开发条目】\n${itemsText}\n\n请输出 JSON。`;
}

// ------------------------------------------------------------------
// Fallback（规则兜底）
// ------------------------------------------------------------------

function fallbackDevAssessmentDraft(items: DevAssessmentItemInput[]): DevAssessmentItem[] {
  return items.map((item) => {
    const descLen = item.description?.length ?? 0;
    let codingDays = 3;
    switch (item.devType) {
      case "feature":
        codingDays = 3;
        if (descLen > 200) codingDays = 5;
        else if (descLen > 100) codingDays = 4;
        break;
      case "report":
        codingDays = 2;
        if (descLen > 150) codingDays = 3;
        break;
      case "integration":
        codingDays = 4;
        if (descLen > 200) codingDays = 7;
        else if (descLen > 100) codingDays = 5;
        break;
    }
    const planningDays = Math.round(codingDays * 0.2 * 10) / 10;
    const testingDays = Math.round(codingDays * 0.4 * 10) / 10;
    const totalDays = Math.round((codingDays + planningDays + testingDays) * 10) / 10;
    return {
      ...item,
      codingDays,
      planningDays,
      testingDays,
      totalDays,
      basis: `基于${item.devType}类型默认基准，结合功能描述长度(${descLen}字)调整`,
    };
  });
}

// ------------------------------------------------------------------
// 归一化 Kimi 输出
// ------------------------------------------------------------------

function normalizeGeneratedItems(
  raw: Record<string, unknown>,
  originalItems: DevAssessmentItemInput[],
): DevAssessmentItem[] {
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  return originalItems.map((orig, idx) => {
    const rawItem = rawItems.find(
      (it: unknown) =>
        it &&
        typeof it === "object" &&
        (it as Record<string, unknown>).index === idx,
    ) as Record<string, unknown> | undefined;

    const codingDays = Math.max(0.5, Number(rawItem?.codingDays) || 3);
    const planningDays = Math.round(codingDays * 0.2 * 10) / 10;
    const testingDays = Math.round(codingDays * 0.4 * 10) / 10;
    const totalDays = Math.round((codingDays + planningDays + testingDays) * 10) / 10;

    return {
      ...orig,
      codingDays,
      planningDays,
      testingDays,
      totalDays,
      basis: asString(rawItem?.basis) || `AI 评估，编码人天 ${codingDays}`,
    };
  });
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

export interface GenerateDevAssessmentDraftResult {
  items: DevAssessmentItem[];
  rawContent?: string;
  usedFallback: boolean;
}

export async function generateDevAssessmentDraft(params: {
  items: DevAssessmentItemInput[];
  contextSnapshot?: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<GenerateDevAssessmentDraftResult> {
  if (!params.items.length) {
    return { items: [], usedFallback: true };
  }

  try {
    const provider = getKimiProvider();
    const system = buildSystemPrompt();
    const user = buildUserPrompt(params.items, params.contextSnapshot);

    const response = await provider.chatCompletion({
      model: "moonshot-v1-8k",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
    });

    const rawText = response.content ?? "";
    const parsed = parseJsonFromModelText(rawText);

    if (parsed && Array.isArray(parsed.items)) {
      return {
        items: normalizeGeneratedItems(parsed, params.items),
        rawContent: rawText,
        usedFallback: false,
      };
    }
  } catch {
    // 任何异常都 fallback
  }

  return {
    items: fallbackDevAssessmentDraft(params.items),
    usedFallback: true,
  };
}
