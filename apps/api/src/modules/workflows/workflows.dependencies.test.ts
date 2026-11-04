import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { testDb, testPool } from '../../test-helpers/db';
import { workflowSkillDependencies, workflowVersions, skillVersions } from '../../db/schema';
import { createSkillsPgRepository } from '../skills/skills-pg.repository';
import { createSkillUsecase } from '../skills/skills.usecase';
import { createSkillReleaseRepository } from '../skills/skills-release.repository';
import { createWorkflowContextLoader } from './workflows.context';
import { createWorkflowsPgRepository } from './workflows-pg.repository';
import { createWorkflowService } from './workflows.usecase';
import type { SkillDefinition } from '../skills/skills.types';
import type { SkillResolvedContext } from '../skills/skills.context';
import type { AuthUser } from '../../types';
import { WorkflowError, type WorkflowDefinition } from './workflows.types';
assert.equal(new URL(process.env.TEST_DATABASE_URL!).pathname, '/workload_eval_test');
after(async () => testPool.end());
const user = { id: 'workflow-dependencies-fixture', username: 'Fixture', role: 'admin', status: 'active' } as AuthUser;
const actor = { id: user.id, username: user.username };
const skills = createSkillsPgRepository(testDb);
const skillUsecase = createSkillUsecase(skills, async () => []);
const repo = createWorkflowsPgRepository(testDb);
let contextRevision = 1;
const load = createWorkflowContextLoader({ releases: createSkillReleaseRepository(testDb), getTools: async () => [], loadSkillContext: async () => ({ hash: `context-${contextRevision}`, snapshot: { schemaVersion: 1, references: [], model: { model: `fixture-${contextRevision}` }, tools: [], roles: ['ADMIN'] } } as unknown as SkillResolvedContext) });
const service = createWorkflowService(repo, load, user);
const payload = { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] };
const skill: SkillDefinition = { name: 'Workflow trusted PG dependency fixture', description: '', category: 'delivery', instructions: 'Fixture only; no provider invocation', roles: ['delivery'], inputSchema: payload, outputSchema: payload,
    references: [], tools: [], examples: [], model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 } };
