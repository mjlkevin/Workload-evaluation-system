import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMvpRequirementTools } from '../../../agent/tools/mvp-requirements.tools';
import { buildMvpAssessmentTools } from '../../../agent/tools/mvp-assessment.tools';
import { buildMvpAssessmentDraftTools } from '../../../agent/tools/mvp-assessment-draft.tools';
import { validateSkillDefinition, compileSkillPayloadSchema } from '../skills.validation';
import { skillDefinitionHash } from '../skills.hash';
import { validateWorkflowDefinition } from '../../workflows/workflows.validation';
import type { WorkflowValidationContext, WorkflowDefinition } from '../../workflows/workflows.types';
import { REQUIREMENT_EXTRACTION_INPUT_SCHEMA, REQUIREMENT_CLARIFICATION_INPUT_SCHEMA, REQUIREMENT_REPORT_SCHEMA,
 normalizeRequirementCandidates, validateRequirementClarification, confirmRequirements, requirementReportDigest, type RequirementReport, type RequirementSource } from './requirements';
import { TRANSPORT_REQUIREMENT_CANDIDATES_SCHEMA, TRANSPORT_REQUIREMENT_REPORT_SCHEMA, resolveCandidateQuotes, resolveReportQuotes } from './quote-transport';
import { ASSESSMENT_MATCHING_INPUT_SCHEMA, ASSESSMENT_MATCHING_OUTPUT_SCHEMA, validateAssessmentMatching, type FrozenAssessmentCatalog } from './assessment-matching';
import { buildMvpSkillDefinitions, buildMvpWorkflowDefinition, type MvpSkillBindings } from './managed-assets';

const bindings: MvpSkillBindings = {
 decompose: { skillId: 'test-decompose', skillVersionId: 'test-decompose-A01' },
 clarify: { skillId: 'test-clarify', skillVersionId: 'test-clarify-A01' },
 matching: { skillId: 'test-matching', skillVersionId: 'test-matching-A01' },
};
const native = [...buildMvpRequirementTools('test-owner'), ...buildMvpAssessmentTools('test-owner'), ...buildMvpAssessmentDraftTools('test-owner')];
const context = (): WorkflowValidationContext => {
 const definitions = buildMvpSkillDefinitions();
 return { tools: native.map(tool => ({ ...tool, requiresConfirmation: tool.mutates || Boolean(tool.exfiltrates) })),
  skills: Object.entries(bindings).map(([key, binding]) => ({ ...binding, stepId: key, hash: skillDefinitionHash(definitions[key as keyof MvpSkillBindings]),
   status: 'published', enabled: true, archived: false, definition: definitions[key as keyof MvpSkillBindings] })) };
};
const step = (workflow: WorkflowDefinition, id: string) => {
 const found = workflow.steps.find(item => item.id === id); assert.ok(found, `missing step ${id}`); return found;
};
const paths = (workflow: WorkflowDefinition, id: string) => Object.fromEntries(step(workflow, id).inputMapping.map(item => [item.target, item.source]));
const path = (value: string) => ({ kind: 'path' as const, path: value });

test('three editable semantic Skills validate against canonical schemas and have human-authored examples', () => {
 const definitions = buildMvpSkillDefinitions();
 assert.deepEqual(Object.keys(definitions).sort(), ['clarify', 'decompose', 'matching']);
 for (const definition of Object.values(definitions)) {
  assert.deepEqual(validateSkillDefinition(definition, native), definition);
  assert.deepEqual(definition.roles, ['pre_sales']);
  assert.deepEqual(definition.tools, []);
  assert.deepEqual(definition.model, { scenario: 'assessment', temperature: 0.2, maxTokens: 8192, timeoutMs: 60000 });
  assert.ok(definition.examples.length >= 2);
  for (const example of definition.examples) {
   assert.match(example.title, /TEST ONLY/);
   assert.ok(example.assertions && example.assertions.length >= 2);
   assert.equal(compileSkillPayloadSchema(definition.inputSchema, 'test.input')(example.input), true);
   assert.equal(compileSkillPayloadSchema(definition.outputSchema, 'test.output')(example.expected), true);
  }
 }
 assert.deepEqual(definitions.decompose.inputSchema, REQUIREMENT_EXTRACTION_INPUT_SCHEMA);
 assert.deepEqual(definitions.decompose.outputSchema, TRANSPORT_REQUIREMENT_CANDIDATES_SCHEMA);
 assert.deepEqual(definitions.clarify.inputSchema, REQUIREMENT_CLARIFICATION_INPUT_SCHEMA);
 assert.deepEqual(definitions.clarify.outputSchema, TRANSPORT_REQUIREMENT_REPORT_SCHEMA);
 assert.deepEqual(definitions.matching.inputSchema, ASSESSMENT_MATCHING_INPUT_SCHEMA);
 assert.deepEqual(definitions.matching.outputSchema, ASSESSMENT_MATCHING_OUTPUT_SCHEMA);
});

