// ============================================================
// 批次 3 · ①：模型请求的 token 计量
// ============================================================
// 立批前的事实：全仓没有任何一处对模型请求做 token 计量（实取 0 处），上下文窗口
// 只由硬编码的 `slice(-12)` 条数截断决定。本模块是第一个计量口。
//
// 「用与 provider 一致的计法」在本仓可达范围内这样落地（三条，缺一不可）：
//  ① **不按字符数估算**。计数单位是 subword token：按 Unicode 脚本分类后走词片展开
//     ——拉丁词按长度做 BPE 式折分（常见英文约 4 字符/token，长词与 URL 更碎），
//     CJK 按字计（Kimi 系 16 万级词表对汉字基本一字一 token）。
//  ② **算 provider 真正计费的结构**，不只是正文字符：ChatML 每条消息带固定包裹开销
//     与角色 token，tools 的 JSON Schema 同样进 prompt（传了 tools 就要计费），末了
//     再加一条 reply priming。漏掉任一项都会系统性低估。
//  ③ **偏差用 provider 自己的读数校准，而不是靠注释断言**。provider 每次响应都回
//     usage.prompt_tokens——那就是它自己数出来的精确值。本模块把「同一次请求的本地
//     估算 vs provider 实测」记进台账（见 recordProviderUsage），偏差是量出来的、
//     可持续复核的，不是一句口径声明。
//
// 估算方向刻意取**偏保守（宁可高估）**：低估会让请求真的顶到上下文上限，而那正是
// 本批要消灭的失效形态；高估只是提前一点剪枝，方向上无害。保守性来自构造规则本身
// ——每个词片一律向上取整、每个脚本连续段至少计 1 token，不含「可与邻字合并」的假设。
// ============================================================

import type { ChatRole, TokenUsage, ToolDefinition } from "../../../ai/provider/model-provider";

/**
 * ChatML 单条消息的固定包裹开销（角色标记 + 分隔 + 换行）。
 * Moonshot 系模型沿用 ChatML 模板，其每条消息的结构性开销与 OpenAI 文档里
 * `tokens_per_message = 3` 的口径同量级；这里取该口径，不另发明一个数。
 */
const MESSAGE_OVERHEAD_TOKENS = 3;
/** 末尾 reply priming（`<|im_start|>assistant\n`），每个请求一次。 */
const REPLY_PRIMING_TOKENS = 3;
/** 角色名本身进 prompt 时的开销上限（system/user/assistant 各 1 token）。 */
const ROLE_TOKENS = 1;

/**
 * 拉丁词片折分基数：BPE 系词表在英文散文上约 4 字符/token。
 * 取 3 而不是 4 是刻意的保守——代码、URL、数字串在真实工作台负载里占比不低，
 * 这些形态实际会碎到 2~3 字符/token，用 4 会系统性低估。
 */
const TOKENS_PER_LATIN_CHAR = 1 / 3;
/** 单个拉丁词最少折成的 token 数（短词也是完整 token，不随长度线性趋零）。 */
const MIN_LATIN_WORD_TOKENS = 1;
/** 长词按该步长继续折分（BPE 对超长词的近似上界）。 */
const LATIN_WORD_PIECE_STEP = 12;

/** 需要单独计数的脚本类：这些类按「字」计 token，不做词片折分。 */
const WIDE_CHAR_RANGES: Array<[number, number]> = [
  [0x2e80, 0x2eff], // CJK 部首补充
  [0x3000, 0x303f], // CJK 符号与标点
  [0x3040, 0x30ff], // 平假名 / 片假名
  [0x3400, 0x4dbf], // 扩展 A
  [0x4e00, 0x9fff], // CJK 统一表意文字
  [0xac00, 0xd7af], // 谚文音节
  [0xf900, 0xfaff], // CJK 兼容表意文字
  [0xfe30, 0xfe4f], // CJK 兼容形式
  [0xff00, 0xffef], // 半角/全角形式
  [0x20000, 0x2a6df], // 扩展 B
];

