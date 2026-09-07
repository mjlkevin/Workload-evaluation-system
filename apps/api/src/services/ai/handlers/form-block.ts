// ============================================================
// O4 搬迁：formBlock 交互表单协议（类型 + 归一化 + 模型输出提取）
// 内容逐字节搬迁自 workbench-dispatch.service.ts，零逻辑变更。
// ============================================================

import { asCleanString, asRecord, parseJsonObject } from "./json-utils";

export type InteractiveFormFieldType = "text" | "textarea" | "single_select" | "boolean" | "number";

export type InteractiveFormField = {
  id: string;
  label: string;
  type: InteractiveFormFieldType;
  required?: boolean;
  placeholder?: string;
  helperText?: string;
  options?: Array<{ label: string; value: string }>;
};

export type InteractiveFormBlock = {
  blockId: string;
  title: string;
  description?: string;
  submitLabel: string;
  submitMessageTemplate?: string;
  fields: InteractiveFormField[];
};

const FORM_FIELD_TYPES: InteractiveFormFieldType[] = ["text", "textarea", "single_select", "boolean", "number"];

function normalizeFormOption(value: unknown): { label: string; value: string } | null {
  const record = asRecord(value);
  const label = asCleanString(record.label);
  const optionValue = asCleanString(record.value);
  if (!label || !optionValue) return null;
  return { label, value: optionValue };
}

function normalizeInteractiveFormField(value: unknown): InteractiveFormField | null {
  const record = asRecord(value);
  const id = asCleanString(record.id);
  const label = asCleanString(record.label);
  const type = asCleanString(record.type) as InteractiveFormFieldType;
  if (!id || !label || !FORM_FIELD_TYPES.includes(type)) return null;

  const field: InteractiveFormField = {
    id,
    label,
    type,
  };
  if (record.required === true) field.required = true;
  const placeholder = asCleanString(record.placeholder);
  if (placeholder) field.placeholder = placeholder;
  const helperText = asCleanString(record.helperText, 400);
  if (helperText) field.helperText = helperText;
  if (type === "single_select") {
    const options = Array.isArray(record.options)
      ? record.options.map(normalizeFormOption).filter((item): item is { label: string; value: string } => Boolean(item)).slice(0, 8)
      : [];
    if (options.length === 0) return null;
    field.options = options;
  }
  return field;
}

export function normalizeInteractiveFormBlock(value: unknown): InteractiveFormBlock | undefined {
  const record = asRecord(value);
  const blockId = asCleanString(record.blockId);
  const title = asCleanString(record.title);
  const submitLabel = asCleanString(record.submitLabel);
  if (!blockId || !title || !submitLabel) return undefined;
  if (!Array.isArray(record.fields) || record.fields.length === 0 || record.fields.length > 8) return undefined;
  const fields = record.fields.map(normalizeInteractiveFormField);
  if (fields.some((field) => !field)) return undefined;

  const formBlock: InteractiveFormBlock = {
    blockId,
    title,
    submitLabel,
    fields: fields as InteractiveFormField[],
  };
  const description = asCleanString(record.description, 500);
  if (description) formBlock.description = description;
  const submitMessageTemplate = asCleanString(record.submitMessageTemplate, 1000);
  if (submitMessageTemplate) formBlock.submitMessageTemplate = submitMessageTemplate;
  return formBlock;
}

function extractFormBlockPayload(record: Record<string, unknown>): InteractiveFormBlock | undefined {
  return normalizeInteractiveFormBlock(record.formBlock);
}

