import type { AgentTool } from '../agent.types';
import type { MvpExecutionProof } from '../../modules/skills/mvp/execution-proof.repository';
import { validateFrozenExecutionAssets } from '../../modules/skills/mvp/execution-assets';
import { assessmentMatchingDigest, validateAssessmentMatching, FROZEN_ASSESSMENT_CATALOG_SCHEMA, ASSESSMENT_MATCHING_OUTPUT_SCHEMA,
 type FrozenAssessmentCatalog, type AssessmentMatching } from '../../modules/skills/mvp/assessment-matching';
import { confirmRequirements, mvpInvalid, mvpObject, mvpText, requirementReportDigest, type ConfirmedRequirements } from '../../modules/skills/mvp/requirements';
import { CONFIRMED_REQUIREMENTS_SCHEMA, mvpReadTool, requirementReportEnvelope, type MvpProofReader } from './mvp-requirements.tools';

/** Read only the admitted manifest snapshot; never consult the active template or rule repositories. */
function frozenCatalog(proof: MvpExecutionProof, templateId: string): FrozenAssessmentCatalog {
 const assets = proof.manifest.assetBindings ?? [];
 try { validateFrozenExecutionAssets(assets); } catch { return mvpInvalid('MVP_CATALOG_CHANGED'); }
 const matches = assets.filter(asset => asset.kind === 'assessment-catalog' && asset.templateId === templateId);
 if (matches.length !== 1) return mvpInvalid('MVP_CATALOG_CHANGED');
 const { template, ruleSet, snapshotDigest } = matches[0];
 return { template, ruleSet, snapshotDigest };
}
export function buildMvpAssessmentTools(ownerUserId: string, reader?: MvpProofReader): AgentTool[] {
 return [
  mvpReadTool(ownerUserId, reader, { name: 'assessment_catalog', description: '读取本次执行已冻结的实施目录和规则版本',
   parameters: mvpObject({ templateId: mvpText(160) }), outputSchema: FROZEN_ASSESSMENT_CATALOG_SCHEMA,
   run: (input: { templateId: string }, proof) => frozenCatalog(proof, input.templateId) }),
  mvpReadTool(ownerUserId, reader, { name: 'assessment_match_validate', description: '以真实确认范围和冻结目录验证实施匹配，不计算或保存评估',
   parameters: mvpObject({ requirements: CONFIRMED_REQUIREMENTS_SCHEMA, matching: ASSESSMENT_MATCHING_OUTPUT_SCHEMA }),
   outputSchema: mvpObject({ matching: ASSESSMENT_MATCHING_OUTPUT_SCHEMA, matchingDigest: mvpText(160) }),
   run(input: { requirements: ConfirmedRequirements; matching: AssessmentMatching }, proof) {
    // Model-provided confirmation fields are accepted only as an exact echo of the latest persisted producer.
    proof.assertPreviousOutput(['requirement_confirm'], input.requirements);
    const { report, confirmation } = input.requirements;
    proof.assertPreviousOutput(['requirement_normalize', 'requirement_clarify'], requirementReportEnvelope(report));
    const displayed = { report, requirementIds: confirmation.requirementIds,
     ...(confirmation.resolvedConflicts !== undefined ? { resolvedConflicts: confirmation.resolvedConflicts } : {}) };
    const decision = proof.readConfirmation(displayed);
    const trusted = confirmRequirements(report, { reportDigest: requirementReportDigest(report), requirementIds: confirmation.requirementIds,
     actorId: decision.actorId, decisionId: decision.decisionId,
     ...(confirmation.resolvedConflicts !== undefined ? { resolvedConflicts: confirmation.resolvedConflicts } : {}) });
    // Reconstruct independently rather than trusting a self-confirmation envelope from the caller.
    proof.assertPreviousOutput(['requirement_confirm'], trusted);
    const matching = validateAssessmentMatching(trusted, frozenCatalog(proof, input.matching.templateId), input.matching);
    return { matching, matchingDigest: assessmentMatchingDigest(matching) };
   } }),
 ];
}
