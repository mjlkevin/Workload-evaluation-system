// ============================================================
// WES Agent Phase 1G — AI 工作台意图分发器
// 根据意图路由结果，调用对应的处理路径（模型问答、WES 查询、能力发现等），
// 返回统一的 WorkbenchDispatchData 结构（包含 intent, answer, suggestedActions, trace）。
// ============================================================

import type { AuthUser, BusinessRole } from "../../types";
import { config } from "../../config/env";
import { queryZhipuKnowledgeBase, type ZhipuKnowledgeToolTrace } from "./knowledge-tool.service";
import { routeWorkbenchIntent, classifyIntentWithModel, type WorkbenchIntent, type ModelClassificationResult } from "./workbench-intent.service";
import { buildWorkbenchContext, type WorkbenchContext, type WorkbenchAttachmentContext, type WorkbenchHarnessArtifactContext } from "./workbench-context.service";
import { resolveActiveKnowledgeBaseConfig } from "../../modules/system/system.repository";

export type WorkbenchSuggestedAction = {
  id: string;
  label: string;
  actionType:
    | "send_message"
    | "generate_requirement_report"
    | "submit_structured_answers"
    | "open_project_list"
    | "confirm_write_action"
    | "company_lookup"
    | "create_project_evaluation";
  requiresConfirm: boolean;
  disabled?: boolean;
  payload?: Record<string, unknown>;
};

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

export type WorkbenchLightweightModelRunTrace = {
  runKind: "attachment_summary" | "attachment_qa" | "knowledge_fallback";
  auditMode: "lightweight";
  createsHarnessRun: false;
  provider: string;
  model: string;
  contextRefs: string[];
  latencyMs: number;
  rawContentLength: number;
  attempts?: number;
  finishReason?: string;
};

export type WorkbenchDispatchData = {
  intent: WorkbenchIntent;
  answer: string;
  businessRole: BusinessRole;
  roleLabel: string;
  model?: string;
  rawContent?: string;
  formBlock?: InteractiveFormBlock;
  session?: unknown;
  suggestedActions: WorkbenchSuggestedAction[];
  trace: {
    intentConfidence: number;
    routingRule: string;
    contextRefs: string[];
    knowledgeTool?: ZhipuKnowledgeToolTrace;
    modelRun?: WorkbenchLightweightModelRunTrace;
    modelClassification?: ModelClassificationResult;
  };
};

export type WorkbenchDispatchInput = {
  user: AuthUser;
  workflowKey: string;
  message: string;
  attachment?: WorkbenchAttachmentContext | null;
  latestHarnessArtifact?: WorkbenchHarnessArtifactContext | null;
  clientAction?: string;
  /** 由调用方提供的模型回复函数 */
  modelChat: (params: { systemPrompt: string; userContent: string }) => Promise<{ answer: string; rawContent: string; provider?: string; model?: string; attempts?: number; finishReason?: string }>;
  /** 由调用方提供的角色标签 */
  businessRole: BusinessRole;
  roleLabel: string;
  model: string;
  /** 角色预设提示词（可选，用于注入到 system prompt） */
  rolePrompt?: string;
  /** 可注入的知识库查询函数，用于测试和后续工具注册器接入 */
  knowledgeQuery?: (query: string) => Promise<ZhipuKnowledgeToolTrace>;
  /** RP-029 返工：可选流式 adapter，提供后模型调用路径改为流式输出 */
  streamingAdapter?: StreamingAdapter;
  /** RP-029 返工：可选流式模型调用函数 */
  modelChatStream?: (params: { systemPrompt: string; userContent: string }) => AsyncIterable<StreamingChunk>;
};

/** RP-029 返工：流式 chunk */
export type StreamingChunk = {
  contentDelta: string;
  reasoningContentDelta?: string;
  model?: string;
  finishReason?: string;
};

/** RP-029 返工：流式 adapter — 由调用方实现，dispatch 内部模型调用路径会回调此 adapter */
export type StreamingAdapter = {
  onToken: (chunk: StreamingChunk) => void;
  onComplete?: (fullContent: string) => void;
  onError?: (error: Error) => void;
};

