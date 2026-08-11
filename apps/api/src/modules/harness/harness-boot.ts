// ============================================================
// Harness Runtime Boot（RP-047 Batch E · Step 2）
// ============================================================
// 导出 startHarnessRuntime({ repo, enabled }) → { stop }；
// enabled=true 时创建 registry + worker + projector 并 start；
// enabled=false 返回 no-op stop。

import type { HarnessRuntimeRepository } from "./harness-runtime.repository";
import { createHarnessRuntimeWorker, type HarnessRuntimeWorker } from "./harness-runtime.worker";
import { createHarnessSessionProjector, type HarnessSessionProjector } from "./harness-session-projector";
import { createHarnessSessionSink } from "./harness-session-sink";
import { createWorkbenchChatWorkflow } from "./workbench-chat.workflow";
import { createHarnessWorkflowRegistry } from "./harness-runtime.worker";
import { dispatchHomeWorkbenchTurn } from "../../services/ai/workbench-dispatch.service";
import type { StreamingChunk } from "../../services/ai/workbench-dispatch.service";
import { buildWorkbenchChatDispatchInput, getKimiProvider } from "../../services/ai/handlers/workbench-shared";
import { appendAiSessionMessageIdempotent } from "../ai-sessions/ai-sessions.repository";
import type { AuthUser } from "../../types";
import { config } from "../../config/env";
import { loadRequirementSystemConfigStore, resolveActiveRequirementKimiApiKey } from "../system/system.repository";
import { distillRunMemory } from "../memory/memory.distiller";
import { getMemoryRepository } from "../memory/memory.module";

export type HarnessRuntimeBootOptions = {
  repo: HarnessRuntimeRepository;
  enabled: boolean;
  /** 测试注入用：自定义 worker 工厂 */
  createWorker?: (opts: { repo: HarnessRuntimeRepository; registry: ReturnType<typeof createHarnessWorkflowRegistry> }) => HarnessRuntimeWorker;
  /** 测试注入用：自定义 projector 工厂 */
  createProjector?: (opts: { repo: HarnessRuntimeRepository }) => HarnessSessionProjector;
  /** 测试注入用：自定义 modelChat 工厂（覆盖默认真实组装） */
  createModelChat?: (user: AuthUser, content: string) => import("../../services/ai/handlers/workbench-shared").ModelChatFactory;
};

export type HarnessRuntimeBootResult = {
  stop(): Promise<void>;
};

// ============================================================
// SP-2026-007 MS2 补测：Run 终态蒸馏钩子（可注入工厂）
// 生产默认装配真实依赖；测试注入 distill/onError 替身，
// 失败路径必须经 onError 留痕（不得仅 console.error 静默）。
// ============================================================

export type RunTerminalOutcome = "completed" | "failed" | "cancelled";

export type RunTerminalMemoryHookDeps = {
  repo: HarnessRuntimeRepository;
  resolveApiKey: () => { apiKey: string };
  getProvider: () => ReturnType<typeof getKimiProvider>;
  getMemoryRepo: () => ReturnType<typeof getMemoryRepository>;
  distill: typeof distillRunMemory;
  model: string;
  apiBaseUrl: string;
  timeoutMs: number;
  onError: (info: { harnessRunId: string; outcome: string; error: string }) => void;
};

export function createRunTerminalMemoryHook(deps: RunTerminalMemoryHookDeps) {
  return async (run: any, outcome: RunTerminalOutcome): Promise<void> => {
    if (outcome !== "completed") return;
    try {
      const snapshot = await deps.repo.getRunSnapshot(run.harnessRunId);
      const outputContent = snapshot?.output?.content as Record<string, unknown> | undefined;
      const answer = typeof outputContent?.answer === "string" ? outputContent.answer : "";
      const userMessage = run.title || "";
      if (!userMessage && !answer) return;

      const { apiKey } = deps.resolveApiKey();
      if (!apiKey) return; // 无 API Key 时静默跳过

      const result = await deps.distill(
        {
          repo: deps.getMemoryRepo(),
          provider: deps.getProvider(),
          model: deps.model,
          apiKey,
          apiBaseUrl: deps.apiBaseUrl,
          timeoutMs: deps.timeoutMs,
        },
        {
          ownerUserId: run.ownerUserId,
          projectId: run.projectEvaluationId || run.metadata?.projectId || "default",
          harnessRunId: run.harnessRunId,
          runTitle: run.title,
          messages: [
            { role: "user", content: userMessage },
            { role: "assistant", content: answer },
          ],
        },
      );
      // 蒸馏返回 success=false 属于业务失败，同样必须留痕（此前静默）
      if (result && result.success === false) {
        deps.onError({
          harnessRunId: run.harnessRunId,
          outcome,
          error: String(result.error || "distill_failed").slice(0, 200),
        });
      }
    } catch (distillErr) {
      // 蒸馏失败不阻塞主链路，降级为无记忆模式并留可追溯日志
      const msg = distillErr instanceof Error ? distillErr.message : String(distillErr);
      deps.onError({ harnessRunId: run.harnessRunId, outcome, error: msg.slice(0, 200) });
    }
  };
}

