import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
const fixtureCredential = randomUUID();
import { createSkillExecutionService } from './skills.execution';
import { prepareFrozenSkillModel } from './skills.execution-model';
import { skillDefinitionHash as hash } from './skills.hash';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../agent/tool-policy';
import type { ExecutionManifest } from './execution-manifest.types';
import type { SkillDefinition } from './skills.types';
import { KimiProvider } from '../../ai/provider/kimi-provider';
const input = { text: 'actual business' };
const schema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const outputSchema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
const native = { name: 'read_one', description: 'Frozen tool', parameters: schema, mutates: false, exfiltrates: false, simulationOnly: false, source: 'code' as const, sandboxReadSafe: true, capability: 'estimates:read' as const };
function manifest(tool = false, workflow = false): ExecutionManifest {
  const definition: SkillDefinition = { name: 'Frozen skill', description: '', category: 'test', instructions: 'Original instructions', roles: ['pre_sales'], inputSchema: schema, outputSchema,
    model: { scenario: 'generation', temperature: 1.7, maxTokens: 20, timeoutMs: 1000 }, tools: tool ? [{ toolName: native.name, inputMapping: { text: '$.text' }, requiresConfirmation: false }] : [], examples: [],
    references: [{ label: 'Original ref', uri: 'wes://knowledge/a', version: 'v1' }] };
  const material = { uri: 'wes://knowledge/a', version: 'v1', title: 'Original title', content: 'Original body', digest: hash({ title: 'Original title', content: 'Original body' }) };
  const skill = { stepId: workflow ? 'one' : '$skill', skillId: 'skill-one', versionId: 'version-one', hash: hash(definition), definition,
    context: { schemaVersion: 1 as const, references: [{ uri: material.uri, version: material.version, digest: material.digest }], tools: tool ? [{ native: structuredClone(native), policy: structuredClone(DEFAULT_TOOL_POLICY_ENTRY) }] : [], roles: ['PRE_SALES' as const],
      model: { providerId: 'custom', model: 'Exact-Model', modelSource: 'binding' as const, credentialScope: 'provider:custom', baseUrlDigest: hash('https://endpoint.invalid/v1'), params: definition.model, capabilities: ['chat'], supportedParams: ['temperature', 'maxTokens'] } }, materials: [material] };
  const workflowDefinition = { name: 'Workflow', description: '', category: 'test', roles: ['pre_sales'], inputSchema: schema, outputSchema, steps: [{ id: 'one', name: 'One', type: 'skill', skillId: skill.skillId, skillVersionId: skill.versionId, inputMapping: [{ target: 'text', source: { kind: 'path', path: '$.input.text' } }], onFailure: 'fail' }], outputMapping: [{ target: 'ok', source: { kind: 'path', path: '$.steps.one.output.ok' } }] };
  const body = { schemaVersion: 1 as const, kind: workflow ? 'workflow' as const : 'skill' as const,
    target: { id: workflow ? 'workflow-one' : skill.skillId, versionId: workflow ? 'wv1' : skill.versionId, hash: hash(workflow ? workflowDefinition : definition), definition: workflow ? workflowDefinition : definition }, skills: [skill],
    ...(workflow ? { publishedDependencies: { schemaVersion: 1, skills: [{ stepId: skill.stepId, skillId: skill.skillId, skillVersionId: skill.versionId, hash: skill.hash, context: skill.context }], tools: [] } } : {}),
    tools: [], caller: { id: 'caller', businessRole: 'pre_sales' as const }, initialInput: input, sources: [], assetBindings: [] };
  return { ...body, manifestHash: hash(body) } as unknown as ExecutionManifest;
}
const rehash = (m: ExecutionManifest) => { const { manifestHash: _, ...body } = m; m.manifestHash = hash(body); return m; };
const response = (changes: Record<string, unknown> = {}) => ({ provider: 'kimi', model: 'Exact-Model', usage: { outputTokens: 3 }, output: { ok: true }, ...changes });
const call = (id = 'call1', changes: Record<string, unknown> = {}) => ({ id, name: 'read_one', arguments: input, ...changes });
const toolsResponse = (calls = [call()]) => response({ output: undefined, toolCalls: calls });
function toolResponse(calls = [call()]) { const value = toolsResponse(calls); delete (value as any).output; return value; }
function runner(complete: any = async () => response(), extra: any = {}) {
  return createSkillExecutionService({ createAuthority: () => ({ check: async () => {} }), prepareModel: async () => ({ complete, transportProvider: 'kimi' }), ...extra });
}
const execute = (service: ReturnType<typeof runner>, m = manifest(), changes: Record<string, unknown> = {}) => service.execute({ runId: 'trusted-run', ownerUserId: m.caller.id, manifest: m, stepId: m.skills[0].stepId, input, signal: new AbortController().signal, ...changes });
test('runs actual business input once with no examples; supports selected workflow dependency', async () => {
  for (const workflow of [false, true]) {
    let requests = 0;
    const r = await execute(runner(async (request: any) => { requests++; assert.deepEqual(request.input, input); assert.equal(request.instructions, 'Original instructions'); assert.equal(request.model.temperature, 1.7); return response(); }), manifest(false, workflow));
    assert.equal(r.status, 'succeeded'); assert.deepEqual(r.output, { ok: true }); assert.equal(requests, 1); assert.equal(r.usage.outputTokens, 3);
    assert.deepEqual(r.model, { providerId: 'custom', model: 'Exact-Model', transportProvider: 'kimi' });
  }
});
test('validates complete manifest, step selection, input schema and unsafe JSON before preparing model', async () => {
  let prepared = 0; const service = runner(undefined, { prepareModel: async () => { prepared++; throw new Error('must not prepare'); } });
  for (const changes of [{ stepId: 'missing' }, { input: { text: 3 } }, { input: JSON.parse('{"text":"x","__proto__":{}}') }, { manifest: { ...manifest(), manifestHash: 'bad' } }]) assert.equal((await execute(service, manifest(), changes)).status, 'failed');
  assert.equal(prepared, 0);
});
test('root Skill input must equal frozen initial input while mapped Workflow input can differ', async () => {
  let prepares = 0; const service = runner(undefined, { prepareModel: async () => { prepares++; return { complete: async () => response(), transportProvider: 'kimi' }; } });
  const r = await execute(service, manifest(), { input: { text: 'replaced root input' } }); assert.equal(r.code, 'EXECUTION_INPUT_MISMATCH'); assert.equal(prepares, 0);
  assert.equal((await execute(service, manifest(false, true), { input: { text: 'mapped step business input' } })).status, 'succeeded'); assert.equal(prepares, 1);
});
test('budget object cannot be a primitive or array', async () => {
  for (const budgets of [3, 'bad', [], null]) assert.equal((await execute(runner(), manifest(), { budgets })).code, 'INVALID_BUDGET');
});
test('parent abort before scheduled execution microtask prevents preparation', async () => {
  const parent = new AbortController(); let prepares = 0; const running = execute(runner(undefined, { prepareModel: async () => { prepares++; return {}; } }), manifest(), { signal: parent.signal });
  parent.abort(); assert.equal((await running).status, 'cancelled'); assert.equal(prepares, 0);
});
test('does not send samples, expected data or assertions to production model', async () => {
  const m = manifest(); m.skills[0].definition.examples = [{ title: 'sample', input: { text: 'SAMPLE' }, expected: { ok: false }, assertions: [{ path: '$.ok', op: 'equals', value: false }] }];
  m.target.definition = structuredClone(m.skills[0].definition); m.skills[0].hash = hash(m.skills[0].definition); m.target.hash = m.skills[0].hash; rehash(m);
  const r = await execute(runner(async (request: any) => { assert.equal(JSON.stringify(request).includes('SAMPLE'), false); return response(); }), m);
  assert.equal(r.status, 'succeeded');
});
for (const [name, changes, code] of [
  ['wrong provider', { provider: 'other' }, 'INVALID_PROVIDER_METADATA'], ['wrong model', { model: 'new-model' }, 'INVALID_PROVIDER_METADATA'],
  ['zero usage', { usage: { outputTokens: 0 } }, 'INVALID_MODEL_USAGE'], ['noninteger usage', { usage: { outputTokens: 1.1 } }, 'INVALID_MODEL_USAGE'],
  ['missing output', { output: undefined }, 'INVALID_OR_OVERSIZED_JSON'], ['schema output', { output: { ok: 1 } }, 'OUTPUT_SCHEMA_FAILED'],
  ['mixed response', { toolCalls: [call()] }, 'INVALID_MODEL_RESPONSE'], ['invalid calls', { toolCalls: 'bad' }, 'INVALID_MODEL_RESPONSE'],
] as const) test(`rejects ${name} with safe fixed code`, async () => {
  const r = await execute(runner(async () => response(changes))); assert.equal(r.code, code); assert.equal(r.status, 'failed');
  if (!name.includes('usage')) assert.equal(r.usage.outputTokens, 3);
});
test('rejects arbitrary adapter and gate errors without leaking plaintext', async () => {
  for (const ports of [{ prepareModel: async () => { throw new Error('secret endpoint api-key'); } }, {}, { toolGate: async () => { throw new Error('secret endpoint api-key'); } }]) {
    const r = await execute(runner(async () => { if (Object.keys(ports).length) return toolResponse(); throw new Error('secret endpoint api-key'); }, ports), manifest(true));
    assert.equal(r.status, 'failed'); assert.equal(JSON.stringify(r).includes('secret'), false); assert.equal(JSON.stringify(r).includes('endpoint'), false);
  }
});
test('default absent production tool gate fails safe; approved trusted gate returns actual safe results', async () => {
  assert.equal((await execute(runner(async () => toolResponse()), manifest(true))).code, 'TOOL_GATE_UNAVAILABLE');
  let attempts = 0; let gates = 0;
  const service = runner(async (request: any) => { assert.deepEqual(request.tools.map((t: any) => t.name), ['read_one']); return attempts++ ? (assert.equal(request.toolResults[0].simulated, false), response()) : toolResponse(); },
    { toolGate: async (request: any) => { gates++; assert.equal(request.binding.requiresConfirmation, false); assert.deepEqual(request.snapshot.native, native); assert.equal(request.caller.id, 'caller'); return { found: true }; } });
  const r = await execute(service, manifest(true)); assert.equal(r.status, 'succeeded'); assert.equal(gates, 1); assert.equal(r.usage.toolCalls, 1);
});
for (const [name, calls, code] of [
  ['invented tool', [call('a', { name: 'fake' })], 'TOOL_NOT_ALLOWED'], ['unsafe ID', [call('bad id')], 'INVALID_OR_REPEATED_TOOL_CALL'],
  ['duplicate batch ID', [call(), call()], 'INVALID_OR_REPEATED_TOOL_CALL'], ['native schema', [call('a', { arguments: { text: 4 } })], 'NATIVE_PARAMETERS_INVALID'],
  ['mapping', [call('a', { arguments: { text: 'different' } })], 'TOOL_MAPPING_MISMATCH'],
  ['unsafe arguments', [call('a', { arguments: JSON.parse('{"text":"x","constructor":{}}') })], 'INVALID_OR_OVERSIZED_JSON'],
  ['invalid second call', [call('a'), call('b', { name: 'fake' })], 'TOOL_NOT_ALLOWED'],
] as const) test(`preflights entire tool batch: ${name}`, async () => {
  let gates = 0; const r = await execute(runner(async () => toolResponse(calls as any), { toolGate: async () => { gates++; return {}; } }), manifest(true));
  assert.equal(r.code, code); assert.equal(gates, 0);
});
test('duplicate IDs across rounds fail before another gate', async () => {
  let gates = 0; const r = await execute(runner(async () => toolResponse(), { toolGate: async () => { gates++; return {}; } }), manifest(true));
  assert.equal(r.code, 'INVALID_OR_REPEATED_TOOL_CALL'); assert.equal(gates, 1);
});
test('disabled frozen policy is rejected before model advertisement', async () => {
  const m = manifest(true); m.skills[0].context.tools[0].policy.enabled = false; rehash(m); let attempts = 0;
  const r = await execute(runner(async () => { attempts++; return response(); }), m); assert.equal(r.code, 'TOOL_SNAPSHOT_DENIED'); assert.equal(attempts, 0);
});
test('trusted gate result retains existing JSON and size boundaries', async () => {
  for (const result of [undefined, { tooBig: 'x'.repeat(1048576) }, JSON.parse('{"constructor":{}}')]) {
    const r = await execute(runner(async () => toolResponse(), { toolGate: async () => result }), manifest(true)); assert.equal(r.code, 'INVALID_OR_OVERSIZED_JSON'); assert.equal(r.usage.toolCalls, 1);
  }
});
for (const budgets of [{ maxModelAttempts: 0 }, { maxToolCalls: -1 }, { maxOutputTokens: 128001 }, { totalTimeoutMs: 300001 }, { maxModelAttempts: 1.1 }, { surprise: 1 }])
  test(`rejects invalid budget ${JSON.stringify(budgets)}`, async () => { assert.equal((await execute(runner(), manifest(), { budgets })).code, 'INVALID_BUDGET'); });