function isWideChar(code: number): boolean {
  if (code < 0x2e80) return false;
  for (const [lo, hi] of WIDE_CHAR_RANGES) {
    if (code >= lo && code <= hi) return true;
  }
  return false;
}

/** 拉丁词片的 token 数：向上取整，且长词按步长继续折分。 */
function latinWordTokens(word: string): number {
  const byRatio = Math.ceil(word.length * TOKENS_PER_LATIN_CHAR);
  const byPieces = Math.ceil(word.length / LATIN_WORD_PIECE_STEP);
  return Math.max(MIN_LATIN_WORD_TOKENS, byRatio, byPieces);
}

/** 数字串单独成词片（BPE 对数字的切分通常比同长度字母更碎）。 */
function digitRunTokens(run: string): number {
  return Math.max(1, Math.ceil(run.length / 3));
}

/**
 * 正文字符 → subword token 估算（纯函数，同输入必同输出）。
 * 计法：逐码点扫描，按「宽字符 / 数字串 / 拉丁词 / 其他符号」四类分段，
 * 每段各自向上取整；标点与空白不单独计 token（BPE 里它们几乎总是并入邻词片）。
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  let latinWord = "";
  let digitRun = "";

  const flushLatin = () => {
    if (latinWord) tokens += latinWordTokens(latinWord);
    latinWord = "";
  };
  const flushDigits = () => {
    if (digitRun) tokens += digitRunTokens(digitRun);
    digitRun = "";
  };

  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (isWideChar(code)) {
      flushLatin();
      flushDigits();
      tokens += 1;
      continue;
    }
    if (code >= 0x30 && code <= 0x39) {
      flushLatin();
      digitRun += ch;
      continue;
    }
    const isLatin =
      (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || code === 0x5f;
    if (isLatin) {
      flushDigits();
      latinWord += ch;
      continue;
    }
    // 其余（空白、拉丁标点、emoji、符号）：终止当前词片，本身不单独计 token。
    flushLatin();
    flushDigits();
  }
  flushLatin();
  flushDigits();
  return tokens;
}

export type MeteredMessage = { role: ChatRole; content: string };

/** 单条消息进 prompt 的 token 数（含 ChatML 包裹与角色）。 */
export function estimateMessageTokens(message: MeteredMessage): number {
  return MESSAGE_OVERHEAD_TOKENS + ROLE_TOKENS + estimateTextTokens(message.content ?? "");
}

/** 历史消息列表（不含结构性开销以外的 reply priming）的总 token 估算。 */
export function estimateMessagesTokens(messages: readonly MeteredMessage[]): number {
  let total = 0;
  for (const message of messages) total += estimateMessageTokens(message);
  return total + (messages.length > 0 ? REPLY_PRIMING_TOKENS : 0);
}

/**
 * tools 定义进 prompt 的 token 估算。
 * provider 按序列化后的 Schema 计费，因此这里计的也是同一份序列化文本——
 * 与请求体里实际发出的形状一致（key 顺序由传入对象决定，不做重排）。
 */
export function estimateToolsTokens(tools: readonly ToolDefinition[] | undefined): number {
  if (!tools || tools.length === 0) return 0;
  return estimateTextTokens(tools.map((tool) => stableStringify(tool)).join(""));
}

/** 一次模型请求的完整输入 token 估算（messages + tools + priming）。 */
export function estimateRequestTokens(input: {
  messages: readonly MeteredMessage[];
  tools?: readonly ToolDefinition[];
}): number {
  return estimateMessagesTokens(input.messages) + estimateToolsTokens(input.tools);
}

/** 与 provider 请求体同形状的稳定序列化（循环引用降级为字符串，不抛）。 */
function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

// ============================================================
// 估算 vs provider 实测：偏差不靠声明，靠量
// ============================================================

