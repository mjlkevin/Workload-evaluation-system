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

export type HarnessRuntimeBootOptions = {
  repo: HarnessRuntimeRepository;
  enabled: boolean;
  /** 测试注入用：自定义 worker 工厂 */
  createWorker?: (opts: { repo: HarnessRuntimeRepository; registry: ReturnType<typeof createHarnessWorkflowRegistry> }) => HarnessRuntimeWorker;
  /** 测试注入用：自定义 projector 工厂 */
  createProjector?: (opts: { repo: HarnessRuntimeRepository }) => HarnessSessionProjector;
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

  const workflow = createWorkbenchChatWorkflow({
    dispatch: async () => {
      // 真实 dispatch 由调用方注入；boot 阶段只负责组装
      throw new Error("dispatch not wired in boot; use test injection or wire in main.ts");
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
