// ============================================================
// O4 搬迁：AI 工作台会话与模型调用的共享 helper
// 供 chat 各 handler 复用；内容逐字节搬迁自 chat.service.ts，零逻辑变更。
// ============================================================

import { Request, Response } from "express";

import { config } from "../../../config/env";
import { asString } from "../../../utils/helpers";
import { normalizeKimiModelName } from "../../../utils/model-name";
import { requireAuth, resolveBusinessRole } from "../../../middleware/auth";
import { loadRequirementSystemConfigStore, resolveActiveApiKeyForScope } from "../../../modules/system/system.repository";
import { resolveScenarioConfig } from "../../../modules/system/model-providers";
import { createAiSession, getAiSession } from "../../../modules/ai-sessions/ai-sessions.usecase";
import type { AiSessionRecord } from "../../../modules/ai-sessions/ai-sessions.types";
import type { AuthUser, BusinessRole } from "../../../types";
import { defaultProviderRegistry, type ChatCompletionResponse, type ChatRole, type ModelProvider } from "../../../ai/provider";
import type { StreamingChunk } from "../workbench-dispatch.service";
import { resolveWorkbenchInjectableTools, runWorkbenchToolLoop } from "../workbench-tool-loop";
import type { WorkbenchAttachmentContext } from "../workbench-context.service";
import { createMemoryUsecase, getMemoryRepository } from "../../../modules/memory/memory.module";
import type { MemoryContextBlock } from "../../../modules/memory/memory.usecase";

export function getKimiProvider(): ModelProvider {
  const provider = defaultProviderRegistry.get("kimi");
  if (!provider) throw new Error("kimi_provider_not_registered");
  return provider;
}
export function asModelObject(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}; }
export function pickModelField(input: Record<string, unknown>, keys: string[]): string { for (const key of keys) { const v = input[key]; if (v == null || typeof v === "boolean" || typeof v === "object") continue; const s = asString(v); if (s) return s; } return ""; }

export const HOME_ROLE_PRESETS: Record<BusinessRole, { label: string; prompt: string }> = {
  sales: { label: "销售员", prompt: "你是销售员的 AI 工作助手。帮助用户从客户资料、会议纪要或口述中识别商机背景、客户痛点、初步需求范围和下一步跟进动作。" },
  pre_sales: { label: "售前顾问", prompt: "你是售前顾问的 AI 工作助手。帮助用户解析 Excel、Word、PDF 或访谈纪要，识别业务需求及问题，生成需求包、模块建议、风险假设和实施评估输入。" },
  delivery: { label: "交付顾问", prompt: "你是交付顾问的 AI 工作助手。帮助用户拉取待详细评估需求包，补充实施范围、人天、复杂度、依赖、风险和交付假设。" },
  pm: { label: "项目经理", prompt: "你是项目经理的 AI 工作助手。帮助用户接力评估包，检查范围、人天、WBS、交付物、项目风险和 PMO 审核准备。" },
  pmo: { label: "PMO", prompt: "你是 PMO 的 AI 工作助手。帮助用户审核交付物齐全性、规范性、方法论完整性，并生成驳回意见或封版检查建议。" },
  dev: { label: "开发顾问", prompt: "你是开发顾问的 AI 工作助手。帮助用户识别开发范围、接口、报表、集成复杂度和技术风险。" },
  admin: { label: "管理视角", prompt: "你是管理员的 AI 工作助手。帮助用户查看全局项目队列、异常流程、角色配置和系统治理建议。" },
};

export type HomeAttachmentInput = { name: string; size?: number; type?: string; parsedSummary?: string };
export type HomeMessageInput = { role: "user" | "assistant"; content: string; attachments: HomeAttachmentInput[] };

