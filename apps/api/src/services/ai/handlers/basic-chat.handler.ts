// ============================================================
// O4 搬迁：基础对话（chat 路由 handler + chatWithKimi）
// 内容逐字节搬迁自 chat.service.ts，零逻辑变更。
// ============================================================

import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

import { config } from "../../../config/env";
import { asString } from "../../../utils/helpers";
import { normalizeKimiModelName } from "../../../utils/model-name";
import { ok, fail } from "../../../utils/response";
import { getKimiProvider } from "./workbench-shared";

async function chatWithKimi(params: { apiUrl: string; apiKey: string; model: string; messages: Array<{ role: "user" | "assistant"; content: string }>; }): Promise<{ answer: string; rawContent: string }> { const safeMessages = params.messages.map((item) => ({ role: item.role, content: asString(item.content) })).filter((item) => item.content); const completion = await getKimiProvider().chatCompletion({ model: params.model, temperature: 0.3, promptCacheKey: "kimi-basic-chat-v1", credentialsOverride: { apiKey: params.apiKey, apiBaseUrl: params.apiUrl }, messages: [{ role: "system", content: "你是工作量评估系统内置助手（KIMI）。请用中文简洁回答，优先结合用户上下文，避免冗余。" }, ...safeMessages] }); return { answer: completion.content, rawContent: completion.rawContent }; }

export async function chat(req: Request, res: Response) { const requestId = randomUUID(); const body = (req.body || {}) as { messages?: Array<{ role?: string; content?: string }> }; const messages = Array.isArray(body.messages) ? body.messages.map((item) => ({ role: asString(item?.role) === "assistant" ? "assistant" as const : "user" as const, content: asString(item?.content) })).filter((item) => item.content) : []; if (messages.length === 0) return fail(res, 40001, "参数错误", [{ field: "messages", reason: "required" }]); const apiKey = config.kimi.apiKey; if (!apiKey) return fail(res, 40001, "参数错误", [{ field: "apiKey", reason: "required_or_env_missing" }]); try { const result = await chatWithKimi({ apiUrl: config.kimi.apiBaseUrl, apiKey, model: config.kimi.model, messages: messages.slice(-12) }); return res.json(ok({ answer: result.answer, model: normalizeKimiModelName(config.kimi.model) }, requestId)); } catch (err) { return fail(res, 40001, "参数错误", [{ field: "messages/api", reason: err instanceof Error ? err.message : "chat_failed" }]); } }
