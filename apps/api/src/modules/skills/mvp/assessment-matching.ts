import type { CalculateRequest, Template, RuleSet } from '../../../types';
import type { ConfirmedRequirements } from './requirements';
import { validateCalculateRequest } from '../../../engine';
import { skillDefinitionHash } from '../skills.hash';
import { mvpArray, mvpInvalid, mvpObject, mvpText, parseMvpContract, confirmRequirements, REQUIREMENT_REPORT_SCHEMA } from './requirements';

/** Loaded and frozen by trusted host tools. This module never resolves or changes catalog storage. */
export type FrozenAssessmentCatalog = {
  template: Template; ruleSet: RuleSet; snapshotDigest: string;
};
export type AssessmentParams = Pick<CalculateRequest, 'userCount' | 'difficultyFactor' | 'orgCount' | 'orgSimilarityFactor'>;
export type AssessmentMatching = {
  requirementReportDigest: string; templateId: string; templateVersion: string; ruleSetId: string; ruleVersion: string; snapshotDigest: string;
  matches: Array<{ reqId: string; templateItemIds: string[]; scope: 'include' | 'review'; rationale: string }>;
  unmatched: Array<{ reqId: string; reason: string }>;
  params: Partial<AssessmentParams>;
  aiAdjustments: Array<{ reqId: string; proposedDays: number; basis: string }>;
};
const paramProperties = { userCount: { type: 'integer', minimum: 0 }, difficultyFactor: { type: 'number', minimum: 0 },
  orgCount: { type: 'integer', minimum: 0 }, orgSimilarityFactor: { type: 'number', minimum: 0, maximum: 1 } };
export const ASSESSMENT_MATCHING_OUTPUT_SCHEMA = mvpObject({
  requirementReportDigest: mvpText(160), templateId: mvpText(160), templateVersion: mvpText(160), ruleSetId: mvpText(160), ruleVersion: mvpText(160), snapshotDigest: mvpText(160),
  matches: mvpArray(mvpObject({ reqId: mvpText(160), templateItemIds: { ...mvpArray(mvpText(160), 1), uniqueItems: true }, scope: { enum: ['include', 'review'] }, rationale: mvpText() })),
  unmatched: mvpArray(mvpObject({ reqId: mvpText(160), reason: mvpText() })), params: mvpObject(paramProperties, []),
  aiAdjustments: mvpArray(mvpObject({ reqId: mvpText(160), proposedDays: { type: 'number', minimum: 0 }, basis: mvpText() })),
});
export type AssessmentScopeConfirmation = {
  matchingDigest: string; actorId: string; decisionId: string; selectedItemIds: string[]; params: AssessmentParams;
};
const templateItemProperties = {
  templateItemId: mvpText(160), groupId: mvpText(160), itemName: mvpText(200), standardDays: { type: 'number', minimum: 0 },
  sheetName: mvpText(200, 0), cloudProduct: mvpText(200, 0), skuName: mvpText(200, 0), appGroup: mvpText(200, 0),
  deliveryModule: mvpText(200, 0), deliveryPoint: mvpText(4000, 0), deliveryDesc: mvpText(10000, 0), evalDesc: mvpText(10000, 0), defaultIncluded: { type: 'boolean' },
};
const catalogProperties = {
  template: mvpObject({ templateId: mvpText(160), templateVersion: mvpText(160), templateName: mvpText(200),
    groups: mvpArray(mvpObject({ groupId: mvpText(160), groupName: mvpText(200) }), 0, 1000),
    items: mvpArray(mvpObject(templateItemProperties, ['templateItemId', 'groupId', 'itemName', 'standardDays']), 1, 10000),
    sheets: mvpArray(mvpObject({ sheetId: mvpText(160), sheetName: mvpText(200) }), 0, 1000),
  }, ['templateId', 'templateVersion', 'templateName', 'groups', 'items']),
  ruleSet: mvpObject({ ruleSetId: mvpText(160), ruleVersion: mvpText(160), pipelineVersion: mvpText(160), pipeline: mvpArray(mvpText(160)),
    baseRule: mvpObject({ userCountTiers: mvpArray(mvpObject({ min: { type: 'number' }, max: { type: 'number' }, factor: { type: 'number' } })),
      difficultyFactorList: mvpArray({ type: 'number' }), userIncrementRounding: { enum: ['none', 'ceil_int'] } }, ['userCountTiers', 'difficultyFactorList']),
    orgIncrementRule: mvpObject({ enabled: { type: 'boolean' }, factor: { type: 'number' } }, ['enabled']),
  }),
};
export const FROZEN_ASSESSMENT_CATALOG_SCHEMA = mvpObject({ ...catalogProperties, snapshotDigest: mvpText(160) });
export const ASSESSMENT_MATCHING_INPUT_SCHEMA = mvpObject({ requirementReportDigest: mvpText(160), requirements: REQUIREMENT_REPORT_SCHEMA,
  confirmedRequirementIds: { ...mvpArray(mvpText(160), 1), uniqueItems: true }, catalog: FROZEN_ASSESSMENT_CATALOG_SCHEMA });