test('remaining tokens decrease across rounds and prevent further attempt at exhaustion', async () => {
  const sent: number[] = []; let gates = 0;
  const r = await execute(runner(async (request: any) => { sent.push(request.model.maxTokens); return toolResponse([call(`id${sent.length}`)]); }, { toolGate: async () => { gates++; return {}; } }), manifest(true), { budgets: { maxOutputTokens: 6 } });
  assert.deepEqual(sent, [6, 3]); assert.equal(r.code, 'OUTPUT_TOKEN_LIMIT'); assert.equal(r.usage.outputTokens, 6); assert.equal(gates, 2);
});
test('attempt and whole batch tool limits prevent excess side effects', async () => {
  let gates = 0; const ports = { toolGate: async () => { gates++; return {}; } };
  const attempts = await execute(runner(async () => toolResponse(), ports), manifest(true), { budgets: { maxModelAttempts: 1 } });
  assert.equal(attempts.code, 'MODEL_ATTEMPT_LIMIT'); assert.equal(attempts.usage.modelAttempts, 1);
  gates = 0; const tools = await execute(runner(async () => toolResponse([call('a'), call('b')]), ports), manifest(true), { budgets: { maxToolCalls: 1 } });
  assert.equal(tools.code, 'TOOL_CALL_LIMIT'); assert.equal(gates, 0);
  const over = await execute(runner(async () => response({ usage: { outputTokens: 21 } }))); assert.equal(over.code, 'OUTPUT_TOKEN_LIMIT'); assert.equal(over.usage.outputTokens, 21);
});
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { promise, resolve }; };
for (const phase of ['prepare', 'model', 'gate']) test(`total deadline races ignored signals during ${phase} and suppresses late actions`, async () => {
  const pending = deferred(); let calls = 0; let forwarded!: AbortSignal;
  const service = runner(async (request: any) => { calls++; forwarded = request.signal; return phase === 'model' ? pending.promise : toolResponse(); }, {
    ...(phase === 'prepare' ? { prepareModel: async (_s: any, signal: AbortSignal) => { forwarded = signal; return pending.promise; } } : {}),
    toolGate: async (request: any) => { forwarded = request.signal; return phase === 'gate' ? pending.promise : {}; },
  });
  const r = await execute(service, manifest(true), { budgets: { totalTimeoutMs: 100 } }); assert.equal(r.code, 'TOTAL_TIMEOUT'); assert.equal(forwarded.aborted, true);
  const before = JSON.stringify(r); pending.resolve(phase === 'prepare' ? { complete: async () => { calls++; return response(); }, transportProvider: 'kimi' } : response());
  await new Promise(r => setTimeout(r, 10)); assert.equal(JSON.stringify(r), before); assert.equal(calls, phase === 'prepare' ? 0 : 1);
});
test('parent cancellation races ignored provider, removes listener and forbids late tool gate', async () => {
  const pending = deferred(); const parent = new AbortController(); let gates = 0; let signal!: AbortSignal; let removed = 0;
  const remove = parent.signal.removeEventListener.bind(parent.signal); parent.signal.removeEventListener = (...args: any[]) => { removed++; return (remove as any)(...args); };
  const running = execute(runner(async (req: any) => { signal = req.signal; return pending.promise; }, { toolGate: async () => { gates++; return {}; } }), manifest(true), { signal: parent.signal });
  await new Promise(r => setImmediate(r)); parent.abort('private cancellation text'); const r = await running;
  assert.equal(r.status, 'cancelled'); assert.equal(r.code, 'CANCELLED'); assert.equal(signal.aborted, true); assert.equal(removed, 1);
  pending.resolve(toolResponse()); await new Promise(r => setImmediate(r)); assert.equal(gates, 0);
});
test('already cancelled request performs no model preparation', async () => {
  const controller = new AbortController(); controller.abort(); let prepared = 0;
  const r = await execute(runner(undefined, { prepareModel: async () => { prepared++; return {}; } }), manifest(), { signal: controller.signal });
  assert.equal(r.status, 'cancelled'); assert.equal(prepared, 0);
});
const provider = () => ({ id: 'custom', name: 'Catalog supplier', protocol: 'openai-compatible', enabled: true, baseUrl: 'https://endpoint.invalid/v1', models: [{ id: 'Exact-Model' }] });
function modelPorts(changes: any = {}) {
  return { beforeDispatch: async () => {}, loadProviders: async () => [provider()], loadCredential: async () => fixtureCredential, provider: { chatCompletion: async () => ({ content: '{"ok":true}', model: 'Exact-Model', provider: 'kimi', usage: { completionTokens: 4 } }) }, ...changes };
}
test('production preparation uses current frozen-scope credential, original model/params and frozen references', async () => {
  let sent: any; let scopes: string[] = []; let rotation = 0;
  const ports = modelPorts({ loadCredential: async (scope: string) => { scopes.push(scope); return `${fixtureCredential}-${++rotation}`; }, provider: { chatCompletion: async (req: any) => { sent = req; return { content: '{"ok":true}', model: 'Exact-Model', provider: 'kimi', usage: { completionTokens: 4 } }; } } });
  for (let i = 1; i <= 2; i++) {
    const prepared = await prepareFrozenSkillModel(manifest().skills[0], new AbortController().signal, ports);
    const r = await prepared.complete({ instructions: 'Original instructions', input, outputSchema, model: manifest().skills[0].definition.model, tools: [], toolResults: [], signal: new AbortController().signal });
    assert.equal(prepared.transportProvider, 'kimi'); assert.equal(sent.frozenExecution, true); assert.equal(sent.maxAttempts, 1); assert.equal(sent.temperature, 1.7); assert.equal(sent.model, 'Exact-Model'); assert.equal(sent.credentialsOverride.apiKey, `${fixtureCredential}-${i * 2}`);
    assert.equal(JSON.stringify(sent.messages).includes('Original body'), true); assert.equal(JSON.stringify(r).includes(fixtureCredential), false); assert.deepEqual(r.output, { ok: true });
  }
  assert.deepEqual(scopes, Array(4).fill('provider:custom'));
});
for (const [name, change] of [['disabled', { enabled: false }], ['missing model', { models: [{ id: 'latest' }] }], ['changed endpoint', { baseUrl: 'https://changed.invalid' }], ['wrong protocol', { protocol: 'unknown' }]] as const)
  test(`production preparation rejects ${name} before credential/model execution`, async () => {
    let keys = 0; await assert.rejects(prepareFrozenSkillModel(manifest().skills[0], new AbortController().signal, modelPorts({ loadProviders: async () => [{ ...provider(), ...change }], loadCredential: async () => { keys++; return fixtureCredential; } }))); assert.equal(keys, 0);
  });