export function normalizeHomeAttachments(value: unknown): HomeAttachmentInput[] {
  if (!Array.isArray(value)) return [];
  const attachments: HomeAttachmentInput[] = [];
  for (const item of value) {
    const record = asModelObject(item);
    const name = asString(record.name);
    if (!name) continue;
    attachments.push({
      name,
      size: typeof record.size === "number" ? record.size : undefined,
      type: asString(record.type) || undefined,
      parsedSummary: asString(record.parsedSummary) || undefined,
    });
  }
  return attachments;
}

export function normalizeHomeMessages(value: unknown): HomeMessageInput[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = asModelObject(item);
      return {
        role: asString(record.role) === "assistant" ? "assistant" as const : "user" as const,
        content: asString(record.content),
        attachments: normalizeHomeAttachments(record.attachments),
      };
    })
    .filter((item) => item.content);
}

// 阶段 1 批 2：签名改 async；内部 await requireAuth（requireAuth 仍同步读 users.json，await 同步值不改变行为）。
export async function currentUserFromRequest(req: Request, res: Response): Promise<AuthUser | null> {
  if (req.user) return req.user;
  return (await requireAuth(req, res))?.user || null;
}

export function latestUserMessage(messages: HomeMessageInput[]): { role: "user"; content: string; attachments: HomeAttachmentInput[] } | null {
  const message = [...messages].reverse().find((item) => item.role === "user" && item.content.trim());
  return message ? { role: "user", content: message.content, attachments: message.attachments } : null;
}

/** 阶段 1 批 8：签名改 async（内部 await 已异步化的 getAiSession/createAiSession），实现 不动。 */
export async function ensureHomeAiSession(user: AuthUser, input: { sessionId?: unknown; workflowKey?: unknown; title?: unknown }): Promise<AiSessionRecord> {
  const requestedSessionId = asString(input.sessionId);
  if (requestedSessionId) {
    const existing = await getAiSession(user, requestedSessionId);
    if (existing) return existing;
  }
  const workflowKey = asString(input.workflowKey) || "free_chat";
  return createAiSession(user, {
    title: asString(input.title) || "AI 工作台会话",
    domain: "business_evaluation",
    workflowKey,
    status: workflowKey === "free_chat" ? "temporary_chat" : "rough_estimate",
  });
}

export function resolveWorkbenchStreamFinalContent(dispatchAnswer: string, streamedChunks: StreamingChunk[]): { hasStreaming: boolean; content: string } {
  if (streamedChunks.length === 0) return { hasStreaming: false, content: dispatchAnswer };
  const streamedContent = streamedChunks.map((chunk) => chunk.contentDelta || "").join("");
  return { hasStreaming: true, content: dispatchAnswer || streamedContent };
}

export function buildHomeMessageContentForModel(message: HomeMessageInput): string {
  const attachmentSummaries = message.attachments
    .map((attachment) => attachment.parsedSummary)
    .filter(Boolean);
  if (attachmentSummaries.length === 0) return message.content;
  return [
    message.content,
    "",
    "【附件解析上下文】",
    ...attachmentSummaries.map((summary, index) => `附件 ${index + 1}：\n${summary}`),
  ].join("\n");
}

export function latestParsedHomeAttachment(messages: HomeMessageInput[]): HomeAttachmentInput | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue;
    const attachment = message.attachments.find((item) => asString(item.parsedSummary));
    if (attachment) return attachment;
  }
  return null;
}

// ISS-2026-08-08-001: 会话级附件回退——请求未携带 parsedSummary 时，从已落库会话附件中取最近一个带解析上下文的附件
export function latestSessionAttachmentWithSummary(session: AiSessionRecord | null | undefined): HomeAttachmentInput | null {
  if (!session || !Array.isArray(session.attachments)) return null;
  for (const attachment of [...session.attachments].reverse()) {
    if (!asString(attachment.parsedSummary)) continue;
    return {
      name: attachment.name,
      size: attachment.size,
      type: attachment.type,
      parsedSummary: attachment.parsedSummary,
    };
  }
  return null;
}

