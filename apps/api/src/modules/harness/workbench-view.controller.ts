// ============================================================
// Workbench 统一视图 Controller（O5 Sprint 3A）
// ============================================================
// GET /api/v1/ai/home-workbench/view（JWT 鉴权）
// 返回统一视图：{ sessions, runs, tasks, artifacts, failedRuns }

import { Request, Response, RequestHandler } from "express";
import { randomUUID } from "node:crypto";

import { requireCapability } from "../../rbac/middleware";
import { ok } from "../../utils/response";
import type { WorkbenchViewUsecase } from "./workbench-view.usecase";

/** 把 requireCapability 与业务 handler 组合为完整中间件（含 401/403 门闸）。 */
function guard(handler: (req: Request, res: Response) => Promise<void> | void): RequestHandler {
  const capability = requireCapability("estimates:read");
  return (req, res) => {
    capability(req, res, async () => {
      try {
        await handler(req, res);
      } catch (err) {
        // 未知错误不泄露内部细节
        res.status(500).json({
          code: 50000,
          message: "服务内部错误",
          details: [],
          requestId: randomUUID(),
        });
      }
    });
  };
}

export type WorkbenchViewHandlersDeps = {
  usecase: WorkbenchViewUsecase;
};

export function createWorkbenchViewHandlers(deps: WorkbenchViewHandlersDeps) {
  const usecase = deps.usecase;

  const getWorkbenchViewHandler = guard(async (req, res) => {
    const view = await usecase.getUnifiedView(req.user!);
    res.json(ok(view, randomUUID()));
  });

  return {
    getWorkbenchViewHandler,
  };
}
