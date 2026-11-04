import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { skillDefinitionHash } from './skills.hash';
import { createSkillUsecase } from './skills.usecase';
import { testDb, testPool } from '../../test-helpers/db';
import { skillRevisions, skillVersions, skillReleaseEvents, skillEvaluations, skillReleaseReviews } from '../../db/schema';
import { createSkillsPgRepository } from './skills-pg.repository';
import { SkillError, type SkillDefinition } from './skills.types';

// Match the global test setup guard while allowing isolated *_test databases.
assert.ok(new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith('_test'), 'repository tests require an explicit *_test database');
const repo = createSkillsPgRepository(testDb);
const actor = { id: 'skills-repo-test', username: '仓储测试' };
const definition: SkillDefinition = {
  name: '评估技能', description: '测试', category: 'assessment', instructions: '执行评估', roles: ['pre_sales'],
  references: [], inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
  model: { scenario: 'assessment', temperature: 0.2, maxTokens: 1024, timeoutMs: 3000 }, tools: [], examples: [],
};
async function create() {
  const result = await repo.create(structuredClone(definition), actor);
  return result;
}
function code(expected: string) {
  return (error: unknown) => error instanceof SkillError && error.code === expected;
}
after(async () => {
  assert.ok(new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith('_test'), 'repository cleanup requires an explicit *_test database');
  try { await testDb.execute(sql`TRUNCATE TABLE execution_emergency_audits, workflow_skill_dependencies, workflow_revisions, workflow_versions, workflow_definitions, skill_release_events, skill_release_reviews, skill_evaluations, skill_revisions, skill_versions, skill_definitions`); }
  finally { await testPool.end(); }
});

test('create persists A.0, detached JSON, DB timestamps and revision snapshot', async () => {
  const input = structuredClone(definition);
  const record = await repo.create(input, actor);
  assert.equal(record.revision, 1);
  assert.equal(record.activeVersionId, null);
  const version = record.versions[0];
  assert.equal(version.versionCode, `SK-${record.skillId.slice(0, 8)}-VA.0`);
  assert.equal(version.status, 'draft'); assert.equal(version.checkoutStatus, 'checked_in');
  assert.equal(version.hash, skillDefinitionHash(definition));
  assert.equal(record.createdAt, version.createdAt);
  input.name = 'caller changed'; record.versions[0].definition.name = 'return changed';
  const read = await createSkillsPgRepository(testDb).get(record.skillId);
  assert.equal(read!.versions[0].definition.name, definition.name);
  assert.deepEqual(read!.versions[0].lastCheckinDefinition, definition);
  assert.ok((await repo.list()).some(item => item.skillId === record.skillId));
  const snapshots = await testDb.select().from(skillRevisions).where(eq(skillRevisions.skillId, record.skillId));
  assert.equal(snapshots.length, 1); assert.equal(snapshots[0].snapshot.revision, 1);
});

test('two checked-out writers using one revision have exactly one winner and persistent audit', async () => {
  const record = await create();
  const service = createSkillUsecase(repo, async () => []);
  const checkedOut = await service.action(record.skillId, record.revision, actor, 'checkout');
  const results = await Promise.allSettled(['first', 'second'].map(name => service.save(record.skillId,
    checkedOut.revision, actor, { ...definition, name })));
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  const rejected = results.find(item => item.status === 'rejected') as PromiseRejectedResult;
  assert.ok(code('SKILL_REVISION_CONFLICT')(rejected.reason));
  const read = (await repo.get(record.skillId))!;
  assert.equal(read.revision, 3); assert.equal(read.audit.at(-1)!.action, 'save-draft');
  const snapshots = await testDb.select().from(skillRevisions).where(eq(skillRevisions.skillId, record.skillId));
  assert.equal(snapshots.length, 3);
  assert.deepEqual(snapshots.find(row => row.revision === 3)!.snapshot, read);
});

test('failed callback leaves original aggregate and history unchanged and hides raw errors', async () => {
  const record = await create();
  await assert.rejects(repo.mutate(record.skillId, 1, actor, 'fail', next => {
    next.enabled = false; next.versions[0].definition.name = 'partially changed';
    throw new Error('postgres://secret@localhost private SQL');
  }), error => code('SKILL_STORE_INTERNAL')(error) && !(error as Error).message.includes('secret'));
  assert.deepEqual(await repo.get(record.skillId), record);
  const snapshots = await testDb.select().from(skillRevisions).where(eq(skillRevisions.skillId, record.skillId));
  assert.equal(snapshots.length, 1);
});

