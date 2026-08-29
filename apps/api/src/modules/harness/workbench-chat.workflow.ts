// ============================================================
// Workflow 适配器：workbench_chat_v1@1.0.0（RP-047 Batch E · Step 1）
// ============================================================
// 复用 workbench-dispatch.service.ts 意图分发链路，
// 经 HarnessWorker recordToolEffectOnce 实现幂等，
// assistant 消息经 appendSessionMessage 直接幂等落库（S2b-2 后 outbox 恒空）。
//
// Batch E 二次返工（新通道消息落库双缺陷修复，ISS-2026-08-09-002）：
// C1 缺陷 A：assistant 直写内容与 answer 一致（不落空消息）；
// C2 缺陷 B：用户消息在 dispatch 前经 ai-sessions 幂等 API 落库，
//   来源键 ${runId}:user:1 防恢复重放重复；503 回退同步路径不经
//   本 workflow，零双写。
// S2a（阶段 2 · §4.8）：assistant 消息改为同款直接幂等落库（同库直写）；
// S2b-2（2026-08-28）：projector/sink/outbox 表随 §4.8 补偿链删除，outbox 恒空，
//   恢复重放由 repository 层来源键查重吸收。

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
import type { AiAttachment, AiSessionRecord } from "../ai-sessions/ai-sessions.types";
import { normalizeHomeAttachments, latestSessionAttachmentWithSummary, isExplicitReportRequest } from "../../services/ai/handlers/workbench-shared";
import { runExplicitHomeReportFlow } from "../../services/ai/handlers/report-flow";
import type { recordWorkbenchTurnTrace, recordWorkbenchTurnFailureTrace } from "../trace/trace.usecase";

