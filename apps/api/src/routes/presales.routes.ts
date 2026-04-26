// ============================================================
// Pre-sales Routes — 售前审查 Agent API
// ============================================================
// P1-1 端点：原始物料 → 需求包 → DSL 审阅 → 问询 → 初估包 → SOW
//
// 能力位映射：
//   - POST   /presales/requirement-packs                      → extractor:trigger
//   - GET    /presales/requirement-packs                       → requirement:upload
//   - GET    /presales/requirement-packs/:id                   → requirement:upload
//   - PATCH  /presales/requirement-packs/:id                   → requirement:maintain
//   - DELETE /presales/requirement-packs/:id                   → requirement:maintain
//   - POST   /presales/requirement-packs/:id/review            → extractor:trigger
//   - GET    /presales/requirement-packs/:id/confidences       → requirement:upload
//   - POST   /presales/requirement-packs/:id/initial-estimate  → estimates:create
//   - GET    /presales/initial-estimates/:id                   → estimates:read OR estimates:create
//   - PATCH  /presales/initial-estimates/:id                   → estimates:write OR estimates:create
//   - POST   /presales/requirement-packs/:id/sow               → estimates:create
//   - GET    /presales/sow-documents/:id                       → estimates:read OR estimates:create
//   - PATCH  /presales/sow-documents/:id                       → estimates:write OR estimates:create
//   - GET    /presales/requirement-packs/:id/sow               → estimates:read OR estimates:create

import { Router } from "express";

import { requireCapability, requireAnyCapability, requireAuthenticated } from "../rbac/middleware";
import {
  requirementPackService,
  initialEstimateService,
  sowService,
} from "../services/presales";
import { ApiError } from "../utils/errors";

const router = Router();

// ------------------------------------------------------------------
// 校验 schema
// ------------------------------------------------------------------

