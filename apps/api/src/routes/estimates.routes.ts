// ============================================================
// 估算路由
// ============================================================

import { Router } from "express";
import * as EstimatesModule from "../modules/estimates/estimates.module";
import { requireCapability } from "../rbac/middleware";

const router = Router();

router.post("/calculate", requireCapability("estimates:create"), EstimatesModule.calculate);
router.post("/calculate-and-export", requireCapability("estimates:create"), EstimatesModule.calculateAndExport);
router.post("/export/excel", requireCapability("estimates:read"), EstimatesModule.exportExcel);
router.post("/export/pdf", requireCapability("estimates:read"), EstimatesModule.exportPdf);
router.get("/dependency-rules/active", requireCapability("estimates:read"), EstimatesModule.getActiveDependencyRules);

export default router;
