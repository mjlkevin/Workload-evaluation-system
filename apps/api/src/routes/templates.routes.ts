// ============================================================
// 模板路由
// ============================================================

import { Router } from "express";
import multer from "multer";
import * as TemplatesModule from "../modules/templates/templates.module";
import { requireCapability, requireAnyCapability } from "../rbac/middleware";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const router = Router();

router.get("/", requireAnyCapability("template:manage", "estimates:read"), TemplatesModule.listTemplates);
router.get("/:templateId", requireAnyCapability("template:manage", "estimates:read"), TemplatesModule.getTemplate);
router.post("/import-json", requireCapability("template:manage"), TemplatesModule.importTemplateJson);
router.post("/import-excel", upload.single("file"), requireCapability("template:manage"), TemplatesModule.importTemplateExcel);

export default router;