function isValidUUID(v: unknown): boolean {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function parseCreatePack(body: unknown): { sourceExtractionId?: string; extractionId?: string } {
  const b = body as Record<string, unknown>;
  const out: { sourceExtractionId?: string; extractionId?: string } = {};
  if (b.sourceExtractionId && isValidUUID(b.sourceExtractionId)) out.sourceExtractionId = b.sourceExtractionId as string;
  if (b.extractionId && isValidUUID(b.extractionId)) out.extractionId = b.extractionId as string;
  return out;
}

function parseUpdatePack(body: unknown): {
  structuredRequirements?: unknown[];
  industry?: string;
  scale?: string;
  modules?: unknown[];
  constraints?: unknown[];
  status?: "draft" | "confirmed" | "deprecated";
} {
  const b = body as Record<string, unknown>;
  const out: ReturnType<typeof parseUpdatePack> = {};
  if (Array.isArray(b.structuredRequirements)) out.structuredRequirements = b.structuredRequirements;
  if (typeof b.industry === "string") out.industry = b.industry;
  if (typeof b.scale === "string") out.scale = b.scale;
  if (Array.isArray(b.modules)) out.modules = b.modules;
  if (Array.isArray(b.constraints)) out.constraints = b.constraints;
  if (b.status === "draft" || b.status === "confirmed" || b.status === "deprecated") out.status = b.status;
  return out;
}

function parseUpdateEstimate(body: unknown): {
  effortEstimate?: Array<{ module: string; days: number; basis: string }>;
  riskTags?: string[];
  assumptions?: Array<{ assumption: string; rationale: string; riskIfInvalid: string }>;
  confidenceScores?: Record<string, number>;
  phaseProposal?: Array<{ phase: string; modules: string[]; estimatedDays: number; milestone: string }>;
  status?: "draft" | "reviewed" | "handed_off" | "deprecated";
} {
  const b = body as Record<string, unknown>;
  const out: ReturnType<typeof parseUpdateEstimate> = {};
  if (Array.isArray(b.effortEstimate)) out.effortEstimate = b.effortEstimate as any;
  if (Array.isArray(b.riskTags)) out.riskTags = b.riskTags as string[];
  if (Array.isArray(b.assumptions)) out.assumptions = b.assumptions as any;
  if (b.confidenceScores && typeof b.confidenceScores === "object") out.confidenceScores = b.confidenceScores as Record<string, number>;
  if (Array.isArray(b.phaseProposal)) out.phaseProposal = b.phaseProposal as any;
  if (b.status === "draft" || b.status === "reviewed" || b.status === "handed_off" || b.status === "deprecated") out.status = b.status;
  return out;
}

function parseUpdateSow(body: unknown): {
  cloudProduct?: string;
  module?: string;
  category?: string;
  description?: string;
  customizationScope?: string;
  status?: "draft" | "confirmed" | "changed";
} {
  const b = body as Record<string, unknown>;
  const out: ReturnType<typeof parseUpdateSow> = {};
  if (typeof b.cloudProduct === "string") out.cloudProduct = b.cloudProduct;
  if (typeof b.module === "string") out.module = b.module;
  if (typeof b.category === "string") out.category = b.category;
  if (typeof b.description === "string") out.description = b.description;
  if (typeof b.customizationScope === "string") out.customizationScope = b.customizationScope;
  if (b.status === "draft" || b.status === "confirmed" || b.status === "changed") out.status = b.status;
  return out;
}

// ------------------------------------------------------------------
// Requirement Pack 路由
// ------------------------------------------------------------------

/** POST /presales/requirement-packs — 从 extraction 创建需求包 */
router.post(
  "/requirement-packs",
  requireCapability("extractor:trigger"),
  async (req, res, next) => {
    try {
      const body = parseCreatePack(req.body);
      const ownerUserId = req.user?.id;
      const pack = await requirementPackService.createFromExtraction({
        sourceExtractionId: body.sourceExtractionId,
        extractionId: body.extractionId,
        ownerUserId,
      });
      res.status(201).json({ success: true, data: pack });
    } catch (err) {
      next(err);
    }
  },
);

/** GET /presales/requirement-packs — 列出当前用户的需求包 */
router.get(
  "/requirement-packs",
  requireCapability("requirement:upload"),
  async (req, res, next) => {
    try {
      const ownerUserId = req.user?.id;
      if (!ownerUserId) throw new ApiError(401, "未登录");
      const status = req.query.status as string | undefined;
      const packs = await requirementPackService.listByOwner(ownerUserId, status);
      res.json({ success: true, data: packs });
    } catch (err) {
      next(err);
    }
  },
);

/** GET /presales/requirement-packs/:id — 获取需求包详情 */
router.get(
  "/requirement-packs/:id",
  requireCapability("requirement:upload"),
    async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const pack = await requirementPackService.findById(id);
      if (!pack) throw new ApiError(404, "需求包不存在");
      res.json({ success: true, data: pack });
    } catch (err) {
      next(err);
    }
  },
);

/** PATCH /presales/requirement-packs/:id — 更新需求包 */
router.patch(
  "/requirement-packs/:id",
  requireCapability("requirement:maintain"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const body = parseUpdatePack(req.body);
      const pack = await requirementPackService.update(id, body);
      if (!pack) throw new ApiError(404, "需求包不存在");
      res.json({ success: true, data: pack });
    } catch (err) {
      next(err);
    }
  },
);

