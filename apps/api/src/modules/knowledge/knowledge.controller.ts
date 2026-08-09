// ============================================================
// SP-2026-007 · MS1（M1 中文混合检索基线）
// knowledge.controller — HTTP handler 工厂（绑定 repository）
// 响应结构统一 { code, message, data }
// ============================================================

import type { Request, Response } from "express";

import type { KnowledgeRepository } from "./knowledge.repository";
import { searchKnowledge } from "./knowledge.usecase";

/** handler 工厂：路由层注入 repo，便于测试替换存储 */
export function createKnowledgeHandlers(repo: KnowledgeRepository) {
  function searchHandler(req: Request, res: Response): void {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    if (!q.trim()) {
      res.status(400).json({ code: 40001, message: "缺少查询参数 q", data: null });
      return;
    }
    const limitRaw = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 20 ? limitRaw : undefined;
    const result = searchKnowledge(repo, q, limit ? { limit } : {});
    res.json({ code: 0, message: "ok", data: result });
  }

  function listEntriesHandler(_req: Request, res: Response): void {
    const items = repo.list();
    res.json({ code: 0, message: "ok", data: { items, total: items.length } });
  }

  function createEntryHandler(req: Request, res: Response): void {
    const { title, content, category, tags, id } = (req.body ?? {}) as Record<string, unknown>;
    try {
      const entry = repo.create({
        id: typeof id === "string" ? id : undefined,
        title: typeof title === "string" ? title : "",
        content: typeof content === "string" ? content : "",
        category: typeof category === "string" ? category : undefined,
        tags: Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : undefined,
      });
      res.json({ code: 0, message: "ok", data: { entry } });
    } catch (err) {
      res.status(400).json({ code: 40002, message: err instanceof Error ? err.message : "创建失败", data: null });
    }
  }

  function archiveEntryHandler(req: Request, res: Response): void {
    const entryId = typeof req.params.entryId === "string" ? req.params.entryId : "";
    try {
      const entry = repo.archive(entryId);
      res.json({ code: 0, message: "ok", data: { entry } });
    } catch (err) {
      res.status(404).json({ code: 40401, message: err instanceof Error ? err.message : "条目不存在", data: null });
    }
  }

  /** 检索诊断（admin 可见）：返回语料规模、护栏口径与样例查询表现 */
  function diagnoseHandler(req: Request, res: Response): void {
    const q = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q : "售前估算";
    const entries = repo.list();
    const active = entries.filter((entry) => entry.status === "active");
    const result = searchKnowledge(repo, q, { limit: 5 });
    res.json({
      code: 0,
      message: "ok",
      data: {
        corpus: { total: entries.length, active: active.length, archived: entries.length - active.length },
        guard: { maxItems: 8, charBudget: 6000, timeoutMs: 3000 },
        stage: "ms1-bm25-rrf",
        sample: result,
      },
    });
  }

  return { searchHandler, listEntriesHandler, createEntryHandler, archiveEntryHandler, diagnoseHandler };
}
