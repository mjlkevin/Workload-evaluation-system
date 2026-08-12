// ============================================================
// Workflow 适配器：workbench_chat_v1@1.0.0（RP-047 Batch E · Step 1）
// ============================================================
// 复用 workbench-dispatch.service.ts 意图分发链路，
// 经 HarnessWorker recordToolEffectOnce 实现幂等，
// 结果经 outbox 投递 assistant 消息到会话。
//
// Batch E 二次返工（新通道消息落库双缺陷修复，ISS-2026-08-09-002）：
// C1 缺陷 A：outbox payload 携带 projector 契约的 message 字段
//   （{ message: { role, content } }），保留既有 answer/intent 等键；
// C2 缺陷 B：用户消息在 dispatch 前经 ai-sessions 幂等 API 落库，
//   来源键 ${runId}:user:1 防恢复重放重复；503 回退同步路径不经
//   本 workflow，零双写。

import { randomUUID } from "node:crypto";
import type {
  HarnessWorkflow,
  HarnessWorkflowStepContext,
  HarnessWorkflowStepOutcome,
} from "./harness-runtime.worker";
import type { WorkbenchDispatchInput, WorkbenchDispatchData } from "../../services/ai/workbench-dispatch.service";
import type {
  AppendAiSessionMessageIdempotentInput,
  AppendAiSessionMessageIdempotentResult,
} from "../ai-sessions/ai-sessions.repository";
import type { AiAttachment } from "../ai-sessions/ai-sessions.types";
import { normalizeHomeAttachments } from "../../services/ai/handlers/workbench-shared";

export type WorkbenchChatWorkflowDeps = {
  /**
   * 复用 workbench-dispatch.service.ts 的分发入口。
   * 调用方注入真实 dispatch 或测试 stub。
   */
  dispatch(input: Pick<WorkbenchDispatchInput, "message" | "user" | "workflowKey"> & Partial<WorkbenchDispatchInput>): Promise<WorkbenchDispatchData>;
  /**
   * 用户消息幂等落库（复用 ai-sessions 仓库公开 API，与投影 sink 同款）。
   * 生产接线见 harness-boot.ts；测试可注入指向临时存储的实现。
   */
  appendSessionMessage(input: Omit<AppendAiSessionMessageIdempotentInput, "storePath">): AppendAiSessionMessageIdempotentResult;
  /**
   * ISS-2026-08-10-004（层 2）：流式事件写入 run 事件流（additive）。
   * 生产接线复用 harness runtime repository 的 appendRunEvent（白名单校验后落库，
   * SSE 端点原样透传）；payload 形状对齐前端消费侧：
   * text.delta → { delta }，thought → { text }。
   * 可选以保持 additive 不破坏既有构造点（如 projector 测试 stub）；
   * 未注入时流式事件静默跳过，不影响 dispatch 主链路。
   */
  appendRunEvent?(input: {
    runId: string;
    eventType: "text.delta" | "thought";
    payload: Record<string, unknown>;
  }): Promise<unknown>;
};

