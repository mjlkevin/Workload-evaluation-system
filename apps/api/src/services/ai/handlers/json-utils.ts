// ============================================================
// O4 搬迁：JSON / 字符串工具（原 workbench-dispatch.service.ts 内部 helper）
// 内容逐字节搬迁，零逻辑变更。
// ============================================================

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function asCleanString(value: unknown, maxLength = 200): string {
  if (value == null || typeof value === "object" || typeof value === "boolean") return "";
  return String(value).trim().slice(0, maxLength);
}

/**
 * 尝试修复被截断的 JSON 文本：关闭未闭合的字符串、方括号和大括号。
 * 用于处理模型因 token 限制输出不完整 JSON 的场景。
 */
function repairJson(text: string): string {
  let repaired = text.trim();
  if (!repaired) return repaired;

  // 1. 用状态机判断末尾是否在字符串内部，若是则补上闭合引号
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < repaired.length; i += 1) {
    const ch = repaired[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\') { escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; }
  }
  if (inString) repaired += '"';

  // 2. 按顺序跟踪未闭合的括号/大括号，生成对应的闭合符
  const closers: string[] = [];
  inString = false;
  escapeNext = false;
  for (let i = 0; i < repaired.length; i += 1) {
    const ch = repaired[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\') { escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') closers.push('}');
    else if (ch === '[') closers.push(']');
    else if (ch === '}') { if (closers.length && closers[closers.length - 1] === '}') closers.pop(); }
    else if (ch === ']') { if (closers.length && closers[closers.length - 1] === ']') closers.pop(); }
  }
  repaired += closers.reverse().join('');

  return repaired;
}

export function parseJsonObject(text: string, tryRepair = false): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return asRecord(parsed);
  } catch {
    if (tryRepair) {
      try {
        const repaired = repairJson(text);
        const parsed = JSON.parse(repaired);
        return asRecord(parsed);
      } catch {
        return null;
      }
    }
    return null;
  }
}
