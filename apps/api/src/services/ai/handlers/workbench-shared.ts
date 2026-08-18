// ============================================================
// O4 搬迁：AI 工作台会话与模型调用的共享 helper
// 供 chat 各 handler 复用；内容逐字节搬迁自 chat.service.ts，零逻辑变更。
// ============================================================

import { Request, Response } from "express";

import { config } from "../../../config/env";
import { asString } from "../../../utils/helpers";
import { normalizeKimiModelName } from "../../../utils/model-name";
import { requireAuth, resolveBusinessRole } from "../../../middleware/auth";
import { loadRequirementSystemConfigStore, resolveActiveRequirementKimiApiKey } from "../../../modules/system/system.repository";
import { createAiSession, getAiSession } from "../../../modules/ai-sessions/ai-sessions.usecase";
import type { AiSessionRecord } from "../../../modules/ai-sessions/ai-sessions.types";
import type { AuthUser, BusinessRole } from "../../../types";
import { defaultProviderRegistry, type ModelProvider } from "../../../ai/provider";
import type { StreamingChunk } from "../workbench-dispatch.service";
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

export function ensureHomeAiSession(user: AuthUser, input: { sessionId?: unknown; workflowKey?: unknown; title?: unknown }): AiSessionRecord {
  const requestedSessionId = asString(input.sessionId);
  if (requestedSessionId) {
    const existing = getAiSession(user, requestedSessionId);
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
  const completion = await getKimiProvider().chatCompletion({
    model: params.model,
    temperature: 0.3,
    promptCacheKey: "home-workbench-chat-v1",
    timeoutMs: requirementSystemConfig.active.kimiEvaluation.timeoutMs || 120000,
    credentialsOverride: { apiKey: params.apiKey, apiBaseUrl: params.apiUrl },
    messages: [{ role: "system", content: systemPrompt }, ...safeMessages],
  });
  return { answer: completion.content, rawContent: completion.rawContent, businessRole, roleLabel: preset.label };
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

export function buildWorkbenchChatModelChat(
  user: AuthUser,
  options: {
    messages?: HomeMessageInput[];
    modelName?: string;
    projectId?: string;
  },
): ModelChatFactory {
  const messages = options.messages ?? [];
  const modelName = options.modelName ?? normalizeKimiModelName(config.kimi.model);
  return async ({ systemPrompt, userContent }) => {
    const { apiKey } = resolveActiveRequirementKimiApiKey();
    if (!apiKey) throw new Error("required_or_env_missing");

    // SP-2026-007 MS2：按 projectId 拉取 active 记忆上下文
    let memoryBlock: MemoryContextBlock | null = null;
    if (options.projectId) {
      try {
        const memoryUsecase = createMemoryUsecase({ repo: getMemoryRepository() });
        memoryBlock = await memoryUsecase.buildMemoryContext({
          ownerUserId: user.id,
          projectId: options.projectId,
          maxScenes: 3,
          maxAtoms: 5,
        });
      } catch {
        // 记忆注入失败降级为无记忆模式，不阻塞主链路
      }
    }

    const memoryPrompt = memoryBlock
      ? buildMemoryPrompt(memoryBlock)
      : "";

    const safeMessages = messages.slice(-12).map((message) => ({ role: message.role, content: buildHomeMessageContentForModel(message) }));
    // 覆盖最后一条用户消息的 system prompt；异步通道不传历史时补推 userContent，避免模型只看到 system prompt（C3）
    if (safeMessages.length > 0) {
      safeMessages[safeMessages.length - 1] = { role: "user", content: userContent };
    } else {
      safeMessages.push({ role: "user", content: userContent });
    }

    const finalSystemPrompt = memoryPrompt
      ? `${systemPrompt}\n\n${memoryPrompt}`
      : systemPrompt;

    // 阶段 1 批 5：loadRequirementSystemConfigStore 已异步化，对象字面量内调用提升为变量后补 await。
    const requirementSystemConfig = await loadRequirementSystemConfigStore();
    const completion = await getKimiProvider().chatCompletion({
      model: config.kimi.model,
      temperature: 0.3,
      promptCacheKey: "home-workbench-dispatch-v1",
      timeoutMs: requirementSystemConfig.active.kimiEvaluation.timeoutMs || 120000,
      credentialsOverride: { apiKey, apiBaseUrl: config.kimi.apiBaseUrl },
      messages: [{ role: "system", content: finalSystemPrompt }, ...safeMessages],
    });
    return {
      answer: completion.content,
      rawContent: completion.rawContent,
      provider: completion.provider,
      model: completion.model,
      attempts: completion.attempts,
      finishReason: completion.finishReason,
      // additive：记忆注入透明度——注入成功（含 0 条）即携带计数，
      // 前端仅在计数 > 0 时渲染「引用记忆」chip，缺省保持静默降级
      ...(memoryBlock
        ? { memoryRef: { scenesCount: memoryBlock.scenes.length, atomsCount: memoryBlock.atoms.length } }
        : {}),
    };
  };
}

export function buildWorkbenchChatDispatchInput(user: AuthUser, content: string, options?: {
  modelChat?: ModelChatFactory;
  messages?: HomeMessageInput[];
  /** 记忆注入项目上下文（缺省不注入，行为与旧版一致）；工作台会话蒸馏落 default 项目 */
  projectId?: string;
  attachment?: WorkbenchAttachmentContext | null;
}): {
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
} {
  const businessRole = resolveBusinessRole(user);
  const roleLabel = HOME_ROLE_PRESETS[businessRole].label;
  const modelName = normalizeKimiModelName(config.kimi.model);
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
