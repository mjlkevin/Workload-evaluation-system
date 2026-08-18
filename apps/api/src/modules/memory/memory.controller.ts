// ============================================================
// SP-2026-007 · MS2（M2 会话记忆分层蒸馏）
// memory.controller — 记忆管理 REST API
// ============================================================

import { Router } from "express";
import type { MemoryRepository } from "./memory.repository";
import { createMemoryUsecase } from "./memory.usecase";
import {
  validateListMemoryQuery,
  validateMemoryIdsInput,
} from "./memory.types";
import { requireAuth } from "../../middleware/auth";

export type CreateMemoryRouterDeps = {
  repo: MemoryRepository;
};

// DEF-2026-08-11-001 关联根因：requireAuth 是普通函数（返回 user 或 null），
// 直接挂为 Express middleware 时成功分支既不调 next() 也不写 req.user，
// 导致有效 JWT 请求永远挂起（记忆面板生产恒空的第三层原因）。
// 最小修复：薄包装为真正的 middleware——失败分支沿用 requireAuth 原有 401 响应，
// 成功分支写 req.user 并 next()，鉴权语义零变更。
// 阶段 1 批 2：requireAuth 签名变异步，包装同步变异步；成功分支仍在微任务内
// 写 req.user 后调 next()，Express 4 中间件语义零变更。
async function requireAuthMiddleware(
  req: Parameters<typeof requireAuth>[0],
  res: Parameters<typeof requireAuth>[1],
  next: () => void,
) {
  const result = await requireAuth(req, res);
  if (!result) return;
  req.user = result.user;
  next();
}

export function createMemoryRouter(deps: CreateMemoryRouterDeps): Router {
  const router = Router();
  const usecase = createMemoryUsecase({ repo: deps.repo });

  // GET /memory?projectId=xxx&status=draft&page=1&pageSize=20
  router.get("/", requireAuthMiddleware, async (req, res) => {
    const user = req.user!;
    const parse = validateListMemoryQuery(req.query);
    if (!parse.success) {
      return res.status(422).json({ code: "INVALID_QUERY", message: "查询参数错误", data: { error: parse.error } });
    }
    const result = await usecase.listMemory({ ...parse.data, ownerUserId: user.id });
    return res.json({ code: "OK", message: "success", data: result });
  });

  // POST /memory/atoms/confirm
  router.post("/atoms/confirm", requireAuthMiddleware, async (req, res) => {
    const user = req.user!;
    const parse = validateMemoryIdsInput(req.body);
    if (!parse.success) {
      return res.status(422).json({ code: "INVALID_BODY", message: "请求体错误", data: { error: parse.error } });
    }
    const result = await usecase.confirmAtoms({ ...parse.data, ownerUserId: user.id });
    return res.json({ code: "OK", message: "success", data: result });
  });

  // POST /memory/scenes/confirm
  router.post("/scenes/confirm", requireAuthMiddleware, async (req, res) => {
    const user = req.user!;
    const parse = validateMemoryIdsInput(req.body);
    if (!parse.success) {
      return res.status(422).json({ code: "INVALID_BODY", message: "请求体错误", data: { error: parse.error } });
    }
    const result = await usecase.confirmScenes({ ...parse.data, ownerUserId: user.id });
    return res.json({ code: "OK", message: "success", data: result });
  });

  // POST /memory/atoms/archive
  router.post("/atoms/archive", requireAuthMiddleware, async (req, res) => {
    const user = req.user!;
    const parse = validateMemoryIdsInput(req.body);
    if (!parse.success) {
      return res.status(422).json({ code: "INVALID_BODY", message: "请求体错误", data: { error: parse.error } });
    }
    const result = await usecase.archiveAtoms({ ...parse.data, ownerUserId: user.id });
    return res.json({ code: "OK", message: "success", data: result });
  });

  // POST /memory/scenes/archive
  router.post("/scenes/archive", requireAuthMiddleware, async (req, res) => {
    const user = req.user!;
    const parse = validateMemoryIdsInput(req.body);
    if (!parse.success) {
      return res.status(422).json({ code: "INVALID_BODY", message: "请求体错误", data: { error: parse.error } });
    }
    const result = await usecase.archiveScenes({ ...parse.data, ownerUserId: user.id });
    return res.json({ code: "OK", message: "success", data: result });
  });

  return router;
}
