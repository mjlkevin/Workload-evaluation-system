import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { testDb, testPool } from '../../test-helpers/db';
import { workflowVersions, workflowRevisions, workflowSkillDependencies } from '../../db/schema';
import { createWorkflowsPgRepository } from './workflows-pg.repository';
import { createWorkflowService } from './workflows.usecase';
import { WorkflowError, type WorkflowDefinition } from './workflows.types';
import type { AuthUser } from '../../types';
assert.equal(new URL(process.env.TEST_DATABASE_URL!).pathname, '/workload_eval_test');
const repo = createWorkflowsPgRepository(testDb);
const user = { id: 'workflow-test-owner', username: 'Workflow tests', role: 'admin', status: 'active' } as AuthUser;
const value: WorkflowDefinition = { name: '输入确认', description: '', category: 'delivery', roles: ['delivery'], inputSchema: { type: 'object', additionalProperties: false }, outputSchema: { type: 'object', additionalProperties: false },
    steps: [{ id: 'confirm', type: 'confirmation', name: '确认', prompt: '?', inputSchema: { type: 'object', additionalProperties: false }, inputMapping: [], onFailure: 'wait' }], outputMapping: [] };
const resolve = async () => ({ context: { skills: [], tools: [] }, snapshot: { schemaVersion: 1 as const, skills: [], tools: [] }, hash: 'empty-context' });
const service = createWorkflowService(repo, resolve, user);
const code = (expected: string) => (e: unknown) => e instanceof WorkflowError && e.code === expected;
after(async () => testPool.end());
async function publish(record: Awaited<ReturnType<typeof repo.create>>) {
    record = await service.validate(record.workflowId, record.revision);
    record = await service.review(record.workflowId, record.revision, '静态定义审核，不代表执行通过');
    return service.publish(record.workflowId, record.revision);
}
test('PG A.0 checkout/save/checkin/promote, owner lock, CAS and admin restore', async () => {
    let r = await service.create(value);
    const id = r.workflowId;
    assert.equal(r.versions[0].versionCode, `WF-${id.slice(0, 8)}-VA.0`);
    await assert.rejects(service.save(id, r.revision, { ...value, name: 'no checkout' }), code('WORKFLOW_CHECKOUT_REQUIRED'));
    r = await service.action(id, r.revision, 'checkout');
    const other = createWorkflowService(repo, resolve, { ...user, id: 'other' });
    await assert.rejects(other.save(id, r.revision, value), code('WORKFLOW_LOCKED'));
    await assert.rejects(other.action(id, r.revision, 'checkin'), code('WORKFLOW_LOCKED'));
    const races = await Promise.allSettled(['a', 'b'].map(name => service.save(id, r.revision, { ...value, name })));
    assert.equal(races.filter(x => x.status === 'fulfilled').length, 1);
    r = (await repo.get(id))!;
    assert.equal((races.find(x => x.status === 'rejected') as PromiseRejectedResult).reason.code, 'WORKFLOW_REVISION_CONFLICT');
    r = await other.action(id, r.revision, 'force-unlock');
    assert.deepEqual(r.versions[0].definition, value);
    r = await service.action(id, r.revision, 'checkout');
    r = await service.action(id, r.revision, 'checkin');
    assert.equal(r.versions[0].minorNumber, 1);
    r = await publish(r);
    const a = structuredClone(r.versions[0]);
    r = await service.action(id, r.revision, 'promote');
    assert.equal(r.versions[1].versionCode, `WF-${id.slice(0, 8)}-VB.0`);
    r = await service.action(id, r.revision, 'checkout');
    r = await service.save(id, r.revision, { ...value, name: 'B edit' });
    assert.deepEqual(r.versions[0], a);
});
test('server static proofs reject stale context/review and cannot publish checked-out candidates', async () => {
    let r = await service.create(value);
    const id = r.workflowId;
    await assert.rejects(service.publish(id, r.revision), code('WORKFLOW_RELEASE_GATE_PENDING'));
    r = await service.validate(id, r.revision);
    assert.equal(r.versions[0].validation!.executionPerformed, false);
    assert.equal(r.versions[0].validation!.mode, 'static');
    await assert.rejects(service.review(id, r.revision, ''), code('WORKFLOW_REASON_REQUIRED'));
    const changed = createWorkflowService(repo, async () => ({ ...await resolve(), hash: 'new-contract' }), user);
    await assert.rejects(changed.review(id, r.revision, 'reason'), code('WORKFLOW_RELEASE_GATE_PENDING'));
    r = await service.review(id, r.revision, '静态审查');
    await assert.rejects(changed.publish(id, r.revision), code('WORKFLOW_RELEASE_GATE_PENDING'));
    r = await service.action(id, r.revision, 'checkout');
    await assert.rejects(service.publish(id, r.revision), code('WORKFLOW_CHECKIN_REQUIRED'));
    r = await service.save(id, r.revision, { ...value, name: 'changed' });
    r = await service.action(id, r.revision, 'checkin');
    await assert.rejects(service.review(id, r.revision, 'old proof'), code('WORKFLOW_RELEASE_GATE_PENDING'));
});
test('publish is atomic through revision insertion and published/history rows and audit reject direct SQL writes', async () => {
    let r = await service.create(value);
    r = await service.validate(r.workflowId, r.revision);
    r = await service.review(r.workflowId, r.revision, 'failure-fixture');
    await testDb.execute(sql.raw(`ALTER TABLE workflow_revisions ADD CONSTRAINT workflow_test_atomic_failure CHECK (NOT (workflow_id = '${r.workflowId}' AND action = 'publish')) NOT VALID`));
    try {
        await assert.rejects(service.publish(r.workflowId, r.revision), code('WORKFLOW_STORE_INTERNAL'));
        assert.deepEqual(await repo.get(r.workflowId), r);
    }
    finally {
        await testDb.execute(sql `ALTER TABLE workflow_revisions DROP CONSTRAINT workflow_test_atomic_failure`);
    }
    r = await service.publish(r.workflowId, r.revision);
    await assert.rejects(testDb.update(workflowVersions).set({ status: 'draft' }).where(eq(workflowVersions.workflowVersionId, r.currentVersionId)));
    await assert.rejects(testDb.delete(workflowVersions).where(eq(workflowVersions.workflowVersionId, r.currentVersionId)));
    await assert.rejects(testDb.delete(workflowRevisions).where(eq(workflowRevisions.workflowId, r.workflowId)));
    r = await service.action(r.workflowId, r.revision, 'promote');
    const old = r.versions[0];
    await assert.rejects(testDb.update(workflowVersions).set({ minorNumber: 99 }).where(eq(workflowVersions.workflowVersionId, old.workflowVersionId)));
    await assert.rejects(testDb.update(workflowRevisions).set({ reason: 'rewrite' }).where(eq(workflowRevisions.workflowId, r.workflowId)));
});
test('rollback switches only active pointer, rejects foreign/draft/incompatible targets and requires reason', async () => {
    let r = await publish(await service.create(value));
    const a = r.currentVersionId;
    r = await service.action(r.workflowId, r.revision, 'promote');
    await assert.rejects(service.rollback(r.workflowId, r.revision, r.currentVersionId, 'draft'), code('WORKFLOW_ROLLBACK_TARGET_INVALID'));
    r = await publish(r);
    const before = structuredClone(r);
    for (const target of ['missing', (await publish(await service.create(value))).currentVersionId])
        await assert.rejects(service.rollback(r.workflowId, r.revision, target, 'reason'), code('WORKFLOW_ROLLBACK_TARGET_INVALID'));
    await assert.rejects(service.rollback(r.workflowId, r.revision, a, ' '), code('WORKFLOW_REASON_REQUIRED'));
    r = await service.rollback(r.workflowId, r.revision, a, '业务回退');
    assert.equal(r.activeVersionId, a);
    assert.equal(r.currentVersionId, before.currentVersionId);
    assert.deepEqual(r.versions, before.versions);
    r = await service.action(r.workflowId, r.revision, 'promote');
    r = await service.action(r.workflowId, r.revision, 'checkout');
    r = await service.save(r.workflowId, r.revision, { ...value, inputSchema: { type: 'object', additionalProperties: true } });
    r = await service.action(r.workflowId, r.revision, 'checkin');
    r = await publish(r);
    await assert.rejects(service.rollback(r.workflowId, r.revision, a, 'incompatible'), code('WORKFLOW_ROLLBACK_INCOMPATIBLE'));
    assert.equal((await testDb.select().from(workflowSkillDependencies).where(eq(workflowSkillDependencies.versionId, a))).length, 0);
});
test('revision evidence contains only root metadata/current version/current event and preserves checked-in draft content', async () => {
    let r = await service.create(value);
    r = await service.action(r.workflowId, r.revision, 'checkout');
    r = await service.save(r.workflowId, r.revision, { ...value, name: 'original checkin' });
    r = await service.action(r.workflowId, r.revision, 'checkin');
    const checkinRevision = r.revision;
    r = await service.action(r.workflowId, r.revision, 'promote');
    r = await service.action(r.workflowId, r.revision, 'checkout');
    r = await service.save(r.workflowId, r.revision, { ...value, name: 'future draft' });
    const rows = await testDb.select().from(workflowRevisions).where(eq(workflowRevisions.workflowId, r.workflowId));
    for (const row of rows) {
        assert.equal(Object.prototype.hasOwnProperty.call(row.snapshot, 'versions'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(row.snapshot, 'audit'), false);
        assert.equal(Array.isArray(row.snapshot.event), false);
    }
    const evidence = rows.find(row => row.revision === checkinRevision)!.snapshot;
    assert.equal(evidence.version.definition.name, 'original checkin');
    assert.equal(evidence.version.lastCheckinDefinition.name, 'original checkin');
    assert.equal(evidence.event.action, 'checkin');
    assert.equal(evidence.root.currentVersionId, evidence.version.workflowVersionId);
});
test('archive disables the root and unarchive preserves disabled state without changing version contents', async () => {
    let r = await service.create(value); const versions = structuredClone(r.versions);
    r = await service.status(r.workflowId, r.revision, { archived: true }); assert.equal(r.enabled, false); assert.equal(r.archived, true);
    r = await service.status(r.workflowId, r.revision, { enabled: true }); assert.equal(r.enabled, false); assert.equal(r.archived, true);
    r = await service.status(r.workflowId, r.revision, { archived: false }); assert.equal(r.enabled, false); assert.equal(r.archived, false);
    r = await service.status(r.workflowId, r.revision, { enabled: true }); assert.equal(r.enabled, true); assert.deepEqual(r.versions, versions);
});
