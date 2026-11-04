import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExecutionManifestService, readPersistedExecutionManifest, validateExecutionRequest } from '../execution-manifest';
import type { ExecutionSnapshot } from '../execution-manifest.types';
import type { SkillDefinition } from '../skills.types';
import type { AuthUser } from '../../../types';
import { skillDefinitionHash as hash } from '../skills.hash';
import { readBusinessSkillsRun } from '../../harness/business-skills.workflow';
import { BUSINESS_SKILLS_WORKFLOW_ID, BUSINESS_SKILLS_WORKFLOW_VERSION } from '../../harness/business-skills.identity';
import { assessmentCatalogDigest } from './assessment-matching';
const user = { id: 'owner', username: 'Owner', role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const definition: SkillDefinition = { name: 'Freeze assets', description: '', category: 'test', instructions: 'Use frozen catalog', roles: ['pre_sales'],
  inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 }, tools: [], references: [], examples: [] };
const context = { schemaVersion: 1 as const, references: [], tools: [], roles: ['ADMIN' as const], model: {
  providerId: 'fixture', model: 'frozen', modelSource: 'binding' as const, credentialScope: 'scope', baseUrlDigest: hash('endpoint'), params: definition.model, capabilities: [], supportedParams: [] } };
const catalog = () => {
  const template = { templateId: 'catalog-a', templateVersion: 'v1', templateName: 'Catalog A', groups: [], items: [{ templateItemId: 'a', groupId: 'g', itemName: 'Original point', standardDays: 3 }] };
  const ruleSet = { ruleSetId: 'rules-a', ruleVersion: 'v1', pipelineVersion: 'v1', pipeline: ['base'], baseRule: { userCountTiers: [{ min: 0, max: 100, factor: 1 }], difficultyFactorList: [1] }, orgIncrementRule: { enabled: false } };
  return { kind: 'assessment-catalog' as const, templateId: template.templateId, templateVersion: template.templateVersion,
    ruleSetId: ruleSet.ruleSetId, ruleVersion: ruleSet.ruleVersion, pipelineVersion: ruleSet.pipelineVersion,
    template, ruleSet, snapshotDigest: assessmentCatalogDigest({ template, ruleSet }) };
};
function fixture(kind: 'skill' | 'workflow' = 'skill') {
  let current = catalog(); let assetReads = 0;
  const skill = { stepId: kind === 'skill' ? '$skill' : 's', skillId: 'skill-a', versionId: 'version-a', hash: hash(definition), definition };
  const workflow = { name: 'Workflow', description: '', category: 'test', roles: ['pre_sales'], inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    steps: [{ id: 's', name: 'Read', type: 'skill', skillId: 'skill-a', skillVersionId: 'version-a', inputMapping: [], onFailure: 'fail' }], outputMapping: [] };
  const snapshot: ExecutionSnapshot = kind === 'skill' ? { kind, target: { id: 'skill-a', versionId: 'version-a', hash: hash(definition), definition }, skills: [skill] }
    : { kind, target: { id: 'workflow-a', versionId: 'workflow-v1', hash: hash(workflow), definition: workflow as never }, skills: [skill],
      publishedDependencies: { schemaVersion: 1, tools: [], skills: [{ stepId: 's', skillId: 'skill-a', skillVersionId: 'version-a', hash: hash(definition), context }] } };
  const service = createExecutionManifestService({ database: { transaction: async (cb: (tx: unknown) => unknown) => cb({}) } as never,
    repository: { async read() { return structuredClone(snapshot); }, async verifyCaller() {} },
    assetRepository: { async read(_tx: unknown, refs: unknown[]) { assetReads++; return refs.length ? [structuredClone(current)] : []; } },
    prepareAuthority: async (_uris, resolve) => ({ value: await resolve(), verify: async () => {} }),
    loadSkillContext: async () => ({ tools: [], snapshot: context }) as never,
    loadWorkflowTools: async () => [],
  });
  const request = { kind, [kind === 'skill' ? 'skillId' : 'workflowId']: snapshot.target.id, input: { text: 'exact user input' }, assets: [{ kind: 'assessment-catalog', templateId: 'catalog-a' }] };
  return { service, request, get reads() { return assetReads; }, change() { current.template.items[0].standardDays = 9; current.ruleSet.ruleVersion = 'v2'; current.ruleVersion = 'v2'; current.snapshotDigest = assessmentCatalogDigest({ template: current.template, ruleSet: current.ruleSet }); } };
}
test('new references reject caller data while assets=[] canonicalizes to omitted for legacy fingerprints', () => {
  assert.deepEqual(validateExecutionRequest({ kind: 'skill', skillId: 'a', input: {}, assets: [] }), { kind: 'skill', skillId: 'a', input: {} });
  assert.throws(() => validateExecutionRequest({ kind: 'skill', skillId: 'a', input: {}, assets: [{ kind: 'assessment-catalog', templateId: 'a', items: [] }] }));
});
for (const kind of ['skill', 'workflow'] as const) test(`${kind} freezes selected complete catalog and restores it without current DB lookup`, async () => {
  const f = fixture(kind); const prepared = await f.service.prepareExecution(f.request, user);
  const manifest = await prepared.resolveInTransaction({} as never); assert.equal(manifest.assetBindings[0].template.items[0].standardDays, 3);
  f.change(); const restored = readPersistedExecutionManifest(manifest);
  assert.equal(restored.assetBindings[0].template.items[0].standardDays, 3); assert.equal(restored.assetBindings[0].ruleSet.ruleVersion, 'v1'); assert.equal(f.reads, 2);
  assert.deepEqual(restored.initialInput, { text: 'exact user input' });
});
test('prepare then authoritative template/rule change conflicts and never freezes mixed values', async () => {
  const f = fixture(); const prepared = await f.service.prepareExecution(f.request, user); f.change();
  await assert.rejects(prepared.resolveInTransaction({} as never), (e: any) => e.code === 'EXECUTION_CONTEXT_CHANGED');
});
test('trusted owned sources freeze outside initialInput; manifest reader rejects source mismatches and client materials', async () => {
  const f = fixture(); const source = { id: 'message-a', kind: 'conversation' as const, text: ' exact owned message\nsecond line ', location: 'message:message-a' };
  const material = { ...source, digest: hash(source) };
  const request = { ...f.request, sources: [{ id: source.id, kind: source.kind }] };
  const prepared = await f.service.prepareExecution(request, user, { sourceMaterials: [material] });
  const manifest = await prepared.resolveInTransaction({} as never);
  assert.deepEqual(manifest.sourceMaterials, [material]); assert.deepEqual(manifest.initialInput, request.input);
  const bad = structuredClone(manifest); bad.sourceMaterials![0].id = 'foreign';
  const { digest: oldDigest, ...changedMaterial } = bad.sourceMaterials![0]; bad.sourceMaterials![0].digest = hash(changedMaterial);
  const { manifestHash: _, ...body } = bad; bad.manifestHash = hash(body);
  assert.throws(() => readPersistedExecutionManifest(bad));
  assert.throws(() => validateExecutionRequest({ ...request, sourceMaterials: [material] }));
});
test('new file refs cannot manufacture original text from a legacy client summary', async () => {
  const f = fixture(); const request = { ...f.request, sources: [{ id: 'legacy-file', kind: 'file' }] };
  await assert.rejects(f.service.prepareExecution(request, user, { sourceMaterials: [] }), (e: any) => e.code === 'EXECUTION_SOURCE_UNAVAILABLE');
});

test('runtime fingerprints retain original request input and reconstruct only nonempty asset references', async () => {
  for (const withAssets of [false, true]) {
    const f = fixture(); const { assets, ...legacy } = f.request;
    const request = withAssets ? f.request : legacy;
    const prepared = await f.service.prepareExecution(request, user);
    const manifest = await prepared.resolveInTransaction({} as never);
    const execution = { ...request, sources: [] };
    const run = { workflowId: BUSINESS_SKILLS_WORKFLOW_ID, workflowVersion: BUSINESS_SKILLS_WORKFLOW_VERSION, runKind: 'workbench_chat',
      aiSessionId: 'session-a', ownerUserId: user.id, executionConfig: { content: ' Start ', executionManifest: manifest },
      metadata: { invocationFingerprint: hash({ sessionId: 'session-a', content: 'Start', execution }) } };
    assert.deepEqual(readBusinessSkillsRun(run as never), manifest);
    assert.equal('sourceMaterials' in manifest, false);
  }
});
