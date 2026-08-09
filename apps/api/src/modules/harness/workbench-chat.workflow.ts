// ============================================================
// Workflow 适配器：workbench_chat_v1@1.0.0（RP-047 Batch E · Step 1）
// ============================================================
// 复用 workbench-dispatch.service.ts 意图分发链路，
// 经 HarnessWorker recordToolEffectOnce 实现幂等，
// 结果经 outbox 投递 assistant 消息到会话。

import type {
  HarnessWorkflow,
  HarnessWorkflowStepContext,
  HarnessWorkflowStepOutcome,
} from "./harness-runtime.worker";
import type { WorkbenchDispatchInput, WorkbenchDispatchData } from "../../services/ai/workbench-dispatch.service";

export type WorkbenchChatWorkflowDeps = {
  /**
   * 复用 workbench-dispatch.service.ts 的分发入口。
   * 调用方注入真实 dispatch 或测试 stub。
   */
  dispatch(input: Pick<WorkbenchDispatchInput, "message" | "user" | "workflowKey"> & Partial<WorkbenchDispatchInput>): Promise<WorkbenchDispatchData>;
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

      // effectKey 冻结口径：workbench_chat_answer
      const effectKey = ctx.makeEffectKey("workbench_chat_answer", 1);

      const effectResult = await ctx.recordToolEffectOnce({
        effectKey,
        toolName: "workbench_chat_dispatch",
        input: { content, sessionId: run.aiSessionId },
        execute: async () => {
          const result = await deps.dispatch({
            message: content,
            user: { id: run.ownerUserId, username: run.ownerUsername, role: "user", status: "active", passwordHash: "", createdAt: "", lastLoginAt: "" },
            workflowKey: "free_chat",
          });
          return {
            answer: result.answer,
            intent: result.intent,
            suggestedActions: result.suggestedActions,
            trace: result.trace,
          };
        },
      });

      const output = effectResult.output ?? { answer: "" };

      return {
        nextStepKey: null, // 单步 workflow，执行后直接终态
        outbox: [
          {
            eventType: "assistant_message",
            deduplicationKey: `${run.harnessRunId}:assistant:1`,
            payload: {
              answer: String(output.answer ?? ""),
              intent: String((output as any).intent ?? "domain_qa"),
              suggestedActions: (output as any).suggestedActions ?? [],
              trace: (output as any).trace ?? {},
            },
          },
        ],
      };
    },
  };
}