export type WorkbenchChatWorkflowDeps = {
  /**
   * 复用 workbench-dispatch.service.ts 的分发入口。
   * 调用方注入真实 dispatch 或测试 stub。
   */
  dispatch(input: Pick<WorkbenchDispatchInput, "message" | "user" | "workflowKey"> & Partial<WorkbenchDispatchInput>): Promise<WorkbenchDispatchData>;
  /**
   * 用户消息幂等落库（复用 ai-sessions 仓库公开 API，与直写路径同款）。
   * 生产接线见 harness-boot.ts；测试可注入 recording fake（S2b-2 后不再有
   * storePath 注入钩子）。阶段 1 批 8：返回类型由同步改 Promise。
   */
  appendSessionMessage(input: AppendAiSessionMessageIdempotentInput): Promise<AppendAiSessionMessageIdempotentResult>;
  /**
   * ISS-2026-08-10-004（层 2）：流式事件写入 run 事件流（additive）。
   * 生产接线复用 harness runtime repository 的 appendRunEvent（白名单校验后落库，
   * SSE 端点原样透传）；payload 形状对齐前端消费侧：
   * text.delta → { delta }，thought → { text }。
   * 可选以保持 additive 不破坏既有构造点（如 workflow 测试 stub）；
   * 未注入时流式事件静默跳过，不影响 dispatch 主链路。
   */
  appendRunEvent?(input: {
    runId: string;
    eventType: "text.delta" | "thought";
    payload: Record<string, unknown>;
  }): Promise<unknown>;
  /**
   * ISS-2026-08-16-002：会话级附件回退——请求未携带附件时，从已落库会话
   * 记录中取最近一个带 parsedSummary 的附件作为 dispatch 上下文（与同步
   * 路径 workbench-chat.handler.ts L59 同一口径）。
   * 生产接线见 harness-boot.ts（复用 ai-sessions usecase）；测试注入临时存储实现。
   * 可选以保持 additive 不破坏既有构造点；未注入时回退静默跳过（行为同修复前）。
   * 阶段 1 批 8：返回类型由同步改 Promise（底层 accessor 已异步化），实现 不动。
   */
  getSessionRecord?(sessionId: string, ownerUserId: string): Promise<AiSessionRecord | null>;
  /**
   * RP-030 真实链路覆盖（2026-08-28）：异步通道 trace 归档（与同步路径
   * workbench-chat.handler.ts 同口径）。生产接线注入 trace.usecase 真实
   * 实现；测试注入 spy。可选以保持 additive 不破坏既有构造点；未注入时
   * 静默跳过。写入必须置于 recordToolEffectOnce 的 execute 内——恢复重放
   * 跳过 execute，幂等天然成立（同流式事件口径）。
   */
  recordTurnTrace?(input: Parameters<typeof recordWorkbenchTurnTrace>[0]): Promise<unknown>;
  recordTurnFailureTrace?(input: Parameters<typeof recordWorkbenchTurnFailureTrace>[0]): Promise<unknown>;
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
      // ISS-2026-08-16-002：请求级附件优先，缺失时经 getSessionRecord 回退到
      // 已落库会话附件（与同步路径 workbench-chat.handler.ts L59 同一口径）——
      // 覆盖「同一会话第二轮无附件请求」场景（如先传附件解析，再发"生成报告"）。
      const dispatchAttachment = attachments.find((attachment) => attachment.parsedSummary) ?? attachments[0]
        ?? latestSessionAttachmentWithSummary((await deps.getSessionRecord?.(aiSessionId, run.ownerUserId)) ?? null);

      // C2 缺陷 B：用户消息先于 dispatch 幂等落库（旧同步路径同款结构）；
      // 来源键 run 维度 deduplicationKey，恢复重放由去重吸收，不重复。
      await deps.appendSessionMessage({
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

      // ISS-2026-08-16-004：显式报告闸门——当 dispatchAttachment 存在且用户消息
      // 是「生成需求解析报告」时，直接调用 runExplicitHomeReportFlow 生成报告，
      // 而不是走 dispatchHomeWorkbenchTurn 的意图分发（后者路由到静态文案）。
      // 与同步路径 workbench-chat.handler.ts L65 同一口径。
      if (dispatchAttachment && isExplicitReportRequest(content)) {
        const sessionWithUserTurn = (await deps.getSessionRecord?.(aiSessionId, run.ownerUserId)) ?? null;
        if (!sessionWithUserTurn) {
          throw new Error(`session not found: ${aiSessionId}`);
        }
        const flowResult = await runExplicitHomeReportFlow({
          user: { id: run.ownerUserId, username: run.ownerUsername, role: "user", status: "active", passwordHash: "", createdAt: "", lastLoginAt: "" },
          workflowKey: "free_chat",
          session: sessionWithUserTurn,
          sessionWithUserTurn,
          parsedAttachment: dispatchAttachment,
          allAttachments: [dispatchAttachment],
        });
        if (flowResult.ok) {
          // runExplicitHomeReportFlow 已直接落库 assistant 消息 + artifact + pendingAction，
          // 返回空 outbox 避免双写（S2b-2 后补偿链已删，outbox 恒空）。
          return {
            nextStepKey: null,
            outbox: [],
          };
        }
        // API Key 缺失时回退到普通 dispatch（与同步路径行为对齐：同步路径返回 40001，
        // 异步路径降级为普通问答，由意图分发器路由到静态文案）。
      }

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
          let result: Awaited<ReturnType<WorkbenchChatWorkflowDeps["dispatch"]>>;
          try {
            result = await deps.dispatch({
              message: content,
              attachment: dispatchAttachment,
              user: { id: run.ownerUserId, username: run.ownerUsername, role: "user", status: "active", passwordHash: "", createdAt: "", lastLoginAt: "" },
              workflowKey: "free_chat",
              streamingAdapter,
            });
          } catch (err) {
            // RP-030：失败 trace 归档（与同步路径同口径；归档自身失败静默吸收），随后重抛由 runtime 标记 run failed
            if (deps.recordTurnFailureTrace) {
              const reason = err instanceof Error ? err.message : "workbench_chat_failed";
              await deps.recordTurnFailureTrace({
                ownerUserId: run.ownerUserId,
                ownerUsername: run.ownerUsername,
                aiSessionId,
                userInputSummary: content.slice(0, 200),
                routingRule: "failed_before_dispatch",
                contextRefs: dispatchAttachment ? [`attachment:${dispatchAttachment.name}`] : [],
                error: { code: reason, message: reason, retryable: true },
              }).catch(() => {
                // 失败 trace 写入失败不影响主链路
              });
            }
            throw err;
          }
          // execute 返回前冲刷写链，避免流式事件丢失在游离 promise 中
          await streamEventChain;
          // RP-030：成功 trace 归档（置于 execute 内，恢复重放跳过不重复写）
          if (deps.recordTurnTrace) {
            await deps.recordTurnTrace({
              ownerUserId: run.ownerUserId,
              ownerUsername: run.ownerUsername,
              aiSessionId,
              userInputSummary: content.slice(0, 200),
              dispatchTrace: result.trace,
              model: result.model,
            }).catch(() => {
              // trace 写入失败不影响主链路
            });
          }
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

      // S2b-2（§4.8 补偿链删除）：assistant 消息与 user 消息同款经
      // appendSessionMessage 直接幂等落库（同库直写），来源键
      // ${run.harnessRunId}:assistant:1 由仓储层按键查重吸收；outbox 恒空
      // （projector/sink/outbox 表已随补偿链删除，恢复重放由去重吸收）。
      await deps.appendSessionMessage({
        sessionId: aiSessionId,
        message: {
          messageId: `msg-${randomUUID()}`,
          role: "assistant",
          content: answer,
          createdAt: new Date().toISOString(),
          metadata: messageMetadata,
        },
        source: {
          deduplicationKey: `${run.harnessRunId}:assistant:1`,
          runId: run.harnessRunId,
          eventType: "assistant_message",
        },
      });

      return {
        nextStepKey: null, // 单步 workflow，执行后直接终态
        outbox: [],
      };
    },
  };
}
