import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSkillReleaseService } from './skills.release';
import { skillDefinitionHash } from './skills.hash';
import { SkillError, type SkillDefinition, type SkillRecord } from './skills.types';
import type { AuthUser } from '../../types';
import type { SkillReleaseRepository } from './skills-release.types';
import type { SkillRepository } from './skills.repository';
import type { SkillDependencySnapshot } from './skills-release.types';
import { permittedSkillTools, skillToolContract } from './skills.context';
import { buildKnowledgeQueryTool, buildProjectListTool } from '../../agent/tools/query.tools';

const user: AuthUser = { id: 'release-admin', username: 'admin', role: 'admin', businessRole: 'pre_sales', status: 'active', passwordHash: '', createdAt: '', lastLoginAt: '' };
const definition: SkillDefinition = { name: '发布测试', description: '目录', category: 'test', instructions: 'PRIVATE PROMPT', roles: ['pre_sales'], references: [], inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, model: { scenario: 'assessment', temperature: 0, maxTokens: 8, timeoutMs: 1000 }, tools: [], examples: [{ title: 'sample', input: {}, expected: { ok: true } }] };
function record(): SkillRecord {
  const hash = skillDefinitionHash(definition);
  return { skillId: 's1', revision: 1, enabled: true, archived: false, activeVersionId: null, currentVersionId: 'v1', createdAt: '', updatedAt: '', audit: [], versions: [{ skillVersionId: 'v1', versionCode: 'SK-test-VA.0', majorLetter: 'A', minorNumber: 0, status: 'draft', checkoutStatus: 'checked_in', checkedOutBy: null, definition: structuredClone(definition), lastCheckinDefinition: structuredClone(definition), hash, createdAt: '', updatedAt: '' }] };
}
const snapshot: SkillDependencySnapshot = { schemaVersion: 1, references: [], model: { providerId: 'moonshot', model: 'actual-model', modelSource: 'binding', credentialScope: 'kimi', baseUrlDigest: 'endpoint-digest', params: definition.model, capabilities: ['chat'], supportedParams: ['maxTokens'] }, tools: [], roles: ['ADMIN'] };
function fixture(records = [record()]) {
  let appended: Parameters<SkillReleaseRepository['appendEvaluation']>[3] | null = null;
  let calls = 0;
  const roots: SkillRepository = { get: async () => structuredClone(records[0]), list: async () => structuredClone(records), create: async () => { throw new Error(); }, mutate: async () => { throw new Error('network must not hold a mutation lock'); } };
  const release: SkillReleaseRepository = { evidence: async () => ({ evaluations: [], reviews: [], events: [] }), getPublishedVersion: async () => null,
    appendEvaluation: async (_, revision, __, value) => {
      if (records[0].revision !== revision) throw new SkillError('SKILL_REVISION_CONFLICT', 'changed', 409);
      appended = value; return { record: records[0], evaluation: { ...value, id: 'evaluation', skillId: records[0].skillId, snapshotRevision: revision, actorId: user.id, createdAt: '' } };
    }, review: async () => { throw new Error(); }, publish: async () => { throw new Error(); }, rollback: async () => { throw new Error(); } };
  const service = createSkillReleaseService(roots, release, async () => ({ hash: 'ctx', snapshot, tools: [], complete: async () => { calls++; return { output: { ok: true }, provider: 'kimi', model: 'actual-model', usage: { outputTokens: 2 } }; }, runReadTool: async () => { throw new Error('must not run'); } }), user);
  return { service, calls: () => calls, appended: () => appended };
}
test('simulation uses expected outputs explicitly, persists ineligible result and never calls the model', async () => {
  const f = fixture(); const result = await f.service.trial('s1', 1, 'simulation');
  assert.equal(f.calls(), 0); assert.equal(result.evaluation.result.passed, true);
  assert.equal(result.evaluation.result.releaseEligible, false); assert.equal(result.evaluation.result.modelExecuted, false);
  assert.deepEqual(result.evaluation.result.dependencyContext, snapshot);
  assert.equal(JSON.stringify(result.evaluation.result).includes('https://'), false);
  assert.deepEqual(result.evaluation.result.cases[0].output, definition.examples[0].expected);
});
test('trial owner checked-out is permitted; other lock rejected; model snapshot cannot append after revision changes', async () => {
  const r = record(); r.versions[0].checkoutStatus = 'checked_out'; r.versions[0].checkedOutBy = user.id;
  const f = fixture([r]); await f.service.trial('s1', 1, 'model'); assert.equal(f.calls(), 1);
  r.versions[0].checkedOutBy = 'other';
  await assert.rejects(f.service.trial('s1', 1, 'model'), e => e instanceof SkillError && e.code === 'SKILL_LOCKED');
  r.versions[0].checkedOutBy = user.id;
  const pending = f.service.trial('s1', 1, 'model'); r.revision++;
  await assert.rejects(pending, e => e instanceof SkillError && e.code === 'SKILL_REVISION_CONFLICT');
});
test('catalog uses business role and only enabled active published projection, never prompts or draft content', async () => {
  const active = record(); active.versions[0].status = 'published'; active.activeVersionId = 'v1';
  const disabled = structuredClone(active); disabled.skillId = 'disabled'; disabled.enabled = false;
  const archived = structuredClone(active); archived.skillId = 'archived'; archived.archived = true;
  const wrongRole = structuredClone(active); wrongRole.skillId = 'sales'; wrongRole.versions[0].definition.roles = ['sales'];
  const draft = record(); draft.skillId = 'draft';
  const items = await fixture([active, disabled, archived, wrongRole, draft]).service.catalog();
  assert.equal(items.length, 1); assert.equal(items[0].skillVersionId, 'v1'); assert.equal(JSON.stringify(items).includes('PRIVATE PROMPT'), false);
  assert.equal('versions' in items[0], false); assert.equal('examples' in items[0], false);
});
test('native inventory intersects actual host capability and policy, and external knowledge reads are simulated', () => {
  const local = buildProjectListTool(async () => []); const remote = buildKnowledgeQueryTool(async () => ({}));
  assert.equal(skillToolContract(local).simulationOnly, false); assert.equal(skillToolContract(remote).simulationOnly, true);
  const policy = { schemaVersion: 1, policies: { [local.name]: { enabled: false, visibleRoles: [], approvalStrategy: 'default' as const, injectionMode: 'default' as const } } };
  assert.equal(permittedSkillTools([local, remote], user, policy).some(t => t.name === local.name), false);
  const systemOnly = { ...local, capability: 'system:manage' as const };
  assert.equal(permittedSkillTools([systemOnly], { ...user, role: 'user' }, { schemaVersion: 1, policies: {} }).length, 0);
  assert.equal(skillToolContract({ ...local, source: 'mcp', sandboxReadSafe: true }).simulationOnly, true);
});

