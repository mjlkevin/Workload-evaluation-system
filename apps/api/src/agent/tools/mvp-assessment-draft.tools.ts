import type { AgentTool } from '../agent.types';
import { SkillError } from '../../modules/skills/skills.types';
import { mvpArray, mvpObject, mvpText, type ConfirmedRequirements } from '../../modules/skills/mvp/requirements';
import { ASSESSMENT_MATCHING_OUTPUT_SCHEMA, type AssessmentMatching, type AssessmentParams } from '../../modules/skills/mvp/assessment-matching';
import { CONFIRMED_REQUIREMENTS_SCHEMA } from './mvp-requirements.tools';

export type MvpAssessmentDraftParameters = { projectName: string; customerName?: string; requirements: ConfirmedRequirements;
 matching: AssessmentMatching; selectedItemIds: string[]; params: AssessmentParams };
export const MVP_ASSESSMENT_DRAFT_PARAMETERS = mvpObject({ projectName: mvpText(200), customerName: mvpText(200, 0),
 requirements: CONFIRMED_REQUIREMENTS_SCHEMA, matching: ASSESSMENT_MATCHING_OUTPUT_SCHEMA,
 selectedItemIds: { ...mvpArray(mvpText(160), 0, 10000), uniqueItems: true },
 params: mvpObject({ userCount: { type: 'integer', minimum: 0 }, difficultyFactor: { type: 'number', minimum: 0 },
  orgCount: { type: 'integer', minimum: 0 }, orgSimilarityFactor: { type: 'number', minimum: 0, maximum: 1 } }),
}, ['projectName', 'requirements', 'matching', 'selectedItemIds', 'params']);
export const MVP_ASSESSMENT_DRAFT_OUTPUT = mvpObject({ assessmentId: mvpText(160), versionCode: mvpText(500),
 projectId: mvpText(160), projectVersionCode: mvpText(500), totalDays: { type: 'number', minimum: 0 },
 templateId: mvpText(160), ruleSetId: mvpText(160), templateVersion: mvpText(160), ruleVersion: mvpText(160),
 snapshotDigest: mvpText(160), operationId: mvpText(160), runId: mvpText(160) });
/** The registry publishes the contract. Only the operation consumer can assemble its local transaction adapter. */
export function buildMvpAssessmentDraftTools(_ownerUserId: string): AgentTool[] {
 return [{ name: 'create_assessment_draft', description: '按已核对的需求、实施目录、范围及参数计算并创建关联的项目与实施评估草稿',
  parameters: MVP_ASSESSMENT_DRAFT_PARAMETERS, outputSchema: MVP_ASSESSMENT_DRAFT_OUTPUT,
  source: 'code', capability: 'estimates:create', category: 'estimate', discoverable: true,
  mutates: true, exfiltrates: false, simulationOnly: false, sandboxReadSafe: false, businessExecutionOnly: true,
  async execute() { throw new SkillError('confirmedlocaladapterrequired', '请通过当前业务任务的操作执行入口创建草稿', 409); },
 }];
}
