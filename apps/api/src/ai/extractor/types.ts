// ============================================================
// 抽取器 - 请求与选项类型
// ============================================================
// T3 P0：从工作簿文本（Excel join 后字符串）抽取结构化证据。
// 当前覆盖最小字段集：basicInfo.customerName / customerIndustry / location。
// 完整字段集（productModuleRows 等）待 T4 迁移旧 ai.service 时拉齐。

import type { Evidence, ExtractionResult } from "../evidence";
import type { ModelProvider } from "../provider";

export interface ExtractRequest {
  /** 拼接后的工作簿文本（含 sheet 标题分隔） */
  workbookText: string;
  /** 来源标识：文件名 / 上传 hash / versionId 等，落到 ExtractionResult.sourceRef */
  sourceRef: string;
  /** 关联的需求版本 ID（如已入库） */
  versionId?: string;
  /** 触发抽取的用户 ID，落到 ExtractionResult.extractedByUserId */
  extractedByUserId?: string;
}

export interface ExtractOptions {
  /** 是否禁用 AI 路径（便于测试或临时熔断），默认 false */
  disableAi?: boolean;
  /** 单次 AI 调用的超时（ms），透传给 Provider */
  aiTimeoutMs?: number;
  /** AI 调用最大尝试次数（含首次） */
  aiMaxAttempts?: number;
  /** 覆盖 extractor 版本号，落 ExtractionResult.extractorVersion */
  extractorVersion?: string;
  /** 注入"现在时间"，便于测试稳定性 */
  now?: () => Date;
  /** 注入 UUID 生成器，便于测试稳定性 */
  generateId?: () => string;
}

export interface ExtractDependencies {
  /** AI 路径使用的 ModelProvider；不传则跳过 AI 直接走规则 */
  provider?: ModelProvider;
}

/** Extractor 内部各路径返回的最小载荷：仅 evidences 与可选警告 */
export interface ExtractPathOutput {
  evidences: Evidence[];
  /** 该路径自身上报的非致命问题（field 级降级、字段缺失等） */
  warnings: ExtractionResult["warnings"];
}