test('catalog intersects native tool eligibility once per request; no-tool entries remain discoverable', async () => {
  const records = ['local', 'remote', 'no-tools'].map(id => { const r = record(); r.skillId = id; r.activeVersionId = 'v1'; r.versions[0].status = 'published'; r.versions[0].definition.tools = id === 'no-tools' ? [] : [{ toolName: id, inputMapping: {}, requiresConfirmation: false }]; return r; });
  let inventories = 0;
  const roots = { list: async () => records } as SkillRepository;
  const service = createSkillReleaseService(roots, {} as SkillReleaseRepository, async () => { throw new Error('no model context needed'); }, { ...user, role: 'user' }, async () => { inventories++; return [{ name: 'local', description: '', parameters: {}, mutates: false }]; });
  const items = await service.catalog();
  assert.deepEqual(items.map(i => i.skillId), ['local', 'no-tools']); assert.equal(inventories, 1);
  assert.equal('toolNames' in items[0], false);
});

test('read executor refreshes identity before native execution; disabled or changed-role user cannot read', async () => {
  const { createSkillReadExecutor } = await import('./skills.context');
  const { ToolRegistry } = await import('../../agent/tool-registry');
  let calls = 0; const tool = buildProjectListTool(async () => { calls++; return []; }); const registry = new ToolRegistry(); registry.register(tool);
  const inventory = async () => ({ registry, tools: [tool], policy: { schemaVersion: 1, policies: {} } });
  for (const currentUser of [null, { ...user, status: 'disabled' as const }, { ...user, role: 'user' as const }]) {
    const execute = createSkillReadExecutor(user, [skillToolContract(tool)], inventory, async () => currentUser);
    await assert.rejects(execute(tool.name, {}, new AbortController().signal));
  }
  assert.equal(calls, 0);
  const execute = createSkillReadExecutor(user, [skillToolContract(tool)], inventory, async () => user);
  await execute(tool.name, {}, new AbortController().signal); assert.equal(calls, 1);
  const changed = createSkillReadExecutor(user, [skillToolContract(tool)], async () => ({ ...await inventory(), tools: [{ ...tool, parameters: { type: 'object', required: ['newField'] } }] }), async () => user);
  await assert.rejects(changed(tool.name, {}, new AbortController().signal)); assert.equal(calls, 1);
});
test('readiness cannot reuse a historical same-hash review after undo resets the current version to draft', async () => {
  const r = record(); const version = r.versions[0];
  const evaluation = { id: 'old-evaluation', skillId: r.skillId, versionId: version.skillVersionId, hash: version.hash, contextHash: 'ctx', snapshotRevision: 1, actorId: user.id, createdAt: '', result: { releaseEligible: true, mode: 'model', modelExecuted: true, passed: true } };
  const review = { id: 'old-review', skillId: r.skillId, versionId: version.skillVersionId, evaluationId: evaluation.id, hash: version.hash, contextHash: 'ctx', reason: 'old same-hash review', acknowledgedSimulation: false, actorId: user.id, createdAt: '' };
  const roots = { get: async () => r } as unknown as SkillRepository;
  const release = { evidence: async () => ({ evaluations: [evaluation], reviews: [review], events: [] }) } as unknown as SkillReleaseRepository;
  const service = createSkillReleaseService(roots, release, async () => ({ hash: 'ctx' } as never), user);
  const readiness = await service.readiness(r.skillId); assert.equal(readiness.publishAvailable, false); assert.ok(readiness.blockers.includes('SKILL_REVIEW_REQUIRED')); assert.equal(readiness.review, null);
});
