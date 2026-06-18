// ============================================================
// 证据链契约 - TypeScript 类型定义
// ============================================================
// Evidence 是系统的原子事实单元：一条从源文档抽取出来、
// 可追溯到原始位置的字段值，配合 ExtractionResult 共同构成
// "责任接力"机制中的证据底座——DSL 规则、人工复审和审计日志
// 都以此为输入，而非直接消费 AI 原始输出。
//
// 与旧 ai.service.ts 的对应关系：
//  parseRequirementImportByKimi   → ExtractionResult（method=ai）
//  normalizeBasicProjectInfo      → 每个字段对应一个 Evidence
//  规则回退（inferIndustry4Level）→ method=rule
//  用户手动填写                   → method=manual

// -------------------- 来源定位 --------------------

export type EvidenceSourceKind =
  | "excel_sheet"    // 来自 Excel 工作表特定行列
  | "text_section"   // 来自纯文本特定段落
  | "ai_inference"   // 由 AI 模型推断（无确定原始位置）
  | "rule"           // 由规则引擎推断
  | "manual";        // 人工录入

export type EvidenceSource =
  | {
      kind: "excel_sheet";
      sheetName: string;
      rowIndex?: number;
      colKey?: string;
    }
  | {
      kind: "text_section";
      sectionName: string;
      charOffset?: number;
      charLength?: number;
    }
  | {
      kind: "ai_inference";
      promptHash?: string;
    }
  | {
      kind: "rule";
      ruleId?: string;
      ruleVersion?: string;
    }
  | {
      kind: "manual";
      editedByUserId?: string;
    };

// -------------------- 抽取方法 --------------------

export type ExtractionMethod = "rule" | "ai" | "manual" | "default";

// -------------------- 核心类型：Evidence --------------------

export type Evidence = {
  /** 全局唯一 ID（UUID v4） */
  evidenceId: string;
  /** 语义字段路径，使用点号 + 数组索引，如 "basicInfo.customerIndustry"
   *  或 "requirementImportData.productModuleRows[2].moduleName" */
  fieldPath: string;
  /** 规范化后的字段值（字符串化，空字符串表示"确认为空"） */
  value: string;
  /** 支撑 value 的原始文本片段（可为空，用于 UI 高亮溯源） */
  rawText?: string;
  /** 抽取方式 */
  method: ExtractionMethod;
  /** 置信度 [0, 1]；规则=1.0，人工=1.0，AI 按不确定性评估 */
  confidence: number;
  source: EvidenceSource;
  extractedAt: string; // ISO 8601
  /** AI 抽取时记录 provider/model 元数据，方便可观测性 */
  aiMeta?: {
    provider: string;
    model: string;
    attempts: number;
    finishReason?: string;
  };
  /** 覆盖历史（manual 修改时追加，保留原始 AI 证据） */
  history?: Array<{
    value: string;
    method: ExtractionMethod;
    changedAt: string;
    changedByUserId?: string;
    reason?: string;
  }>;
};

// -------------------- 核心类型：ExtractionResult --------------------

export type ExtractionStatus = "success" | "partial" | "failed";

export type ExtractionWarning = {
  fieldPath: string;
  reason: string;
  /** 旧 ai.service.ts 中的 error key，如 "industry_not_code_name_format" */
  legacyKey?: string;
};

export type ExtractionFallback = {
  fieldPath: string;
  /** 触发降级的原因，如 "kimi_engine_overloaded" */
  reason: string;
  /** 降级后实际使用的方法 */
  usedMethod: ExtractionMethod;
  /** 兼容旧降级文案 key（toFriendlyFallbackReason 使用） */
  legacyReason?: string;
};

export type ExtractionResult = {
  /** 全局唯一 ID（UUID v4） */
  extractionId: string;
  /** 来源文档标识：文件名、版本 ID 或上传 hash */
  sourceRef: string;
  /** 关联的需求版本 ID（如已入库） */
  versionId?: string;
  /** 整体状态 */
  status: ExtractionStatus;
  /** 提取出的全量证据列表 */
  evidences: Evidence[];
  /** 非致命警告（如某字段降级回填） */
  warnings: ExtractionWarning[];
  /** 降级事件（AI 不可用 → 规则，需要对用户透明） */
  fallbacks: ExtractionFallback[];
  /** 从发起到完成的总耗时（ms） */
  durationMs: number;
  extractedAt: string; // ISO 8601
  extractedByUserId?: string;
  /** 生成本次 ExtractionResult 的 extractor 版本，便于未来重放比对 */
  extractorVersion?: string;
};
