import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ToolRegistry } from '../../agent/tool-registry';
import type { AgentTool } from '../../agent/agent.types';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../agent/tool-policy';
import type { AuthUser, ToolPolicyConfig, ToolPolicyEntry } from '../../types';
import type { WorkflowDefinition } from '../workflows/workflows.types';
import type { SkillDefinition } from './skills.types';
import { createExecutionManifestService, readPersistedExecutionManifest } from './execution-manifest';
import type { ExecutionManifest, ExecutionSnapshot } from './execution-manifest.types';
import { validateFrozenExecutionTools } from './execution-authority';
import { skillDefinitionHash as hash } from './skills.hash';
import { skillToolContract } from './skills.context';

const user = { id: 'owner', username: 'Owner', status: 'active', role: 'admin', businessRole: 'pre_sales' } as AuthUser;
const schema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const readTool: AgentTool = { name: 'read_native', description: 'Read local record', parameters: schema,
  capability: 'estimates:read', mutates: false, exfiltrates: false, sandboxReadSafe: true, source: 'code',
  execute: async () => { throw new Error('authority checks must never dispatch'); } };
const denied = (error: any) => error.code === 'EXECUTION_AUTHORITY_DENIED';
function rehash(manifest: ExecutionManifest) {
  const { manifestHash: _, ...body } = manifest; return { ...body, manifestHash: hash(body) };
}
function inventory(tool = readTool, policy: ToolPolicyEntry = DEFAULT_TOOL_POLICY_ENTRY) {
  const registry = new ToolRegistry(); registry.register(tool);
  return { registry, tools: [tool], policy: { schemaVersion: 1, policies: { [tool.name]: structuredClone(policy) } } as ToolPolicyConfig };
}
async function prepare(options: { tool?: AgentTool; actor?: AuthUser; policy?: ToolPolicyEntry; confirm?: boolean; missingSafety?: boolean; two?: boolean; child?: boolean } = {}) {
  const tool = options.tool ?? readTool; const actor = options.actor ?? user;
  const policy = structuredClone(options.policy ?? DEFAULT_TOOL_POLICY_ENTRY);
  const contract = { ...skillToolContract(tool), source: tool.source ?? 'code', capability: tool.capability,
    requiresConfirmation: options.confirm ?? Boolean(tool.mutates || tool.exfiltrates || tool.source === 'mcp' || policy.approvalStrategy === 'user-confirm'), policy };
  const ids = options.two ? ['first', 'second'] : ['first'];
  const definition: WorkflowDefinition = { name: 'Native workflow', description: '', category: 'test', roles: ['pre_sales'], inputSchema: schema,
    outputSchema: { type: 'object' }, steps: ids.map(id => ({ id, name: id, type: 'tool', toolName: tool.name,
      requiresConfirmation: contract.requiresConfirmation, inputMapping: [{ target: 'text', source: { kind: 'path', path: '$.input.text' } }], onFailure: 'fail' })), outputMapping: [] };
  const child: SkillDefinition = { name: 'Child', description: '', category: 'test', roles: ['pre_sales'], instructions: 'Respond', inputSchema: schema,
    outputSchema: { type: 'object' }, model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 }, references: [], tools: [], examples: [] };
  const childContext = { schemaVersion: 1 as const, references: [], tools: [], roles: ['ADMIN' as const],
    model: { providerId: 'provider', model: 'model', modelSource: 'binding' as const, credentialScope: 'scope', baseUrlDigest: hash('endpoint'), params: child.model, capabilities: [], supportedParams: [] } };
  if (options.child) definition.steps.push({ id: 'child', name: 'Child', type: 'skill', skillId: 'child-id', skillVersionId: 'child-v1',
    inputMapping: [{ target: 'text', source: { kind: 'path', path: '$.input.text' } }], onFailure: 'fail' });
  const snapshot: ExecutionSnapshot = { kind: 'workflow', target: { id: 'workflow', versionId: 'published-v1', hash: hash(definition), definition },
    skills: options.child ? [{ stepId: 'child', skillId: 'child-id', versionId: 'child-v1', hash: hash(child), definition: child }] : [],
    publishedDependencies: { schemaVersion: 1, skills: options.child ? [{ stepId: 'child', skillId: 'child-id', skillVersionId: 'child-v1', hash: hash(child), context: childContext }] : [],
      tools: ids.map(stepId => ({ stepId, contract, hash: hash(contract) })) } };
  const metadata = { ...contract, allowedRoles: ['pre_sales'], ...(options.missingSafety ? {} : { sandboxReadSafe: tool.sandboxReadSafe === true }) };
  const service = createExecutionManifestService({ database: { transaction: async (fn: any) => fn({}) } as never,
    repository: { read: async () => structuredClone(snapshot), verifyCaller: async () => {} },
    prepareAuthority: async (_uris, resolve) => ({ value: await resolve(), verify: async () => {} }),
    loadSkillContext: async () => ({ snapshot: childContext, tools: [] }) as never,
    loadWorkflowTools: async () => [metadata] as never });
  const pending = await service.prepareExecution({ kind: 'workflow', workflowId: 'workflow', input: { text: 'hello' } }, actor);
  return pending.resolveInTransaction({} as never);
}
function check(manifest: ExecutionManifest, phase: 'resume' | 'tool' | 'model' | 'prepare-tool' = 'resume', now = inventory(), role = 'admin', stepId = 'first', toolName = readTool.name) {
  // The new phase checks preparation only. No checker injection or dispatch override is involved.
  return validateFrozenExecutionTools(manifest, { role }, now, { phase, stepId, toolName });
}

