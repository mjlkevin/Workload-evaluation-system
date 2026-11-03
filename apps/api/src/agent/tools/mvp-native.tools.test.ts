import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { buildMvpRequirementTools, requirementReportEnvelope } from './mvp-requirements.tools';
import { buildMvpAssessmentTools } from './mvp-assessment.tools';
import type { MvpExecutionProof } from '../../modules/skills/mvp/execution-proof.repository';
import { assessmentCatalogDigest, type FrozenAssessmentCatalog } from '../../modules/skills/mvp/assessment-matching';
import { normalizeRequirementCandidates } from '../../modules/skills/mvp/requirements';
import type { RuntimeContext } from '../context/context.types';

const owner = 'fixture-owner';
const user = { id: owner, capabilities: ['estimates:read' as const] };
const runtime: RuntimeContext = { requestId: 'fixture-request', traceId: 'fixture-trace', actor: { userId: owner, roles: ['IMPL'], capabilities: user.capabilities },
 channel: 'api', workflowKey: 'business_skills', harnessRunId: 'fixture-run', aiSessionId: 'fixture-session' };
const source = { id: 'fixture-source', kind: 'conversation' as const, text: '查询订单' };
const candidates = { requirements: [{ title: source.text, description: source.text, role: '用户', action: '查询', object: '订单',
 constraints: [], openQuestions: [], assumptions: [], sources: [{ sourceId: source.id, quote: source.text, start: 0, end: source.text.length }] }], relations: [] };
const report = normalizeRequirementCandidates({ sources: [source] }, candidates);
const catalogBody = { template: { templateId: 'fixture-template', templateVersion: 'V1', templateName: '合成目录', groups: [],
 items: [{ templateItemId: 'fixture-item', groupId: 'g', itemName: '合成项目', standardDays: 2 }] },
 ruleSet: { ruleSetId: 'fixture-rule', ruleVersion: 'V1', pipelineVersion: 'V1', pipeline: ['baseRule'],
 baseRule: { userCountTiers: [{ min: 0, max: 100, factor: 0 }], difficultyFactorList: [0] }, orgIncrementRule: { enabled: false } } };
const catalog: FrozenAssessmentCatalog = { ...catalogBody, snapshotDigest: assessmentCatalogDigest(catalogBody) };
function fixture() {
 const outputs: Array<{ name: string; value: unknown }> = [];
 let approved: unknown;
 let lastRuntime: RuntimeContext | undefined;
 const failure = (code: string): never => { throw Object.assign(new Error(code), { code }); };
 const proof = { sources: [source], manifest: { assetBindings: [{ kind: 'assessment-catalog', templateId: catalog.template.templateId,
  templateVersion: 'V1', ruleSetId: 'fixture-rule', ruleVersion: 'V1', pipelineVersion: 'V1', ...catalog }] },
  assertPreviousOutput(names: readonly string[], expected: unknown) {
   const previous = [...outputs].reverse().find(output => names.includes(output.name));
   if (!previous || !isDeepStrictEqual(previous.value, expected)) failure('MVP_PREVIOUS_OUTPUT_MISMATCH');
  },
  readConfirmation(expected: unknown) {
   if (!approved || !isDeepStrictEqual(approved, expected)) failure('MVP_CONFIRMATION_PROOF_MISSING');
   return { actorId: owner, decisionId: 'fixture-decision', actionId: 'fixture-action', physicalRunId: 'fixture-run', stepId: 'confirm', displayInput: expected };
  }, readAnswerSources: () => [],
 } as unknown as MvpExecutionProof;
 const read = async (_owner: string, trusted: RuntimeContext | undefined, _name: string, _args: unknown) => {
  assert.equal(_owner, owner); lastRuntime = trusted;
  if (!trusted || trusted.actor.userId !== owner) failure('MVP_EXECUTION_PROOF_INVALID');
  return proof;
 };
 const tools = [...buildMvpRequirementTools(owner, read), ...buildMvpAssessmentTools(owner, read)];
 const call = async (name: string, args: Record<string, unknown>, trusted: RuntimeContext | undefined = runtime) => {
  const value = await tools.find(t => t.name === name)!.execute(args, user, trusted);
  outputs.push({ name, value: structuredClone(value) }); return value as any;
 };
 return { tools, call, proof, setPrevious: (name: string, value: unknown) => { outputs.push({ name, value }); },
  approve: (value: unknown) => { approved = structuredClone(value); }, lastRuntime: () => lastRuntime };
}
const rejects = (promise: Promise<unknown>, code: string) => assert.rejects(promise, (e: any) => e.code === code);

