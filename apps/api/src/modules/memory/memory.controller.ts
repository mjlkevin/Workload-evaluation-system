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

export function createMemoryRouter(deps: CreateMemoryRouterDeps): Router {
  const router = Router();
  const usecase = createMemoryUsecase({ repo: deps.repo });

  // GET /memory?projectId=xxx&status=draft&page=1&pageSize=20
  router.get("/", requireAuth, async (req, res) => {
    const user = req.user!;
    const parse = validateListMemoryQuery(req.query);
    if (!parse.success) {
      return res.status(422).json({ code: "INVALID_QUERY", message: "查询参数错误", data: { error: parse.error } });
    }
    const result = await usecase.listMemory({ ...parse.data, ownerUserId: user.id });
    return res.json({ code: "OK", message: "success", data: result });
  });

  // POST /memory/atoms/confirm
  router.post("/atoms/confirm", requireAuth, async (req, res) => {
    const user = req.user!;
    const parse = validateMemoryIdsInput(req.body);
    if (!parse.success) {
      return res.status(422).json({ code: "INVALID_BODY", message: "请求体错误", data: { error: parse.error } });
    }
    const result = await usecase.confirmAtoms({ ...parse.data, ownerUserId: user.id });
    return res.json({ code: "OK", message: "success", data: result });
  });

  // POST /memory/scenes/confirm
  router.post("/scenes/confirm", requireAuth, async (req, res) => {
    const user = req.user!;
    const parse = validateMemoryIdsInput(req.body);
    if (!parse.success) {
      return res.status(422).json({ code: "INVALID_BODY", message: "请求体错误", data: { error: parse.error } });
    }
    const result = await usecase.confirmScenes({ ...parse.data, ownerUserId: user.id });
    return res.json({ code: "OK", message: "success", data: result });
  });

  // POST /memory/atoms/archive
  router.post("/atoms/archive", requireAuth, async (req, res) => {
    const user = req.user!;
    const parse = validateMemoryIdsInput(req.body);
    if (!parse.success) {
      return res.status(422).json({ code: "INVALID_BODY", message: "请求体错误", data: { error: parse.error } });
    }
    const result = await usecase.archiveAtoms({ ...parse.data, ownerUserId: user.id });
    return res.json({ code: "OK", message: "success", data: result });
  });

  // POST /memory/scenes/archive
  router.post("/scenes/archive", requireAuth, async (req, res) => {
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