test('published versions are immutable and cannot be removed, including attempts to change state', async () => {
  const record = await create();
  const published = await repo.mutate(record.skillId, 1, actor, 'publish', next => {
    next.versions[0].status = 'published'; next.activeVersionId = next.currentVersionId;
  });
  for (const change of [
    (next: typeof record) => { next.versions[0].definition.instructions = 'tampered'; },
    (next: typeof record) => { next.versions[0].status = 'draft'; },
    (next: typeof record) => { next.versions = []; },
  ]) {
    await assert.rejects(repo.mutate(record.skillId, 2, actor, 'tamper', change), code('SKILL_HISTORY_IMMUTABLE'));
    assert.deepEqual(await repo.get(record.skillId), published);
  }
  const disabled = await repo.mutate(record.skillId, 2, actor, 'disable', next => { next.enabled = false; });
  assert.deepEqual(disabled.versions, published.versions);
});

test('identity/history tampering fails closed; new version and current pointer may be added', async () => {
  const record = await create();
  for (const change of [
    (next: typeof record) => { next.skillId = 'other'; },
    (next: typeof record) => { next.audit = []; },
    (next: typeof record) => { next.versions[0].versionCode = 'SK-other'; },
    (next: typeof record) => { next.currentVersionId = 'missing'; },
  ]) {
    await assert.rejects(repo.mutate(record.skillId, 1, actor, 'tamper', change), code('SKILL_HISTORY_IMMUTABLE'));
    assert.deepEqual(await repo.get(record.skillId), record);
  }
  const next = await repo.mutate(record.skillId, 1, actor, 'upgrade', (draft, now) => {
    const version = structuredClone(draft.versions[0]);
    version.skillVersionId = crypto.randomUUID(); version.versionCode += '.1'; version.minorNumber = 1;
    version.createdAt = now; version.updatedAt = now;
    draft.versions.push(version); draft.currentVersionId = version.skillVersionId;
  });
  assert.equal(next.versions.length, 2); assert.equal(next.currentVersionId, next.versions[1].skillVersionId);
});

test('missing reads return null, mutations return typed 404, DB errors never leak', async () => {
  assert.equal(await repo.get('missing-skills-test'), null);
  await assert.rejects(repo.mutate('missing-skills-test', 1, actor, 'update', () => {}), code('SKILL_NOT_FOUND'));
  const broken = createSkillsPgRepository({ transaction: () => { throw new Error('private db sql'); } } as never);
  await assert.rejects(broken.create(definition, actor), code('SKILL_STORE_INTERNAL'));
});


test('database rejects updates/deletes of published rows even outside the repository', async () => {
  const record = await create();
  const published = await repo.mutate(record.skillId, 1, actor, 'publish', next => { next.versions[0].status = 'published'; });
  await assert.rejects(testDb.update(skillVersions).set({ status: 'draft' })
    .where(eq(skillVersions.skillVersionId, published.currentVersionId)));
  await assert.rejects(testDb.delete(skillVersions).where(eq(skillVersions.skillVersionId, published.currentVersionId)));
  assert.deepEqual(await repo.get(record.skillId), published);
});

test('database rejects rewriting or deleting persisted revision snapshots', async () => {
  const record = await create();
  await assert.rejects(testDb.update(skillRevisions).set({ action: 'tampered' })
    .where(eq(skillRevisions.skillId, record.skillId)));
  await assert.rejects(testDb.delete(skillRevisions).where(eq(skillRevisions.skillId, record.skillId)));
  assert.deepEqual(await repo.get(record.skillId), record);
});

test('database failure after root update rolls back root, versions and audit together', async () => {
  const record = await create();
  await assert.rejects(repo.mutate(record.skillId, 1, actor, 'upgrade', (next, now) => {
    next.enabled = false;
    const version = structuredClone(next.versions[0]);
    version.skillVersionId = crypto.randomUUID(); version.minorNumber = 1;
    version.createdAt = now; version.updatedAt = now;
    // Same code violates the unique constraint only after the root UPDATE has executed.
    next.versions.push(version); next.currentVersionId = version.skillVersionId;
  }), code('SKILL_STORE_INTERNAL'));
  assert.deepEqual(await repo.get(record.skillId), record);
  const snapshots = await testDb.select().from(skillRevisions).where(eq(skillRevisions.skillId, record.skillId));
  assert.equal(snapshots.length, 1);
});