// RP-006: 收集所有带 parsedSummary 的附件（跨消息去重）
export function allParsedHomeAttachments(messages: HomeMessageInput[]): HomeAttachmentInput[] {
  const seen = new Set<string>();
  const result: HomeAttachmentInput[] = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const attachment of message.attachments) {
      if (!asString(attachment.parsedSummary)) continue;
      if (seen.has(attachment.name)) continue;
      seen.add(attachment.name);
      result.push(attachment);
    }
  }
  return result;
}

async function homeChatWithKimi(params: { apiUrl: string; apiKey: string; model: string; user: AuthUser; workflowKey: string; messages: HomeMessageInput[]; }): Promise<{ answer: string; rawContent: string; businessRole: BusinessRole; roleLabel: string }> {
  const businessRole = resolveBusinessRole(params.user);
  const preset = HOME_ROLE_PRESETS[businessRole];
  const workflowLine = params.workflowKey ? `当前工作流：${params.workflowKey}` : "当前工作流：自由对话";
  const systemPrompt = [
    "你是 WES 工作量评估系统首页 AI 工作台。",
    preset.prompt,
    workflowLine,
    "请用中文回答。回答要面向业务推进，优先给出下一步动作、需要确认的问题和可沉淀到系统的结果。",
    "当用户上传附件且消息中包含【附件解析上下文】时，必须基于解析出的客户、项目、业务需求、模块线索和工作表信息推进需求识别、粗评建议和待确认问题；不要声称无法接收附件。",
  ].join("\n");
  const safeMessages = params.messages.slice(-12).map((message) => ({ role: message.role, content: buildHomeMessageContentForModel(message) }));
  // 阶段 1 批 5：loadRequirementSystemConfigStore 已异步化，对象字面量内调用提升为变量后补 await。
  const requirementSystemConfig = await loadRequirementSystemConfigStore();
  const timeoutMs = requirementSystemConfig.active.kimiEvaluation.timeoutMs || 120000;
  // 批次 0 · ①②③：模型调用点必须传 tools，且模型返回的 tool_calls 必须被真正
  // 执行后回填再问一次。分流在注入点完成（见 resolveWorkbenchInjectableTools）；
  // 本同步兜底通道**不接审批闸门**，因此 ask 档（写工具）一律拒绝执行（批次 1a 失败关闭）。
  // 不改注册表；注入集为空时连 tools 字段都不传，行为与修复前逐字节一致。
  const toolSet = resolveWorkbenchInjectableTools(params.user);
  // 循环只回传末轮正文，provider 元信息（rawContent/model/attempts…）取末轮实际响应
  let lastCompletion: ChatCompletionResponse | undefined;
  const loop = await runWorkbenchToolLoop({
    messages: [{ role: "system", content: systemPrompt }, ...safeMessages],
    registry: toolSet.registry,
    agentUser: toolSet.agentUser,
    allowToolNames: toolSet.allowToolNames,
    invoke: async ({ messages }) => {
      const completion = await getKimiProvider().chatCompletion({
        model: params.model,
        temperature: 0.3,
        promptCacheKey: "home-workbench-chat-v1",
        timeoutMs,
        credentialsOverride: { apiKey: params.apiKey, apiBaseUrl: params.apiUrl },
        messages,
        ...(toolSet.tools.length > 0 ? { tools: toolSet.tools, toolChoice: "auto" as const } : {}),
      });
      lastCompletion = completion;
      return { content: completion.content, toolCalls: completion.toolCalls };
    },
  });
  return { answer: loop.content, rawContent: lastCompletion?.rawContent ?? loop.content, businessRole, roleLabel: preset.label };
}

// ============================================================
// RP-047 Batch E 返工 · B1：共享 dispatch 入参组装
// ============================================================
// 供同步 handler 与 harness workflow boot 共用；modelChat 可注入以支持测试。