test('safe direct native read resumes and dispatches with real original role evidence', async () => {
  const manifest = await prepare();
  assert.doesNotThrow(() => check(manifest));
  assert.doesNotThrow(() => check(manifest, 'tool'));
  assert.equal(manifest.schemaVersion, 2);
  assert.deepEqual((manifest as any).toolAuthority, { schemaVersion: 1, roles: ['ADMIN'], tools: [{ stepId: 'first', sandboxReadSafe: true }] });
  assert.deepEqual(readPersistedExecutionManifest(JSON.parse(JSON.stringify(manifest))), manifest);
  assert.deepEqual(manifest.tools, manifest.publishedDependencies!.tools);
  assert.equal(Object.prototype.hasOwnProperty.call(manifest.tools[0].contract, 'sandboxReadSafe'), false);
});
test('legacy direct-tool manifests remain readable but cannot acquire roles from current identity', async () => {
  const manifest: any = await prepare(); manifest.schemaVersion = 1; delete manifest.toolAuthority;
  const legacy = readPersistedExecutionManifest(rehash(manifest));
  assert.throws(() => check(legacy), denied); assert.throws(() => check(legacy, 'tool'), denied);
  assert.throws(() => check(legacy, 'prepare-tool'), denied);
});
test('original ADMIN evidence is captured from real role, independent of business role', async () => {
  const manifest = await prepare(); assert.equal(manifest.caller.businessRole, 'pre_sales');
  assert.deepEqual((manifest as any).toolAuthority.roles, ['ADMIN']);
  const ordinary = await prepare({ actor: { ...user, role: 'user' } });
  assert.deepEqual((ordinary as any).toolAuthority.roles, ['PRE_SALES']);
});
test('missing Registry safety metadata is never filled in as true or false', async () => {
  await assert.rejects(prepare({ missingSafety: true }));
});
for (const mutate of [
  (m: any) => { delete m.toolAuthority; },
  (m: any) => { m.toolAuthority.schemaVersion = 2; },
  (m: any) => { m.toolAuthority.roles = []; },
  (m: any) => { m.toolAuthority.roles = ['admin']; },
  (m: any) => { m.toolAuthority.roles = ['ADMIN', 'ADMIN']; },
  (m: any) => { m.toolAuthority.extra = true; },
  (m: any) => { m.toolAuthority.tools = []; },
  (m: any) => { m.toolAuthority.tools.push(structuredClone(m.toolAuthority.tools[0])); },
  (m: any) => { m.toolAuthority.tools[0].stepId = 'phantom'; },
  (m: any) => { delete m.toolAuthority.tools[0].sandboxReadSafe; },
  (m: any) => { m.toolAuthority.tools[0].sandboxReadSafe = 'true'; },
  (m: any) => { m.toolAuthority.tools[0].extra = true; },
  (m: any) => { m.schemaVersion = 1; },
]) test(`strict frozen direct-tool evidence rejects malformed shape ${mutate.toString()}`, async () => {
  const bad = await prepare(); mutate(bad); assert.throws(() => readPersistedExecutionManifest(rehash(bad)));
});
test('original role and safety evidence are covered by manifest checksum', async () => {
  for (const mutate of [(m: any) => { m.toolAuthority.roles = ['PRE_SALES']; }, (m: any) => { m.toolAuthority.tools[0].sandboxReadSafe = false; }]) {
    const bad = await prepare(); mutate(bad); assert.throws(() => readPersistedExecutionManifest(bad));
  }
});
test('each repeated native tool binds its own unique Workflow step', async () => {
  const manifest = await prepare({ two: true });
  assert.equal((manifest as any).toolAuthority.tools.length, 2);
  assert.doesNotThrow(() => check(manifest, 'tool', inventory(), 'admin', 'second'));
  for (const [stepId, toolName] of [['phantom', readTool.name], ['first', 'wrong'], ['', readTool.name]])
    assert.throws(() => check(manifest, 'tool', inventory(), 'admin', stepId, toolName), denied);
  assert.throws(() => check(manifest, 'model'), denied);
});
test('current role loss and missing original capability each deny native tool preparation', async () => {
  const restricted = { ...readTool, capability: 'system:manage' as const };
  const manifest = await prepare({ tool: restricted });
  assert.throws(() => check(manifest, 'prepare-tool', inventory(restricted), 'user'), denied);
  const originalNoGrant = await prepare({ tool: restricted, actor: { ...user, role: 'user' } });
  assert.throws(() => check(originalNoGrant, 'prepare-tool', inventory(restricted)), denied);
  assert.throws(() => check(manifest, 'resume', inventory(restricted), 'invented'), denied);
});
for (const change of [
  { description: 'changed contract' }, { parameters: { type: 'object' } }, { mutates: true }, { exfiltrates: true },
  { capability: 'system:manage' }, { sandboxReadSafe: false }, { source: 'mcp', mcpAllowedRoles: ['ADMIN'] },
]) test(`current native contract/source/safety drift denies ${JSON.stringify(change)}`, async () => {
  const manifest = await prepare(); const changed = { ...readTool, ...change } as AgentTool;
  // Registry still resolves the frozen name; the authority must compare source as well.
  const now = inventory();
  const current = { ...now, registry: { get: () => changed } as unknown as ToolRegistry };
  assert.throws(() => check(manifest, 'resume', current), denied);
});
test('original and current policy restrictions both apply to original and current roles', async () => {
  const manifest = await prepare();
  for (const policy of [{ ...DEFAULT_TOOL_POLICY_ENTRY, enabled: false }, { ...DEFAULT_TOOL_POLICY_ENTRY, visibleRoles: ['DEV'] as any }])
    assert.throws(() => check(manifest, 'resume', inventory(readTool, policy)), denied);
  const restricted = await prepare({ policy: { ...DEFAULT_TOOL_POLICY_ENTRY, visibleRoles: ['DEV'] } });
  assert.throws(() => check(restricted), denied);
  const ordinary = await prepare({ actor: { ...user, role: 'user' } });
  assert.throws(() => check(ordinary, 'resume', inventory(readTool, { ...DEFAULT_TOOL_POLICY_ENTRY, visibleRoles: ['ADMIN'] })), denied);
  assert.throws(() => check(manifest, 'resume', { ...inventory(), registry: new ToolRegistry(), tools: [] }), denied);
});
test('write preparation checks authority without granting generic tool dispatch', async () => {
  const write = { ...readTool, name: 'write_native', capability: 'estimates:write' as const, mutates: true, sandboxReadSafe: false };
  const manifest = await prepare({ tool: write });
  assert.doesNotThrow(() => check(manifest, 'resume', inventory(write), 'admin', 'first', write.name));
  assert.doesNotThrow(() => check(manifest, 'prepare-tool', inventory(write), 'admin', 'first', write.name));
  assert.throws(() => check(manifest, 'tool', inventory(write), 'admin', 'first', write.name), denied);
});
for (const mode of ['confirmation', 'policy', 'exfiltration', 'unsafe', 'mcp']) test(`generic native tool dispatch denies ${mode}`, async () => {
  const tool: AgentTool = { ...readTool, ...(mode === 'exfiltration' ? { exfiltrates: true } : {}),
    ...(mode === 'unsafe' ? { sandboxReadSafe: false } : {}),
    ...(mode === 'mcp' ? { name: 'mcp__fixture__read', source: 'mcp', capability: 'mcp:invoke', mcpAllowedRoles: ['ADMIN'] } : {}) };
  const policy: ToolPolicyEntry = { ...DEFAULT_TOOL_POLICY_ENTRY, ...(mode === 'policy' ? { approvalStrategy: 'user-confirm' as const } : {}) };
  const manifest = await prepare({ tool, policy, ...(mode === 'confirmation' ? { confirm: true } : {}) });
  assert.doesNotThrow(() => check(manifest, 'prepare-tool', inventory(tool, policy), 'admin', 'first', tool.name));
  assert.throws(() => check(manifest, 'tool', inventory(tool, policy), 'admin', 'first', tool.name), denied);
});
test('current confirmation policy prevents a previously safe direct read dispatch', async () => {
  const manifest = await prepare(); const policy = { ...DEFAULT_TOOL_POLICY_ENTRY, approvalStrategy: 'user-confirm' as const };
  assert.throws(() => check(manifest, 'tool', inventory(readTool, policy)), denied);
});
test('Workflow model phase checks only the selected frozen child, including legacy manifests', async () => {
  const manifest = await prepare({ child: true }); const empty = { ...inventory(), registry: new ToolRegistry(), tools: [] };
  assert.doesNotThrow(() => check(manifest, 'model', empty, 'admin', 'child'));
  const legacy: any = structuredClone(manifest); legacy.schemaVersion = 1; delete legacy.toolAuthority;
  assert.doesNotThrow(() => check(readPersistedExecutionManifest(rehash(legacy)), 'model', empty, 'admin', 'child'));
  assert.throws(() => check(manifest, 'model', empty, 'admin', 'first'), denied);
});
