import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { createExecutionManifestService, readPersistedExecutionManifest } from './execution-manifest';
import { createExecutionManifestPgRepository } from './execution-manifest-pg.repository';
import { createSkillsPgRepository } from './skills-pg.repository';
import { createSkillUsecase } from './skills.usecase';
import { createWorkflowsPgRepository } from '../workflows/workflows-pg.repository';
import { createWorkflowService } from '../workflows/workflows.usecase';
import { createWorkflowContextLoader } from '../workflows/workflows.context';
import { createSkillReleaseRepository } from './skills-release.repository';
import { KnowledgePgRepository } from '../knowledge/knowledge-pg.repository';
import { skillDefinitionHash as hash } from './skills.hash';
import type { WorkflowDefinition } from '../workflows/workflows.types';
import type { SkillDefinition } from './skills.types';
import type { SkillResolvedContext } from './skills.context';
import type { AuthUser } from '../../types';
import { resolveExecutionTestDatabaseUrl } from '../../test-helpers/execution-database-guard';
const target = resolveExecutionTestDatabaseUrl(process.env);
const pool = new Pool({ connectionString: target, max: 6 }); const database = drizzle(pool, { schema });
const user = { id: randomUUID(), username: `manifest-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const actor = { id: user.id, username: user.username };
const payload = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const definition: SkillDefinition = { name: 'Execution fixture', description: '', category: 'test', instructions: 'Frozen fixture', roles: ['pre_sales'],
  inputSchema: payload, outputSchema: payload, tools: [], references: [], examples: [], model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 } };
const roots = createSkillsPgRepository(database); const skillUsecase = createSkillUsecase(roots, async () => []);
const workflowRoots = createWorkflowsPgRepository(database);
const snapshot = (d: SkillDefinition): SkillResolvedContext['snapshot'] => ({ schemaVersion: 1, references: [], tools: [], roles: ['ADMIN'], model: {
  providerId: 'fixture', model: 'frozen-model', modelSource: 'binding', credentialScope: 'ai', baseUrlDigest: hash('endpoint'), params: d.model, capabilities: [], supportedParams: [] } });
const loadContext = async (d: SkillDefinition): Promise<SkillResolvedContext> => ({ snapshot: snapshot(d), tools: [] } as unknown as SkillResolvedContext);
const service = createExecutionManifestService({ database, loadSkillContext: loadContext, loadWorkflowTools: async () => [] });
const request = (skillId: string) => ({ kind: 'skill', skillId, input: { text: 'original' } });
async function skill(d = definition) {
  const r = await roots.create(d, actor);
  return roots.mutate(r.skillId, r.revision, actor, 'publish', next => { next.versions[0].status = 'published'; next.activeVersionId = next.currentVersionId; });
}
async function workflow(skillId: string, skillVersionId: string) {
  const d: WorkflowDefinition = { name: 'Frozen workflow', description: '', category: 'test', roles: ['pre_sales'], inputSchema: payload, outputSchema: payload,
    steps: [{ id: 's', name: 'Skill', type: 'skill', skillId, skillVersionId, inputMapping: [{ target: 'text', source: { kind: 'path', path: '$.input.text' } }], onFailure: 'fail' }],
    outputMapping: [{ target: 'text', source: { kind: 'path', path: '$.steps.s.output.text' } }] };
  const service = workflowService();
  let r = await service.create(d); r = await service.validate(r.workflowId, r.revision);
  r = await service.review(r.workflowId, r.revision, 'Trusted static fixture, no business execution');
  return service.publish(r.workflowId, r.revision);
}
function workflowService() {
  const load = createWorkflowContextLoader({ database, releases: createSkillReleaseRepository(database), getTools: async () => [], loadSkillContext: loadContext });
  return createWorkflowService(workflowRoots, load, user);
}
async function commit(value: unknown, caller = user) { const prepared = await service.prepareExecution(value, caller); return database.transaction(tx => prepared.resolveInTransaction(tx)); }
const ready = database.insert(schema.users).values({ userId: user.id, username: user.username, role: 'admin', businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: new Date() });
after(async () => { await database.delete(schema.users).where(eq(schema.users.userId, user.id)); await pool.end(); });
test('real PG rejects missing, unpublished and disabled/archived Skill and Workflow roots', async () => {
  await ready;
  await assert.rejects(commit(request(randomUUID())));
  const draft = await roots.create(definition, actor); await assert.rejects(commit(request(draft.skillId)));
  const r = await skill(); const w = await workflow(r.skillId, r.currentVersionId);
  const draftWorkflow = await workflowRoots.create(w.versions[0].definition, actor);
  await assert.rejects(commit({ kind: 'workflow', workflowId: draftWorkflow.workflowId, input: { text: 'x' } }));
  await skillUsecase.setStatus(r.skillId, r.revision, actor, { enabled: false });
  await assert.rejects(commit(request(r.skillId))); await assert.rejects(commit({ kind: 'workflow', workflowId: w.workflowId, input: { text: 'x' } }));
  const archived = await skill(); await skillUsecase.setStatus(archived.skillId, archived.revision, actor, { archived: true }); await assert.rejects(commit(request(archived.skillId)));
  await workflowRoots.mutate(w.workflowId, w.revision, actor, 'status', next => { next.enabled = false; });
  await assert.rejects(commit({ kind: 'workflow', workflowId: w.workflowId, input: { text: 'x' } }));
});
test('workflow keeps exact old Skill version and content after Skill default publication changes', async () => {
  const s = await skill(); const w = await workflow(s.skillId, s.currentVersionId);
  let newer = await skillUsecase.action(s.skillId, s.revision, actor, 'promote');
  newer = await roots.mutate(newer.skillId, newer.revision, actor, 'publish', next => { next.versions[1].status = 'published'; next.activeVersionId = next.currentVersionId; });
  const manifest = await commit({ kind: 'workflow', workflowId: w.workflowId, input: { text: 'x' } });
  assert.equal(manifest.skills[0].versionId, s.currentVersionId); assert.notEqual(manifest.skills[0].versionId, newer.activeVersionId);
  assert.deepEqual(manifest.skills[0].definition, definition); assert.equal(manifest.target.versionId, w.activeVersionId);
});
test('prepare then publication change conflicts; fresh parse is completely new and concurrent disable waits for SHARE locks', async () => {
  const s = await skill(); let n = await skillUsecase.action(s.skillId, s.revision, actor, 'promote');
  const prepared = await service.prepareExecution(request(s.skillId), user);
  n = await roots.mutate(n.skillId, n.revision, actor, 'publish', next => { next.versions[1].status = 'published'; next.activeVersionId = next.currentVersionId; });
  await assert.rejects(database.transaction(tx => prepared.resolveInTransaction(tx)), (e: any) => e.code === 'EXECUTION_CONTEXT_CHANGED');
  const fresh = await commit(request(s.skillId)); assert.equal(fresh.target.versionId, n.activeVersionId); assert.equal(fresh.skills[0].versionId, n.activeVersionId);
  const old = await service.prepareExecution(request(s.skillId), user);
  let release!: () => void; let locked!: () => void; const gate = new Promise<void>(r => { release = r; }); const acquired = new Promise<void>(r => { locked = r; });
  const parsing = database.transaction(async tx => { const result = await old.resolveInTransaction(tx); locked(); await gate; return result; });
  await acquired;
  let disabled = false; const disabling = skillUsecase.setStatus(n.skillId, n.revision, actor, { enabled: false }).then(() => { disabled = true; });
  try { await new Promise(r => setTimeout(r, 30)); assert.equal(disabled, false); } finally { release(); }
  const manifest = await parsing; await disabling;
  assert.equal(manifest.target.versionId, n.activeVersionId); assert.deepEqual(readPersistedExecutionManifest(manifest), manifest);
  await assert.rejects(commit(request(s.skillId)));
});
test('single Skill concurrent publication cannot change the locked definition or version halfway through parsing', async () => {
  const s = await skill(); const next = await skillUsecase.action(s.skillId, s.revision, actor, 'promote');
  let release!: () => void; let locked!: () => void; const gate = new Promise<void>(r => { release = r; }); const acquired = new Promise<void>(r => { locked = r; });
  const repo = createExecutionManifestPgRepository();
  const gated = createExecutionManifestService({ database, loadSkillContext: loadContext, repository: { ...repo, async read(tx, request, lock) {
    const result = await repo.read(tx, request, lock); if (lock) { locked(); await gate; } return result;
  } } });
  const prepared = await gated.prepareExecution(request(s.skillId), user); const parsing = database.transaction(tx => prepared.resolveInTransaction(tx)); await acquired;
  let done = false;
  const publication = roots.mutate(s.skillId, next.revision, actor, 'publish', record => { record.versions[1].status = 'published'; record.activeVersionId = record.currentVersionId; }).then(record => { done = true; return record; });
  try { await new Promise(r => setTimeout(r, 30)); assert.equal(done, false); } finally { release(); }
  const old = await parsing; const current = await publication;
  assert.equal(old.target.versionId, s.currentVersionId); assert.equal(old.skills[0].versionId, s.currentVersionId);
  assert.deepEqual(old.target.definition, definition); assert.deepEqual(old.skills[0].definition, definition);
  const fresh = await commit(request(s.skillId)); assert.equal(fresh.target.versionId, current.currentVersionId); assert.equal(fresh.skills[0].versionId, current.currentVersionId);
});
test('current user changes are rejected and caller transaction rollback writes nothing', async () => {
  const s = await skill(); const prepared = await service.prepareExecution(request(s.skillId), user);
  await database.update(schema.users).set({ businessRole: 'delivery' }).where(eq(schema.users.userId, user.id));
  await assert.rejects(database.transaction(tx => prepared.resolveInTransaction(tx)), (e: any) => e.code === 'EXECUTION_AUTHORITY_CHANGED');
  await database.update(schema.users).set({ businessRole: 'pre_sales' }).where(eq(schema.users.userId, user.id));
  const stable = await service.prepareExecution(request(s.skillId), user);
  const [before] = await database.select({ n: sql<number>`count(*)::int` }).from(schema.skillRevisions).where(eq(schema.skillRevisions.skillId, s.skillId));
  await assert.rejects(database.transaction(async tx => { await stable.resolveInTransaction(tx); throw new Error('caller rollback'); }), /caller rollback/);
  const [after] = await database.select({ n: sql<number>`count(*)::int` }).from(schema.skillRevisions).where(eq(schema.skillRevisions.skillId, s.skillId));
  assert.equal(after.n, before.n); assert.equal((await roots.get(s.skillId))!.revision, s.revision);
});
test('actual database reference change is caught by the authority fence and old nonempty material remains readable', async () => {
  const id = `manifest-ref-${randomUUID()}`;
  const knowledge = new KnowledgePgRepository(database);
  const entry = await knowledge.create({ id, title: 'Frozen knowledge', content: 'original content', category: 'test' });
  try {
    const d = { ...definition, references: [{ label: 'Source', uri: `wes://knowledge/${id}`, version: entry.updatedAt }] };
    const s = await skill(d);
    const service = createExecutionManifestService({ database, loadSkillContext: async d => ({ ...await loadContext(d), snapshot: { ...snapshot(d), references: [{ uri: d.references[0].uri, version: entry.updatedAt, digest: hash({ title: entry.title, content: entry.content }) }] } }),
      loadReference: id => knowledge.get(id) });
    const saved = await service.prepareExecution(request(s.skillId), user); const manifest = await database.transaction(tx => saved.resolveInTransaction(tx));
    const stale = await service.prepareExecution(request(s.skillId), user);
    await database.update(schema.knowledgeEntries).set({ content: 'same-timestamp replacement' }).where(eq(schema.knowledgeEntries.id, id));
    await assert.rejects(database.transaction(tx => stale.resolveInTransaction(tx)), (e: any) => e.code === 'SKILL_CONTEXT_CHANGED');
    assert.equal(readPersistedExecutionManifest(manifest).skills[0].materials[0].content, 'original content');
    assert.equal(manifest.skills[0].materials[0].version, entry.updatedAt);
  } finally { await database.delete(schema.knowledgeEntries).where(eq(schema.knowledgeEntries.id, id)); }
});
test('concurrent workflow publication returns complete old bindings, then fresh complete new bindings and rejects stale prepare', async () => {
  const a = await skill(); const b = await skill({ ...definition, instructions: 'Second exact Skill' });
  const w = await workflow(a.skillId, a.currentVersionId); const ws = workflowService();
  let next = await ws.action(w.workflowId, w.revision, 'promote'); next = await ws.action(next.workflowId, next.revision, 'checkout');
  const changed = structuredClone(next.versions[1].definition); changed.name = 'Second workflow';
  const step = changed.steps[0]; assert.equal(step.type, 'skill'); if (step.type !== 'skill') throw new Error('fixture'); step.skillId = b.skillId; step.skillVersionId = b.currentVersionId;
  next = await ws.save(next.workflowId, next.revision, changed); next = await ws.action(next.workflowId, next.revision, 'checkin');
  next = await ws.validate(next.workflowId, next.revision); next = await ws.review(next.workflowId, next.revision, 'Second static fixture');
  const value = { kind: 'workflow', workflowId: w.workflowId, input: { text: 'x' } };
  const stale = await service.prepareExecution(value, user);
  let release!: () => void; let locked!: () => void; const gate = new Promise<void>(r => { release = r; }); const acquired = new Promise<void>(r => { locked = r; });
  const repo = createExecutionManifestPgRepository();
  const gated = createExecutionManifestService({ database, loadSkillContext: loadContext, loadWorkflowTools: async () => [], repository: { ...repo, async read(tx, request, lock) {
    const result = await repo.read(tx, request, lock); if (lock) { locked(); await gate; } return result;
  } } });
  const prepared = await gated.prepareExecution(value, user); const parsing = database.transaction(tx => prepared.resolveInTransaction(tx)); await acquired;
  let published = false; const publication = ws.publish(next.workflowId, next.revision).then(r => { published = true; return r; });
  try { await new Promise(r => setTimeout(r, 30)); assert.equal(published, false); } finally { release(); }
  const old = await parsing; const current = await publication;
  assert.equal(old.target.versionId, w.activeVersionId); assert.equal(old.skills[0].skillId, a.skillId); assert.equal(old.skills[0].versionId, a.currentVersionId);
  await assert.rejects(database.transaction(tx => stale.resolveInTransaction(tx)), (e: any) => e.code === 'EXECUTION_CONTEXT_CHANGED');
  const fresh = await commit(value); assert.equal(fresh.target.versionId, current.activeVersionId); assert.equal(fresh.skills[0].skillId, b.skillId);
  assert.equal(fresh.skills[0].versionId, b.currentVersionId); assert.equal(fresh.skills[0].definition.instructions, 'Second exact Skill');
});
test('max=1 pool resolves only before commit and reuses one transaction connection', async () => {
  const s = await skill(); const single = new Pool({ connectionString: target, max: 1, connectionTimeoutMillis: 500 }); const db = drizzle(single, { schema });
  try {
    let reads = 0;
    const service = createExecutionManifestService({ database: db, loadSkillContext: async d => { await single.query('SELECT 1'); reads++; return loadContext(d); }, loadWorkflowTools: async () => [] });
    const prepared = await service.prepareExecution(request(s.skillId), user);
    const manifest = await db.transaction(tx => prepared.resolveInTransaction(tx));
    assert.equal(reads, 1); assert.equal(manifest.target.versionId, s.activeVersionId);
  } finally { await single.end(); }
});