/** DELETE /presales/requirement-packs/:id — 删除需求包 */
router.delete(
  "/requirement-packs/:id",
  requireCapability("requirement:maintain"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const ok = await requirementPackService.delete(id);
      if (!ok) throw new ApiError(404, "需求包不存在");
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

/** POST /presales/requirement-packs/:id/review — DSL 审阅 + 问询生成 */
router.post(
  "/requirement-packs/:id/review",
  requireCapability("extractor:trigger"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const result = await requirementPackService.review(id);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

/** GET /presales/requirement-packs/:id/confidences — 字段级置信度（US-8） */
router.get(
  "/requirement-packs/:id/confidences",
  requireCapability("requirement:upload"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const confidences = await requirementPackService.getFieldConfidences(id);
      res.json({ success: true, data: confidences });
    } catch (err) {
      next(err);
    }
  },
);

// ------------------------------------------------------------------
// Initial Estimate 路由
// ------------------------------------------------------------------

/** POST /presales/requirement-packs/:id/initial-estimate — 生成初估包 */
router.post(
  "/requirement-packs/:id/initial-estimate",
  requireCapability("estimates:create"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const pack = await requirementPackService.findById(id);
      if (!pack) throw new ApiError(404, "需求包不存在");

      // 若已存在，先删除旧 estimate（P1-1 单 estimate 策略）
      const existing = await initialEstimateService.findByPackId(pack.requirementPackId);
      if (existing) {
        await initialEstimateService.delete(existing.initialEstimateId);
      }

      const estimate = await initialEstimateService.generateFromPack({
        requirementPack: pack,
        ownerUserId: req.user?.id,
      });
      res.status(201).json({ success: true, data: estimate });
    } catch (err) {
      next(err);
    }
  },
);

/** GET /presales/initial-estimates/:id — 获取初估包 */
router.get(
  "/initial-estimates/:id",
  requireAnyCapability("estimates:read", "estimates:create"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const estimate = await initialEstimateService.findById(id);
      if (!estimate) throw new ApiError(404, "初估包不存在");
      res.json({ success: true, data: estimate });
    } catch (err) {
      next(err);
    }
  },
);

/** PATCH /presales/initial-estimates/:id — 更新初估包 */
router.patch(
  "/initial-estimates/:id",
  requireAnyCapability("estimates:write", "estimates:create"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const body = parseUpdateEstimate(req.body);
      const estimate = await initialEstimateService.update(id, body);
      if (!estimate) throw new ApiError(404, "初估包不存在");
      res.json({ success: true, data: estimate });
    } catch (err) {
      next(err);
    }
  },
);

// ------------------------------------------------------------------
// SOW 路由
// ------------------------------------------------------------------

/** POST /presales/requirement-packs/:id/sow — 生成 SOW 条目 */
router.post(
  "/requirement-packs/:id/sow",
  requireCapability("estimates:create"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const pack = await requirementPackService.findById(id);
      if (!pack) throw new ApiError(404, "需求包不存在");

      const cloudProduct = (req.body.cloudProduct as string) || "金蝶AI星空";
      const sowItems = await sowService.generateFromPack({
        requirementPack: pack,
        cloudProduct,
        ownerUserId: req.user?.id,
      });
      res.status(201).json({ success: true, data: sowItems });
    } catch (err) {
      next(err);
    }
  },
);

/** GET /presales/sow-documents/:id — 获取 SOW 条目 */
router.get(
  "/sow-documents/:id",
  requireAnyCapability("estimates:read", "estimates:create"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const sow = await sowService.findById(id);
      if (!sow) throw new ApiError(404, "SOW 条目不存在");
      res.json({ success: true, data: sow });
    } catch (err) {
      next(err);
    }
  },
);

/** PATCH /presales/sow-documents/:id — 更新 SOW 条目 */
router.patch(
  "/sow-documents/:id",
  requireAnyCapability("estimates:write", "estimates:create"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const body = parseUpdateSow(req.body);
      const sow = await sowService.update(id, body);
      if (!sow) throw new ApiError(404, "SOW 条目不存在");
      res.json({ success: true, data: sow });
    } catch (err) {
      next(err);
    }
  },
);

/** GET /presales/requirement-packs/:id/sow — 列出需求包关联的 SOW */
router.get(
  "/requirement-packs/:id/sow",
  requireAnyCapability("estimates:read", "estimates:create"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const sowItems = await sowService.findByPackId(id);
      res.json({ success: true, data: sowItems });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
