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
import { buildWorkbenchChatDispatchInput } from "../../services/ai/handlers/workbench-shared";
import type { AuthUser } from "../../types";

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
      });
    },
  });
  const registry = createHarnessWorkflowRegistry([workflow]);

  const worker = options.createWorker
    ? options.createWorker({ repo: options.repo, registry })
    : createHarnessRuntimeWorker({ repository: options.repo, registry, workerId: "wes-worker-1" });

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