test('repository refuses checked-in edits, other-owner edits and unexplained content changes', async () => {
  const original = await create();
  const change = (next: typeof original) => {
    next.versions[0].definition.name = 'changed';
    next.versions[0].hash = skillDefinitionHash(next.versions[0].definition);
  };
  await assert.rejects(repo.mutate(original.skillId, 1, actor, 'save-draft', change), code('SKILL_CHECKOUT_REQUIRED'));
  const service = createSkillUsecase(repo, async () => []);
  const locked = await service.action(original.skillId, 1, actor, 'checkout');
  for (const action of ['save-draft', 'undo-checkout', 'checkin']) {
    await assert.rejects(repo.mutate(original.skillId, locked.revision, { id: 'other', username: '他人' }, action, change), code('SKILL_LOCKED'));
  }
  await assert.rejects(repo.mutate(original.skillId, locked.revision, actor, 'invented-edit', change), code('SKILL_HISTORY_IMMUTABLE'));
  assert.deepEqual(await repo.get(original.skillId), locked);
});

test('repository allows owner undo/admin force-unlock only to saved checkin snapshot', async () => {
  const service = createSkillUsecase(repo, async () => []);
  let record = await create();
  record = await service.action(record.skillId, record.revision, actor, 'checkout');
  record = await service.save(record.skillId, record.revision, actor, { ...definition, name: 'draft change' });
  await assert.rejects(repo.mutate(record.skillId, record.revision, actor, 'undo-checkout', next => {
    next.versions[0].definition.name = 'invented restore'; next.versions[0].hash = skillDefinitionHash(next.versions[0].definition);
  }), code('SKILL_HISTORY_IMMUTABLE'));
  const admin = { id: 'other-admin', username: '另一管理员' };
  record = await service.action(record.skillId, record.revision, admin, 'force-unlock');
  assert.deepEqual(record.versions[0].definition, definition);
  assert.equal(record.versions[0].checkedOutBy, null);
});

test('PG roundtrip no-op checkout and undo preserve canonical content hash', async () => {
  const service = createSkillUsecase(repo, async () => []);
  let record = await service.create(definition, actor);
  const originalHash = record.versions[0].hash;
  const persisted = (await repo.get(record.skillId))!;
  assert.equal(originalHash, skillDefinitionHash(persisted.versions[0].definition));
  record = await service.action(record.skillId, record.revision, actor, 'checkout');
  record = await service.action(record.skillId, record.revision, actor, 'undo-checkout');
  assert.equal(record.versions[0].hash, originalHash);
});

test('real PG usecase checkout-save-checkin-promote-edit keeps published historical hash and content', async () => {
  const service = createSkillUsecase(repo, async () => []);
  let record = await service.create(definition, actor);
  record = await service.action(record.skillId, record.revision, actor, 'checkout');
  record = await service.save(record.skillId, record.revision, actor, { ...definition, name: 'A checked in' });
  record = await service.action(record.skillId, record.revision, actor, 'checkin');
  assert.equal(record.versions[0].minorNumber, 1);
  assert.equal(record.versions[0].versionCode, `SK-${record.skillId.slice(0, 8)}-VA.1`);
  record = await repo.mutate(record.skillId, record.revision, actor, 'publish', next => {
    next.versions[0].status = 'published'; next.activeVersionId = next.currentVersionId;
  });
  const published = structuredClone(record.versions[0]);
  record = await service.action(record.skillId, record.revision, actor, 'promote');
  assert.equal(record.versions[1].majorLetter, 'B');
  record = await service.action(record.skillId, record.revision, actor, 'checkout');
  record = await service.save(record.skillId, record.revision, actor, { ...definition, name: 'B draft edited' });
  const persisted = (await repo.get(record.skillId))!;
  assert.deepEqual(persisted.versions[0], published);
  assert.notEqual(persisted.versions[1].hash, published.hash);
  await assert.rejects(repo.mutate(record.skillId, record.revision, actor, 'save-draft', next => {
    next.versions[0].definition.name = 'tamper old'; next.versions[0].hash = skillDefinitionHash(next.versions[0].definition);
  }), code('SKILL_HISTORY_IMMUTABLE'));
});


