import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { resolveExecutionTestDatabaseUrl } from '../../test-helpers/execution-database-guard';
import { createHarnessRuntimeRepository } from '../harness/harness-runtime.repository';
import { createHarnessRuntimeWorker, createHarnessWorkflowRegistry } from '../harness/harness-runtime.worker';
import { createBusinessSkillsWorkflow } from '../harness/business-skills.workflow';
import { createBusinessSkillsWaitService, createBusinessWorkflowWaitExecutor } from '../harness/business-skills.wait';
import { createExecutionAuthority } from './execution-authority';
import { createExecutionEmergencyRepository } from './execution-emergency';
import { createExecutionManifestService } from './execution-manifest';
import { createSkillInvocationService } from './skills.invocation';
import { createInvocationPgRepository } from './skills.invocation-pg.repository';
import { createSkillsPgRepository } from './skills-pg.repository';
import { createSkillExecutionService } from './skills.execution';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../agent/tool-policy';
import { skillDefinitionHash as hash } from './skills.hash';
import type { SkillDefinition } from './skills.types';
import type { AuthUser } from '../../types';
import { manifest as waitingManifest } from '../harness/workflows.runtime.fixture';
const pool = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 1, connectionTimeoutMillis: 1000 });
const database = drizzle(pool, { schema }); const queue = createHarnessRuntimeRepository(database);
const user = { id: randomUUID(), username: `authority-${randomUUID()}`, role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const actor = { id: user.id, username: user.username }; const roots = createSkillsPgRepository(database);
const emergency = createExecutionEmergencyRepository(database);
const payload = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const native = { name: 'read_one', description: 'Read fixture', parameters: payload, mutates: false, exfiltrates: false, simulationOnly: false,
  source: 'code' as const, sandboxReadSafe: true, capability: 'estimates:read' as const };
const definition: SkillDefinition = { name: 'Authority fixture', description: '', category: 'test', instructions: 'Frozen instructions', roles: ['pre_sales'],
  inputSchema: payload, outputSchema: payload, tools: [], references: [], examples: [], model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 } };
