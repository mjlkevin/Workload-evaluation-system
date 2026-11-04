import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentTool } from '../../agent/agent.types';
import { ToolRegistry } from '../../agent/tool-registry';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../agent/tool-policy';
import type { AuthUser, ToolPolicyConfig } from '../../types';
import { readBusinessSkillsHostState } from '../harness/business-skills.host-state';
import { createWorkflowRuntime } from '../harness/workflows.runtime-adapter';
import { manifest, single, path, payload, hash } from '../harness/workflows.runtime.fixture';
import { frozenManifest } from '../harness/business-skills.test-fixture';
import { createWorkflowContextLoader } from '../workflows/workflows.context';
import { validateWorkflowDefinition } from '../workflows/workflows.validation';
import type { WorkflowDefinition } from '../workflows/workflows.types';
import { createExecutionManifestService, readPersistedExecutionManifest } from './execution-manifest';
import type { ExecutionManifest, ExecutionSnapshot } from './execution-manifest.types';
import { validateFrozenExecutionTools } from './execution-authority';
import { skillToolContract, createSkillReadExecutor } from './skills.context';
import { createResumableSkillExecutor } from './skills.execution-resumable';
import { createSkillExecutionService } from './skills.execution';
import { createSkillSandbox } from './skills.sandbox';

// Trusted server fixtures only: no provider, real native tool, DB or acceptance claim.
const user = { id: 'owner', username: 'Owner', status: 'active', role: 'admin', businessRole: 'pre_sales' } as AuthUser;
const native: AgentTool = { name: 'native_write', description: 'Frozen native contract', parameters: payload,
  capability: 'estimates:read', source: 'code', sandboxReadSafe: true, mutates: false, exfiltrates: false, simulationOnly: false,
  execute: async () => ({ text: 'native result' }) };
const typed = () => ({ ...native, outputSchema: structuredClone(payload) });
const inventory = (tool: AgentTool = typed()) => {
  const registry = new ToolRegistry(); registry.register(tool);
  return { registry, tools: [tool], policy: { schemaVersion: 1, policies: { [tool.name]: structuredClone(DEFAULT_TOOL_POLICY_ENTRY) } } as ToolPolicyConfig };
};
const rehash = (m: ExecutionManifest) => { const { manifestHash: _, ...body } = m; m.manifestHash = hash(body); return m; };
function workflow(withSchema = true) {
  return manifest((d, m) => {
    const tool = m.tools[0].contract as any;
    Object.assign(tool, { mutates: false, requiresConfirmation: false });
    if (withSchema) tool.outputSchema = structuredClone(payload);
    const t = d.steps[3]; t.inputMapping = [path('text', '$.input.text')];
    if (t.type === 'tool') t.requiresConfirmation = false;
    d.steps = [t, d.steps[0], d.steps[1]];
    d.steps[1].inputMapping = [path('text', '$.steps.t.output.text')];
    d.outputMapping = [path('text', '$.steps.t.output.text')];
    d.steps[0].branches = [{ when: [{ path: '$.steps.t.output.text', op: 'eq', value: 'stop' }], target: '$end' }];
    d.steps[2].inputMapping = [path('text', '$.steps.s.output.text')];
  });
}
const ready = (d: any) => { assert.equal(d.kind, 'ready'); return d; };
const settle = (r: ReturnType<typeof createWorkflowRuntime>, d: any, output: unknown) => r.settle(d.state, { operationId: ready(d).command.operationId, output });
function metadata(tool: AgentTool) {
  return { ...skillToolContract(tool), source: tool.source ?? 'code', capability: tool.capability,
    requiresConfirmation: false, policy: structuredClone(DEFAULT_TOOL_POLICY_ENTRY), sandboxReadSafe: true, allowedRoles: ['pre_sales'] };
}
function toolOnly() {
  return manifest((d, m) => { d.steps = [d.steps[3]]; d.steps[0].inputMapping = [path('text', '$.input.text')];
    d.outputSchema = { type: 'object', additionalProperties: false }; d.outputMapping = [];
    const { allowedRoles: _, sandboxReadSafe: __, ...contract } = metadata(typed());
    Object.assign(m.tools[0].contract, contract); if (d.steps[0].type === 'tool') d.steps[0].requiresConfirmation = false; });
}