test('hash tampering and skipped minor revisions fail closed without changing stored content', async () => {
  const service = createSkillUsecase(repo, async () => []);
  let record = await create();
  record = await service.action(record.skillId, record.revision, actor, 'checkout');
  await assert.rejects(repo.mutate(record.skillId, record.revision, actor, 'save-draft', next => {
    next.versions[0].definition.name = 'hash mismatch';
  }), code('SKILL_HISTORY_IMMUTABLE'));
  await assert.rejects(repo.mutate(record.skillId, record.revision, actor, 'checkin', next => {
    next.versions[0].minorNumber += 2;
    next.versions[0].versionCode = `SK-${next.skillId.slice(0, 8)}-VA.2`;
    next.versions[0].checkoutStatus = 'checked_in'; next.versions[0].checkedOutBy = null;
  }), code('SKILL_HISTORY_IMMUTABLE'));
  await assert.rejects(repo.mutate(record.skillId, record.revision, actor, 'promote', (next, now) => {
    const version = structuredClone(next.versions[0]);
    version.skillVersionId = crypto.randomUUID(); version.versionCode += 'new'; version.hash = 'wrong';
    version.createdAt = now; version.updatedAt = now; next.versions.push(version); next.currentVersionId = version.skillVersionId;
  }), code('SKILL_HISTORY_IMMUTABLE'));
  assert.deepEqual(await repo.get(record.skillId), record);
});