export type TokenCalibrationSample = {
  /** 调用场景标识（provider 侧的 promptCacheKey，可区分工作台/评估等通道） */
  channel: string;
  model: string;
  messageCount: number;
  estimatedPromptTokens: number;
  reportedPromptTokens: number;
  /** 估算 − 实测：正数即高估（保守方向），负数即低估（危险方向） */
  delta: number;
  /** delta / 实测 */
  relativeDelta: number;
};

/**
 * 台账容量：进程内环形缓冲，只留最近 N 条。
 * 只放数值与计数，**不放正文**——工作台历史是客户的需求原文。
 */
const CALIBRATION_CAPACITY = 200;
const calibrationSamples: TokenCalibrationSample[] = [];

/**
 * 记录一次「本地估算 vs provider 实测」对照。
 * provider 未回 usage 或回 0 时不记录（无对照价值，不制造假样本）。
 */
export function recordProviderUsage(input: {
  channel: string;
  model: string;
  messages: readonly MeteredMessage[];
  tools?: readonly ToolDefinition[];
  usage?: TokenUsage | undefined;
}): TokenCalibrationSample | null {
  const reported = input.usage?.promptTokens ?? 0;
  if (!Number.isFinite(reported) || reported <= 0) return null;
  const estimatedPromptTokens = estimateRequestTokens({ messages: input.messages, tools: input.tools });
  const delta = estimatedPromptTokens - reported;
  const sample: TokenCalibrationSample = {
    channel: input.channel,
    model: input.model,
    messageCount: input.messages.length,
    estimatedPromptTokens,
    reportedPromptTokens: reported,
    delta,
    relativeDelta: reported > 0 ? delta / reported : 0,
  };
  calibrationSamples.push(sample);
  if (calibrationSamples.length > CALIBRATION_CAPACITY) calibrationSamples.shift();
  if (sample.delta < 0) {
    // 估算刻意取保守方向（高估无害、低估才会真顶上限）。provider 实测低于估算之外
    // 的形态一旦出现在生产，必须当场可见——这条假设不该只在测试里成立。
    // 只报计数与比值，不报正文。
    console.warn(
      `[token-meter] ⚠ 本地估算低于 provider 实测 channel=${sample.channel} model=${sample.model} ` +
        `估算=${sample.estimatedPromptTokens} 实测=${sample.reportedPromptTokens} 偏差=${sample.delta}`,
    );
  }
  return sample;
}

export type TokenCalibrationSummary = {
  samples: number;
  /** 低估样本数：>0 即说明估算方向不再保守，必须处理 */
  underestimates: number;
  maxUnderestimateRatio: number;
  maxOverestimateRatio: number;
  meanRelativeDelta: number;
};

/** 台账汇总（测试与诊断入口）。空台账返回全 0，不抛。 */
export function summarizeTokenCalibration(): TokenCalibrationSummary {
  const items = calibrationSamples;
  if (items.length === 0) {
    return { samples: 0, underestimates: 0, maxUnderestimateRatio: 0, maxOverestimateRatio: 0, meanRelativeDelta: 0 };
  }
  let underestimates = 0;
  let maxUnderestimateRatio = 0;
  let maxOverestimateRatio = 0;
  let sum = 0;
  for (const item of items) {
    if (item.delta < 0) underestimates += 1;
    if (item.relativeDelta < maxUnderestimateRatio) maxUnderestimateRatio = item.relativeDelta;
    if (item.relativeDelta > maxOverestimateRatio) maxOverestimateRatio = item.relativeDelta;
    sum += item.relativeDelta;
  }
  return {
    samples: items.length,
    underestimates,
    maxUnderestimateRatio,
    maxOverestimateRatio,
    meanRelativeDelta: sum / items.length,
  };
}

/** 仅供测试：清空台账，使断言不受同进程其他用例污染。 */
export function resetTokenCalibration(): void {
  calibrationSamples.length = 0;
}

/** 仅供测试与对照脚本：取当前台账快照（只读副本）。 */
export function getTokenCalibrationSamples(): readonly TokenCalibrationSample[] {
  return [...calibrationSamples];
}
