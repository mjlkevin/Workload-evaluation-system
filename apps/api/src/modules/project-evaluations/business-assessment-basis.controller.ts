import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { SkillError } from '../skills/skills.types';
import { createBusinessAssessmentBasisService, type BusinessAssessmentBasisService } from './business-assessment-basis.usecase';
export function createBusinessAssessmentBasisHandlers(service: BusinessAssessmentBasisService = createBusinessAssessmentBasisService()) {
 const handler = (calculate: boolean): RequestHandler => async (req, res) => {
  try {
   // The router's current JWT/capability guard supplies user; never accept an actor from the body.
   if (!req.user) { res.status(401).json({ code: 40101, message: '请先登录', data: null }); return; }
   const recordId = typeof req.params.recordId === 'string' ? req.params.recordId : '';
   const data = calculate ? await service.calculate(req.user, recordId, req.body) : await service.read(req.user, recordId);
   res.json({ code: 0, message: 'success', data, requestId: randomUUID() });
  } catch (error) {
   const known = error instanceof SkillError, status = known ? error.status : 503;
   res.status(status).json({ code: status * 100 + 1, message: known ? error.message : '评估计算依据暂不可用，请稍后重试',
    data: null, errorCode: known ? error.code : 'BUSINESS_ASSESSMENT_UNAVAILABLE', requestId: randomUUID() });
  }
 };
 return { read: handler(false), calculate: handler(true) };
}