export function assessmentCatalogDigest(catalog: Omit<FrozenAssessmentCatalog, 'snapshotDigest'>): string {
  return skillDefinitionHash(parseMvpContract(mvpObject(catalogProperties), catalog));
}
export function assessmentMatchingDigest(matching: AssessmentMatching): string {
  return skillDefinitionHash(parseMvpContract(ASSESSMENT_MATCHING_OUTPUT_SCHEMA, matching));
}
export function validateAssessmentMatching(requirements: ConfirmedRequirements, catalog: FrozenAssessmentCatalog, output: unknown): AssessmentMatching {
  // Caller supplies this trusted envelope; an LLM cannot self-approve through the output schema.
  const req = confirmRequirements(requirements.report, requirements.confirmation);
  const c = parseMvpContract<FrozenAssessmentCatalog>(FROZEN_ASSESSMENT_CATALOG_SCHEMA, catalog);
  const { snapshotDigest, ...contents } = c;
  if (snapshotDigest !== assessmentCatalogDigest(contents)) mvpInvalid('MVP_CATALOG_CHANGED');
  const m = parseMvpContract<AssessmentMatching>(ASSESSMENT_MATCHING_OUTPUT_SCHEMA, output);
  if (m.requirementReportDigest !== req.confirmation.reportDigest) mvpInvalid('MVP_REQUIREMENTS_CHANGED');
  if (m.templateId !== c.template.templateId || m.templateVersion !== c.template.templateVersion || m.ruleSetId !== c.ruleSet.ruleSetId
    || m.ruleVersion !== c.ruleSet.ruleVersion || m.snapshotDigest !== snapshotDigest) mvpInvalid('MVP_CATALOG_CHANGED');
  const itemIds = new Set(c.template.items.map(i => i.templateItemId));
  if (itemIds.size !== c.template.items.length) mvpInvalid('MVP_MATCHING_REFERENCE_INVALID');
  const expected = new Set(req.confirmation.requirementIds); const covered = new Set<string>();
  for (const entry of [...m.matches, ...m.unmatched]) {
    if (!expected.has(entry.reqId) || covered.has(entry.reqId)) mvpInvalid('MVP_MATCHING_REFERENCE_INVALID');
    covered.add(entry.reqId);
    if ('templateItemIds' in entry && (entry.templateItemIds.some(id => !itemIds.has(id)) || !entry.rationale.trim())) mvpInvalid('MVP_MATCHING_REFERENCE_INVALID');
    if ('reason' in entry && !entry.reason.trim()) mvpInvalid('MVP_MATCHING_REFERENCE_INVALID');
  }
  if (covered.size !== expected.size) mvpInvalid('MVP_MATCHING_REFERENCE_INVALID');
  const adjustments = new Set<string>();
  for (const suggestion of m.aiAdjustments) {
    if (!expected.has(suggestion.reqId) || adjustments.has(suggestion.reqId) || !suggestion.basis.trim()) mvpInvalid('MVP_MATCHING_REFERENCE_INVALID');
    adjustments.add(suggestion.reqId);
  }
  return m;
}
/** Maps explicit reviewed selection to the existing WES calculation contract. No effort calculation or overrides.
 * AI adjustments remain proposals in matching; applying one requires a separate explicit native review path.
 * The host must retain matching/unmatched and all snapshot/version refs beside the calculation draft.
 */
export function buildAssessmentItems(requirements: ConfirmedRequirements, catalog: FrozenAssessmentCatalog, output: unknown,
  confirmation: AssessmentScopeConfirmation): CalculateRequest {
  const matching = validateAssessmentMatching(requirements, catalog, output);
  const schema = mvpObject({ matchingDigest: mvpText(160), actorId: mvpText(160), decisionId: mvpText(160),
    selectedItemIds: { ...mvpArray(mvpText(160), 0, 10000), uniqueItems: true }, params: mvpObject(paramProperties) });
  const review = parseMvpContract<AssessmentScopeConfirmation>(schema, confirmation);
  if (review.matchingDigest !== assessmentMatchingDigest(matching)) mvpInvalid('MVP_CONFIRMATION_STALE');
  if (!review.actorId.trim() || !review.decisionId.trim() || review.selectedItemIds.some(id => !catalog.template.items.some(i => i.templateItemId === id))) mvpInvalid('MVP_SCOPE_INVALID');
  const request: CalculateRequest = { templateId: catalog.template.templateId, ruleSetId: catalog.ruleSet.ruleSetId, ...review.params,
    items: catalog.template.items.map(item => ({ templateItemId: item.templateItemId, included: review.selectedItemIds.includes(item.templateItemId) })) };
  if (!validateCalculateRequest(request, catalog.template, catalog.ruleSet).ok) mvpInvalid('MVP_CALCULATION_INVALID');
  return request;
}
