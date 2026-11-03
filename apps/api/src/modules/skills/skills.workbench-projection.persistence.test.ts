import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { closeDb } from '../../db/client';
import { resolveExecutionTestDatabaseUrl } from '../../test-helpers/execution-database-guard';
import { createBusinessExecutionProjectionService } from './skills.workbench-projection';
import { createSkillsPgRepository } from './skills-pg.repository';
import { createSkillInvocationService } from './skills.invocation';
import { createInvocationPgRepository } from './skills.invocation-pg.repository';
import { createExecutionManifestService } from './execution-manifest';
import { createExecutionEmergencyRepository } from './execution-emergency';
import { skillDefinitionHash as hash } from './skills.hash';
import { createHarnessRuntimeRepository } from '../harness/harness-runtime.repository';
import type { AuthUser } from '../../types';
import type { SkillDefinition } from './skills.types';
const pool = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 1 });
const database = drizzle(pool, { schema }), queue = createHarnessRuntimeRepository(database);
const user = { id: randomUUID(), username: `projection-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const rootIds: string[] = [];
const definition: SkillDefinition = { name: 'Frozen projection', description: 'Owned execution', category: 'fixture', instructions: 'PRIVATE instruction', roles: ['pre_sales'],
 inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, references: [], tools: [], examples: [], model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 } };
const manifests = createExecutionManifestService({ database, loadSkillContext: async d => ({ tools: [], snapshot: { schemaVersion: 1, references: [], tools: [], roles: ['ADMIN'],
 model: { providerId: 'fixture', model: 'fixed', modelSource: 'binding', credentialScope: 'PRIVATE', baseUrlDigest: hash('endpoint'), params: d.model, capabilities: [], supportedParams: [] } } }) as any });
const service = () => createBusinessExecutionProjectionService({ database, inventory: async () => ({ tools: [], policy: {}, registry: { get: () => undefined } }) as any });
async function fixture() {
 const roots = createSkillsPgRepository(database); let root = await roots.create(definition, { id: user.id, username: user.username }); rootIds.push(root.skillId);
 root = await roots.mutate(root.skillId, root.revision, { id: user.id, username: user.username }, 'publish', r => { r.versions[0].status = 'published'; r.activeVersionId = r.currentVersionId; });
 const sessionId = randomUUID(); await database.insert(schema.aiSessions).values({ sessionId, ownerUserId: user.id, ownerUsername: user.username, title: 'Projection', domain: 'business_evaluation', workflowKey: 'temporary_chat', businessRole: 'pre_sales', status: 'temporary_chat', createdAt: new Date(), updatedAt: new Date() });
 const response = await createSkillInvocationService({ queue, repository: createInvocationPgRepository(database), prepareExecution: manifests.prepareExecution, authority: createExecutionEmergencyRepository(database) })
  .submitInvocation(user, sessionId, { submissionKey: randomUUID(), content: 'Start', execution: { kind: 'skill', skillId: root.skillId, input: { name: 'Owned material' } } });
 return { root, sessionId, runId: response.data.runId };
}
before(async () => { await database.insert(schema.users).values({ userId: user.id, username: user.username, role: 'admin', businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: new Date() }); });
after(async () => {
 await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id)); await database.delete(schema.aiSessions).where(eq(schema.aiSessions.ownerUserId, user.id));
 // Immutable Skill roots and audit revisions are intentionally retained.
 await database.delete(schema.users).where(eq(schema.users.userId, user.id));
 assert.equal((await database.select().from(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id))).length, 0);
 await pool.end(); await closeDb();
});
test('owned projection preserves immutable selected version and input across root publication changes and refresh', async () => {
 const f = await fixture();
 const first = await service().read(user, f.runId);
 await database.update(schema.skillDefinitions).set({ activeVersionId: randomUUID(), enabled: false }).where(eq(schema.skillDefinitions.skillId, f.root.skillId));
 const refreshed = await service().read(user, f.runId);
 assert.deepEqual(refreshed, first); assert.equal(first.target.versionId, f.root.currentVersionId); assert.deepEqual(first.input, { name: 'Owned material' });
 assert.equal(JSON.stringify(first).includes('PRIVATE'), false);
 assert.equal('executionManifest' in first, false); assert.equal('state' in first, false);
});
test('projection refuses other owners, revoked DB identity and corrupted checkpoint pointers', async () => {
 const f = await fixture();
 await assert.rejects(service().read(user, randomUUID()), (e: any) => e.status === 404);
 await assert.rejects(service().read({ ...user, id: randomUUID() }, f.runId), (e: any) => e.status === 404);
 await database.update(schema.users).set({ businessRole: 'delivery' }).where(eq(schema.users.userId, user.id));
 try { await assert.rejects(service().read(user, f.runId), (e: any) => e.status === 403); }
 finally { await database.update(schema.users).set({ businessRole: 'pre_sales' }).where(eq(schema.users.userId, user.id)); }
 await database.update(schema.harnessRuns).set({ lastCheckpointId: randomUUID() }).where(eq(schema.harnessRuns.harnessRunId, f.runId));
 await assert.rejects(service().read(user, f.runId), (e: any) => e.status === 409);
});
