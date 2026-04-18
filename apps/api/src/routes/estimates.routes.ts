// ============================================================
// 估算路由
// ============================================================

import { Router } from "express";
import * as EstimatesModule from "../modules/estimates/estimates.module";

const router = Router();

router.post("/calculate", EstimatesModule.calculate);
router.post("/calculate-and-export", EstimatesModule.calculateAndExport);
router.post("/export/excel", EstimatesModule.exportExcel);
router.post("/export/pdf", EstimatesModule.exportPdf);
router.get("/dependency-rules/active", EstimatesModule.getActiveDependencyRules);

export default router;
