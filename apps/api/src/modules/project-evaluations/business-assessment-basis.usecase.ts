import { calculateEstimate, validateCalculateRequest } from '../../engine';
import type { AuthUser, CalculateRequest, EstimateResult } from '../../types';
import { mvpArray, mvpObject, mvpText, parseMvpContract } from '../skills/mvp/requirements';
import { businessAssessmentError, createBusinessAssessmentBasisRepository, type BusinessAssessmentBasisRepository } from './business-assessment-basis.repository';

const requestSchema = mvpObject({ templateId: mvpText(160), ruleSetId: mvpText(160),
 userCount: { type: 'integer', minimum: 0, maximum: 1000000000 }, orgCount: { type: 'integer', minimum: 0, maximum: 1000000000 },
 difficultyFactor: { type: 'number', minimum: 0, maximum: 1000000 }, orgSimilarityFactor: { type: 'number', minimum: 0, maximum: 1 },
 items: mvpArray(mvpObject({ templateItemId: mvpText(160), included: { type: 'boolean' },
  customStandardDays: { type: 'number', minimum: 0, maximum: 1000000000 } }, ['templateItemId', 'included']), 1, 10000),
 selectedSheet: mvpText(200, 0), selectedCloudNames: mvpArray(mvpText(200, 0), 0, 1000),
 exportProjectName: mvpText(500, 0), exportAssessmentVersionCode: mvpText(500, 0),
}, ['userCount', 'orgCount', 'difficultyFactor', 'orgSimilarityFactor', 'items']);
export function createBusinessAssessmentBasisService(repository: BusinessAssessmentBasisRepository = createBusinessAssessmentBasisRepository()) {
 return { read: (user: AuthUser, recordId: string) => repository.read(user, recordId),
  async calculate(user: AuthUser, recordId: string, value: unknown): Promise<EstimateResult> {
   const basis = await repository.read(user, recordId);
   if (basis.kind === 'legacy') return businessAssessmentError('BUSINESS_ASSESSMENT_LEGACY');
   try {
    const body = parseMvpContract<CalculateRequest>(requestSchema, value);
    const { template, ruleSet } = basis;
    if (body.templateId !== undefined && body.templateId !== template.templateId
     || body.ruleSetId !== undefined && body.ruleSetId !== ruleSet.ruleSetId
     || new Set(body.items.map(i => i.templateItemId)).size !== body.items.length) return businessAssessmentError('BUSINESS_ASSESSMENT_INVALID_REQUEST', 400);
    const request = { ...body, templateId: template.templateId, ruleSetId: ruleSet.ruleSetId };
    if (!validateCalculateRequest(request, template, ruleSet).ok) return businessAssessmentError('BUSINESS_ASSESSMENT_INVALID_REQUEST', 400);
    // No active catalog/dependency-store resolution, writes, checkout or export is performed here.
    return parseMvpContract<EstimateResult>({}, calculateEstimate(request, template, ruleSet));
   } catch { return businessAssessmentError('BUSINESS_ASSESSMENT_INVALID_REQUEST', 400); }
  }
 };
}
export type BusinessAssessmentBasisService = ReturnType<typeof createBusinessAssessmentBasisService>;
