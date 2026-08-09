// ============================================================
// SP-2026-007 · MS1（M1 中文混合检索基线）
// knowledge.types — 知识库条目与检索结果类型
// ============================================================

/** 条目状态：draft → active → archived（单向流转，M4 治理时扩展） */
export type KnowledgeStatus = "draft" | "active" | "archived";

/** 知识库条目（JSON 存储于 config/knowledge/store.json） */
export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  /** 业务域分类（presales / estimates / engine / auth / ai ...） */
  category: string;
  /** 检索辅助标签 */
  tags?: string[];
  status: KnowledgeStatus;
  createdAt: string;
  updatedAt: string;
}

/** 检索命中的单路排名项 */
export interface RankedHit {
  entryId: string;
  score?: number;
}

/** 融合后的最终检索条目 */
export interface KnowledgeResultItem {
  entry: KnowledgeEntry;
  score: number;
  /** 阶段 1 固定 bm25；阶段 2 接向量后为 fused */
  source: "bm25" | "fused";
}

/** 护栏留痕 */
export interface GuardReport {
  /** 触发截断的原因；null 表示未触发 */
  truncatedBy: "maxItems" | "charBudget" | null;
  /** 被丢弃的条目数（含字符预算截断与条目数截断） */
  droppedCount: number;
  /** 输出条目内容累计字符数 */
  totalChars: number;
  /** 超时降级留痕 */
  timedOut?: boolean;
}

/** 检索编排返回结构 */
export interface KnowledgeSearchResult {
  query: string;
  tokens: string[];
  items: KnowledgeResultItem[];
  guard: GuardReport;
  durationMs: number;
}

/** 三重预算护栏配置（默认口径移植自 GT-009） */
export interface GuardOptions {
  maxItems: number;
  charBudget: number;
  timeoutMs: number;
}