export type ModelChatFactory = (params: {
  systemPrompt: string;
  userContent: string;
}) => Promise<{
  answer: string;
  rawContent: string;
  provider?: string;
  model?: string;
  attempts?: number;
  finishReason?: string;
  /** additive：本轮模型调用产生的工具调用记录（MS3 工具调用 chip 数据源） */
  toolCalls?: { name: string; source?: string }[];
  /** additive：本轮注入的 active 记忆计数（MS2-PATCH 引用记忆 chip 数据源） */
  memoryRef?: { scenesCount: number; atomsCount: number };
}>;

// ============================================================
// DEF-2026-08-27-001：模型入参组装的唯一口径
// ============================================================
// 三条工作台对话路径（同步非流式 / 同步流式 / 异步 Run）共用本函数，
// 避免「中间层对了、底层另写一份」的口径分叉再次发生：
//  · 历史窗口 slice(-12) 且**覆盖末条**为用户本轮——因此调用方必须
//    在当前用户消息落库之后再取历史，否则上一轮 assistant 会被覆盖丢失；
//  · 仅当传入 projectId 才注入 active 记忆，失败静默降级为无记忆模式。

export const WORKBENCH_MODEL_HISTORY_WINDOW = 12;

export type WorkbenchModelMessage = { role: ChatRole; content: string };

export type WorkbenchModelMemoryRef = { scenesCount: number; atomsCount: number };

export async function buildWorkbenchChatModelInput(
  user: AuthUser,
  params: {
    systemPrompt: string;
    userContent: string;
    messages?: HomeMessageInput[];
    /** 记忆注入项目上下文（缺省不注入，行为与旧版一致） */
    projectId?: string;
  },
): Promise<{ messages: WorkbenchModelMessage[]; memoryRef?: WorkbenchModelMemoryRef }> {
  let memoryBlock: MemoryContextBlock | null = null;
  if (params.projectId) {
    try {
      const memoryUsecase = createMemoryUsecase({ repo: getMemoryRepository() });
      memoryBlock = await memoryUsecase.buildMemoryContext({
        ownerUserId: user.id,
        projectId: params.projectId,
        maxScenes: 3,
        maxAtoms: 5,
      });
    } catch {
      // 记忆注入失败降级为无记忆模式，不阻塞主链路
    }
  }

  const memoryPrompt = memoryBlock ? buildMemoryPrompt(memoryBlock) : "";

  const safeMessages: WorkbenchModelMessage[] = (params.messages ?? []).slice(-WORKBENCH_MODEL_HISTORY_WINDOW).map((message) => ({ role: message.role, content: buildHomeMessageContentForModel(message) }));
  // 覆盖末条为用户本轮（非追加）；无历史时补推 userContent，避免模型只看到 system prompt（C3）
  if (safeMessages.length > 0) {
    safeMessages[safeMessages.length - 1] = { role: "user", content: params.userContent };
  } else {
    safeMessages.push({ role: "user", content: params.userContent });
  }

  const finalSystemPrompt = memoryPrompt
    ? `${params.systemPrompt}\n\n${memoryPrompt}`
    : params.systemPrompt;

  return {
    messages: [{ role: "system", content: finalSystemPrompt }, ...safeMessages],
    // additive：记忆注入透明度——注入成功（含 0 条）即携带计数，
    // 前端仅在计数 > 0 时渲染「引用记忆」chip，缺省保持静默降级
    ...(memoryBlock ? { memoryRef: { scenesCount: memoryBlock.scenes.length, atomsCount: memoryBlock.atoms.length } } : {}),
  };
}

/**
 * DEF-2026-08-27-001：已落库会话记录 → 模型历史入参。
 * 附件按 message.attachmentIds 从会话 attachments 解析（与同步路径来前端的
 * messages[].attachments 同一形状，使 buildHomeMessageContentForModel 能拼出
 * 【附件解析上下文】）；system/tool 角色与空正文不进历史窗口。
 */