/**
 * 【遗留路径 · 批次 9 起不再是发起交互的正道，行为保持原样】
 *
 * 本函数从模型**自由文本**里抽 formBlock：模型必须自己想起来写一整段 JSON，
 * 且格式完全正确。实证失效（2026-09-06 会话 7f5cbf75）：抽取失败时那段 JSON
 * 逐字出现在 text.delta 里被当正文渲染给用户；且模型把字段键猜成 `name`
 * 而契约要求 `id`。产生方式不可靠，控件本身其实没问题。
 *
 * 批次 9 已把「向用户发起交互」做成工具（ask_user，见
 * services/ai/workbench-tool-user-input.ts）：参数由 provider 结构化下发、
 * 服务端按同一份 INTERACTIVE_FORM_BLOCK_CONTRACT 校验，渲染与否不再取决于
 * 模型是否记得写对格式。新用法一律走工具。
 *
 * 保留而不删（§9.8.3 裁决）：报告生成等其它流程可能在用，尚未逐条盘点；
 * 删除的风险大于本批收益。整体退役与批次 4（正则 handler 退役）合并评估。
 * 本批对其**行为零改动**，判据⑤以同一批输入做改前改后逐字节对照。
 */
export function extractFormBlockFromModelOutput(answer: string, rawContent?: string): { answer: string; formBlock?: InteractiveFormBlock } {
  const inspectTexts = [answer, rawContent || ""].filter(Boolean);

  for (const text of inspectTexts) {
    // 策略1: 匹配完整 fenced code block（```json ... ```）
    const fencedPattern = /```(?:json)?\s*([\s\S]*?)```/gi;
    for (const match of text.matchAll(fencedPattern)) {
      const jsonContent = match[1]?.trim() || "";
      let parsed = parseJsonObject(jsonContent);
      if (!parsed) parsed = parseJsonObject(jsonContent, true);
      const formBlock = parsed ? extractFormBlockPayload(parsed) : undefined;
      if (formBlock) {
        const cleanedAnswer = text === answer ? answer.replace(match[0], "").trim() || answer : answer;
        return { answer: cleanedAnswer, formBlock };
      }
    }

    // 策略2: 扫描无围栏的 JSON 对象（模型未输出 ``` 或截断导致无闭合 ``` 的情况）
    const braceStart = text.indexOf("{");
    if (braceStart >= 0) {
      const jsonCandidate = text.slice(braceStart).trim();
      let parsed = parseJsonObject(jsonCandidate);
      if (!parsed) parsed = parseJsonObject(jsonCandidate, true);
      const formBlock = parsed ? extractFormBlockPayload(parsed) : undefined;
      if (formBlock) {
        let cleanedAnswer = text === answer
          ? answer.slice(0, braceStart).trim() || answer
          : answer;
        // 同时清理可能残留的开头围栏标记（如 ```json）
        cleanedAnswer = cleanedAnswer.replace(/```(?:json)?\s*$/i, "").trim();
        return { answer: cleanedAnswer, formBlock };
      }
    }

    // 策略3: 处理纯 JSON 对象（整个文本就是一个 JSON）
    const trimmed = text.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      let parsed = parseJsonObject(trimmed);
      if (!parsed) parsed = parseJsonObject(trimmed, true);
      const formBlock = parsed ? extractFormBlockPayload(parsed) : undefined;
      if (formBlock) {
        const answerFromJson = asCleanString(parsed?.answer ?? parsed?.message, 4000);
        return { answer: text === answer ? answerFromJson || answer : answer, formBlock };
      }
    }
  }

  // 提取失败时，清理 answer 中残留的 JSON 代码块，避免前端渲染为纯代码
  let cleanedAnswer = answer;
  const fencedCleanup = /```(?:json)?\s*[\s\S]*?```/gi;
  if (fencedCleanup.test(cleanedAnswer)) {
    cleanedAnswer = cleanedAnswer.replace(fencedCleanup, "").trim();
  }
  // 清理尾部可能的不完整 JSON（最后 { 位置超过文本一半视为残留）
  const trailingBrace = cleanedAnswer.lastIndexOf("{");
  if (trailingBrace >= 0 && trailingBrace > cleanedAnswer.length * 0.5) {
    cleanedAnswer = cleanedAnswer.slice(0, trailingBrace).trim();
  }

  return { answer: cleanedAnswer };
}