const input = { text: 'original' };
const policy = () => ({ schemaVersion: 1, policies: {} });
const inventory = async () => ({ registry: { get: (name: string) => name === native.name ? { ...native, execute: async () => ({}) } : undefined }, policy: policy(), tools: [] }) as any;
const authority = () => createExecutionAuthority(database, inventory);
async function start(tool = false, changes: (d: SkillDefinition) => void = () => {}) {
  const d = structuredClone(definition); if (tool) d.tools = [{ toolName: native.name, inputMapping: { text: '$.text' }, requiresConfirmation: false }]; changes(d);
  let s = await roots.create(d, actor);
  s = await roots.mutate(s.skillId, s.revision, actor, 'publish', r => { r.versions[0].status = 'published'; r.activeVersionId = r.currentVersionId; });
  const sessionId = randomUUID(); await database.insert(schema.aiSessions).values({ sessionId, ownerUserId: user.id, ownerUsername: user.username, title: 'Authority',
    domain: 'business_evaluation', workflowKey: 'temporary_chat', businessRole: 'pre_sales', status: 'temporary_chat', createdAt: new Date(), updatedAt: new Date() });
  const manifests = createExecutionManifestService({ database, loadSkillContext: async definition => ({ tools: tool ? [native] : [], snapshot: { schemaVersion: 1, references: [],
    tools: tool ? [{ native: structuredClone(native), policy: structuredClone(DEFAULT_TOOL_POLICY_ENTRY) }] : [], roles: ['ADMIN'],
    model: { providerId: 'fixture', model: 'fixed', modelSource: 'binding', credentialScope: 'ai', baseUrlDigest: hash('endpoint'), params: definition.model, capabilities: [], supportedParams: [] } } }) as any });
  const invocation = createSkillInvocationService({ queue, repository: createInvocationPgRepository(database), prepareExecution: manifests.prepareExecution });
  const accepted = await invocation.submitInvocation(user, sessionId, { submissionKey: randomUUID(), content: 'Execute', execution: { kind: 'skill', skillId: s.skillId, input } });
  const run = (await queue.findRunForOwner(accepted.data.runId, user.id))!; const manifest = (run.executionConfig as any).executionManifest;
  return { run, manifest, root: s, action: { runId: run.harnessRunId, ownerUserId: user.id, manifestHash: manifest.manifestHash, phase: 'model' as const, stepId: '$skill' } };
}
const denied = (e: any) => e.code === 'EXECUTION_AUTHORITY_DENIED';
before(async () => { await database.insert(schema.users).values({ userId: user.id, username: user.username, role: 'admin', businessRole: 'pre_sales', status: 'active', passwordHash: randomUUID(), createdAt: new Date() }); });
after(async () => { await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, user.id)); await database.delete(schema.aiSessions).where(eq(schema.aiSessions.ownerUserId, user.id)); await database.delete(schema.users).where(eq(schema.users.userId, user.id)); await pool.end(); });
test('real PG binding: owner/session/hash/step, user status and business role are mandatory', async () => {
  const f = await start(); await authority().check(f.action);
  for (const patch of [{ ownerUserId: randomUUID() }, { manifestHash: hash('forged') }, { stepId: 'foreign' }]) await assert.rejects(authority().check({ ...f.action, ...patch }), denied);
  for (const change of [{ status: 'disabled' as const }, { businessRole: 'delivery' }]) {
    await database.update(schema.users).set(change).where(eq(schema.users.userId, user.id));
    try { await assert.rejects(authority().check(f.action), denied); }
    finally { await database.update(schema.users).set({ status: 'active', businessRole: 'pre_sales' }).where(eq(schema.users.userId, user.id)); }
  }
  await database.update(schema.aiSessions).set({ ownerUserId: randomUUID() }).where(eq(schema.aiSessions.sessionId, f.run.aiSessionId!));
  try { await assert.rejects(authority().check(f.action), denied); }
  finally { await database.update(schema.aiSessions).set({ ownerUserId: user.id }).where(eq(schema.aiSessions.sessionId, f.run.aiSessionId!)); }
});
test('real PG ordinary disable preserves old Run; stop/release permanently rejects its epoch', async () => {
  const f = await start(); await database.update(schema.skillDefinitions).set({ enabled: false }).where(eq(schema.skillDefinitions.skillId, f.root.skillId));
  await authority().check(f.action); await emergency.change('skill', f.root.skillId, user, 0, 'Stop fixture', 'stop');
  await assert.rejects(authority().check(f.action), denied); await emergency.change('skill', f.root.skillId, user, 1, 'Release fixture', 'release');
  await assert.rejects(authority().check(f.action), denied);
});
test('real PG inventory has no held connection and identity changes during inventory are rejected', async () => {
  for (const change of [{ role: 'user' as const }, { status: 'disabled' as const }]) {
    const f = await start(); const checker = createExecutionAuthority(database, async () => {
      await pool.query('SELECT 1'); await database.update(schema.users).set(change).where(eq(schema.users.userId, user.id)); return inventory();
    });
    try { await assert.rejects(checker.check(f.action), denied); }
    finally { await database.update(schema.users).set({ role: 'admin', status: 'active' }).where(eq(schema.users.userId, user.id)); }
  }
});
test('real PG current Registry removal/native drift/policy/role and original allowlist remain intersected', async () => {
  const f = await start(true);
  for (const change of ['missing', 'parameters', 'capability', 'source', 'mutates', 'exfiltrates', 'disabled', 'role', 'mcpRoles']) {
    const checker = createExecutionAuthority(database, async () => {
      const current: any = { ...native }; const active: any = policy();
      if (['parameters', 'capability', 'source', 'mutates', 'exfiltrates'].includes(change)) current[change] = change === 'parameters' ? {} : change === 'capability' ? 'user:manage' : change === 'source' ? 'mcp' : true;
      if (change === 'disabled' || change === 'role') active.policies[native.name] = { ...DEFAULT_TOOL_POLICY_ENTRY, ...(change === 'disabled' ? { enabled: false } : { visibleRoles: ['DEV'] }) };
      if (change === 'mcpRoles') { current.source = 'mcp'; current.mcpAllowedRoles = []; }
      return { registry: { get: () => change === 'missing' ? undefined : current }, tools: [], policy: active } as any;
    });
    await assert.rejects(checker.check(f.action), denied);
  }
  await assert.rejects(authority().check({ ...f.action, phase: 'tool', toolName: 'new_read' }), denied);
  const restricted = await start(true, d => { d.tools[0].requiresConfirmation = true; });
  await assert.rejects(authority().check({ ...restricted.action, phase: 'tool', toolName: native.name }), denied);
  const currentAsk = createExecutionAuthority(database, async () => ({ ...await inventory(), policy: { schemaVersion: 1, policies: { [native.name]: { ...DEFAULT_TOOL_POLICY_ENTRY, approvalStrategy: 'user-confirm' } } } }));
  await assert.rejects(currentAsk.check({ ...f.action, phase: 'tool', toolName: native.name }), denied);
  await database.update(schema.users).set({ role: 'user' }).where(eq(schema.users.userId, user.id));
  try {
    const elevated = createExecutionAuthority(database, async () => ({ ...await inventory(), registry: { get: () => ({ ...native, capability: 'user:manage' }) } }));
    await assert.rejects(elevated.check(f.action), denied);
  } finally { await database.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.userId, user.id)); }
});
async function replaceManifest(f: Awaited<ReturnType<typeof start>>, update: (m: any) => void) {
  const m = structuredClone(f.manifest); update(m); const { manifestHash: _, ...body } = m; m.manifestHash = hash(body);
  await database.update(schema.harnessRuns).set({ executionConfig: { ...f.run.executionConfig as any, executionManifest: m } }).where(eq(schema.harnessRuns.harnessRunId, f.run.harnessRunId));
  return { ...f.action, manifestHash: m.manifestHash };
}
test('real PG original role capabilities and visibleRoles cannot be widened by a later role/policy change', async () => {
  for (const boundary of ['capability', 'originalRoles', 'visibleRoles', 'originalAsk']) {
    const f = await start(true); const action = await replaceManifest(f, m => {
      const snap = m.skills[0].context;
      if (boundary === 'capability') snap.tools[0].native.capability = 'user:manage';
      if (boundary === 'originalRoles') { snap.roles = ['PRE_SALES']; snap.tools[0].native.capability = 'user:manage'; }
      if (boundary === 'visibleRoles') snap.tools[0].policy.visibleRoles = ['ADMIN'];
      if (boundary === 'originalAsk') snap.tools[0].policy.approvalStrategy = 'user-confirm';
    });
    const checker = createExecutionAuthority(database, async () => ({ ...await inventory(), registry: { get: () => ({ ...native,
      capability: boundary === 'capability' || boundary === 'originalRoles' ? 'user:manage' : native.capability }) } }));
    if (boundary === 'capability' || boundary === 'visibleRoles') await database.update(schema.users).set({ role: 'user' }).where(eq(schema.users.userId, user.id));
    try { await assert.rejects(checker.check({ ...action, phase: 'tool', toolName: native.name }), denied); }
    finally { await database.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.userId, user.id)); }
  }
});
const reply = () => ({ provider: 'kimi', model: 'fixed', usage: { outputTokens: 1 }, output: input });
test('default service uses real PG admission; prepare-time stop prevents complete', async () => {
  for (const phase of ['default', 'prepareStop', 'wrongOwner', 'wrongHash']) {
    const f = await start(); let prepares = 0; let models = 0;
    const service = createSkillExecutionService({ prepareModel: async () => { prepares++; if (phase === 'prepareStop') await emergency.change('skill', f.root.skillId, user, 0, 'Stop preparation', 'stop');
      return { transportProvider: 'kimi', complete: async () => { models++; return reply(); } }; } });
    const r = await service.execute({ ...f.action, ...(phase === 'wrongOwner' ? { ownerUserId: randomUUID() } : {}), manifest: phase === 'wrongHash' ? { ...f.manifest, manifestHash: hash('wrong') } : f.manifest, input, signal: new AbortController().signal });
    assert.equal(r.status, phase === 'default' ? 'succeeded' : 'failed'); assert.equal(prepares, phase === 'wrongOwner' || phase === 'wrongHash' ? 0 : 1); assert.equal(models, phase === 'default' ? 1 : 0);
  }
});
test('real PG stop in first tool blocks second tool and subsequent model round', async () => {
  const f = await start(true); let gates = 0; let models = 0;
  const service = createSkillExecutionService({ createAuthority: authority, prepareModel: async () => ({ transportProvider: 'kimi', complete: async () => { models++; return {
    provider: 'kimi', model: 'fixed', usage: { outputTokens: 1 }, toolCalls: ['one', 'two'].map(id => ({ id, name: native.name, arguments: input })) }; } }),
    toolGate: async () => { gates++; await emergency.change('skill', f.root.skillId, user, 0, 'Stop between tools', 'stop'); return {}; } });
  const r = await service.execute({ ...f.action, manifest: f.manifest, input, signal: new AbortController().signal });
  assert.equal(r.code, 'EXECUTION_AUTHORITY_DENIED'); assert.equal(gates, 1); assert.equal(models, 1);
});
async function storeWorkflow(f: Awaited<ReturnType<typeof start>>, m: any) {
  m.target.id = randomUUID(); m.caller = f.manifest.caller; const { manifestHash: _, ...body } = m; m.manifestHash = hash(body);
  await database.insert(schema.workflowDefinitions).values({ workflowId: m.target.id, name: 'Wait authority', description: '', category: 'test', currentVersionId: m.target.versionId,
    enabled: true, archived: false, revision: 0, createdAt: new Date(), updatedAt: new Date() });
  const config = f.run.executionConfig as any; const execution = { kind: 'workflow', workflowId: m.target.id, input: m.initialInput, sources: m.sources };
  await database.update(schema.harnessRuns).set({ executionConfig: { ...config, executionManifest: m, executionAuthority: [{ kind: 'workflow', id: m.target.id, epoch: 0 }] },
    metadata: { invocationFingerprint: hash({ sessionId: f.run.aiSessionId, content: config.content, execution }) } }).where(eq(schema.harnessRuns.harnessRunId, f.run.harnessRunId));
}
test('direct Workflow tools have no frozen original-role grant and cannot dispatch or resume', async () => {
  const f = await start(); const m = waitingManifest(d => { d.steps = d.steps.filter(s => s.type === 'tool'); d.steps[0].inputMapping = [{ target: 'text', source: { kind: 'path', path: '$.input.text' } }];
    d.outputMapping = [{ target: 'text', source: { kind: 'path', path: '$.input.text' } }]; });
  await storeWorkflow(f, m);
  await emergency.assertRunAdmission(f.run.harnessRunId, user.id);
  for (const phase of ['tool', 'resume'] as const) await assert.rejects(authority().check({ ...f.action, phase, manifestHash: m.manifestHash, stepId: 't', toolName: 'native_write' }), denied);
});
test('fresh Worker after saved answer uses default real authority and rejects stop or revoked owner before executor', async () => {
  for (const reason of ['stop', 'revoke']) {
    const f = await start(); const m = waitingManifest(d => { d.steps = d.steps.filter(s => s.type === 'userInput'); d.steps[0].inputMapping = [{ target: 'text', source: { kind: 'path', path: '$.input.text' } }]; d.outputMapping = [{ target: 'text', source: { kind: 'path', path: '$.steps.u.output.text' } }]; });
    await storeWorkflow(f, m);
    const waits = createBusinessSkillsWaitService(database); let executions = 0;
    const runWorker = async () => { const executor = createBusinessWorkflowWaitExecutor(waits); const registry = createHarnessWorkflowRegistry([createBusinessSkillsWorkflow({ executor: async req => { executions++; return executor(req); } })]);
      await createHarnessRuntimeWorker({ repository: queue, registry, workerId: randomUUID() }).runNextAttempt(); };
    // Earlier tests leave queued runs; isolate this selected Run as the only claimable one.
    await database.update(schema.harnessRuns).set({ status: 'failed' }).where(eq(schema.harnessRuns.ownerUserId, user.id));
    await database.update(schema.harnessRuns).set({ status: 'queued' }).where(eq(schema.harnessRuns.harnessRunId, f.run.harnessRunId));
    await runWorker(); assert.equal(executions, 1);
    const events = await queue.listRunEventsAfter({ runId: f.run.harnessRunId, afterSequence: 0, limit: 100 }); const wait = events.find(e => e.eventType === 'workflow.awaiting_input')!.payload as any;
    await waits.answer({ runId: f.run.harnessRunId, sessionId: f.run.aiSessionId!, requestedBy: user.id, actionId: wait.actionId, kind: wait.kind, stepId: wait.stepId, contentHash: wait.contentHash, value: { text: 'saved answer' } });
    if (reason === 'stop') await emergency.change('workflow', m.target.id, user, 0, 'Stop after answer', 'stop');
    else await database.update(schema.users).set({ status: 'disabled' }).where(eq(schema.users.userId, user.id));
    try { await runWorker(); assert.equal(executions, 1); assert.equal((await queue.findRunForOwner(f.run.harnessRunId, user.id))!.status, 'failed'); }
    finally { await database.update(schema.users).set({ status: 'active' }).where(eq(schema.users.userId, user.id)); }
  }
});

