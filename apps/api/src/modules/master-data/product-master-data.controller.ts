// ============================================================
// 批次 10b · 产品主数据控制器
// ============================================================

import type { Request, Response, NextFunction } from "express";
import { ok, fail } from "../../utils/response";
import type { ProductMasterDataPgRepository } from "./product-master-data-pg.repository";
import {
  buildModuleOptions,
  buildProductMasterDataTree,
  buildProductOptions,
  buildSkuOptions,
} from "./product-master-data.usecase";
import { MasterDataError } from "./industry-pg.repository";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number {
  return Number(value);
}

function asBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function handleError(err: unknown, res: Response) {
  if (err instanceof MasterDataError) {
    return fail(res, 40001, err.message, [{ field: err.code, reason: err.code }]);
  }
  return fail(res, 50001, err instanceof Error ? err.message : "操作失败");
}

export function createProductMasterDataHandlers(repo: ProductMasterDataPgRepository) {
  async function treeHandler(req: Request, res: Response, next: NextFunction) {
    try {
      const assignments = await repo.listAssignments();
      res.json(ok({ tree: buildProductMasterDataTree(assignments), items: assignments }));
    } catch (err) { next(err); }
  }

  async function optionsHandler(req: Request, res: Response, next: NextFunction) {
    try {
      const [products, skus, modules] = await Promise.all([
        repo.listProductLines(),
        repo.listProductSkus(),
        repo.listProductModules(),
      ]);
      res.json(ok({
        products: buildProductOptions(products),
        skus: buildSkuOptions(skus),
        modules: buildModuleOptions(modules),
      }));
    } catch (err) { next(err); }
  }

  async function createProductLineHandler(req: Request, res: Response, next: NextFunction) {
    try {
      const row = await repo.createProductLine({
        name: asString(req.body.name),
        sortOrder: req.body.sortOrder,
        id: asString(req.body.id) || undefined,
      });
      res.status(201).json(ok({ row }));
    } catch (err) { handleError(err, res); }
  }

  async function createProductSkuHandler(req: Request, res: Response, next: NextFunction) {
    try {
      const row = await repo.createProductSku({
        name: asString(req.body.name),
        sortOrder: req.body.sortOrder,
        id: asString(req.body.id) || undefined,
      });
      res.status(201).json(ok({ row }));
    } catch (err) { handleError(err, res); }
  }

  async function createProductModuleHandler(req: Request, res: Response, next: NextFunction) {
    try {
      const row = await repo.createProductModule({
        name: asString(req.body.name),
        sortOrder: req.body.sortOrder,
        id: asString(req.body.id) || undefined,
      });
      res.status(201).json(ok({ row }));
    } catch (err) { handleError(err, res); }
  }

  async function createAssignmentHandler(req: Request, res: Response, next: NextFunction) {
    try {
      const row = await repo.createAssignment({
        productId: asString(req.body.productId),
        skuId: asString(req.body.skuId),
        moduleId: asString(req.body.moduleId),
        standardDays: asNumber(req.body.standardDays),
        templateItemId: asString(req.body.templateItemId) || undefined,
        groupId: asString(req.body.groupId) || undefined,
        groupName: asString(req.body.groupName) || undefined,
        itemName: asString(req.body.itemName) || undefined,
        sheetName: asString(req.body.sheetName) || undefined,
        appGroup: asString(req.body.appGroup) || undefined,
        defaultIncluded: asBoolean(req.body.defaultIncluded),
        deliveryPoint: asString(req.body.deliveryPoint) || undefined,
        deliveryDesc: asString(req.body.deliveryDesc) || undefined,
        evalDesc: asString(req.body.evalDesc) || undefined,
        sortOrder: req.body.sortOrder,
      });
      res.status(201).json(ok({ row }));
    } catch (err) { handleError(err, res); }
  }

  async function updateAssignmentHandler(req: Request, res: Response, next: NextFunction) {
    try {
      const row = await repo.updateAssignment(req.params.id as string, {
        standardDays: req.body.standardDays !== undefined ? asNumber(req.body.standardDays) : undefined,
        deliveryPoint: req.body.deliveryPoint !== undefined ? asString(req.body.deliveryPoint) : undefined,
        deliveryDesc: req.body.deliveryDesc !== undefined ? asString(req.body.deliveryDesc) : undefined,
        evalDesc: req.body.evalDesc !== undefined ? asString(req.body.evalDesc) : undefined,
        itemName: req.body.itemName !== undefined ? asString(req.body.itemName) : undefined,
        sheetName: req.body.sheetName !== undefined ? asString(req.body.sheetName) : undefined,
        appGroup: req.body.appGroup !== undefined ? asString(req.body.appGroup) : undefined,
        defaultIncluded: req.body.defaultIncluded !== undefined ? asBoolean(req.body.defaultIncluded) : undefined,
        groupName: req.body.groupName !== undefined ? asString(req.body.groupName) : undefined,
        sortOrder: req.body.sortOrder,
      });
      res.json(ok({ row }));
    } catch (err) { handleError(err, res); }
  }

  async function setAssignmentStatusHandler(req: Request, res: Response, next: NextFunction) {
    try {
      const status = asString(req.body.status);
      if (status !== "active" && status !== "inactive") {
        return fail(res, 40001, "参数错误", [{ field: "status", reason: "invalid" }]);
      }
      const row = await repo.setAssignmentStatus(req.params.id as string, status);
      res.json(ok({ row }));
    } catch (err) { handleError(err, res); }
  }

  async function updateProductLineHandler(req: Request, res: Response, next: NextFunction) {
    try {
      const row = await repo.updateProductLine(req.params.id as string, {
        name: req.body.name !== undefined ? asString(req.body.name) : undefined,
        sortOrder: req.body.sortOrder,
      });
      res.json(ok({ row }));
    } catch (err) { handleError(err, res); }
  }

  async function updateProductSkuHandler(req: Request, res: Response, next: NextFunction) {
    try {
      const row = await repo.updateProductSku(req.params.id as string, {
        name: req.body.name !== undefined ? asString(req.body.name) : undefined,
        sortOrder: req.body.sortOrder,
      });
      res.json(ok({ row }));
    } catch (err) { handleError(err, res); }
  }

  async function updateProductModuleHandler(req: Request, res: Response, next: NextFunction) {
    try {
      const row = await repo.updateProductModule(req.params.id as string, {
        name: req.body.name !== undefined ? asString(req.body.name) : undefined,
        sortOrder: req.body.sortOrder,
      });
      res.json(ok({ row }));
    } catch (err) { handleError(err, res); }
  }

  async function setProductLineStatusHandler(req: Request, res: Response, next: NextFunction) {
    try {
      const status = asString(req.body.status);
      if (status !== "active" && status !== "inactive") {
        return fail(res, 40001, "参数错误", [{ field: "status", reason: "invalid" }]);
      }
      const row = await repo.setProductLineStatus(req.params.id as string, status);
      res.json(ok({ row }));
    } catch (err) { handleError(err, res); }
  }

  async function setProductSkuStatusHandler(req: Request, res: Response, next: NextFunction) {
    try {
      const status = asString(req.body.status);
      if (status !== "active" && status !== "inactive") {
        return fail(res, 40001, "参数错误", [{ field: "status", reason: "invalid" }]);
      }
      const row = await repo.setProductSkuStatus(req.params.id as string, status);
      res.json(ok({ row }));
    } catch (err) { handleError(err, res); }
  }

  async function setProductModuleStatusHandler(req: Request, res: Response, next: NextFunction) {
    try {
      const status = asString(req.body.status);
      if (status !== "active" && status !== "inactive") {
        return fail(res, 40001, "参数错误", [{ field: "status", reason: "invalid" }]);
      }
      const row = await repo.setProductModuleStatus(req.params.id as string, status);
      res.json(ok({ row }));
    } catch (err) { handleError(err, res); }
  }

  async function deleteForbiddenHandler(_req: Request, res: Response) {
    return res.status(405).set("Allow", "GET, POST, PATCH").json({
      code: 40501,
      message: "产品主数据禁止硬删；请改用停用",
      details: [{ field: "delete", reason: "forbidden" }],
    });
  }

  return {
    treeHandler,
    optionsHandler,
    createProductLineHandler,
    createProductSkuHandler,
    createProductModuleHandler,
    createAssignmentHandler,
    updateAssignmentHandler,
    setAssignmentStatusHandler,
    updateProductLineHandler,
    updateProductSkuHandler,
    updateProductModuleHandler,
    setProductLineStatusHandler,
    setProductSkuStatusHandler,
    setProductModuleStatusHandler,
    deleteForbiddenHandler,
  };
}
