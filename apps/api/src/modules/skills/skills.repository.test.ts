import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { skillDefinitionHash } from './skills.hash';
import { createSkillUsecase } from './skills.usecase';
import { testDb, testPool } from '../../test-helpers/db';
import { skillRevisions, skillVersions } from '../../db/schema';
import { createSkillsPgRepository } from './skills-pg.repository';
import { SkillError, type SkillDefinition } from './skills.types';

assert.equal(new URL(process.env.TEST_DATABASE_URL!).pathname, '/workload_eval_test');
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
  assert.equal(new URL(process.env.TEST_DATABASE_URL!).pathname, '/workload_eval_test');
  try { await testDb.execute(sql`TRUNCATE TABLE skill_revisions, skill_versions, skill_definitions`); }
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