test('real PG stop between model rounds blocks the following round before another prepare', async () => {
  const f = await start(true); let prepares = 0; let models = 0;
  const service = createSkillExecutionService({ createAuthority: authority, prepareModel: async () => { prepares++; return { transportProvider: 'kimi', complete: async () => { models++; return {
    provider: 'kimi', model: 'fixed', usage: { outputTokens: 1 }, toolCalls: [{ id: 'one', name: native.name, arguments: input }] }; } }; },
    toolGate: async () => { await emergency.change('skill', f.root.skillId, user, 0, 'Stop after round', 'stop'); return {}; } });
  const r = await service.execute({ ...f.action, manifest: f.manifest, input, signal: new AbortController().signal });
  assert.equal(r.code, 'EXECUTION_AUTHORITY_DENIED'); assert.equal(prepares, 1); assert.equal(models, 1);
});

test('real PG role downgrade during preparation prevents model completion even with shared read capability', async () => {
  const f = await start(); let models = 0;
  const service = createSkillExecutionService({ prepareModel: async () => {
    await database.update(schema.users).set({ role: 'user' }).where(eq(schema.users.userId, user.id));
    return { transportProvider: 'kimi', complete: async () => { models++; return reply(); } };
  } });
  try {
    const r = await service.execute({ ...f.action, manifest: f.manifest, input, signal: new AbortController().signal });
    assert.equal(r.code, 'EXECUTION_AUTHORITY_DENIED'); assert.equal(models, 0);
  } finally { await database.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.userId, user.id)); }
});

