// ============================================================
// 证据链契约 - JSON Schema（draft-07 兼容）
// ============================================================
// 作为 TypeScript 类型的机器可读补充，用于：
//  1. JSON 文件落盘前校验（T5 持久化层）
//  2. 未来接入 Ajv 或 Zod 做运行时 guard
//  3. DSL 引擎规则声明的字段引用验证
//
// 约定：子 schema 均为独立 const，顶层通过 $ref 引用（简化版，
// 无 $id 注册，直接内联引用路径 "#/$defs/..."）。

export const EVIDENCE_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://internal/ai/evidence/Evidence",
  title: "Evidence",
  type: "object",
  required: ["evidenceId", "fieldPath", "value", "method", "confidence", "source", "extractedAt"],
  additionalProperties: false,
  properties: {
    evidenceId: { type: "string", format: "uuid" },
    fieldPath: { type: "string", minLength: 1 },
    value: { type: "string" },
    rawText: { type: "string" },
    method: { type: "string", enum: ["rule", "ai", "manual", "default"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    source: { $ref: "#/$defs/EvidenceSource" },
    extractedAt: { type: "string", format: "date-time" },
    aiMeta: {
      type: "object",
      required: ["provider", "model", "attempts"],
      additionalProperties: false,
      properties: {
        provider: { type: "string" },
        model: { type: "string" },
        attempts: { type: "integer", minimum: 1 },
        finishReason: { type: "string" },
      },
    },
    history: {
      type: "array",
      items: {
        type: "object",
        required: ["value", "method", "changedAt"],
        additionalProperties: false,
        properties: {
          value: { type: "string" },
          method: { type: "string", enum: ["rule", "ai", "manual", "default"] },
          changedAt: { type: "string", format: "date-time" },
          changedByUserId: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
  $defs: {
    EvidenceSource: {
      oneOf: [
        {
          type: "object",
          required: ["kind"],
          additionalProperties: false,
          properties: {
            kind: { type: "string", const: "excel_sheet" },
            sheetName: { type: "string" },
            rowIndex: { type: "integer", minimum: 0 },
            colKey: { type: "string" },
          },
        },
        {
          type: "object",
          required: ["kind"],
          additionalProperties: false,
          properties: {
            kind: { type: "string", const: "text_section" },
            sectionName: { type: "string" },
            charOffset: { type: "integer", minimum: 0 },
            charLength: { type: "integer", minimum: 0 },
          },
        },
        {
          type: "object",
          required: ["kind"],
          additionalProperties: false,
          properties: {
            kind: { type: "string", const: "ai_inference" },
            promptHash: { type: "string" },
          },
        },
        {
          type: "object",
          required: ["kind"],
          additionalProperties: false,
          properties: {
            kind: { type: "string", const: "rule" },
            ruleId: { type: "string" },
            ruleVersion: { type: "string" },
          },
        },
        {
          type: "object",
          required: ["kind"],
          additionalProperties: false,
          properties: {
            kind: { type: "string", const: "manual" },
            editedByUserId: { type: "string" },
          },
        },
      ],
    },
  },
} as const;

export const EXTRACTION_RESULT_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://internal/ai/evidence/ExtractionResult",
  title: "ExtractionResult",
  type: "object",
  required: [
    "extractionId",
    "sourceRef",
    "status",
    "evidences",
    "warnings",
    "fallbacks",
    "durationMs",
    "extractedAt",
  ],
  additionalProperties: false,
  properties: {
    extractionId: { type: "string", format: "uuid" },
    sourceRef: { type: "string", minLength: 1 },
    versionId: { type: "string" },
    status: { type: "string", enum: ["success", "partial", "failed"] },
    evidences: { type: "array", items: { $ref: EVIDENCE_SCHEMA.$id } },
    warnings: {
      type: "array",
      items: {
        type: "object",
        required: ["fieldPath", "reason"],
        additionalProperties: false,
        properties: {
          fieldPath: { type: "string" },
          reason: { type: "string" },
          legacyKey: { type: "string" },
        },
      },
    },
    fallbacks: {
      type: "array",
      items: {
        type: "object",
        required: ["fieldPath", "reason", "usedMethod"],
        additionalProperties: false,
        properties: {
          fieldPath: { type: "string" },
          reason: { type: "string" },
          usedMethod: { type: "string", enum: ["rule", "ai", "manual", "default"] },
          legacyReason: { type: "string" },
        },
      },
    },
    durationMs: { type: "number", minimum: 0 },
    extractedAt: { type: "string", format: "date-time" },
    extractedByUserId: { type: "string" },
    extractorVersion: { type: "string" },
  },
} as const;
