import { Router } from 'express';
import { requireCapability } from '../rbac/middleware';
import { createBusinessAssessmentBasisHandlers } from '../modules/project-evaluations/business-assessment-basis.controller';
import type { BusinessAssessmentBasisService } from '../modules/project-evaluations/business-assessment-basis.usecase';
export function createBusinessAssessmentsRouter(options: { service?: BusinessAssessmentBasisService } = {}) {
 const router = Router(), handlers = createBusinessAssessmentBasisHandlers(options.service);
 router.get('/:recordId/basis', requireCapability('estimates:read'), handlers.read);
 router.post('/:recordId/calculate', requireCapability('estimates:read'), handlers.calculate);
 return router;
}
export default createBusinessAssessmentsRouter();