test('example quotes resolve without model-computed offsets; clarification retains stable IDs and all old evidence', () => {
 const definitions = buildMvpSkillDefinitions();
 for (const example of definitions.decompose.examples) {
  const input = example.input as { sources: RequirementSource[] };
  const report = normalizeRequirementCandidates(input, resolveCandidateQuotes(input.sources, example.expected));
  assert.ok(report.requirements.every(item => item.sources.length));
 }
 for (const example of definitions.clarify.examples) {
  const input = example.input as { sources: RequirementSource[]; previous: RequirementReport };
  const after = resolveReportQuotes(input.sources, example.expected, input.previous);
  assert.deepEqual(validateRequirementClarification(input.previous, input.sources, after), after);
  assert.deepEqual(after.requirements.map(item => item.id), input.previous.requirements.map(item => item.id));
 }
 const unanswered = definitions.clarify.examples.find(example => /未回答/.test(example.title)); assert.ok(unanswered);
 const before = (unanswered.input as { previous: RequirementReport }).previous;
 assert.ok(before.requirements.some(item => item.openQuestions.length));
 assert.deepEqual(unanswered.expected, before);
});

test('default Workflow validates whole-output mappings against actual native contracts and exact published Skill versions', () => {
 const workflow = buildMvpWorkflowDefinition(bindings);
 assert.deepEqual(validateWorkflowDefinition(workflow, context()), workflow);
 assert.deepEqual(workflow.inputSchema.required, ['projectName', 'templateId', 'description']);
 assert.deepEqual(workflow.steps.filter(item => item.type === 'skill').map(item => [item.id, item.skillId, item.skillVersionId]),
  Object.entries(bindings).map(([key, binding]) => [key, binding.skillId, binding.skillVersionId]));
 assert.deepEqual(paths(workflow, 'normalize'), { candidates: path('$.steps.decompose.output') });
 assert.deepEqual(paths(workflow, 'clarify'), { sources: path('$.steps.clarificationSources.output.sources'), previous: path('$.steps.normalize.output.report') });
 assert.deepEqual(paths(workflow, 'clarified'), { previous: path('$.steps.normalize.output.report'), report: path('$.steps.clarify.output') });
 assert.deepEqual(paths(workflow, 'matching'), { requirementReportDigest: path('$.steps.clarified.output.reportDigest'),
  requirements: path('$.steps.clarified.output.report'), confirmedRequirementIds: path('$.steps.confirmed.output.confirmation.requirementIds'), catalog: path('$.steps.catalog.output') });
 assert.deepEqual(paths(workflow, 'matched'), { requirements: path('$.steps.confirmed.output'), matching: path('$.steps.matching.output') });
});

test('human checkpoints show exact native confirmation payloads and require actual clarification plus reviewed scope', () => {
 const workflow = buildMvpWorkflowDefinition(bindings);
 assert.deepEqual(workflow.steps.filter(item => item.type === 'userInput').map(item => item.id), ['clarification', 'scope']);
 assert.deepEqual(workflow.steps.filter(item => item.type === 'confirmation').map(item => item.id), ['confirmRequirements', 'confirmScope']);
 assert.deepEqual(paths(workflow, 'confirmRequirements'), paths(workflow, 'confirmed'));
 assert.deepEqual(Object.keys(paths(workflow, 'confirmRequirements')).sort(), ['report', 'requirementIds']);
 assert.deepEqual(Object.keys(paths(workflow, 'confirmScope')).sort(), ['matching', 'params', 'selectedItemIds']);
 const clarification = step(workflow, 'clarification'); assert.equal(clarification.type, 'userInput');
 if (clarification.type !== 'userInput') return;
 const answer = compileSkillPayloadSchema(clarification.outputSchema, 'test.answer');
 assert.equal(answer({ answer: '' }), false); assert.equal(answer({ answer: '实际补充' }), true);
 const scope = step(workflow, 'scope'); assert.equal(scope.type, 'userInput'); if (scope.type !== 'userInput') return;
 const validateScope = compileSkillPayloadSchema(scope.outputSchema, 'test.scope');
 const validScope = { selectedItemIds: [], params: { userCount: 50, difficultyFactor: 1, orgCount: 1, orgSimilarityFactor: 0 } };
 assert.equal(validateScope(validScope), true);
 for (const [name, value] of [['userCount', -1], ['userCount', 1.5], ['orgCount', 1.5], ['orgSimilarityFactor', 1.1], ['difficultyFactor', -0.1]]) {
  assert.equal(validateScope({ ...validScope, params: { ...validScope.params, [name]: value } }), false);
 }
 assert.equal(validateScope({ ...validScope, selectedItemIds: Array.from({ length: 10001 }, (_, i) => `test-${i}`) }), false);
 assert.deepEqual(paths(workflow, 'draft').customerName, { ...path('$.input.customerName'), fallback: '' });
 assert.deepEqual(paths(workflow, 'draft').selectedItemIds, path('$.steps.scope.output.selectedItemIds'));
 assert.deepEqual(paths(workflow, 'draft').params, path('$.steps.scope.output.params'));
 const draft = step(workflow, 'draft'); assert.equal(draft.type, 'tool'); if (draft.type === 'tool') assert.equal(draft.requiresConfirmation, true);
});

