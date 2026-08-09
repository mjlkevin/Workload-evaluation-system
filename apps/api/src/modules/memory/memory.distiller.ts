// ============================================================
// SP-2026-007 · MS2（M2 会话记忆分层蒸馏）
// memory.distiller — Harness Run 终态后异步蒸馏记忆
// ============================================================
// 设计约束：
//  1. 蒸馏失败不阻塞主链路（降级为无记忆模式并留 toolEvent）
//  2. 调用 Kimi Provider 执行结构化蒸馏提示词
//  3. 输出经校验后落 L1/L2
//  4. 默认 draft，用户确认后才转 active

import type { MemoryRepository } from "./memory.repository";
import { validateDistillOutput } from "./memory.types";
import type { ModelProvider } from "../../ai/provider";

export type MemoryDistillerDeps = {
  repo: MemoryRepository;
  provider: ModelProvider;
  model: string;
  apiKey: string;
  apiBaseUrl: string;
  timeoutMs?: number;
};

export type DistillRunMemoryInput = {
  ownerUserId: string;
  projectId: string;
  harnessRunId: string;
  runTitle: string;
  messages: { role: string; content: string }[];
};

const DISTILL_SYSTEM_PROMPT = `你是 WES 记忆蒸馏助手。请从以下 AI 工作台会话中提炼结构化记忆。

输出必须严格为 JSON，格式如下：
{
  "atoms": [
    { "factKey": "唯一键", "factText": "原子事实文本", "confidence": 90 }
  ],
  "scenes": [
    { "sceneTitle": "场景标题", "sceneSummary": "场景摘要", "atomKeys": ["关联的 factKey"] }
  ]
}

规则：
- atoms 最多 20 条，scenes 最多 10 条
- factKey 用英文小写+下划线，如 "customer_name"
- confidence 范围 0-100，越高表示越确定
- 只提取与项目评估、需求分析、实施范围相关的业务事实
- 不要提取通用寒暄、系统操作指令`;

export async function distillRunMemory(
  deps: MemoryDistillerDeps,
  input: DistillRunMemoryInput,
): Promise<{ success: boolean; atomsCount: number; scenesCount: number; error?: string }> {
  const { repo, provider, model, apiKey, apiBaseUrl, timeoutMs = 60000 } = deps;

  try {
    const userContent = buildDistillUserContent(input);

    const completion = await provider.chatCompletion({
      model,
      temperature: 0.3,
      timeoutMs,
      credentialsOverride: { apiKey, apiBaseUrl },
      messages: [
        { role: "system", content: DISTILL_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    });

    const raw = completion.content.trim();
    const json = extractJsonFromMarkdown(raw);
    if (!json) {
      return { success: false, atomsCount: 0, scenesCount: 0, error: "distill_response_not_json" };
    }

    const parsed = JSON.parse(json);
    const validated = validateDistillOutput(parsed);
    if (!validated.success) {
      return { success: false, atomsCount: 0, scenesCount: 0, error: "distill_schema_invalid" };
    }

    const result = await repo.saveDistilledMemory({
      ownerUserId: input.ownerUserId,
      projectId: input.projectId,
      harnessRunId: input.harnessRunId,
      distill: validated.data,
    });

    return {
      success: true,
      atomsCount: result.atoms.length,
      scenesCount: result.scenes.length,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { success: false, atomsCount: 0, scenesCount: 0, error: errorMessage.slice(0, 200) };
  }
}

function buildDistillUserContent(input: DistillRunMemoryInput): string {
  const lines = [
    `项目ID: ${input.projectId}`,
    `Run标题: ${input.runTitle}`,
    "会话内容:",
  ];
  for (const msg of input.messages) {
    lines.push(`${msg.role}: ${msg.content}`);
  }
  return lines.join("\n");
}

function extractJsonFromMarkdown(raw: string): string | null {
  const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlock) return codeBlock[1].trim();
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }
  return null;
}