test('native contract omits legacy schema property and includes only code-owned typed schema', () => {
  const old = { name: native.name, description: native.description, parameters: payload, mutates: false, exfiltrates: false, simulationOnly: false };
  assert.deepEqual(skillToolContract(native), old); assert.equal(hash(skillToolContract(native)), hash(old));
  assert.deepEqual((skillToolContract(typed()) as any).outputSchema, payload);
  assert.equal('outputSchema' in skillToolContract({ ...typed(), name: 'mcp__server__read', source: 'mcp' }), false);
});
test('typed native output maps to exact child Skill, user input and final output; replay uses frozen schema', () => {
  const m = workflow(); const r = createWorkflowRuntime(m, 'typed'); let d = ready(r.next());
  d = ready(settle(r, d, { text: 'native result' })); assert.equal(d.command.type, 'skill'); assert.deepEqual(d.command.input, { text: 'native result' });
  assert.deepEqual(d.state.receipts[0].output, { text: 'native result' }); assert.equal('opaqueResult' in d.state.receipts[0], false);
  d = ready(settle(r, d, { text: 'skill result' })); assert.deepEqual(d.command.input, { text: 'skill result' });
  d = settle(r, d, { text: 'user result' }); assert.equal(d.kind, 'completed'); assert.deepEqual(d.output, { text: 'native result' });
  assert.deepEqual(createWorkflowRuntime(JSON.parse(JSON.stringify(m)), 'typed').next(d.state), d);
});
test('typed native output controls branch only after successful validation', () => {
  const r = createWorkflowRuntime(workflow(), 'branch'); const d = r.next();
  assert.throws(() => settle(r, d, { text: 7 }), { message: 'WORKFLOW_RUNTIME_INVALID_OUTPUT' });
  assert.deepEqual(r.next(), d); const done = settle(r, d, { text: 'stop' });
  assert.equal(done.kind, 'completed'); assert.deepEqual(done.output, { text: 'stop' });
  const bad = structuredClone(done.state); (bad.receipts[0] as any).output.text = 7;
  assert.throws(() => r.next(bad), { message: 'WORKFLOW_RUNTIME_INVALID_STATE' });
});
test('untyped legacy receipts stay opaque and cannot gain trusted mappings from current schema', () => {
  assert.throws(() => createWorkflowRuntime(workflow(false), 'legacy'), { message: 'WORKFLOW_RUNTIME_INVALID_MANIFEST' });
  const m = toolOnly(); delete (m.tools[0].contract as any).outputSchema; m.tools[0].hash = hash(m.tools[0].contract);
  m.publishedDependencies!.tools = structuredClone(m.tools); rehash(m);
  const before = JSON.stringify(m); const r = createWorkflowRuntime(m, 'legacy'); const d = settle(r, r.next(), { anything: 7 });
  assert.deepEqual((d.state.receipts[0] as any).opaqueResult, { anything: 7 }); assert.equal('output' in d.state.receipts[0], false);
  assert.equal(JSON.stringify(readPersistedExecutionManifest(m)), before); assert.deepEqual(createWorkflowRuntime(m, 'legacy').next(d.state), d);
});
test('publication freezes schema and preparation compares the exact published schema', async () => {
  const m = toolOnly(), definition = m.target.definition as WorkflowDefinition;
  const loader = createWorkflowContextLoader({ getTools: async () => [metadata(typed())] as never });
  const resolved = await loader(definition, user); assert.deepEqual((resolved.snapshot.tools[0].contract as any).outputSchema, payload);
  const contract = resolved.snapshot.tools[0].contract; assert.equal(resolved.snapshot.tools[0].hash, hash(contract));
  const snapshot: ExecutionSnapshot = { kind: 'workflow', target: m.target, skills: [], publishedDependencies: resolved.snapshot };
  const prepare = async (tool: AgentTool) => {
    const service = createExecutionManifestService({ database: { transaction: async (fn: any) => fn({}) } as never,
      repository: { read: async () => structuredClone(snapshot), verifyCaller: async () => {} }, assetRepository: { read: async () => [] } as never,
      prepareAuthority: async (_uris, resolve) => ({ value: await resolve(), verify: async () => {} }), loadWorkflowTools: async () => [metadata(tool)] as never });
    const pending = await service.prepareExecution({ kind: 'workflow', workflowId: 'workflow', input: { text: 'original' } }, user);
    return pending.resolveInTransaction({} as never);
  };
  const prepared = await prepare(typed()); assert.deepEqual((prepared.tools[0].contract as any).outputSchema, payload);
  const changed = { ...typed(), outputSchema: { type: 'object' } };
  await assert.rejects(prepare(changed), (e: any) => e.code === 'EXECUTION_CONTEXT_CHANGED');
  assert.notEqual((await createWorkflowContextLoader({ getTools: async () => [metadata(changed)] as never })(definition, user)).hash, resolved.hash);
});
test('typed schema cannot bypass current authority, safety or confirmation and schema drift is denied', () => {
  const m = toolOnly() as any; m.schemaVersion = 2; m.toolAuthority = { schemaVersion: 1, roles: ['ADMIN'], tools: [{ stepId: 't', sandboxReadSafe: true }] }; rehash(m);
  const check = (tool: AgentTool = typed(), phase: 'resume' | 'tool' = 'tool') => validateFrozenExecutionTools(m, { role: 'admin' }, inventory(tool), { phase, stepId: 't', toolName: native.name });
  assert.doesNotThrow(() => check());
  for (const tool of [native, { ...typed(), outputSchema: { type: 'object' } }, { ...typed(), mutates: true }, { ...typed(), exfiltrates: true }, { ...typed(), sandboxReadSafe: false }])
    assert.throws(() => check(tool), (e: any) => e.code === 'EXECUTION_AUTHORITY_DENIED');
  const ctx = { skills: [], tools: [{ ...metadata(typed()), mutates: true }] };
  assert.throws(() => validateWorkflowDefinition(m.target.definition, ctx));
});
for (const schema of [{ type: 'object', anyOf: [] }, { type: 'object', $ref: 'https://untrusted.invalid/schema' }, JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}')])
  test(`unsupported or malicious native output schema fails frozen validation: ${JSON.stringify(schema)}`, () => {
    const m = toolOnly(); (m.tools[0].contract as any).outputSchema = schema; m.tools[0].hash = hash(m.tools[0].contract);
    m.publishedDependencies!.tools = structuredClone(m.tools); rehash(m); assert.throws(() => readPersistedExecutionManifest(m));
  });
test('admin tool step cannot declare output schema and MCP metadata cannot become trusted native output', () => {
  const m = toolOnly(); const d = m.target.definition as WorkflowDefinition;
  assert.throws(() => validateWorkflowDefinition({ ...d, steps: [{ ...d.steps[0], outputSchema: payload }] }, { skills: [], tools: [metadata(typed())] }));
  const only = toolOnly(); (only.tools[0].contract as any).source = 'mcp'; only.tools[0].hash = hash(only.tools[0].contract);
  only.publishedDependencies!.tools = structuredClone(only.tools); rehash(only); assert.throws(() => readPersistedExecutionManifest(only));
});
test('shared read executor rejects invalid typed native output before returning it', async () => {
  const tool = { ...typed(), execute: async () => ({ text: 9 }) }; const now = inventory(tool);
  const read = createSkillReadExecutor(user, [skillToolContract(tool)], async () => now, async () => user);
  await assert.rejects(read(tool.name, { text: 'input' }, new AbortController().signal), { message: 'NATIVE_OUTPUT_SCHEMA_FAILED' });
});
function root() {
  const m = frozenManifest(); const s = m.skills[0];
  s.definition.tools = [{ toolName: native.name, inputMapping: { text: '$.text' }, requiresConfirmation: false }];
  s.context.tools = [{ native: { ...skillToolContract(typed()), source: 'code', capability: native.capability, sandboxReadSafe: true }, policy: structuredClone(DEFAULT_TOOL_POLICY_ENTRY) }];
  s.hash = hash(s.definition); m.target.definition = structuredClone(s.definition); m.target.hash = s.hash; return rehash(m);
}
test('resumable root Skill validates typed native result and rejects corrupted typed result on recovery', async () => {
  const m = root(); const request = { runId: 'run', ownerUserId: 'owner', manifest: m, stepId: '$skill', operationId: 'operation', iteration: 1, input: m.initialInput, signal: new AbortController().signal };
  const ports = { complete: async () => ({ provider: 'fixture', model: 'frozen', usage: { outputTokens: 1 }, toolCalls: [{ id: 'call', name: native.name, arguments: { text: 'original' } }] }), tool: async () => ({ kind: 'completed' as const, result: { text: 9 } }) };
  const executor = createResumableSkillExecutor(ports); const first = await executor.advance(request);
  await assert.rejects(executor.advance({ ...request, state: first.state }), (e: any) => e.code === 'NATIVE_OUTPUT_SCHEMA_FAILED');
  const valid = await createResumableSkillExecutor({ ...ports, tool: async () => ({ kind: 'completed', result: { text: 'ok' } }) }).advance({ ...request, state: first.state });
  assert.deepEqual(valid.state.toolResults[0].result, { text: 'ok' }); const bad = structuredClone(valid.state); bad.toolResults[0].result = { text: 9 };
  await assert.rejects(executor.advance({ ...request, state: bad }), (e: any) => e.code === 'EXECUTION_STATE_INVALID');
});
test('root Skill and trial reject schema-invalid typed read results before passing them to the model', async () => {
  const m = root(); const definition = m.skills[0].definition;
  const call = { id: 'call', name: native.name, arguments: { text: 'original' } }; let modelCalls = 0;
  const execution = createSkillExecutionService({ createAuthority: () => ({ check: async () => {} }),
    prepareModel: async () => ({ transportProvider: 'fixture', complete: async () => { modelCalls++; return { provider: 'fixture', model: 'frozen', usage: { outputTokens: 1 }, toolCalls: [call] }; } }),
    toolGate: async () => ({ text: 9 }) });
  const result = await execution.execute({ runId: 'run', ownerUserId: 'owner', manifest: m, stepId: '$skill', input: m.initialInput, signal: new AbortController().signal });
  assert.equal(result.code, 'NATIVE_OUTPUT_SCHEMA_FAILED'); assert.equal(modelCalls, 1);
  const sandbox = createSkillSandbox(definition, [skillToolContract(typed())], async () => ({ text: 9 }));
  await assert.rejects(sandbox.runTool(call, m.initialInput, new AbortController().signal), (e: any) => e.code === 'NATIVE_OUTPUT_SCHEMA_FAILED');
});

test('completed child recovery rejects corrupt typed native history even when its final output is valid', async () => {
 const m = single((_d, m) => {
  const rootSkill = root().skills[0], child = m.skills[0];
  child.definition.tools = structuredClone(rootSkill.definition.tools);
  child.context.tools = structuredClone(rootSkill.context.tools);
 });
 const runtime = createWorkflowRuntime(m, 'completed-child'), decision = ready(runtime.next()), command = decision.command;
 const request = { runId: 'completed-child', ownerUserId: m.caller.id, manifest: m, stepId: command.stepId,
  operationId: command.operationId, iteration: command.iteration, input: command.input, signal: new AbortController().signal };
 const executor = createResumableSkillExecutor({
  complete: async r => ({ provider: 'fixture', model: 'frozen', usage: { outputTokens: 1 },
   ...(r.toolResults.length ? { output: { text: 'valid final output' } } : { toolCalls: [{ id: 'call', name: native.name, arguments: { text: 'original' } }] }) }),
  tool: async () => ({ kind: 'completed', result: { text: 'valid native output' } }) });
 let advanced = await executor.advance(request);
 advanced = await executor.advance({ ...request, state: advanced.state });
 advanced = await executor.advance({ ...request, state: advanced.state });
 assert.equal(advanced.state.phase, 'completed');
 const state = { schemaVersion: 1 as const, kind: 'workflow' as const, workflow: decision.state, skill: advanced.state };
 assert.deepEqual(readBusinessSkillsHostState(state, m, request.runId), state);
 const corrupt = structuredClone(state); corrupt.skill.toolResults[0].result = { text: 9 };
 assert.deepEqual(corrupt.skill.output, { text: 'valid final output' });
 assert.throws(() => readBusinessSkillsHostState(corrupt, m, request.runId), { message: 'BUSINESS_SKILLS_HOST_STATE_INVALID' });
});