async function skillFixture() {
    let s = await skills.create(skill, actor);
    // Trusted storage fixture: no fake model/evaluation is represented as executed or production evidence.
    s = await skills.mutate(s.skillId, s.revision, actor, 'publish', r => { r.versions[0].status = 'published'; r.activeVersionId = r.currentVersionId; });
    const definition: WorkflowDefinition = { name: 'Exact version fixture', description: '', category: 'delivery', roles: ['delivery'], inputSchema: payload, outputSchema: payload,
        steps: [{ type: 'skill', id: 's', name: 'Skill', skillId: s.skillId, skillVersionId: s.currentVersionId, inputMapping: [{ target: 'text', source: { kind: 'path', path: '$.input.text' } }], onFailure: 'wait' }], outputMapping: [{ target: 'text', source: { kind: 'path', path: '$.steps.s.output.text' } }] };
    return { s, definition };
}
async function publish(r: Awaited<ReturnType<typeof repo.create>>) { r = await service.validate(r.workflowId, r.revision); r = await service.review(r.workflowId, r.revision, '静态定义与固定依赖审查'); return service.publish(r.workflowId, r.revision); }
test('exact references reject wrong/draft/missing/unavailable Skill versions in the real PG resolver', async () => {
    const f = await skillFixture();
    for (const skillVersionId of ['missing', (await skills.create(skill, actor)).currentVersionId])
        await assert.rejects(service.create({ ...f.definition, steps: [{ ...f.definition.steps[0], skillVersionId }] }));
    const draft = await skills.create(skill, actor);
    await assert.rejects(service.create({ ...f.definition, steps: [{ ...f.definition.steps[0], skillId: draft.skillId, skillVersionId: draft.currentVersionId }] }));
    f.s = await skillUsecase.setStatus(f.s.skillId, f.s.revision, actor, { enabled: false });
    await assert.rejects(service.create(f.definition));
});
test('published snapshots pin exact old Skill even after new publish/default rollback; influences retain current/history/archive bindings', async () => {
    const f = await skillFixture();
    let r = await publish(await service.create(f.definition));
    const a = r.currentVersionId;
    const frozen = await service.dependencies(r.workflowId, a);
    f.s = await skillUsecase.action(f.s.skillId, f.s.revision, actor, 'promote');
    f.s = await skills.mutate(f.s.skillId, f.s.revision, actor, 'publish', x => { x.versions[1].status = 'published'; x.activeVersionId = x.currentVersionId; });
    f.s = await skills.mutate(f.s.skillId, f.s.revision, actor, 'rollback', x => { x.activeVersionId = x.versions[0].skillVersionId; });
    assert.deepEqual(await service.dependencies(r.workflowId, a), frozen);
    assert.equal(frozen.snapshot!.skills[0].skillVersionId, f.definition.steps[0].type === 'skill' && f.definition.steps[0].skillVersionId);
    r = await service.action(r.workflowId, r.revision, 'promote');
    r = await publish(r);
    const b = r.currentVersionId;
    r = await service.status(r.workflowId, r.revision, { archived: true });
    const influences = await repo.influences(f.s.skillId, f.s.versions[0].skillVersionId);
    assert.equal(influences.length, 2);
    assert.ok(influences.every(x => x.archived && x.binding === 'fixed'));
    assert.ok(influences.some(x => x.workflowVersionId === a && x.history && !x.current && !x.active));
    assert.ok(influences.some(x => x.workflowVersionId === b && x.current && x.active));
    assert.equal((await repo.influences(f.s.skillId, f.s.currentVersionId)).length, 0);
    assert.equal((await service.list()).some(x => x.workflowId === r.workflowId), false);
    assert.equal((await service.list(true)).some(x => x.workflowId === r.workflowId), true);
    const [binding] = await testDb.select().from(workflowSkillDependencies).where(eq(workflowSkillDependencies.versionId, a));
    await assert.rejects(testDb.update(workflowSkillDependencies).set({ skillVersionId: f.s.currentVersionId }).where(eq(workflowSkillDependencies.versionId, a)));
    await assert.rejects(testDb.delete(workflowSkillDependencies).where(eq(workflowSkillDependencies.versionId, a)));
    await assert.rejects(testDb.insert(workflowSkillDependencies).values({ ...binding, stepId: 'invented' }));
    await assert.rejects(testDb.delete(skillVersions).where(eq(skillVersions.skillVersionId, binding.skillVersionId)));
    const [version] = await testDb.select().from(workflowVersions).where(eq(workflowVersions.workflowVersionId, a));
    assert.deepEqual(version.dependencySnapshot, frozen.snapshot);
});
test('changed native/model/reference digests stale proofs; disabled dependency rejects rollback without changing history', async () => {
    const f = await skillFixture();
    let r = await service.create(f.definition);
    r = await service.validate(r.workflowId, r.revision);
    contextRevision++;
    await assert.rejects(service.review(r.workflowId, r.revision, 'stale'), (e: unknown) => e instanceof WorkflowError && e.code === 'WORKFLOW_RELEASE_GATE_PENDING');
    r = await publish(r);
    const a = r.currentVersionId;
    r = await service.action(r.workflowId, r.revision, 'promote');
    r = await publish(r);
    f.s = await skillUsecase.setStatus(f.s.skillId, f.s.revision, actor, { enabled: false });
    const before = structuredClone(r);
    await assert.rejects(service.rollback(r.workflowId, r.revision, a, 'dependency unavailable'));
    assert.deepEqual(await repo.get(r.workflowId), before);
});
test('Skill root share lock serializes disable against workflow publication dependency validation', async () => {
    const f = await skillFixture();
    let r = await service.create(f.definition);
    r = await service.validate(r.workflowId, r.revision);
    r = await service.review(r.workflowId, r.revision, 'lock test');
    // Disable commits first: publish acquires the root lock and must observe disabled state, with no half event or pointer.
    await skillUsecase.setStatus(f.s.skillId, f.s.revision, actor, { enabled: false });
    await assert.rejects(service.publish(r.workflowId, r.revision));
    assert.deepEqual(await repo.get(r.workflowId), r);
    assert.equal((await testDb.execute(sql `SELECT status FROM workflow_versions WHERE workflow_version_id = ${r.currentVersionId}`)).rows[0].status, 'reviewed');
});
test('concurrent Skill disable waits for workflow publication SHARE lock, then leaves the published snapshot untouched', async () => {
    const f = await skillFixture();
    let r = await service.create(f.definition);
    r = await service.validate(r.workflowId, r.revision);
    r = await service.review(r.workflowId, r.revision, 'concurrent lock');
    const { lockWorkflowSkillDependencies } = await import('./workflows.context');
    let signalLocked!: () => void;
    let release!: () => void;
    const locked = new Promise<void>(resolve => { signalLocked = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const lockedService = createWorkflowService(repo, async (definition, user, tx) => {
        assert.ok(tx);
        await lockWorkflowSkillDependencies(definition, tx);
        signalLocked();
        await gate;
        return load(definition, user, tx);
    }, user);
    const publication = lockedService.publish(r.workflowId, r.revision);
    await locked;
    let disabled = false;
    const disable = skillUsecase.setStatus(f.s.skillId, f.s.revision, actor, { enabled: false }).then(x => { disabled = true; return x; });
    try {
        await new Promise(resolve => setTimeout(resolve, 25));
        assert.equal(disabled, false);
    }
    finally {
        release();
    }
    const published = await publication;
    await disable;
    assert.equal(published.activeVersionId, r.currentVersionId);
    assert.equal(disabled, true);
    const frozen = await service.dependencies(r.workflowId, r.currentVersionId);
    assert.equal(frozen.frozen, true);
    assert.equal(frozen.snapshot!.skills[0].skillVersionId, f.s.currentVersionId);
});
test('dependency table rejects draft/mismatched Skill references and historical draft Workflow versions cannot be rewritten', async () => {
    const f = await skillFixture();
    const r = await service.create(f.definition);
    const a = r.currentVersionId;
    const draftSkill = await skills.create(skill, actor);
    await assert.rejects(testDb.insert(workflowSkillDependencies).values({ versionId: a, stepId: 'other', skillId: draftSkill.skillId, skillVersionId: draftSkill.currentVersionId }));
    await assert.rejects(testDb.insert(workflowSkillDependencies).values({ versionId: a, stepId: 'other', skillId: draftSkill.skillId, skillVersionId: f.s.currentVersionId }));
    await service.action(r.workflowId, r.revision, 'promote');
    await assert.rejects(testDb.update(workflowVersions).set({ minorNumber: 42 }).where(eq(workflowVersions.workflowVersionId, a)));
    await assert.rejects(testDb.delete(workflowSkillDependencies).where(eq(workflowSkillDependencies.versionId, a)));
});
