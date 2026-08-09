// ============================================================
// SP-2026-007 · MS1（M1 中文混合检索基线）
// knowledge.tokenizer — jieba 中文分词 + 停用词过滤 + 单字二元组增强
// 设计：查询与语料共用同一分词管线，保证切分一致性
// ============================================================

import { Jieba } from "@node-rs/jieba";
import { dict } from "@node-rs/jieba/dict";

// 懒加载单例：词典加载有一次性成本，进程内复用
let jieba: InstanceType<typeof Jieba> | null = null;

function getJieba(): InstanceType<typeof Jieba> {
  if (!jieba) {
    jieba = Jieba.withDict(dict);
  }
  return jieba;
}

/** 单字功能词（保留「人」「天」等有业务含义的单字） */
const SINGLE_CHAR_STOPWORDS = new Set([
  "的", "了", "在", "是", "有", "和", "与", "或", "及", "其", "对", "为",
  "被", "把", "将", "等", "也", "都", "很", "就", "还", "又", "才", "之",
  "这", "那", "该", "此", "并", "且", "而", "但", "由", "从", "到", "向",
]);

/** 多字功能词 */
const MULTI_CHAR_STOPWORDS = new Set([
  "以及", "并且", "或者", "如果", "但是", "因为", "所以", "可以", "需要",
  "用于", "进行", "支持", "包括", "关于", "通过", "根据", "对于", "相关",
  "其他", "什么", "怎么", "哪些", "为什么", "如何", "是否", "应当", "应该",
]);

/** 判断是否含 CJK 字符 */
function hasCjk(token: string): boolean {
  return /[\u4e00-\u9fff]/.test(token);
}

/** 判断是否为纯字母数字 */
function isAlnum(token: string): boolean {
  return /^[a-z0-9]+$/i.test(token);
}

/**
 * 分词管线：jieba 切分 → 清洗小写 → 停用词过滤 → 相邻单字二元组增强。
 * 二元组增强解决 jieba 默认词典缺业务术语（如「人天」）时的召回问题。
 */
export function tokenize(text: string): string[] {
  if (!text || !text.trim()) return [];

  const rawTokens = getJieba().cut(text, false);
  const cleaned: string[] = [];
  for (const raw of rawTokens) {
    const token = raw.trim().toLowerCase();
    if (!token) continue;
    if (!hasCjk(token) && !isAlnum(token)) continue; // 纯标点/符号丢弃
    if (token.length === 1 && SINGLE_CHAR_STOPWORDS.has(token)) continue;
    if (token.length > 1 && MULTI_CHAR_STOPWORDS.has(token)) continue;
    cleaned.push(token);
  }

  // 相邻单字 CJK 词合成二元组，增强业务术语召回（人+天 → 人天）
  const tokens: string[] = [...cleaned];
  for (let i = 0; i + 1 < cleaned.length; i++) {
    const a = cleaned[i];
    const b = cleaned[i + 1];
    if (a.length === 1 && b.length === 1 && hasCjk(a) && hasCjk(b)) {
      tokens.push(a + b);
    }
  }
  return tokens;
}
