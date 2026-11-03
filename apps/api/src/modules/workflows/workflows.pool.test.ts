import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { createSkillsPgRepository } from '../skills/skills-pg.repository';
import { createSkillReleaseRepository } from '../skills/skills-release.repository';
import { createWorkflowContextLoader } from './workflows.context';
import { createWorkflowsPgRepository } from './workflows-pg.repository';
import { createWorkflowService } from './workflows.usecase';
import type { SkillDefinition } from '../skills/skills.types';
import type { SkillResolvedContext } from '../skills/skills.context';
import type { WorkflowDefinition } from './workflows.types';
import type { AuthUser } from '../../types';
assert.equal(new URL(process.env.TEST_DATABASE_URL!).pathname, '/workload_eval_test');
const pools: Pool[] = [];
after(async () => { await Promise.all(pools.map(p => p.end())); });
const user = { id: 'workflow-pool-fixture', username: 'Pool fixture', role: 'admin', status: 'active' } as AuthUser;
const definition: SkillDefinition = { name: 'pool fixture', description: '', category: 'test', instructions: 'trusted storage fixture only', roles: ['delivery'], inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, tools: [], references: [], examples: [], model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 } };
const snapshot = { schemaVersion: 1, references: [], tools: [], roles: [], model: {} } as unknown as SkillResolvedContext['snapshot'];
async function fixture(max: number) {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max, connectionTimeoutMillis: 300 });
    pools.push(pool);
    const db = drizzle(pool, { schema });
    const skills = createSkillsPgRepository(db);
    const actor = { id: user.id, username: user.username };
    let s = await skills.create(definition, actor);
    s = await skills.mutate(s.skillId, s.revision, actor, 'publish', r => { r.versions[0].status = 'published'; r.activeVersionId = r.currentVersionId; });
    const workflow: WorkflowDefinition = { name: 'pool fixture', description: '', category: 'test', roles: ['delivery'], inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, outputMapping: [], steps: [{ id: 's', name: 'Skill', type: 'skill', skillId: s.skillId, skillVersionId: s.currentVersionId, inputMapping: [], onFailure: 'wait' }] };
    return { pool, db, workflow, releases: createSkillReleaseRepository(db) };
}
test('exact published Skill resolution inside a max=1 transaction reuses its connection', async () => {
    const f = await fixture(1);
    const load = createWorkflowContextLoader({ database: f.db, releases: f.releases, getTools: async () => [], loadSkillContext: async () => ({ snapshot } as SkillResolvedContext) });
    const result = await f.db.transaction(tx => load(f.workflow, user, tx));
    assert.equal(result.snapshot.skills.length, 1);
});
test('saturated same-root waiters never call DB-backed context preparation while holding transaction connections', async () => {
    const f = await fixture(2);
    let resolutions = 0;
    const load = createWorkflowContextLoader({ database: f.db, releases: f.releases, getTools: async () => { await f.pool.query('SELECT 1'); return []; }, loadSkillContext: async () => { await f.pool.query('SELECT 1'); resolutions++; return { snapshot } as SkillResolvedContext; } });
    const service = createWorkflowService(createWorkflowsPgRepository(f.db), load, user);
    const r = await service.create(f.workflow);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => service.validate(r.workflowId, r.revision)));
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
    assert.ok(resolutions >= 2);
    for (const result of results)
        if (result.status === 'rejected')
            assert.equal(result.reason.code, 'WORKFLOW_REVISION_CONFLICT');
});
test('Skill review/publish pre-resolve their DB-backed context before acquiring the Skill root lock', async () => {
    const { createSkillReleaseService } = await import('../skills/skills.release');
    const f = await fixture(1);
    const roots = createSkillsPgRepository(f.db);
    const actor = { id: user.id, username: user.username };
    const r = await roots.create(definition, actor);
    const service = createSkillReleaseService(roots, f.releases, async () => { await f.pool.query('SELECT 1'); return { hash: 'ctx' } as SkillResolvedContext; }, user);
    for (const action of [() => service.review(r.skillId, r.revision, 'missing-evaluation', 'pool regression', false), () => service.publish(r.skillId, r.revision)]) {
        await assert.rejects(action(), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'SKILL_RELEASE_GATE_PENDING');
        assert.deepEqual(await roots.get(r.skillId), r);
    }
});
test('real shared Skill resolver performs system/model/reference/credential DB reads before a max=1 Workflow transaction', async () => {
    const { db, pool, closeDb } = await import('../../db/client');
    const { ToolRegistry } = await import('../../agent/tool-registry');
    const { resolveSkillDependencyContext } = await import('../skills/skills.context');
    const oldMax = pool.options.max;
    pool.options.max = 1;
    const id = `workflow-pool-reference-${crypto.randomUUID()}`;
    try {
        const now = new Date();
        await db.insert(schema.knowledgeEntries).values({ id, title: 'Pool regression reference', content: 'Local fixture only', category: 'test', tags: [], status: 'active', createdAt: now, updatedAt: now });
        const roots = createSkillsPgRepository(db);
        const actor = { id: user.id, username: user.username };
        let s = await roots.create({ ...definition, references: [{ label: 'Local', uri: `wes://knowledge/${id}`, version: now.toISOString() }] }, actor);
        s = await roots.mutate(s.skillId, s.revision, actor, 'publish', r => { r.versions[0].status = 'published'; r.activeVersionId = r.currentVersionId; });
        const workflow: WorkflowDefinition = { name: 'actual resolver pool test', description: '', category: 'test', roles: ['delivery'], inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, outputMapping: [], steps: [{ id: 's', name: 'Skill', type: 'skill', skillId: s.skillId, skillVersionId: s.currentVersionId, inputMapping: [], onFailure: 'wait' }] };
        let reads = 0;
        const load = createWorkflowContextLoader({ database: db, releases: createSkillReleaseRepository(db), getTools: async () => [], loadSkillContext: async (definition, user) => {
                assert.equal(pool.idleCount, pool.totalCount, 'resolver must not inherit a held transaction connection');
                reads++;
                return resolveSkillDependencyContext(definition, user, { requireModel: false, inventory: { tools: [], policy: { schemaVersion: 1, policies: {} }, registry: new ToolRegistry() } });
            } });
        const service = createWorkflowService(createWorkflowsPgRepository(db), load, user);
        let r = await service.create(workflow);
        r = await service.validate(r.workflowId, r.revision);
        r = await service.review(r.workflowId, r.revision, 'actual resolver static proof');
        r = await service.publish(r.workflowId, r.revision);
        assert.ok(reads >= 4);
        assert.equal(r.versions[0].dependencySnapshot!.skills[0].context.references[0].uri, `wes://knowledge/${id}`);
        assert.equal(r.versions[0].validation!.executionPerformed, false);
        const { createSkillReleaseService } = await import('../skills/skills.release');
        const draft = await roots.create({ ...definition, references: [{ label: 'Local', uri: `wes://knowledge/${id}`, version: now.toISOString() }] }, actor);
        const skillService = createSkillReleaseService(roots, createSkillReleaseRepository(db), (definition, user) => resolveSkillDependencyContext(definition, user, { requireModel: false, inventory: { tools: [], policy: { schemaVersion: 1, policies: {} }, registry: new ToolRegistry() } }), user);
        await assert.rejects(skillService.review(draft.skillId, draft.revision, 'missing-evaluation', 'actual resolver pool regression', false), (e: unknown) => e instanceof Error && 'code' in e && e.code === 'SKILL_RELEASE_GATE_PENDING');
        assert.deepEqual(await roots.get(draft.skillId), draft);
    }
    finally {
        try { await db.delete(schema.knowledgeEntries).where(eq(schema.knowledgeEntries.id, id)); }
        finally { pool.options.max = oldMax; await closeDb(); }
    }
});
test('authority changes during or after preparation invalidate the fence, including same-timestamp reference corrections', async () => {
    const { prepareSkillAuthority } = await import('../skills/skills.authority');
    const f = await fixture(1);
    const id = `workflow-authority-${crypto.randomUUID()}`;
    const now = new Date();
    await f.db.insert(schema.knowledgeEntries).values({ id, title: 'Fence fixture', content: 'before', category: 'test', tags: [], status: 'active', createdAt: now, updatedAt: now });
    try {
        const refs = [`wes://knowledge/${id}`];
        await assert.rejects(prepareSkillAuthority(refs, async () => {
            await f.db.update(schema.knowledgeEntries).set({ content: 'corrected without timestamp change' }).where(eq(schema.knowledgeEntries.id, id));
            return 'ctx';
        }, f.db), (e: unknown) => e instanceof Error && 'code' in e && e.code === 'SKILL_CONTEXT_CHANGED');
        const prepared = await prepareSkillAuthority(refs, async () => 'ctx', f.db);
        await f.db.update(schema.knowledgeEntries).set({ content: 'changed after preparation' }).where(eq(schema.knowledgeEntries.id, id));
        await assert.rejects(f.db.transaction(tx => prepared.verify(tx)), (e: unknown) => e instanceof Error && 'code' in e && e.code === 'SKILL_CONTEXT_CHANGED');
    } finally { await f.db.delete(schema.knowledgeEntries).where(eq(schema.knowledgeEntries.id, id)); }
});