const FORM_FIELD_TYPES: InteractiveFormFieldType[] = ["text", "textarea", "single_select", "boolean", "number"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asCleanString(value: unknown, maxLength = 200): string {
  if (value == null || typeof value === "object" || typeof value === "boolean") return "";
  return String(value).trim().slice(0, maxLength);
}

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

function parseJsonObject(text: string, tryRepair = false): Record<string, unknown> | null {
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

function extractFormBlockPayload(record: Record<string, unknown>): InteractiveFormBlock | undefined {
  return normalizeInteractiveFormBlock(record.formBlock);
}

function extractFormBlockFromModelOutput(answer: string, rawContent?: string): { answer: string; formBlock?: InteractiveFormBlock } {
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

/**
 * 能力发现回复
 */
function buildCapabilityResponse(intent: { confidence: number; routingRule: string }, context: WorkbenchContext, input: WorkbenchDispatchInput): WorkbenchDispatchData {
  const capabilities = [
    "上传需求文件（Excel/Word/PDF），自动解析业务需求、模块线索和客户信息。",
    "对上传的附件内容进行问答，例如询问多组织业务往来包含哪些模块。",
    "明确要求时，生成《需求解析报告 v1》，识别需求、风险和待确认问题。",
    "在 v1 报告基础上，通过结构化卡片提交补充信息并生成《需求解析报告 v2》。",
    "查询你之前创建过的项目和评估记录（仅限你有权限的数据）。",
    "回答 WES/ERP/金蝶业务咨询，例如模块依赖、评估口径、风险含义等。",
    "对于写动作（创建草稿、进入正式评估），给出待确认动作，确认后才会执行。",
  ];
  const answer = [
    "我是 WES AI 工作台，当前角色：" + context.user.username + "（" + context.user.role + "）。",
    "",
    "我可以帮你完成以下工作：",
    ...capabilities.map((item, index) => `${index + 1}. ${item}`),
    "",
    "上传附件时，附件仅作为上下文；除非你明确要求生成报告，我不会自动进入报告生成流程。",
  ].join("\n");

  return {
    intent: "capability_discovery",
    answer,
    businessRole: input.businessRole,
    roleLabel: input.roleLabel,
    model: "rule-static",
    suggestedActions: [
      { id: "upload_file", label: "上传需求文件", actionType: "send_message", requiresConfirm: false },
      { id: "query_projects", label: "查看我的项目", actionType: "open_project_list", requiresConfirm: false },
      { id: "lookup_customer", label: "检索客户主体", actionType: "company_lookup", requiresConfirm: false },
    ],
    trace: {
      intentConfidence: intent.confidence,
      routingRule: intent.routingRule,
      contextRefs: context.contextRefs,
    },
  };
}

/**
 * WES 数据查询回复
 */
const PROJECT_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  active: "进行中",
  reviewing: "评审中",
  published: "已发布",
  archived: "已归档",
};

function labelProjectStatus(status: string): string {
  return PROJECT_STATUS_LABELS[status] || status || "未知";
}

function summarizeProjectStatuses(projects: WorkbenchContext["visibleProjects"]): string[] {
  const statusCounts = new Map<string, number>();
  for (const project of projects) {
    const label = labelProjectStatus(project.status);
    statusCounts.set(label, (statusCounts.get(label) || 0) + 1);
  }
  return Array.from(statusCounts.entries()).map(([label, count]) => `${label}：${count}`);
}

function buildProjectListResponse(intent: { confidence: number; routingRule: string }, context: WorkbenchContext, input: WorkbenchDispatchInput): WorkbenchDispatchData {
  const projects = context.visibleProjects;
  let answer: string;
  if (projects.length === 0) {
    answer = "你当前还没有创建过项目评估。可以在上传需求文件后，通过 AI 生成需求解析报告，再进入正式评估来创建项目。";
  } else {
    const statusSummary = summarizeProjectStatuses(projects);
    const pendingDrafts = projects.filter((project) => project.aiDraftReviewStatus === "pending");
    const lines = projects.map((project, index) =>
      `${index + 1}. ${project.projectName || "未命名项目"} — 客户：${project.customerName || "待补充"} — 状态：${labelProjectStatus(project.status)} — 阶段：${project.currentStage || "待补充"}`
    );
    const pendingLines = pendingDrafts.length
      ? [
        "",
        `待确认 AI 草稿：${pendingDrafts.length} 个`,
        ...pendingDrafts.map((project, index) => `${index + 1}. ${project.projectName || "未命名项目"} — 需要人工确认后才会回写 Harness 审计链。`),
      ]
      : ["", "待确认 AI 草稿：0 个"];
    answer = [
      `你创建过的项目（最近 ${projects.length} 个）：`,
      "",
      `状态汇总：${statusSummary.join("，")}`,
      "",
      ...lines,
      ...pendingLines,
      "",
      "这些结果仅来自你有权限的项目评估记录，不包含其他用户数据。",
    ].join("\n");
  }

  return {
    intent: "wes_data_query",
    answer,
    businessRole: input.businessRole,
    roleLabel: input.roleLabel,
    model: "rule-static",
    suggestedActions: [
      { id: "open_project_list", label: "打开项目列表", actionType: "open_project_list", requiresConfirm: false },
      { id: "upload_file", label: "上传需求文件", actionType: "send_message", requiresConfirm: false },
    ],
    trace: {
      intentConfidence: intent.confidence,
      routingRule: intent.routingRule,
      contextRefs: context.contextRefs,
    },
  };
}

/**
 * 写动作请求回复 — 只返回待确认动作，不自动执行
 */
function buildWriteActionResponse(intent: { confidence: number; routingRule: string }, context: WorkbenchContext, input: WorkbenchDispatchInput): WorkbenchDispatchData {
  // 检测项目创建意图：提取"创建/新建 + 项目名 + 项目"模式中的项目名
  const projectCreateMatch = input.message.match(/(?:创建|新建|设立)(?:一个)?(.+?)项目/);
  const projectName = projectCreateMatch?.[1]?.trim();

  if (projectName) {
    const answer = `检测到项目创建意图：「${projectName}」。为了安全，我不会自动创建正式记录。请确认以下动作后再执行：`;
    return {
      intent: "write_action_request",
      answer,
      businessRole: input.businessRole,
      roleLabel: input.roleLabel,
      model: "rule-static",
      suggestedActions: [
        {
          id: "create_project_evaluation",
          label: `确认创建项目「${projectName}」`,
          actionType: "create_project_evaluation",
          requiresConfirm: true,
          payload: { projectName },
        },
      ],
      trace: {
        intentConfidence: intent.confidence,
        routingRule: intent.routingRule,
        contextRefs: context.contextRefs,
      },
    };
  }

  const answer = "这是一个写动作请求。为了安全，我不会自动创建正式记录。请确认以下动作后再执行：";
  return {
    intent: "write_action_request",
    answer,
    businessRole: input.businessRole,
    roleLabel: input.roleLabel,
    model: "rule-static",
    suggestedActions: [
      {
        id: "confirm_write_action",
        label: "确认执行写动作",
        actionType: "confirm_write_action",
        requiresConfirm: true,
      },
    ],
    trace: {
      intentConfidence: intent.confidence,
      routingRule: intent.routingRule,
      contextRefs: context.contextRefs,
    },
  };
}

/**
 * 报告生成 / v2 提交建议动作回复
 */
function buildReportGenerationResponse(intent: { intent: WorkbenchIntent; confidence: number; routingRule: string }, context: WorkbenchContext, input: WorkbenchDispatchInput): WorkbenchDispatchData {
  const isV2 = intent.intent === "harness_answer_submission";
  const answer = isV2
    ? "检测到你希望基于已有 v1 报告补充信息并生成 v2。请通过结构化卡片提交补充信息，或在卡片中填写后点击「提交补充并生成 v2」。"
    : "检测到你希望生成需求解析报告。请上传需求文件后点击下方按钮启动报告生成流程。";
  return {
    intent: intent.intent,
    answer,
    businessRole: input.businessRole,
    roleLabel: input.roleLabel,
    model: "rule-static",
    suggestedActions: isV2
      ? [{ id: "submit_structured_answers", label: "提交补充并生成 v2", actionType: "submit_structured_answers", requiresConfirm: false }]
      : [{ id: "generate_requirement_report", label: "生成需求解析报告", actionType: "generate_requirement_report", requiresConfirm: false }],
    trace: {
      intentConfidence: intent.confidence,
      routingRule: intent.routingRule,
      contextRefs: context.contextRefs,
    },
  };
}

function buildKnowledgeToolAnswer(trace: ZhipuKnowledgeToolTrace): string {
  const lines = [
    "## 知识库参考",
    "",
    trace.answer,
    "",
    [
      `工具：${trace.toolId}`,
      `检索片段：${trace.chunksCount} 条`,
      `最高相关度：${trace.topScore.toFixed(2)}`,
      `置信度：${trace.confidence}`,
      trace.fallbackReason ? `备注：${trace.fallbackReason}` : "",
    ].filter(Boolean).join("；"),
    "",
    "该结果仅作为产品知识参考，不会自动改写正式估算、项目评估草稿或传统业务记录。",
  ];
  return lines.join("\n");
}

async function buildKnowledgeQueryResponse(
  intent: { confidence: number; routingRule: string },
  context: WorkbenchContext,
  input: WorkbenchDispatchInput,
): Promise<WorkbenchDispatchData> {
  const kbConf = resolveActiveKnowledgeBaseConfig();
  const knowledgeQuery = input.knowledgeQuery || ((query: string) => queryZhipuKnowledgeBase(query, kbConf));
  const knowledgeTool = await knowledgeQuery(input.message);
  const contextRefs = Array.from(new Set([...context.contextRefs, knowledgeTool.contextRef].filter(Boolean)));

  // 知识库检索失败或为空时，fallback 到模型通用知识回答
  if (knowledgeTool.fallbackReason) {
    const systemPrompt = [
      "你是 WES 工作量评估系统首页 AI 工作台。",
      input.rolePrompt || "",
      `当前工作流：${input.workflowKey || "free_chat"}`,
      "请用中文简洁回答，优先结合用户上下文，避免冗余。",
      "【重要】用户的问题本应从知识库检索文档回答，但知识库未找到相关文档。",
      "请基于你的通用知识尽可能回答用户的问题，但必须在回答开头明确标注：",
      "「⚠️ 知识库未检索到相关文档，以下为模型通用知识，仅供参考，不代表官方方案。」",
      "【反幻觉约束】",
      "- 不要编造不存在的文档名称、版本号、案例或数据。",
      "- 涉及具体数值时，必须标注为估算或参考值。",
      "- 如果确实不了解该领域，诚实告知用户。",
    ].filter(Boolean).join("\n");

    const startedAt = Date.now();
    let modelResult: { answer: string; rawContent: string; provider?: string; model?: string; attempts?: number; finishReason?: string };

    // RP-029 返工：知识库 fallback 也支持流式
    if (input.streamingAdapter && input.modelChatStream) {
      let fullContent = "";
      try {
        const stream = input.modelChatStream({ systemPrompt, userContent: input.message });
        for await (const chunk of stream) {
          input.streamingAdapter.onToken(chunk);
          fullContent += chunk.contentDelta || "";
        }
        input.streamingAdapter.onComplete?.(fullContent);
      } catch (err) {
        const error = err instanceof Error ? err : new Error("stream_failed");
        input.streamingAdapter.onError?.(error);
        throw error;
      }
      modelResult = { answer: fullContent, rawContent: fullContent, provider: "kimi" };
    } else {
      modelResult = await input.modelChat({ systemPrompt, userContent: input.message });
    }
    const latencyMs = Math.max(0, Date.now() - startedAt);

    const combinedAnswer = [
      buildKnowledgeToolAnswer(knowledgeTool),
      "",
      "---",
      "",
      modelResult.answer,
    ].join("\n");

    return {
      intent: "knowledge_query",
      answer: combinedAnswer,
      businessRole: input.businessRole,
      roleLabel: input.roleLabel,
      model: modelResult.model || input.model,
      rawContent: modelResult.rawContent,
      suggestedActions: [],
      trace: {
        intentConfidence: intent.confidence,
        routingRule: intent.routingRule,
        contextRefs,
        knowledgeTool,
        modelRun: {
          runKind: "knowledge_fallback" as const,
          auditMode: "lightweight" as const,
          createsHarnessRun: false as const,
          provider: modelResult.provider || "kimi",
          model: modelResult.model || input.model,
          contextRefs,
          latencyMs,
          rawContentLength: String(modelResult.rawContent || "").length,
          ...(typeof modelResult.attempts === "number" ? { attempts: modelResult.attempts } : {}),
          ...(modelResult.finishReason ? { finishReason: modelResult.finishReason } : {}),
        },
      },
    };
  }

  return {
    intent: "knowledge_query",
    answer: buildKnowledgeToolAnswer(knowledgeTool),
    businessRole: input.businessRole,
    roleLabel: input.roleLabel,
    model: knowledgeTool.model,
    suggestedActions: [],
    trace: {
      intentConfidence: intent.confidence,
      routingRule: intent.routingRule,
      contextRefs,
      knowledgeTool,
    },
  };
}

/**
 * 附件摘要 / 附件问答 — 调用模型回复
 */
async function answerWithModelAndContext(
  input: WorkbenchDispatchInput,
  intent: { intent: WorkbenchIntent; confidence: number; routingRule: string },
  context: WorkbenchContext,
): Promise<WorkbenchDispatchData> {
  const systemPrompt = [
    "你是 WES 工作量评估系统首页 AI 工作台。",
    input.rolePrompt || "",
    `当前工作流：${input.workflowKey || "free_chat"}`,
    "请用中文简洁回答，优先结合用户上下文，避免冗余。",
    "【反幻觉约束】",
    "- 不要编造不存在的文档名称、版本号、案例或数据。",
    "- 引用文档时必须标注来源，无法确认来源时明确说明这是基于通用知识的推断。",
    "- 当用户询问知识库/文档/方案时，如果知识库未配置或检索未命中，必须明确告知用户，不要虚构检索结果。",
    "- 涉及具体数值（如实施周期、重构率、并发量等）时，如非来自用户附件或明确来源，必须标注为估算或参考值。",
    input.attachment?.parsedSummary
      ? `【附件解析上下文】\n附件名：${input.attachment.name}\n${input.attachment.parsedSummary}`
      : "",
    input.latestHarnessArtifact?.artifactType === "requirement_report_v1"
      ? "【已有 v1 报告】用户已有需求解析报告 v1，当前追问请基于报告内容解释或回答，不要自动生成 v2。"
      : "",
    "当你需要用户补充结构化信息时，可以在正常中文回复后追加一个 ```json 代码块，且代码块只包含 {\"formBlock\":{...}}。",
    "formBlock 字段仅允许：blockId、title、description、submitLabel、submitMessageTemplate、fields；fields 最多 8 个，字段 type 仅允许 text、textarea、single_select、boolean、number；single_select options 最多 8 个。",
    "formBlock 只用于生成普通用户补充消息，不代表执行写动作、确认动作或正式业务落库。",
  ].filter(Boolean).join("\n");

  const userContent = input.message || "请分析上传的附件内容。";
  const startedAt = Date.now();

  // RP-029 返工：有 streamingAdapter + modelChatStream 时走流式路径
  let modelResult: { answer: string; rawContent: string; provider?: string; model?: string; attempts?: number; finishReason?: string };
  if (input.streamingAdapter && input.modelChatStream) {
    let fullContent = "";
    let lastChunk: StreamingChunk | undefined;
    try {
      const stream = input.modelChatStream({ systemPrompt, userContent });
      for await (const chunk of stream) {
        input.streamingAdapter.onToken(chunk);
        fullContent += chunk.contentDelta || "";
        lastChunk = chunk;
      }
      input.streamingAdapter.onComplete?.(fullContent);
    } catch (err) {
      const error = err instanceof Error ? err : new Error("stream_failed");
      input.streamingAdapter.onError?.(error);
      throw error;
    }
    const latencyMs = Math.max(0, Date.now() - startedAt);
    modelResult = {
      answer: fullContent,
      rawContent: fullContent,
      provider: lastChunk?.model ? "kimi" : undefined,
      model: lastChunk?.model,
      finishReason: lastChunk?.finishReason,
    };
    // 流式场景也需要记录 modelRun trace
    const modelRunTrace: WorkbenchLightweightModelRunTrace = {
      runKind: (intent.intent === "attachment_summary" || intent.intent === "attachment_qa") ? intent.intent : "attachment_summary",
      auditMode: "lightweight" as const,
      createsHarnessRun: false as const,
      provider: modelResult.provider || "kimi",
      model: modelResult.model || input.model,
      contextRefs: context.contextRefs,
      latencyMs,
      rawContentLength: fullContent.length,
      ...(modelResult.finishReason ? { finishReason: modelResult.finishReason } : {}),
    };
    const suggestedActions: WorkbenchSuggestedAction[] = [];
    if (input.attachment && !input.latestHarnessArtifact) {
      suggestedActions.push({
        id: "generate_requirement_report",
        label: "生成需求解析报告",
        actionType: "generate_requirement_report",
        requiresConfirm: false,
      });
    }
    return {
      intent: intent.intent,
      answer: fullContent,
      businessRole: input.businessRole,
      roleLabel: input.roleLabel,
      model: input.model,
      rawContent: fullContent,
      suggestedActions,
      trace: {
        intentConfidence: intent.confidence,
        routingRule: intent.routingRule,
        contextRefs: context.contextRefs,
        modelRun: modelRunTrace,
      },
    };
  }

  // 非流式路径：保持原有 modelChat 逻辑
  modelResult = await input.modelChat({ systemPrompt, userContent });
  const latencyMs = Math.max(0, Date.now() - startedAt);
  const { answer, rawContent } = modelResult;
  const parsedOutput = extractFormBlockFromModelOutput(answer, rawContent);

  const suggestedActions: WorkbenchSuggestedAction[] = [];
  if (input.attachment && !input.latestHarnessArtifact) {
    suggestedActions.push({
      id: "generate_requirement_report",
      label: "生成需求解析报告",
      actionType: "generate_requirement_report",
      requiresConfirm: false,
    });
  }

  const modelRun = input.attachment && (intent.intent === "attachment_summary" || intent.intent === "attachment_qa")
    ? {
      runKind: intent.intent,
      auditMode: "lightweight" as const,
      createsHarnessRun: false as const,
      provider: modelResult.provider || "kimi",
      model: modelResult.model || input.model,
      contextRefs: context.contextRefs,
      latencyMs,
      rawContentLength: String(rawContent || "").length,
      ...(typeof modelResult.attempts === "number" ? { attempts: modelResult.attempts } : {}),
      ...(modelResult.finishReason ? { finishReason: modelResult.finishReason } : {}),
    }
    : undefined;

  return {
    intent: intent.intent,
    answer: parsedOutput.answer,
    businessRole: input.businessRole,
    roleLabel: input.roleLabel,
    model: input.model,
    rawContent,
    formBlock: parsedOutput.formBlock,
    suggestedActions,
    trace: {
      intentConfidence: intent.confidence,
      routingRule: intent.routingRule,
      contextRefs: context.contextRefs,
      ...(modelRun ? { modelRun } : {}),
    },
  };
}

/**
 * 不支持/超出范围的请求 — 静态回复
 */
function buildUnsupportedResponse(
  intent: { confidence: number; routingRule: string },
  context: WorkbenchContext,
  input: WorkbenchDispatchInput,
  modelClassification?: ModelClassificationResult,
): WorkbenchDispatchData {
  const answer = "抱歉，这个请求超出了我的能力范围。我是 WES AI 工作台，主要帮助你完成需求解析、工作量评估和项目管理工作。你可以尝试上传需求文件，或者问我与项目评估相关的问题。";
  return {
    intent: "unsupported_or_out_of_scope",
    answer,
    businessRole: input.businessRole,
    roleLabel: input.roleLabel,
    model: "rule-static",
    suggestedActions: [
      { id: "upload_file", label: "上传需求文件", actionType: "send_message", requiresConfirm: false },
      { id: "ask_capability", label: "了解我能做什么", actionType: "send_message", requiresConfirm: false },
    ],
    trace: {
      intentConfidence: intent.confidence,
      routingRule: intent.routingRule,
      contextRefs: context.contextRefs,
      ...(modelClassification ? { modelClassification } : {}),
    },
  };
}

/**
 * 分发一次 AI 工作台用户输入。
 * 根据 intent 路由结果选择执行路径，返回统一的 WorkbenchDispatchData。
 */
export async function dispatchHomeWorkbenchTurn(input: WorkbenchDispatchInput): Promise<WorkbenchDispatchData> {
  let intent = routeWorkbenchIntent({
    message: input.message,
    hasAttachment: Boolean(input.attachment),
    hasLatestV1Artifact: input.latestHarnessArtifact?.artifactType === "requirement_report_v1",
    clientAction: input.clientAction,
  });

  // RP-003: 规则兜底时调用模型二次分类
  let modelClassification: ModelClassificationResult | undefined;
  if (intent.routingRule === "default_domain_qa") {
    const classification = await classifyIntentWithModel(input.message, input.modelChat);
    if (classification && classification.confidence >= 0.6) {
      modelClassification = classification;
      intent = {
        intent: classification.intent as WorkbenchIntent,
        confidence: classification.confidence,
        routingRule: "model_classification_fallback",
      };
    } else if (classification) {
      // 低置信度，记录但不替换
      modelClassification = classification;
    }
  }

  const context = buildWorkbenchContext({
    user: input.user,
    attachment: input.attachment,
    latestHarnessArtifact: input.latestHarnessArtifact,
  });

  // 能力发现 → 静态回复
  if (intent.intent === "capability_discovery") {
    const resp = await buildCapabilityResponse(intent, context, input);
    if (modelClassification) resp.trace.modelClassification = modelClassification;
    return resp;
  }

  // WES 数据查询 → owner-scoped 项目列表
  if (intent.intent === "wes_data_query") {
    return buildProjectListResponse(intent, context, input);
  }

  // 写动作 → 只返回待确认动作
  if (intent.intent === "write_action_request") {
    return buildWriteActionResponse(intent, context, input);
  }

  // 报告生成 / v2 提交 → 建议动作
  if (intent.intent === "harness_report_generation" || intent.intent === "harness_answer_submission") {
    return buildReportGenerationResponse(intent, context, input);
  }

  // 产品知识问题 → 只读知识库工具，不触发 Kimi 主评估或任何写动作
  if (intent.intent === "knowledge_query") {
    return buildKnowledgeQueryResponse(intent, context, input);
  }

  // 不支持/超出范围 → 静态回复
  if (intent.intent === "unsupported_or_out_of_scope") {
    return buildUnsupportedResponse(intent, context, input, modelClassification);
  }

  // 附件问答 / 附件摘要 / 普通业务问答 → 模型回复
  const result = await answerWithModelAndContext(input, intent, context);
  if (modelClassification) {
    result.trace.modelClassification = modelClassification;
  }
  return result;
}