export function sessionRecordToHomeMessages(session: AiSessionRecord | null | undefined): HomeMessageInput[] {
  if (!session || !Array.isArray(session.messages)) return [];
  const attachmentsById = new Map((Array.isArray(session.attachments) ? session.attachments : []).map((attachment) => [attachment.attachmentId, attachment]));
  return session.messages
    .filter((message) => (message.role === "user" || message.role === "assistant") && asString(message.content))
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
      attachments: (message.attachmentIds ?? [])
        .map((id) => attachmentsById.get(id))
        .filter((attachment): attachment is NonNullable<typeof attachment> => Boolean(attachment))
        .map((attachment) => ({ name: attachment.name, size: attachment.size, type: attachment.type, parsedSummary: attachment.parsedSummary })),
    }));
}

// ============================================================
// DEF-2026-09-03-001：工作台对话的模型/供应商/凭据统一走场景配置
// ============================================================
// 此前三条对话路径直读 `config.kimi.model`（env 默认值），完全绕开用户在系统
// 设置里配的场景绑定——用户改配置不生效，而 env 默认值 "kimi-k2.5" 已被供应商
// 下线（404），导致自 2026-06 起异步通道无一次成功的真实模型调用。
//
// 绑定到 assessment 场景：这三条路径的超时本就取自 kimiEvaluation.timeoutMs
// （= assessment 场景的 legacy 字段），挂过去后模型与超时同源，
// 一并消解 extractor.service.ts 上「模型取 fileParsing、超时取 kimiEvaluation」
// 的同类口径分叉。
export const WORKBENCH_CHAT_SCENARIO = "assessment" as const;

export interface WorkbenchChatScenario {
  model: string;
  baseUrl: string;
  credentialScope: string;
  timeoutMs: number;
  modelSource: string;
}

/**
 * 工作台对话的场景配置解析。三条路径（同步非流式 / 同步流式 / 异步 Run）唯一入口。
 * 解析不出模型时**显式失败**，不得回落到任意兜底值——「静默用一个过期模型」
 * 正是本缺陷瞒了三个月的原因（失败被静态文案掩盖）。
 */
export async function resolveWorkbenchChatScenario(): Promise<WorkbenchChatScenario> {
  const active = (await loadRequirementSystemConfigStore()).active;
  const scenarioCfg = resolveScenarioConfig(active, WORKBENCH_CHAT_SCENARIO, {
    model: config.kimi.model,
    baseUrl: config.kimi.apiBaseUrl,
  });
  const model = scenarioCfg.model?.trim() || "";
  if (!model) throw new Error("model_not_configured");
  return {
    model,
    baseUrl: scenarioCfg.baseUrl,
    credentialScope: scenarioCfg.credentialScope,
    timeoutMs: active.kimiEvaluation.timeoutMs || 120000,
    modelSource: scenarioCfg.modelSource,
  };
}

export function buildWorkbenchChatModelChat(
  user: AuthUser,
  options: {
    messages?: HomeMessageInput[];
    modelName?: string;
    projectId?: string;
  },
): ModelChatFactory {
  const messages = options.messages ?? [];
  return async ({ systemPrompt, userContent }) => {
    // 场景解析先于取密钥：凭据 scope 由场景绑定的供应商决定，不再固定 kimi scope。
    const scenario = await resolveWorkbenchChatScenario();
    const { apiKey } = resolveActiveApiKeyForScope(scenario.credentialScope);
    if (!apiKey) throw new Error("required_or_env_missing");

    const modelInput = await buildWorkbenchChatModelInput(user, {
      systemPrompt,
      userContent,
      messages,
      projectId: options.projectId,
    });

    // 批次 0 · ①②③：注入点解析只读工具集（mutates===false），不改 ToolRegistry。
    const toolSet = resolveWorkbenchInjectableTools(user);
    // provider 元信息取末轮（真正回答轮）的实际响应，首轮多为工具调用轮
    let lastCompletion: ChatCompletionResponse | undefined;
    const loop = await runWorkbenchToolLoop({
      messages: modelInput.messages,
      registry: toolSet.registry,
      agentUser: toolSet.agentUser,
      allowToolNames: toolSet.allowToolNames,
      invoke: async ({ messages }) => {
        const completion = await getKimiProvider().chatCompletion({
          model: scenario.model,
          temperature: 0.3,
          promptCacheKey: "home-workbench-dispatch-v1",
          timeoutMs: scenario.timeoutMs,
          credentialsOverride: { apiKey, apiBaseUrl: scenario.baseUrl },
          messages,
          ...(toolSet.tools.length > 0 ? { tools: toolSet.tools, toolChoice: "auto" as const } : {}),
        });
        lastCompletion = completion;
        return { content: completion.content, toolCalls: completion.toolCalls };
      },
    });
    const completion = lastCompletion;
    return {
      answer: loop.content,
      rawContent: completion?.rawContent ?? loop.content,
      provider: completion?.provider,
      model: completion?.model,
      attempts: completion?.attempts,
      finishReason: completion?.finishReason,
      ...(loop.toolCalls.length > 0 ? { toolCalls: loop.toolCalls } : {}),
      ...(modelInput.memoryRef ? { memoryRef: modelInput.memoryRef } : {}),
    };
  };
}

