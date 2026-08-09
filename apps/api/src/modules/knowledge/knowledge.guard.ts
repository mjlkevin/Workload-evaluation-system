// ============================================================
// SP-2026-007 · MS1（M1 中文混合检索基线）
// knowledge.guard — 三重预算护栏（条目数 / 字符预算 / 超时）
// 默认口径移植自 GT-009：8 条 / 6000 字符 / 3s
// ============================================================

import type { GuardOptions, GuardReport, KnowledgeEntry, RankedHit } from "./knowledge.types";

export const DEFAULT_GUARD: GuardOptions = {
  maxItems: 8,
  charBudget: 6000,
  timeoutMs: 3000,
};

interface ScoredEntry {
  entry: KnowledgeEntry;
  score: number;
}

/**
 * 条目数 + 字符预算双重截断，返回护栏留痕。
 * 字符预算按「标题 + 正文」累计，超限后不再纳入后续条目。
 */
export function applyGuard(
  results: ScoredEntry[],
  options: GuardOptions = DEFAULT_GUARD,
): { items: ScoredEntry[] } & Omit<GuardReport, "timedOut"> {
  const items: ScoredEntry[] = [];
  let totalChars = 0;
  let truncatedBy: GuardReport["truncatedBy"] = null;

  for (const result of results) {
    if (items.length >= options.maxItems) {
      truncatedBy = "maxItems";
      break;
    }
    const size = result.entry.title.length + result.entry.content.length;
    if (totalChars + size > options.charBudget) {
      truncatedBy = "charBudget";
      break;
    }
    totalChars += size;
    items.push(result);
  }

  return {
    items,
    truncatedBy,
    droppedCount: results.length - items.length,
    totalChars,
  };
}

/**
 * 超时护栏：检索超时降级为空结果并留痕，不阻塞调用方。
 */
export async function searchWithTimeout(
  searchFn: () => Promise<RankedHit[]>,
  timeoutMs: number,
): Promise<{ items: RankedHit[]; timedOut: boolean }> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const result = await Promise.race([searchFn(), timeout]);
    if (result === null) return { items: [], timedOut: true };
    return { items: result, timedOut: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