test('six native tools expose code-owned output contracts and production safe read metadata', () => {
 const { tools } = fixture(); assert.equal(tools.length, 6);
 for (const tool of tools) {
  assert.equal(tool.source, 'code'); assert.equal(tool.capability, 'estimates:read'); assert.equal(tool.mutates, false);
  assert.equal(tool.exfiltrates, false); assert.equal(tool.simulationOnly, false); assert.equal(tool.sandboxReadSafe, true);
  assert.equal(tool.outputSchema?.additionalProperties, false);
 }
});
test('trusted sources and candidates normalize into stable native IDs; forged input sources fail', async () => {
 const f = fixture(); assert.deepEqual(await f.call('requirement_sources', {}), { sources: [source] });
 assert.equal(f.lastRuntime(), runtime);
 const normalized = await f.call('requirement_normalize', { candidates }); assert.deepEqual(normalized, requirementReportEnvelope(report));
 await rejects(f.call('requirement_normalize', { candidates, sources: [source] }), 'MVP_SCHEMA_INVALID');
 const forged = structuredClone(candidates); forged.requirements[0].sources[0].quote = '伪造订单';
 await rejects(f.call('requirement_normalize', { candidates: forged }), 'MVP_SOURCE_INVALID');
});
test('clarification requires latest genuine producer and preserves IDs and source anchors', async () => {
 const f = fixture(); await rejects(f.call('requirement_clarify', { previous: report, report }), 'MVP_PREVIOUS_OUTPUT_MISMATCH');
 await f.call('requirement_normalize', { candidates });
 assert.deepEqual(await f.call('requirement_clarify', { previous: report, report }), requirementReportEnvelope(report));
 const invented = structuredClone(report); invented.requirements[0].id = 'REQ-002';
 await rejects(f.call('requirement_clarify', { previous: report, report: invented }), 'MVP_REQUIREMENT_IDS_CHANGED');
});
test('confirmation binds entire displayed report, selection and resolutions and derives authenticated identity', async () => {
 const f = fixture(); await f.call('requirement_normalize', { candidates });
 const args = { report, requirementIds: ['REQ-001'] };
 await rejects(f.call('requirement_confirm', args), 'MVP_CONFIRMATION_PROOF_MISSING');
 f.approve({ report }); await rejects(f.call('requirement_confirm', args), 'MVP_CONFIRMATION_PROOF_MISSING');
 f.approve(args); const confirmed = await f.call('requirement_confirm', args);
 assert.equal(confirmed.confirmation.actorId, owner); assert.equal(confirmed.confirmation.decisionId, 'fixture-decision');
 f.setPrevious('requirement_normalize', requirementReportEnvelope(report));
 await rejects(f.call('requirement_confirm', { ...args, actorId: 'invented' }), 'MVP_SCHEMA_INVALID');
 await rejects(f.call('requirement_confirm', { ...args, requirementIds: [] }), 'MVP_SCHEMA_INVALID');
 await rejects(f.call('requirement_confirm', { ...args, resolvedConflicts: [] }), 'MVP_CONFIRMATION_PROOF_MISSING');
 f.approve({ ...args, resolvedConflicts: [] });
 const resolved = await f.call('requirement_confirm', { ...args, resolvedConflicts: [] });
 assert.deepEqual(resolved.confirmation.resolvedConflicts, []);
});
test('catalog resolves exact frozen manifest snapshot and refuses absent assets', async () => {
 const f = fixture(); assert.deepEqual(await f.call('assessment_catalog', { templateId: 'fixture-template' }), catalog);
 await rejects(f.call('assessment_catalog', { templateId: 'latest-template' }), 'MVP_CATALOG_CHANGED');
 const altered = structuredClone(f.proof.manifest.assetBindings!); altered[0].template.items[0].standardDays++;
 f.proof.manifest.assetBindings = altered;
 await rejects(f.call('assessment_catalog', { templateId: 'fixture-template' }), 'MVP_CATALOG_CHANGED');
});
test('matching requires genuine confirmation envelope plus original human decision and frozen catalog', async () => {
 const f = fixture(); await f.call('requirement_normalize', { candidates });
 const args = { report, requirementIds: ['REQ-001'] }; f.approve(args);
 const requirements = await f.call('requirement_confirm', args);
 const matching = { requirementReportDigest: requirements.confirmation.reportDigest, templateId: catalog.template.templateId,
 templateVersion: 'V1', ruleSetId: 'fixture-rule', ruleVersion: 'V1', snapshotDigest: catalog.snapshotDigest,
 matches: [{ reqId: 'REQ-001', templateItemIds: ['fixture-item'], scope: 'include', rationale: '合成匹配' }], unmatched: [], params: {}, aiAdjustments: [] };
 const validated = await f.call('assessment_match_validate', { requirements, matching }); assert.deepEqual(validated.matching, matching);
 f.setPrevious('requirement_confirm', requirements);
 const forged = structuredClone(requirements); forged.confirmation.actorId = 'model-actor';
 await rejects(f.call('assessment_match_validate', { requirements: forged, matching }), 'MVP_PREVIOUS_OUTPUT_MISMATCH');
 f.approve({ report }); await rejects(f.call('assessment_match_validate', { requirements, matching }), 'MVP_CONFIRMATION_PROOF_MISSING');
 f.approve(args); f.setPrevious('requirement_confirm', requirements);
 await rejects(f.call('assessment_match_validate', { requirements, matching: { ...matching, matches: [] } }), 'MVP_MATCHING_REFERENCE_INVALID');
});
test('native tools reject absent runtime and model-supplied runtime envelopes', async () => {
 const f = fixture(); const tool = f.tools[0];
 await rejects(tool.execute({}, user), 'MVP_EXECUTION_PROOF_INVALID');
 await rejects(f.call('requirement_sources', { runtime }), 'MVP_SCHEMA_INVALID');
});
test('composed sources exceeding count, answer-text or JSON limits fail explicitly without truncation', async () => {
 for (const sources of [
  Array.from({ length: 101 }, (_, index) => ({ ...source, id: `source-${index}` })),
  [{ ...source, id: 'answer:fixture', text: 'x'.repeat(200001) }],
  Array.from({ length: 3 }, (_, index) => ({ ...source, id: `source-${index}`, text: '文'.repeat(150000) })),
 ]) {
  const f = fixture(); f.proof.sources = sources;
  await rejects(f.call('requirement_sources', {}), 'MVP_SOURCE_LIMIT');
  await rejects(f.call('requirement_normalize', { candidates }), 'MVP_SOURCE_LIMIT');
  assert.deepEqual(f.proof.sources, sources);
 }
});
test('a later clarification makes an earlier human-confirmed report stale for matching', async () => {
 const f = fixture(); await f.call('requirement_normalize', { candidates });
 const args = { report, requirementIds: ['REQ-001'] }; f.approve(args);
 const requirements = await f.call('requirement_confirm', args);
 const updated = structuredClone(report); updated.requirements[0].constraints.push('仅授权订单');
 await f.call('requirement_clarify', { previous: report, report: updated });
 const matching = { requirementReportDigest: requirements.confirmation.reportDigest, templateId: catalog.template.templateId,
  templateVersion: 'V1', ruleSetId: 'fixture-rule', ruleVersion: 'V1', snapshotDigest: catalog.snapshotDigest,
  matches: [{ reqId: 'REQ-001', templateItemIds: ['fixture-item'], scope: 'include', rationale: '合成匹配' }], unmatched: [], params: {}, aiAdjustments: [] };
 await rejects(f.call('assessment_match_validate', { requirements, matching }), 'MVP_PREVIOUS_OUTPUT_MISMATCH');
});