// DEF-2026-09-03-001：改为 async——模型名来自场景配置（异步读取），
// 不再是 env 常量。返回的 model 是 trace/展示口径，必须与实际调用的模型一致，
// 否则 trace 记的模型与真正发出的模型对不上。
export async function buildWorkbenchChatDispatchInput(user: AuthUser, content: string, options?: {
  modelChat?: ModelChatFactory;
  messages?: HomeMessageInput[];
  /** 记忆注入项目上下文（缺省不注入，行为与旧版一致）；工作台会话蒸馏落 default 项目 */
  projectId?: string;
  attachment?: WorkbenchAttachmentContext | null;
}): Promise<{
  user: AuthUser;
  workflowKey: string;
  message: string;
  attachment: WorkbenchAttachmentContext | null;
  latestHarnessArtifact: null;
  clientAction: string;
  businessRole: BusinessRole;
  roleLabel: string;
  model: string;
  rolePrompt: string;
  modelChat: ModelChatFactory;
}> {
  const businessRole = resolveBusinessRole(user);
  const roleLabel = HOME_ROLE_PRESETS[businessRole].label;
  const modelName = normalizeKimiModelName((await resolveWorkbenchChatScenario()).model);
  const modelChat = options?.modelChat ?? buildWorkbenchChatModelChat(user, {
    messages: options?.messages,
    modelName,
    projectId: options?.projectId,
  });

  return {
    user,
    workflowKey: "free_chat",
    message: content,
    attachment: options?.attachment ?? null,
    latestHarnessArtifact: null,
    clientAction: "",
    businessRole,
    roleLabel,
    model: modelName,
    rolePrompt: HOME_ROLE_PRESETS[businessRole].prompt,
    modelChat,
  };
}

// O4 快照测试需要直接锁定闸门判定，导出不代表行为变更
export function isExplicitReportRequest(text: string): boolean {
  return /生成|输出|创建|启动/.test(text || '') && /需求解析报告|需求包|评估输入|评估草稿|报告/.test(text || '');
}

// SP-2026-007 MS2：将记忆上下文组装为 system prompt 片段
function buildMemoryPrompt(block: MemoryContextBlock): string {
  const lines = ["【历史记忆上下文】"];
  if (block.scenes.length > 0) {
    lines.push("相关场景：");
    for (const scene of block.scenes) {
      lines.push(`- ${scene.title}：${scene.summary}`);
    }
  }
  if (block.atoms.length > 0) {
    lines.push("已知事实：");
    for (const atom of block.atoms) {
      lines.push(`- ${atom.factKey}：${atom.factText}`);
    }
  }
  lines.push("请基于以上记忆上下文继续推进，避免重复确认已明确的信息。");
  return lines.join("\n");
}