test('release repository persists proof separately, atomically reviews/publishes and CAS admits one winner', async () => {
  const { createSkillReleaseRepository } = await import('./skills-release.repository');
  const release = createSkillReleaseRepository(testDb);
  const { evaluateSkill } = await import('./skills.evaluation');
  const value = { ...definition, examples: [{ title: 'sample', input: {}, expected: {} }] };
  const record = await repo.create(value, actor);
  const result = await evaluateSkill(value, { mode: 'model', allowedTools: [], complete: async () => ({ output: {}, provider: 'kimi', model: 'kimi-test', usage: { outputTokens: 2 } }) });
  const dependencyContext = { schemaVersion: 1 as const, references: [{ uri: 'wes://knowledge/test-ref', version: '2026-11-02T00:00:00.000Z', digest: 'reference-digest' }], model: { providerId: 'moonshot', model: 'kimi-test', modelSource: 'binding', credentialScope: 'kimi', baseUrlDigest: 'endpoint-digest', params: value.model, capabilities: ['chat'], supportedParams: [] }, tools: [], roles: ['ADMIN' as const] };
  const trial = await release.appendEvaluation(record.skillId, 1, actor, { versionId: record.currentVersionId, hash: record.versions[0].hash, contextHash: 'context-a', result: { ...result, dependencyContext } });
  assert.equal(trial.record.revision, 2);
  assert.equal((await release.evidence(record.skillId)).evaluations.length, 1);
  assert.deepEqual((await release.evidence(record.skillId)).evaluations[0].result.dependencyContext, dependencyContext);
  const reviewed = await release.review(record.skillId, 2, actor, { evaluationId: trial.evaluation.id, reason: '样例和边界已核对', contextHash: 'context-a' });
  assert.equal(reviewed.versions[0].status, 'reviewed');
  const outcomes = await Promise.allSettled([release.publish(record.skillId, 3, actor, 'context-a'), release.publish(record.skillId, 3, actor, 'context-a')]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.ok(code('SKILL_REVISION_CONFLICT')((outcomes.find(item => item.status === 'rejected') as PromiseRejectedResult).reason));
  const published = (await repo.get(record.skillId))!;
  assert.equal(published.activeVersionId, record.currentVersionId);
  assert.equal((await release.evidence(record.skillId)).events.length, 1);
  assert.equal((await release.getPublishedVersion(record.skillId, record.currentVersionId, record.versions[0].hash))!.version.hash, record.versions[0].hash);
  const snapshots = await testDb.select().from(skillRevisions).where(eq(skillRevisions.skillId, record.skillId));
  assert.equal(JSON.stringify(snapshots).includes('context-a'), false);
  for (const table of [skillEvaluations, skillReleaseReviews, skillReleaseEvents]) {
    await assert.rejects(testDb.delete(table));
  }
});

test('release gate rejects simulation, no proof, stale context, checked-out review and post-network edits', async () => {
  const { createSkillReleaseRepository } = await import('./skills-release.repository');
  const { evaluateSkill } = await import('./skills.evaluation');
  const release = createSkillReleaseRepository(testDb);
  const value = { ...definition, examples: [{ title: 'sample', input: {}, expected: {} }] };
  let record = await repo.create(value, actor);
  await assert.rejects(release.publish(record.skillId, 1, actor, 'ctx'), code('SKILL_RELEASE_GATE_PENDING'));
  const result = await evaluateSkill(value, { mode: 'simulation', allowedTools: [], complete: async () => ({ output: {}, provider: 'simulation', model: 'expected', usage: { outputTokens: 1 } }) });
  const trial = await release.appendEvaluation(record.skillId, 1, actor, { versionId: record.currentVersionId, hash: record.versions[0].hash, contextHash: 'ctx', result });
  record = trial.record;
  await assert.rejects(release.review(record.skillId, record.revision, actor, { evaluationId: trial.evaluation.id, reason: '核对', contextHash: 'ctx' }), code('SKILL_RELEASE_GATE_PENDING'));
  const service = createSkillUsecase(repo, async () => []);
  const locked = await service.action(record.skillId, record.revision, actor, 'checkout');
  await assert.rejects(release.appendEvaluation(record.skillId, record.revision, actor, { versionId: record.currentVersionId, hash: record.versions[0].hash, contextHash: 'ctx', result }), code('SKILL_REVISION_CONFLICT'));
  await assert.rejects(release.review(record.skillId, locked.revision, actor, { evaluationId: trial.evaluation.id, reason: '核对', contextHash: 'ctx' }), code('SKILL_CHECKIN_REQUIRED'));
  assert.equal((await repo.get(record.skillId))!.activeVersionId, null);
});

async function releaseFixture(value: SkillDefinition = { ...definition, examples: [{ title: 'sample', input: {}, expected: {} }] }) {
  const { createSkillReleaseRepository } = await import('./skills-release.repository');
  const { evaluateSkill } = await import('./skills.evaluation');
  const release = createSkillReleaseRepository(testDb);
  const service = createSkillUsecase(repo, async () => []);
  const prove = async (record: Awaited<ReturnType<typeof create>>, contextHash = 'current-context') => {
    const version = record.versions.find(v => v.skillVersionId === record.currentVersionId)!;
    const result = await evaluateSkill(version.definition, { mode: 'model', allowedTools: [], complete: async () => ({ output: {}, provider: 'kimi', model: 'test-model', usage: { outputTokens: 1 } }) });
    const trial = await release.appendEvaluation(record.skillId, record.revision, actor, { versionId: version.skillVersionId, hash: version.hash, contextHash, result });
    const reviewed = await release.review(record.skillId, trial.record.revision, actor, { evaluationId: trial.evaluation.id, reason: '核对完成', contextHash });
    return { trial, reviewed };
  };
  return { record: await repo.create(value, actor), release, service, prove };
}

test('stale native/model/reference context, edited candidate and failed/no-sample results cannot release', async () => {
  const f = await releaseFixture();
  const { trial, reviewed } = await f.prove(f.record);
  await assert.rejects(f.release.publish(reviewed.skillId, reviewed.revision, actor, 'changed-native-context'), code('SKILL_RELEASE_GATE_PENDING'));
  const evidence = await f.release.evidence(reviewed.skillId); assert.equal(evidence.events.length, 0);
  let edited = await f.service.action(reviewed.skillId, reviewed.revision, actor, 'checkout');
  edited = await f.service.save(edited.skillId, edited.revision, actor, { ...definition, name: 'changed', examples: [{ title: 'sample', input: {}, expected: {} }] });
  edited = await f.service.action(edited.skillId, edited.revision, actor, 'checkin');
  await assert.rejects(f.release.review(edited.skillId, edited.revision, actor, { evaluationId: trial.evaluation.id, reason: '检查', contextHash: 'current-context' }), code('SKILL_RELEASE_GATE_PENDING'));
  assert.equal((await repo.get(edited.skillId))!.activeVersionId, null);
  for (const value of [{ ...definition, examples: [] }, { ...definition, examples: [{ title: 'fail', input: {}, expected: { expected: true } }] }]) {
    const { evaluateSkill } = await import('./skills.evaluation');
    const candidate = await repo.create(value, actor);
    const result = await evaluateSkill(value, { mode: 'model', allowedTools: [], complete: async () => ({ output: {}, provider: 'kimi', model: 'test', usage: { outputTokens: 1 } }) });
    assert.equal(result.releaseEligible, false);
    const saved = await f.release.appendEvaluation(candidate.skillId, candidate.revision, actor, { versionId: candidate.currentVersionId, hash: candidate.versions[0].hash, contextHash: 'current-context', result });
    await assert.rejects(f.release.review(candidate.skillId, saved.record.revision, actor, { evaluationId: saved.evaluation.id, reason: '检查', contextHash: 'current-context' }), code('SKILL_RELEASE_GATE_PENDING'));
    assert.equal((await repo.get(candidate.skillId))!.activeVersionId, null);
  }
});

test('model dry-run steps require explicit review acknowledgement that persists with the boundary', async () => {
  const { createSkillReleaseRepository } = await import('./skills-release.repository');
  const { evaluateSkill } = await import('./skills.evaluation');
  const release = createSkillReleaseRepository(testDb);
  const value = { ...definition, tools: [{ toolName: 'isolated_write', inputMapping: {}, requiresConfirmation: true }], examples: [{ title: 'sample', input: {}, expected: {} }] };
  const record = await repo.create(value, actor); let attempt = 0;
  const result = await evaluateSkill(value, { mode: 'model', allowedTools: [{ name: 'isolated_write', description: '', parameters: { type: 'object' }, mutates: true }], complete: async () => (++attempt === 1
    ? { toolCalls: [{ id: 'call-1', name: 'isolated_write', arguments: {} }], provider: 'kimi', model: 'test', usage: { outputTokens: 1 } }
    : { output: {}, provider: 'kimi', model: 'test', usage: { outputTokens: 1 } }) });
  assert.equal(result.releaseEligible, true); assert.equal(result.simulatedSteps.length, 1);
  const trial = await release.appendEvaluation(record.skillId, 1, actor, { versionId: record.currentVersionId, hash: record.versions[0].hash, contextHash: 'ctx', result });
  await assert.rejects(release.review(record.skillId, trial.record.revision, actor, { evaluationId: trial.evaluation.id, reason: '检查', contextHash: 'ctx' }), code('SKILL_SIMULATION_ACK_REQUIRED'));
  const reviewed = await release.review(record.skillId, trial.record.revision, actor, { evaluationId: trial.evaluation.id, reason: '确认写入仅为模拟', acknowledgeSimulation: true, contextHash: 'ctx' });
  const published = await release.publish(record.skillId, reviewed.revision, actor, 'ctx');
  assert.equal(published.activeVersionId, record.currentVersionId);
  assert.equal((await release.evidence(record.skillId)).reviews[0].acknowledgedSimulation, true);
});

test('event/active-pointer persistence failure rolls back root and release records with original pointer intact', async () => {
  const f = await releaseFixture(); const { reviewed } = await f.prove(f.record);
  // Constraint targets only this UUID; other test files cannot trigger it.
  await testDb.execute(sql.raw(`ALTER TABLE skill_definitions ADD CONSTRAINT skill_test_release_root_failure CHECK (active_version_id IS DISTINCT FROM '${reviewed.currentVersionId}') NOT VALID`));
  try {
    await assert.rejects(f.release.publish(reviewed.skillId, reviewed.revision, actor, 'current-context'), code('SKILL_STORE_INTERNAL'));
    assert.deepEqual(await repo.get(reviewed.skillId), reviewed);
    assert.equal((await f.release.evidence(reviewed.skillId)).events.length, 0);
  } finally { await testDb.execute(sql`ALTER TABLE skill_definitions DROP CONSTRAINT skill_test_release_root_failure`); }
  const published = await f.release.publish(reviewed.skillId, reviewed.revision, actor, 'current-context');
  const before = structuredClone(published);
  await testDb.execute(sql`ALTER TABLE skill_release_events ADD CONSTRAINT skill_test_release_event_failure CHECK (reason <> 'reject-event-fixture') NOT VALID`);
  try {
    let promoted = await f.service.action(published.skillId, published.revision, actor, 'promote');
    const proof = await f.prove(promoted);
    // A new immutable review for the same proof supplies a sentinel rejected only by the event constraint.
    promoted = await f.release.review(promoted.skillId, proof.reviewed.revision, actor, { evaluationId: proof.trial.evaluation.id, reason: 'reject-event-fixture', contextHash: 'current-context' });
    await assert.rejects(f.release.publish(promoted.skillId, promoted.revision, actor, 'current-context'), code('SKILL_STORE_INTERNAL'));
    const after = (await repo.get(promoted.skillId))!;
    assert.equal(after.activeVersionId, before.activeVersionId); assert.equal(after.revision, promoted.revision);
    assert.equal(after.versions[1].status, 'reviewed'); assert.equal((await f.release.evidence(promoted.skillId)).events.length, 1);
  } finally { await testDb.execute(sql`ALTER TABLE skill_release_events DROP CONSTRAINT skill_test_release_event_failure`); }
});

test('rollback only switches pointer to this Skill published compatible history; published content stays immutable', async () => {
  const f = await releaseFixture(); let { reviewed } = await f.prove(f.record);
  const a = await f.release.publish(reviewed.skillId, reviewed.revision, actor, 'current-context');
  let b = await f.service.action(a.skillId, a.revision, actor, 'promote');
  ({ reviewed } = await f.prove(b)); b = await f.release.publish(reviewed.skillId, reviewed.revision, actor, 'current-context');
  const other = await releaseFixture(); const otherProof = await other.prove(other.record);
  const otherPublished = await other.release.publish(other.record.skillId, otherProof.reviewed.revision, actor, 'current-context');
  for (const target of ['missing-version', otherPublished.currentVersionId]) {
    await assert.rejects(f.release.rollback(b.skillId, b.revision, actor, target, '业务回退'), code('SKILL_ROLLBACK_TARGET_INVALID'));
    assert.deepEqual(await repo.get(b.skillId), b);
  }
  await assert.rejects(f.release.rollback(b.skillId, b.revision, actor, a.currentVersionId, '  '), code('SKILL_REASON_REQUIRED'));
  const rolled = await f.release.rollback(b.skillId, b.revision, actor, a.currentVersionId, '业务回退');
  assert.equal(rolled.activeVersionId, a.currentVersionId); assert.equal(rolled.currentVersionId, b.currentVersionId);
  assert.deepEqual(rolled.versions, b.versions);
  assert.equal((await f.release.evidence(b.skillId)).events.at(-1)!.kind, 'rollback');
  assert.equal((await f.release.getPublishedVersion(b.skillId, b.currentVersionId, b.versions[1].hash))!.version.skillVersionId, b.currentVersionId);
  const disabled = await f.service.setStatus(rolled.skillId, rolled.revision, actor, { enabled: false });
  await assert.rejects(f.release.rollback(disabled.skillId, disabled.revision, actor, b.currentVersionId, '回退'), code('SKILL_DISABLED'));
});

test('rollback refuses incompatible input contract and nonpublished draft without changing active pointer', async () => {
  const strict: SkillDefinition = { ...definition, inputSchema: { type: 'object', properties: { must: { type: 'string' } }, required: ['must'] }, examples: [{ title: 'sample', input: { must: 'yes' }, expected: {} }] };
  const f = await releaseFixture(strict); let { reviewed } = await f.prove(f.record);
  const a = await f.release.publish(reviewed.skillId, reviewed.revision, actor, 'current-context');
  let b = await f.service.action(a.skillId, a.revision, actor, 'promote');
  await assert.rejects(f.release.rollback(b.skillId, b.revision, actor, b.currentVersionId, '回退草稿'), code('SKILL_ROLLBACK_TARGET_INVALID'));
  b = await f.service.action(b.skillId, b.revision, actor, 'checkout');
  b = await f.service.save(b.skillId, b.revision, actor, { ...definition, examples: [{ title: 'sample', input: {}, expected: {} }] });
  b = await f.service.action(b.skillId, b.revision, actor, 'checkin');
  ({ reviewed } = await f.prove(b)); b = await f.release.publish(b.skillId, reviewed.revision, actor, 'current-context');
  await assert.rejects(f.release.rollback(b.skillId, b.revision, actor, a.currentVersionId, '不兼容回退'), code('SKILL_ROLLBACK_INCOMPATIBLE'));
  assert.deepEqual(await repo.get(b.skillId), b);
});