test('Workflow rejects draft/missing/mismatched Skill bindings, type drift and weakened mutating confirmation', () => {
 const workflow = buildMvpWorkflowDefinition(bindings);
 for (const patch of [{ status: 'draft' }, { enabled: false }, { archived: true }, { skillVersionId: 'latest' }]) {
  const ctx = context(); Object.assign(ctx.skills[0], patch); assert.throws(() => validateWorkflowDefinition(workflow, ctx));
 }
 assert.throws(() => validateWorkflowDefinition(workflow, { ...context(), skills: [] }));
 const wrongType = structuredClone(workflow);
 step(wrongType, 'normalize').inputMapping = [{ target: 'candidates', source: path('$.input.projectName') }];
 assert.throws(() => validateWorkflowDefinition(wrongType, context()));
 const unconfirmed = structuredClone(workflow); const draft = step(unconfirmed, 'draft'); if (draft.type === 'tool') draft.requiresConfirmation = false;
 assert.throws(() => validateWorkflowDefinition(unconfirmed, context()));
 const wrongVersion = structuredClone(workflow); const decompose = step(wrongVersion, 'decompose'); if (decompose.type === 'skill') decompose.skillVersionId = 'other';
 assert.throws(() => validateWorkflowDefinition(wrongVersion, context()));
});

test('definitions stay editable and freshly built: changes affect hashes and no release or runtime state is manufactured', () => {
 const original = buildMvpSkillDefinitions(); const edited = structuredClone(original.decompose);
 edited.instructions += '\n管理员补充业务拆解规则。';
 assert.notEqual(skillDefinitionHash(edited), skillDefinitionHash(original.decompose));
 assert.equal(validateSkillDefinition(edited, native).instructions, edited.instructions);
 original.decompose.roles.push('admin'); assert.deepEqual(buildMvpSkillDefinitions().decompose.roles, ['pre_sales']);
 assert.deepEqual(buildMvpSkillDefinitions(['delivery']).matching.roles, ['delivery']);
 assert.throws(() => validateSkillDefinition(buildMvpSkillDefinitions(['presales']).decompose, native));
 for (const value of [...Object.values(buildMvpSkillDefinitions()), buildMvpWorkflowDefinition(bindings)]) {
  assert.equal('status' in value, false); assert.equal('activeVersionId' in value, false); assert.equal('execute' in value, false);
 }
});


test('human-authored matching examples preserve all frozen references and cover every confirmed requirement', () => {
 for (const example of buildMvpSkillDefinitions().matching.examples) {
  const input = example.input as { requirements: RequirementReport; requirementReportDigest: string; confirmedRequirementIds: string[]; catalog: FrozenAssessmentCatalog };
  assert.equal(input.requirementReportDigest, requirementReportDigest(input.requirements));
  const requirements = confirmRequirements(input.requirements, { reportDigest: input.requirementReportDigest,
   requirementIds: input.confirmedRequirementIds, actorId: 'test-only-human', decisionId: 'test-only-decision' });
  const output = validateAssessmentMatching(requirements, input.catalog, example.expected);
  assert.deepEqual(output.params, {}); assert.deepEqual(output.aiAdjustments, []);
  assert.deepEqual([...output.matches.map(item => item.reqId), ...output.unmatched.map(item => item.reqId)].sort(), [...input.confirmedRequirementIds].sort());
  if (/完整目录/.test(example.title)) {
   assert.equal(output.matches.length, 0); assert.equal(output.unmatched.length, input.confirmedRequirementIds.length);
  }
 }
});