test('real PG stop or stop+release during inventory cannot pass final admission', async () => {
  for (const release of [false, true]) {
    const f = await start(); const checker = createExecutionAuthority(database, async () => {
      await emergency.change('skill', f.root.skillId, user, 0, 'Stop inventory', 'stop');
      if (release) await emergency.change('skill', f.root.skillId, user, 1, 'Release inventory', 'release');
      return inventory();
    });
    await assert.rejects(checker.check(f.action), denied);
  }
});
test('real PG MCP advertisement requires current manually allowed roles; MCP execution remains closed', async () => {
  const f = await start(true); const action = await replaceManifest(f, m => {
    m.skills[0].context.tools[0].native.source = 'mcp'; m.skills[0].context.tools[0].native.simulationOnly = true;
  });
  for (const allowed of [[], ['DEV'], ['ADMIN']]) {
    const checker = createExecutionAuthority(database, async () => ({ ...await inventory(), registry: { get: () => ({ ...native, source: 'mcp', mcpAllowedRoles: allowed }) } }));
    if (allowed.includes('ADMIN')) { await checker.check(action); await assert.rejects(checker.check({ ...action, phase: 'tool', toolName: native.name }), denied); }
    else await assert.rejects(checker.check(action), denied);
  }
});

test('one service executes two distinct real Runs with separate identity fences', async () => {
  let models = 0; const service = createSkillExecutionService({ prepareModel: async () => ({ transportProvider: 'kimi', complete: async () => { models++; return reply(); } }) });
  for (let i = 0; i < 2; i++) {
    const f = await start(); const r = await service.execute({ ...f.action, manifest: f.manifest, input, signal: new AbortController().signal });
    assert.equal(r.status, 'succeeded');
  }
  assert.equal(models, 2);
});
test('authority instance cannot be reused as permission for another persisted Run', async () => {
  const a = await start(); const b = await start(); const checker = authority(); await checker.check(a.action);
  await assert.rejects(checker.check(b.action), denied);
});
