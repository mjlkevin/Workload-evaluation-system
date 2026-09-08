// ============================================================
// 批次 10a · 行业主数据 controller（HTTP handler 工厂）
// ============================================================
// 响应结构统一 { code, message, data }（AGENTS.md §3）。
// 稳定错误码 → HTTP 状态映射集中在 STATUS_BY_CODE 一处，
// 保证「同一码在哪个端点都是同一状态」，不随端点漂移。
//
// DELETE 端点**注册了但必然回 405**：判据 4 要的是「硬删被拒」这件事
// 本身有合同语义。若只是不注册路由，前端收到的是 404「没这个接口」，
// 与「接口在、但这个操作不被允许」是两回事，后来人也分不清该不该补。

import type { Request, Response } from "express";

import { MasterDataError } from "./industry-pg.repository";
import type { IndustryStoreRepository } from "./industry.repository";
import type { IndustryStatus, MasterDataErrorCode } from "./industry.types";
import { buildIndustryOptions, buildIndustryTree, parseIndustryStatus } from "./industry.usecase";

const STATUS_BY_CODE: Record<MasterDataErrorCode, number> = {
  MASTER_DATA_INVALID: 400,
  MASTER_DATA_NOT_FOUND: 404,
  MASTER_DATA_NAME_EXISTS: 409,
  MASTER_DATA_DELETE_FORBIDDEN: 405,
  MASTER_DATA_STORE_INTERNAL: 500,
};

/** 业务码（响应体 code）：与 HTTP 状态同源，沿用 4xxxx / 5xxxx 既有口径。 */
const BIZ_CODE_BY_HTTP: Record<number, number> = {
  400: 40001,
  404: 40401,
  405: 40501,
  409: 40901,
  500: 50001,
};

function fail(res: Response, err: unknown, fallbackMessage: string): void {
  if (err instanceof MasterDataError) {
    const status = STATUS_BY_CODE[err.code] ?? 500;
    res.status(status).json({ code: BIZ_CODE_BY_HTTP[status] ?? status, message: err.message, data: null });
    return;
  }
  // 非本域错误不得把原始 message 透出去（可能含 SQL / 连接串）
  const status = 500;
  res.status(status).json({ code: 50001, message: fallbackMessage, data: null });
}

/** 路由参数（Express 类型上是 string | string[]，非字符串一律按缺失处理）。 */
function readParam(req: Request, name: string): string {
  const raw = req.params?.[name];
  return typeof raw === "string" ? raw : "";
}

function readString(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

function readSortOrder(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function createIndustryHandlers(repo: IndustryStoreRepository) {
  /** 两层树（含停用），列表页用。 */
  async function treeHandler(_req: Request, res: Response): Promise<void> {
    try {
      const [categories, subcategories] = await Promise.all([
        repo.listCategories(),
        repo.listSubcategories(),
      ]);
      const tree = buildIndustryTree(categories, subcategories);
      res.json({ code: 0, message: "ok", data: { items: tree, total: tree.length } });
    } catch (err) {
      fail(res, err, "行业主数据加载失败");
    }
  }

  /** 新建单据用的选项：只含启用项，父停用则子也不出。 */
  async function optionsHandler(_req: Request, res: Response): Promise<void> {
    try {
      const [categories, subcategories] = await Promise.all([
        repo.listCategories(),
        repo.listSubcategories(),
      ]);
      const options = buildIndustryOptions(buildIndustryTree(categories, subcategories));
      res.json({ code: 0, message: "ok", data: { items: options, total: options.length } });
    } catch (err) {
      fail(res, err, "行业选项加载失败");
    }
  }

  async function createCategoryHandler(req: Request, res: Response): Promise<void> {
    try {
      const category = await repo.createCategory({
        id: typeof req.body?.id === "string" ? req.body.id : undefined,
        name: readString(req.body?.name),
        sortOrder: readSortOrder(req.body?.sortOrder),
      });
      res.json({ code: 0, message: "ok", data: { category } });
    } catch (err) {
      fail(res, err, "新增行业大类失败");
    }
  }

  async function updateCategoryHandler(req: Request, res: Response): Promise<void> {
    try {
      const category = await repo.updateCategory(readParam(req, "id"), {
        ...(req.body?.name === undefined ? {} : { name: readString(req.body.name) }),
        ...(req.body?.sortOrder === undefined ? {} : { sortOrder: readSortOrder(req.body.sortOrder) }),
      });
      res.json({ code: 0, message: "ok", data: { category } });
    } catch (err) {
      fail(res, err, "修改行业大类失败");
    }
  }

  async function createSubcategoryHandler(req: Request, res: Response): Promise<void> {
    try {
      const subcategory = await repo.createSubcategory({
        id: typeof req.body?.id === "string" ? req.body.id : undefined,
        categoryId: readString(req.body?.categoryId),
        name: readString(req.body?.name),
        sortOrder: readSortOrder(req.body?.sortOrder),
      });
      res.json({ code: 0, message: "ok", data: { subcategory } });
    } catch (err) {
      fail(res, err, "新增行业细分失败");
    }
  }

  async function updateSubcategoryHandler(req: Request, res: Response): Promise<void> {
    try {
      const subcategory = await repo.updateSubcategory(readParam(req, "id"), {
        ...(req.body?.name === undefined ? {} : { name: readString(req.body.name) }),
        ...(req.body?.sortOrder === undefined ? {} : { sortOrder: readSortOrder(req.body.sortOrder) }),
      });
      res.json({ code: 0, message: "ok", data: { subcategory } });
    } catch (err) {
      fail(res, err, "修改行业细分失败");
    }
  }

  /** 状态切换工厂：一级 / 二级共用同一套入参校验，仅落点不同。 */
  function statusSetter(set: (id: string, status: IndustryStatus) => Promise<unknown>) {
    return async (req: Request, res: Response): Promise<void> => {
      const status = parseIndustryStatus(req.body?.status);
      if (!status) {
        res.status(400).json({ code: 40001, message: "status 只能是 active 或 inactive", data: null });
        return;
      }
      try {
        const row = await set(readParam(req, "id"), status);
        res.json({ code: 0, message: "ok", data: { row } });
      } catch (err) {
        fail(res, err, "切换行业状态失败");
      }
    };
  }

  /** 硬删拒绝：不查库、不解释目标是否存在，动作本身不在授权范围内。 */
  function deleteForbiddenHandler(_req: Request, res: Response): void {
    res.status(405).set("Allow", "GET, POST, PATCH").json({
      code: 40501,
      message:
        "行业主数据禁止硬删：历史记录按名称文本引用行业，删掉即指向不存在的选项。" +
        "请改用停用（POST .../status 置 inactive）。",
      data: null,
    });
  }

  return {
    treeHandler,
    optionsHandler,
    createCategoryHandler,
    updateCategoryHandler,
    createSubcategoryHandler,
    updateSubcategoryHandler,
    setCategoryStatusHandler: statusSetter((id, status) => repo.setCategoryStatus(id, status)),
    setSubcategoryStatusHandler: statusSetter((id, status) => repo.setSubcategoryStatus(id, status)),
    deleteForbiddenHandler,
  };
}