test('production preparation rejects missing provider, empty key and inconsistent credential scope safely', async () => {
  const skill = manifest().skills[0];
  await assert.rejects(prepareFrozenSkillModel(skill, new AbortController().signal, modelPorts({ loadProviders: async () => [] })));
  await assert.rejects(prepareFrozenSkillModel(skill, new AbortController().signal, modelPorts({ loadCredential: async () => '' })));
  skill.context.model.credentialScope = 'provider:other'; await assert.rejects(prepareFrozenSkillModel(skill, new AbortController().signal, modelPorts()));
});
test('frozen unsupported temperature is omitted; malformed JSON and mixed output preserve usage safely', async () => {
  const skill = manifest().skills[0]; skill.context.model.supportedParams = ['maxTokens'];
  for (const content of ['not JSON', '{"ok":true}']) {
    let sent: any; const prepared = await prepareFrozenSkillModel(skill, new AbortController().signal, modelPorts({ provider: { chatCompletion: async (req: any) => { sent = req; return { content, model: 'Exact-Model', provider: 'kimi', usage: { completionTokens: 7 }, ...(content.startsWith('{') ? { toolCalls: [call()] } : {}) }; } } }));
    const r = await prepared.complete({ instructions: 'x', input, outputSchema, model: skill.definition.model, tools: [], toolResults: [], signal: new AbortController().signal });
    assert.equal(sent.temperature, undefined); assert.equal(r.usage.outputTokens, 7); assert.equal(JSON.stringify(r).includes('not JSON'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(r, 'output'), content.startsWith('{'));
  }
});
test('actual provider rejects explicit non-function native call before gate and preserves received usage', async () => {
  const original = globalThis.fetch; let fetches = 0; let gates = 0;
  globalThis.fetch = async () => { fetches++; return new Response(JSON.stringify({ choices: [{ message: fetches === 1
    ? { tool_calls: [{ id: 'native-call', type: 'INVALID_NOT_FUNCTION', function: { name: 'read_one', arguments: JSON.stringify(input) } }] }
    : { content: '{"ok":true}' } }], usage: { completion_tokens: 3 } }), { status: 200 }); };
  try {
    const service = runner(undefined, { prepareModel: (skill: any, signal: AbortSignal) => prepareFrozenSkillModel(skill, signal,
      modelPorts({ provider: new KimiProvider({ apiKey: fixtureCredential }) })), toolGate: async () => { gates++; return {}; } });
    const r = await execute(service, manifest(true));
    assert.equal(r.status, 'failed'); assert.equal(gates, 0); assert.equal(fetches, 1); assert.equal(r.usage.modelAttempts, 1); assert.equal(r.usage.outputTokens, 3);
  } finally { globalThis.fetch = original; }
});
test('empty frozen supportedParams leaves exact temperature unconstrained', async () => {
  const skill = manifest().skills[0]; skill.context.model.supportedParams = []; let sent: any;
  const prepared = await prepareFrozenSkillModel(skill, new AbortController().signal, modelPorts({ provider: { chatCompletion: async (req: any) => { sent = req; return { content: '{"ok":true}', model: 'Exact-Model', provider: 'kimi', usage: { completionTokens: 3 } }; } } }));
  await prepared.complete({ instructions: skill.definition.instructions, input, outputSchema, model: skill.definition.model, tools: [], toolResults: [], signal: new AbortController().signal });
  assert.equal(sent.temperature, 1.7);
});

test('execution requires trusted Run identity before any model preparation', async () => {
  let prepares = 0;
  const service = createSkillExecutionService({ prepareModel: async () => { prepares++; return { complete: async () => response(), transportProvider: 'kimi' }; } });
  const result = await execute(service, manifest(), { runId: undefined, ownerUserId: undefined });
  assert.equal(result.status, 'failed'); assert.equal(result.code, 'EXECUTION_AUTHORITY_DENIED'); assert.equal(prepares, 0);
});

test('checker unavailable is sanitized and prevents preparation', async () => {
  let prepares = 0;
  const r = await execute(runner(undefined, { createAuthority: () => ({ check: async () => { throw new Error('private SQL credentials'); } }), prepareModel: async () => { prepares++; return {}; } }));
  assert.equal(r.code, 'EXECUTION_AUTHORITY_DENIED'); assert.equal(prepares, 0); assert.equal(JSON.stringify(r).includes('private'), false);
});
for (const phase of ['model', 'tool', 'prepare']) test(`authority revocation between ${phase} actions prevents subsequent I/O`, async () => {
  let revoked = false; let models = 0; let gates = 0;
  const service = runner(async () => { models++; if (phase === 'model') revoked = true; return toolResponse([call('a'), call('b')]); }, {
    createAuthority: () => ({ check: async () => { if (revoked) throw new Error('denied'); } }),
    ...(phase === 'prepare' ? { prepareModel: async () => { revoked = true; return { complete: async () => { models++; return response(); }, transportProvider: 'kimi' }; } } : {}),
    toolGate: async () => { gates++; if (phase === 'tool') revoked = true; return {}; },
  });
  const r = await execute(service, manifest(true)); assert.equal(r.code, 'EXECUTION_AUTHORITY_DENIED');
  assert.equal(models, phase === 'prepare' ? 0 : 1); assert.equal(gates, phase === 'tool' ? 1 : 0);
});
for (const mode of ['cancel', 'deadline']) test(`late authority after ${mode} cannot prepare model`, async () => {
  const pending = deferred(); const parent = new AbortController(); let prepares = 0;
  const running = execute(runner(undefined, { createAuthority: () => ({ check: () => pending.promise }), prepareModel: async () => { prepares++; return {}; } }), manifest(),
    { signal: parent.signal, budgets: { totalTimeoutMs: 30 } });
  await new Promise(r => setImmediate(r)); if (mode === 'cancel') parent.abort();
  const r = await running; assert.equal(r.code, mode === 'cancel' ? 'CANCELLED' : 'TOTAL_TIMEOUT');
  pending.resolve(undefined); await new Promise(r => setImmediate(r)); assert.equal(prepares, 0);
});
test('prepared model rechecks current provider and credentials on every complete; missing hook cannot send', async () => {
  let enabled = true; let sends = 0; let keys = 0;
  const ports = modelPorts({ loadProviders: async () => [{ ...provider(), enabled }], loadCredential: async () => `${fixtureCredential}-${++keys}`,
    provider: { chatCompletion: async () => { sends++; return response(); } } });
  const s = manifest().skills[0]; const req = { instructions: '', input, outputSchema, model: s.definition.model, tools: [], toolResults: [], signal: new AbortController().signal };
  const prepared = await prepareFrozenSkillModel(s, req.signal, ports); enabled = false;
  await assert.rejects(prepared.complete(req)); assert.equal(sends, 0);
  enabled = true; const unguarded = await prepareFrozenSkillModel(s, req.signal, { ...ports, beforeDispatch: undefined });
  await assert.rejects(unguarded.complete(req)); assert.equal(sends, 0);
});
for (const change of ['confirmation', 'ask', 'mutates', 'exfiltrates', 'mcp']) test(`no persistent grant means ${change} never reaches tool gate`, async () => {
  const m = manifest(true); const snapshot = m.skills[0].context.tools[0];
  if (change === 'confirmation') m.skills[0].definition.tools[0].requiresConfirmation = true;
  if (change === 'ask') snapshot.policy.approvalStrategy = 'user-confirm';
  if (change === 'mutates' || change === 'exfiltrates') { snapshot.native[change] = true; m.skills[0].definition.tools[0].requiresConfirmation = true; }
  if (change === 'mcp') { snapshot.native.source = 'mcp'; snapshot.native.simulationOnly = true; snapshot.native.name = 'mcp__server__read'; m.skills[0].definition.tools[0].toolName = snapshot.native.name; }
  m.skills[0].hash = hash(m.skills[0].definition); m.target.definition = structuredClone(m.skills[0].definition); m.target.hash = m.skills[0].hash; rehash(m);
  let gates = 0; const r = await execute(runner(async () => toolResponse([call('a', { name: snapshot.native.name })]), { toolGate: async () => { gates++; return {}; } }), m);
  assert.equal(r.code, 'EXECUTION_AUTHORITY_DENIED'); assert.equal(gates, 0);
});

for (const mode of ['cancel', 'deadline']) test(`late post-prepare checker after ${mode} cannot complete model`, async () => {
  const pending = deferred(); const parent = new AbortController(); let checks = 0; let models = 0;
  const running = execute(runner(async () => { models++; return response(); }, { createAuthority: () => ({ check: async () => { if (++checks === 2) await pending.promise; } }) }), manifest(),
    { signal: parent.signal, budgets: { totalTimeoutMs: 30 } });
  await new Promise(r => setImmediate(r)); if (mode === 'cancel') parent.abort();
  const r = await running; assert.equal(r.code, mode === 'cancel' ? 'CANCELLED' : 'TOTAL_TIMEOUT');
  pending.resolve(undefined); await new Promise(r => setImmediate(r)); assert.equal(models, 0);
});
test('provider disabled while current credential is loading cannot send a model request', async () => {
  let enabled = true; let sends = 0;
  await assert.rejects(prepareFrozenSkillModel(manifest().skills[0], new AbortController().signal, modelPorts({
    loadProviders: async () => [{ ...provider(), enabled }], loadCredential: async () => { enabled = false; return fixtureCredential; },
    provider: { chatCompletion: async () => { sends++; return response(); } },
  })));
  assert.equal(sends, 0);
});
test('late model dispatch checker cannot send after cancellation', async () => {
  const pending = deferred(); const controller = new AbortController(); let checks = 0; let sends = 0;
  const ports = modelPorts({ beforeDispatch: async () => { checks++; await pending.promise; },
    provider: { chatCompletion: async () => { sends++; return response(); } } });
  const s = manifest().skills[0]; const prepared = await prepareFrozenSkillModel(s, controller.signal, ports);
  const running = prepared.complete({ instructions: '', input, outputSchema, model: s.definition.model, tools: [], toolResults: [], signal: controller.signal });
  await new Promise(r => setImmediate(r)); assert.equal(checks, 1);
  controller.abort(); pending.resolve(undefined); await assert.rejects(running); assert.equal(sends, 0);
});
test('unavailable checker factory fails before model preparation', async () => {
  let prepares = 0; const r = await execute(runner(undefined, { createAuthority: () => { throw new Error('private internal failure'); }, prepareModel: async () => { prepares++; return {}; } }));
  assert.equal(r.code, 'EXECUTION_AUTHORITY_DENIED'); assert.equal(prepares, 0);
});
