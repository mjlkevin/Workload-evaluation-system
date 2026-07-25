// ============================================================
// AI 路由
// ============================================================

import { Router, type Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import multer from "multer";
import * as AiModule from "../modules/ai/ai.module";
import * as SystemModule from "../modules/system/system.module";
import { requireCapability } from "../rbac/middleware";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const router = Router();

// ------------------------------------------------------------------
// 流式端点速率限制
// ------------------------------------------------------------------
// 防止 SSE 流式端点被恶意无限发起。每用户每分钟最多 20 次。
// keyGenerator 优先按认证用户 ID 限流（requireCapability 已挂载 req.user），
// 未认证场景回退到 IP。注意：rate limiter 必须置于 requireCapability 之后，
// 否则 req.user 尚未挂载，会退化为纯 IP 限流。
const streamRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分钟
  limit: 20, // 每分钟 20 次（v8 使用 limit，等价于已废弃的 max）
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const userId = req.user?.id;
    if (userId) return `user:${userId}`;
    // 使用库提供的 ipKeyGenerator 处理 IP 回退，正确归并 IPv6 同子网用户，
    // 避免自定义 keyGenerator 直接用 req.ip 触发 ERR_ERL_KEY_GEN_IPV6。
    return req.ip ? ipKeyGenerator(req.ip) : "unknown";
  },
  message: {
    code: "rate_limit_exceeded",
    message: "请求过于频繁，请稍后再试"
  }
});

router.post("/parse-basic-info", upload.single("file"), requireCapability("extractor:trigger"), AiModule.parseBasicInfo);
router.post("/parse-basic-info/stream", upload.single("file"), requireCapability("extractor:trigger"), streamRateLimiter, AiModule.parseBasicInfoStream);
router.post("/company-profile-summary", requireCapability("requirement:upload"), AiModule.companyProfileSummary);
router.post("/kimi-assessment/preview", requireCapability("assessment:create"), AiModule.kimiAssessmentPreview);
router.post("/kimi-assessment/export-markdown", requireCapability("assessment:create"), AiModule.exportKimiAssessmentMarkdown);
router.post("/kimi-assessment/export-pdf", requireCapability("assessment:create"), AiModule.exportKimiAssessmentPdf);

/** 与 `POST /api/v1/system/requirement-settings/kimi-api-key/test` 相同处理函数，便于网关只放行 `/ai/*` 的环境 */
router.post("/kimi-api-key/test", requireCapability("system:manage"), SystemModule.testRequirementKimiApiKey);
router.post("/chat", requireCapability("estimates:read"), AiModule.chat);
router.post("/home-workbench/chat", requireCapability("estimates:read"), AiModule.homeWorkbenchChat);
router.post("/home-workbench/chat/stream", requireCapability("estimates:read"), streamRateLimiter, AiModule.homeWorkbenchChatStream);

export default router;
