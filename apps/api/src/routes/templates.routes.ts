// ============================================================
// 模板路由
// ============================================================

import { Router } from "express";
import multer from "multer";
import * as TemplatesModule from "../modules/templates/templates.module";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const router = Router();

router.get("/", TemplatesModule.listTemplates);
router.get("/:templateId", TemplatesModule.getTemplate);
router.post("/import-json", TemplatesModule.importTemplateJson);
router.post("/import-excel", upload.single("file"), TemplatesModule.importTemplateExcel);

export default router;