export function createWorkbenchChatWorkflow(deps: WorkbenchChatWorkflowDeps): HarnessWorkflow {
  const CHAT_STEP_KEY = "chat";

  return {
    workflowId: "workbench_chat_v1",
    workflowVersion: "1.0.0",
    firstStepKey: CHAT_STEP_KEY,
    stepKeys: [CHAT_STEP_KEY],

    async executeStep(stepKey: string, ctx: HarnessWorkflowStepContext): Promise<HarnessWorkflowStepOutcome> {
      if (stepKey !== CHAT_STEP_KEY) {
        throw new Error(`Unknown step key: ${stepKey}`);
      }

      const run = ctx.run;
      const executionConfig = (run.executionConfig ?? {}) as Record<string, unknown>;
      const content = String(executionConfig.content ?? "").trim();
      if (!content) {
        throw new Error("executionConfig.content is required");
      }
      const aiSessionId = run.aiSessionId;
      if (!aiSessionId) {
        throw new Error("run.aiSessionId is required for workbench chat");
      }
      const attachments = normalizeHomeAttachments(executionConfig.attachments).slice(0, 5);
      const storedAttachments: AiAttachment[] = attachments.map((attachment) => ({
        attachmentId: `att-${randomUUID()}`,
        ...attachment,
        createdAt: new Date().toISOString(),
      }));
      const dispatchAttachment = attachments.find((attachment) => attachment.parsedSummary) ?? attachments[0] ?? null;

      // C2 缺陷 B：用户消息先于 dispatch 幂等落库（旧同步路径同款结构）；
      // 来源键 run 维度 deduplicationKey，恢复重放由去重吸收，不重复。
      deps.appendSessionMessage({
        sessionId: aiSessionId,
        message: {
          messageId: `msg-${randomUUID()}`,
          role: "user",
          content,
          createdAt: new Date().toISOString(),
          attachmentIds: storedAttachments.map((attachment) => attachment.attachmentId),
        },
        attachments: storedAttachments,
        source: {
          deduplicationKey: `${run.harnessRunId}:user:1`,
          runId: run.harnessRunId,
          eventType: "user_message",
        },
      });

      // effectKey 冻结口径：workbench_chat_answer
      const effectKey = ctx.makeEffectKey("workbench_chat_answer", 1);

      const effectResult = await ctx.recordToolEffectOnce({
        effectKey,
        toolName: "workbench_chat_dispatch",
        input: { content, sessionId: run.aiSessionId },
        execute: async () => {
          // ISS-2026-08-10-004（层 2）：异步通道接入逐字流式——dispatch 入参携带
          // streamingAdapter，onToken 逐 chunk 直发写 run 事件流（不做 coalescing）：
          // contentDelta → text.delta({ delta })，reasoningContentDelta → thought({ text })；
          // onComplete/onError 不另写事件（终态事件由 runtime 既有链路发射）。
          // 副作用位于 execute 内，恢复重放经 recordToolEffectOnce 跳过，幂等天然成立；
          // 写链串行化保持事件时序，单条写失败不阻断模型主链路。
          let streamEventChain: Promise<unknown> = Promise.resolve();
          const appendStreamEvent = (eventType: "text.delta" | "thought", payload: Record<string, unknown>) => {
            if (!deps.appendRunEvent) return; // 未注入（兼容构造点）时静默跳过
            const append = deps.appendRunEvent;
            streamEventChain = streamEventChain
              .then(() => append({ runId: run.harnessRunId, eventType, payload }))
              .catch((err) => {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[workbench-chat] appendRunEvent ${eventType} run=${run.harnessRunId} failed: ${msg.slice(0, 200)}`);
              });
          };
          const streamingAdapter = {
            onToken: (chunk: { contentDelta?: string; reasoningContentDelta?: string }) => {
              if (chunk.reasoningContentDelta) {
                appendStreamEvent("thought", { text: chunk.reasoningContentDelta });
              }
              if (chunk.contentDelta) {
                appendStreamEvent("text.delta", { delta: chunk.contentDelta });
              }
            },
          };
          const result = await deps.dispatch({
            message: content,
            attachment: dispatchAttachment,
            user: { id: run.ownerUserId, username: run.ownerUsername, role: "user", status: "active", passwordHash: "", createdAt: "", lastLoginAt: "" },
            workflowKey: "free_chat",
            streamingAdapter,
          });
          // execute 返回前冲刷写链，避免流式事件丢失在游离 promise 中
          await streamEventChain;
          return {
            answer: result.answer,
            intent: result.intent,
            suggestedActions: result.suggestedActions,
            trace: result.trace,
            formBlock: result.formBlock,
          };
        },
      });

      const output = effectResult.output ?? { answer: "" };
      const answer = String(output.answer ?? "");
      const intent = String((output as any).intent ?? "domain_qa");
      const suggestedActions = (output as any).suggestedActions ?? [];
      const trace = (output as any).trace ?? {};
      const formBlock = (output as any).formBlock;
      const messageMetadata = {
        intent,
        suggestedActions,
        trace,
        ...(formBlock ? { formBlock } : {}),
      };

      return {
        nextStepKey: null, // 单步 workflow，执行后直接终态
        outbox: [
          {
            eventType: "assistant_message",
            deduplicationKey: `${run.harnessRunId}:assistant:1`,
            payload: {
              // C1 缺陷 A：projector 契约字段，投影落库的正文来源
              message: { role: "assistant", content: answer, metadata: messageMetadata },
              answer,
              intent,
              suggestedActions,
              trace,
              ...(formBlock ? { formBlock } : {}),
            },
          },
        ],
      };
    },
  };
}