export function startHarnessRuntime(options: HarnessRuntimeBootOptions): HarnessRuntimeBootResult {
  if (!options.enabled) {
    return {
      async stop() {
        // no-op
      },
    };
  }

  // RP-047 Batch E 返工 · B1：默认组装真实 dispatch，支持 createModelChat 注入
  const workflow = createWorkbenchChatWorkflow({
    dispatch: async (input) => {
      const user = input.user as AuthUser;
      const content = input.message;
      const dispatchInput = buildWorkbenchChatDispatchInput(user, content, {
        modelChat: options.createModelChat ? options.createModelChat(user, content) : undefined,
      });
      // ISS-2026-08-10-004（层 2）：workflow 注入 streamingAdapter 时接线流式模型调用——
      // dispatch 流式闸门（model-answer）要求 streamingAdapter + modelChatStream 同时
      // 存在，缺一则静默回退非流式；异步通道无历史消息，与同步 SSE 路径同款参数直推
      // 当前 userContent（同步路径逐字行为零改动）。
      const modelChatStream = async function* (params: { systemPrompt: string; userContent: string }): AsyncIterable<StreamingChunk> {
        const { apiKey } = resolveActiveRequirementKimiApiKey();
        if (!apiKey) throw new Error("required_or_env_missing");
        const provider = getKimiProvider();
        if (!provider.streamChatCompletion) throw new Error("stream_not_supported");
        const stream = provider.streamChatCompletion({
          model: config.kimi.model,
          temperature: 0.3,
          promptCacheKey: "home-workbench-dispatch-v1",
          timeoutMs: loadRequirementSystemConfigStore().active.kimiEvaluation.timeoutMs || 120000,
          credentialsOverride: { apiKey, apiBaseUrl: config.kimi.apiBaseUrl },
          messages: [
            { role: "system", content: params.systemPrompt },
            { role: "user", content: params.userContent },
          ],
        });
        for await (const chunk of stream) {
          yield {
            contentDelta: chunk.contentDelta || "",
            reasoningContentDelta: chunk.reasoningContentDelta || "",
            model: chunk.model,
            finishReason: chunk.finishReason,
          };
        }
      };
      return dispatchHomeWorkbenchTurn({
        requestId: `harness-${Date.now()}`,
        user: dispatchInput.user,
        workflowKey: dispatchInput.workflowKey,
        message: dispatchInput.message,
        attachment: dispatchInput.attachment,
        latestHarnessArtifact: dispatchInput.latestHarnessArtifact,
        clientAction: dispatchInput.clientAction,
        businessRole: dispatchInput.businessRole,
        roleLabel: dispatchInput.roleLabel,
        model: dispatchInput.model,
        rolePrompt: dispatchInput.rolePrompt,
        modelChat: dispatchInput.modelChat,
        ...(input.streamingAdapter
          ? { streamingAdapter: input.streamingAdapter, modelChatStream }
          : {}),
      });
    },
    // Batch E 二次返工（新通道消息落库）C2：用户消息幂等落库生产接线，
    // 与投影 sink 同款 API，默认会话存储路径（data/ai-sessions.json）。
    appendSessionMessage: (input) => appendAiSessionMessageIdempotent(input),
    // ISS-2026-08-10-004（层 2）：流式事件写 run 事件流，复用 runtime repository
    // （白名单校验 + 序号分配 + SSE 透传均走既有链路）。
    appendRunEvent: (input) => options.repo.appendRunEvent(input),
  });
  const registry = createHarnessWorkflowRegistry([workflow]);

  // SP-2026-007 MS2：Run 终态后异步蒸馏记忆钩子（工厂装配真实依赖；
  // 失败留痕走 onError → console.error，与此前口径一致并补 success=false 留痕）
  const onRunTerminal = createRunTerminalMemoryHook({
    repo: options.repo,
    resolveApiKey: () => resolveActiveRequirementKimiApiKey(),
    getProvider: () => getKimiProvider(),
    getMemoryRepo: () => getMemoryRepository(),
    distill: distillRunMemory,
    model: config.kimi.model,
    apiBaseUrl: config.kimi.apiBaseUrl,
    timeoutMs: 60000,
    onError: ({ harnessRunId, outcome, error }) => {
      console.error(`[memory-distill] run=${harnessRunId} outcome=${outcome} error=${error}`);
    },
  });

  const worker = options.createWorker
    ? options.createWorker({ repo: options.repo, registry })
    : createHarnessRuntimeWorker({ repository: options.repo, registry, workerId: "wes-worker-1", onRunTerminal });

  const projector = options.createProjector
    ? options.createProjector({ repo: options.repo })
    : createHarnessSessionProjector({
        repository: options.repo,
        sink: createHarnessSessionSink(),
        projectorId: "wes-projector-1",
      });

  // 异步启动（不 await，让 boot 立即返回）
  const workerStart = worker.start();
  const projectorStart = projector.start();

  return {
    async stop() {
      await worker.stop();
      projector.stop();
      await workerStart.catch(() => {});
      await projectorStart.catch(() => {});
    },
  };
}
