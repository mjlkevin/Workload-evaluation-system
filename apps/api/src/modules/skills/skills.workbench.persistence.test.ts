import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { closeDb } from '../../db/client';
import { resolveExecutionTestDatabaseUrl } from '../../test-helpers/execution-database-guard';
import { createExecutionCatalogService } from './skills.workbench';
import { skillDefinitionHash as hash } from './skills.hash';
import { createSkillsPgRepository } from './skills-pg.repository';
import { createWorkflowsPgRepository } from '../workflows/workflows-pg.repository';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../agent/tool-policy';
import { createWorkflowService } from '../workflows/workflows.usecase';
import type { AuthUser } from '../../types';
import type { SkillDefinition } from './skills.types';
const pool = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 1 });
const database = drizzle(pool, { schema });
const user = { id: randomUUID(), username: `catalog-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const definition: SkillDefinition = { name: 'Authorized estimate', description: 'User catalog', category: 'fixture', instructions: 'PRIVATE instruction', roles: ['pre_sales'],
 inputSchema: { type: 'object', additionalProperties: false }, outputSchema: { type: 'object' }, references: [], tools: [], examples: [],
 model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 } };
const actor = { id: user.id, username: user.username };
const ids: string[] = [], workflowIds: string[] = [];
const inventory = async () => ({ tools: [], policy: { schemaVersion: 1, policies: {} }, registry: { get: () => undefined } }) as any;
const catalog = () => createExecutionCatalogService({ database, inventory, loadSkillContext: async () => ({ tools: [] }) as any });
async function skill(patch: Partial<SkillDefinition> = {}, state: Record<string, unknown> = {}) {
 const repo = createSkillsPgRepository(database); let root = await repo.create({ ...definition, ...patch }, actor); ids.push(root.skillId);
 root = await repo.mutate(root.skillId, root.revision, actor, 'publish', r => { r.versions[0].status = 'published'; r.activeVersionId = r.currentVersionId; });
 if (Object.keys(state).length) await database.update(schema.skillDefinitions).set(state).where(eq(schema.skillDefinitions.skillId, root.skillId));
 return root;
}
before(async () => { await database.insert(schema.users).values({ userId: user.id, username: user.username, role: 'admin', businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: new Date() }); });
after(async () => {
 // Immutable definition roots and revision audits are intentionally retained.
 await database.delete(schema.users).where(eq(schema.users.userId, user.id));
 const [remaining] = await database.select({ id: schema.users.userId }).from(schema.users).where(eq(schema.users.userId, user.id)); assert.equal(remaining, undefined);
 await pool.end(); await closeDb();
});
test('catalog returns only currently published enabled authorized non-stopped definitions', async () => {
 const allowed = await skill(); const disabled = await skill({}, { enabled: false }); const archived = await skill({}, { archived: true });
 const stopped = await skill({}, { emergencyStopped: true }); const forbidden = await skill({ roles: ['delivery'] });
 const unavailableTool = await skill({ tools: [{ toolName: 'not_available', requiresConfirmation: false, inputMapping: {} }] });
 const draft = await createSkillsPgRepository(database).create(definition, actor); ids.push(draft.skillId);
 const items = await catalog().list(user), found = (id: string) => items.some((i: any) => i.id === id);
 assert.equal(found(allowed.skillId), true);
 for (const root of [disabled, archived, stopped, forbidden, unavailableTool, draft]) assert.equal(found(root.skillId), false);
 const entry = items.find((i: any) => i.id === allowed.skillId);
 assert.ok(entry); assert.deepEqual(Object.keys(entry).sort(), ['kind', 'id', 'versionId', 'name', 'description', 'inputSchema'].sort());
 assert.equal(JSON.stringify(entry).includes('PRIVATE'), false);
});
test('workflow catalog uses the same business-role boundary without requiring admin maintenance access', async () => {
 const repo = createWorkflowsPgRepository(database);
 let root = await repo.create({ name: 'Question workflow', description: '', category: 'fixture', roles: ['pre_sales'], inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, steps: [{ id: 'question', name: 'Question', type: 'userInput', prompt: 'Enter value', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, inputMapping: [], onFailure: 'fail' }], outputMapping: [] }, actor);
 workflowIds.push(root.workflowId);
 const service = createWorkflowService(repo, async () => ({ context: { skills: [], tools: [] }, snapshot: { schemaVersion: 1, skills: [], tools: [] }, hash: hash({ skills: [], tools: [] }) }), user);
 root = await service.validate(root.workflowId, root.revision); root = await service.review(root.workflowId, root.revision, 'Catalog fixture'); root = await service.publish(root.workflowId, root.revision);
 assert.equal((await catalog().list(user)).some((i: any) => i.kind === 'workflow' && i.id === root.workflowId), true);
});
test('catalog fails closed when DB role has changed since the JWT user was read', async () => {
 await database.update(schema.users).set({ businessRole: 'delivery' }).where(eq(schema.users.userId, user.id));
 try { await assert.rejects(catalog().list(user), (e: any) => e.status === 403); }
 finally { await database.update(schema.users).set({ businessRole: 'pre_sales' }).where(eq(schema.users.userId, user.id)); }
});

test('catalog excludes a published direct-tool workflow when the current contract has drifted', async () => {
 const tool = { name: 'catalog_read', description: 'Original description', parameters: { type: 'object', additionalProperties: false }, mutates: false, exfiltrates: false,
  simulationOnly: false, source: 'code' as const, capability: 'estimates:read' as const, requiresConfirmation: false, policy: DEFAULT_TOOL_POLICY_ENTRY };
 let current = tool;
 const snapshot = { schemaVersion: 1 as const, skills: [], tools: [{ stepId: 'read', contract: tool, hash: hash(tool) }] };
 const service = createWorkflowService(createWorkflowsPgRepository(database), async () => ({ context: { skills: [], tools: [{ ...tool, allowedRoles: ['pre_sales'], sandboxReadSafe: true }] }, snapshot, hash: hash(snapshot) }), user);
 let root = await service.create({ name: 'Published contract', description: '', category: 'fixture', roles: ['pre_sales'], inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
  steps: [{ id: 'read', name: 'Read', type: 'tool', toolName: tool.name, requiresConfirmation: false, inputMapping: [], onFailure: 'fail' }], outputMapping: [] });
 workflowIds.push(root.workflowId); root = await service.validate(root.workflowId, root.revision); root = await service.review(root.workflowId, root.revision, 'Catalog drift fixture'); root = await service.publish(root.workflowId, root.revision);
 const list = createExecutionCatalogService({ database, inventory, loadSkillContext: async () => ({ tools: [] }) as any,
  loadWorkflowTools: async () => [{ ...current, allowedRoles: ['pre_sales'], sandboxReadSafe: true }] });
 assert.equal((await list.list(user)).some(i => i.id === root.workflowId), true);
 current = { ...tool, description: 'Changed current description' };
 assert.equal((await list.list(user)).some(i => i.id === root.workflowId), false);
});
