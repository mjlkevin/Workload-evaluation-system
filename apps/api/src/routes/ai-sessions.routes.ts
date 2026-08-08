// ============================================================
// AI Sessions 路由
// ============================================================
// RP-047 Batch C 改造为工厂模式（D2/D5）：
//   - flag 开启且注入 repo 时挂载 POST /:sessionId/runs（异步提交，202）
//     与带活跃 Run 409 保护的 DELETE /:sessionId；
//   - flag 关闭时提交端点仍挂载但统一 503 ASYNC_RUNS_DISABLED；
//   - Batch D（E1）：flag 关闭分支的 DELETE 同样注入 activeRunChecker
//     （复用 repo.hasActiveRunForSession），命中活跃 Run 返回 409
//     SESSION_HAS_ACTIVE_RUN 且不删除；无活跃 Run 时行为与旧同步删除一致；
//   - default 导出保持 Router 实例兼容既有注册方式。

import { Router } from "express";

import * as AiSessionsModule from "../modules/ai-sessions/ai-sessions.module";
import { getAiSession } from "../modules/ai-sessions/ai-sessions.usecase";
import { createAiRunsHandlers, createDeleteSessionHandler } from "../modules/harness/harness-runtime.controller";
import {
  createAiRunsUsecase,
  isDurableRunsEnabledFromEnv,
} from "../modules/harness/harness-runtime.usecase";
import {
  createHarnessRuntimeRepository,
  type HarnessRuntimeRepository,
} from "../modules/harness/harness-runtime.repository";
import { requireCapability } from "../rbac/middleware";

export type AiSessionsRouterDeps = {
  repo?: HarnessRuntimeRepository;
  enabled?: boolean;
  heartbeatMs?: number;
  pollMs?: number;
  batchLimit?: number;
};

export function createAiSessionsRouter(deps: AiSessionsRouterDeps = {}): Router {
  const enabled = deps.enabled ?? isDurableRunsEnabledFromEnv();
  // repo 缺省接全局懒加载 db 代理（模块加载不建连接）
  const repo = deps.repo ?? createHarnessRuntimeRepository();

  const runsUsecase = createAiRunsUsecase({
    repo,
    enabled,
    findSession: async (user, sessionId) => getAiSession(user, sessionId),
  });
  const runsHandlers = createAiRunsHandlers({ usecase: runsUsecase });

  const router = Router();
  router.get("/", requireCapability("estimates:read"), AiSessionsModule.listSessions);
  router.post("/", requireCapability("estimates:read"), AiSessionsModule.createSession);
  router.get("/:sessionId", requireCapability("estimates:read"), AiSessionsModule.getSession);
  router.patch("/:sessionId", requireCapability("estimates:read"), AiSessionsModule.renameSession);
  router.post("/:sessionId/events", requireCapability("estimates:read"), AiSessionsModule.appendSessionEvent);
  router.post("/:sessionId/standard-drafts", requireCapability("system:manage"), AiSessionsModule.createStandardDraft);

  // 提交端点始终挂载：flag 关闭时由 usecase 统一返回 503（G4）
  router.post("/:sessionId/runs", runsHandlers.submitRunHandler);

  if (enabled) {
    router.delete("/:sessionId", createDeleteSessionHandler({ repo }));
  } else {
    // E1：旧分支同样接入活跃 Run 守护，避免绕过 enabled 分支的 409 保护
    router.delete(
      "/:sessionId",
      requireCapability("estimates:read"),
      AiSessionsModule.createGuardedDeleteSessionHandler({
        activeRunChecker: (sessionId) => repo.hasActiveRunForSession(sessionId),
      }),
    );
  }

  return router;
}

export default createAiSessionsRouter();
