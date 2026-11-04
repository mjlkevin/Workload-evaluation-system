import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createResumableSkillExecutor, type ResumableSkillPorts, type ResumableSkillAdvanceRequest } from './skills.execution-resumable';
import { skillDefinitionHash as hash } from './skills.hash';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../agent/tool-policy';
import type { ExecutionManifest } from './execution-manifest.types';
import type { SkillDefinition } from './skills.types';
const input = { text: 'actual business' };
const schema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const outputSchema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
const native = { name: 'read_one', description: 'Frozen tool', parameters: schema, mutates: false, exfiltrates: false, simulationOnly: false, source: 'code' as const, sandboxReadSafe: true, capability: 'estimates:read' as const };
function manifest(): ExecutionManifest {
  const definition: SkillDefinition = { name: 'Frozen skill', description: '', category: 'test', instructions: 'Original instructions', roles: ['pre_sales'], inputSchema: schema, outputSchema,
    model: { scenario: 'generation', temperature: 1.7, maxTokens: 20, timeoutMs: 1000 }, tools: [{ toolName: native.name, inputMapping: { text: '$.text' }, requiresConfirmation: false }], examples: [], references: [] };
  const skill = { stepId: '$skill', skillId: 'skill-one', versionId: 'version-one', hash: hash(definition), definition,
    context: { schemaVersion: 1 as const, references: [], tools: [{ native: structuredClone(native), policy: structuredClone(DEFAULT_TOOL_POLICY_ENTRY) }], roles: ['PRE_SALES' as const],
      model: { providerId: 'custom', model: 'Exact-Model', modelSource: 'binding' as const, credentialScope: 'provider:custom', baseUrlDigest: hash('https://endpoint.invalid/v1'), params: definition.model, capabilities: ['chat'], supportedParams: ['temperature', 'maxTokens'] } }, materials: [] };
  const body = { schemaVersion: 1 as const, kind: 'skill' as const, target: { id: skill.skillId, versionId: skill.versionId, hash: skill.hash, definition }, skills: [skill],
    tools: [], caller: { id: 'caller', businessRole: 'pre_sales' as const }, initialInput: input, sources: [], assetBindings: [] as [] };
  return { ...body, manifestHash: hash(body) } as ExecutionManifest;
}
const response = () => ({ provider: 'kimi', model: 'Exact-Model', usage: { outputTokens: 3 }, output: { ok: true } });
const call = (id = 'call1', changes: Record<string, unknown> = {}) => ({ id, name: native.name, arguments: input, ...changes });
const callsResponse = (calls = [call()]) => ({ provider: 'kimi', model: 'Exact-Model', usage: { outputTokens: 3 }, toolCalls: calls });
function request(changes: Partial<ResumableSkillAdvanceRequest> = {}): ResumableSkillAdvanceRequest {
  return { runId: 'trusted-run', ownerUserId: 'caller', manifest: manifest(), stepId: '$skill', operationId: 'root-skill', iteration: 0, input, signal: new AbortController().signal, ...changes };
}
const service = (ports: ResumableSkillPorts = {}) => createResumableSkillExecutor({ complete: async () => response(), tool: async () => ({ kind: 'completed', result: { found: true } }), ...ports });
test('checkpoints model tool calls before effects and resumes with a new executor without another model request', async () => {
  let models = 0; let tools = 0;
  const ports: ResumableSkillPorts = { complete: async () => { models++; return callsResponse(); }, tool: async r => { tools++; assert.equal(r.ordinal, 0); assert.equal(r.operationId, 'root-skill'); return { kind: 'completed', result: { found: true } }; } };
  const first = await service(ports).advance(request());
  assert.equal(first.kind, 'checkpoint'); assert.equal(first.state.phase, 'tools'); assert.equal(models, 1); assert.equal(tools, 0);
  const second = await service(ports).advance(request({ state: JSON.parse(JSON.stringify(first.state)) }));
  assert.equal(second.kind, 'checkpoint'); assert.equal(models, 1); assert.equal(tools, 1); assert.equal(second.state.toolResults[0].simulated, false);
});
test('completed restoration performs zero I/O', async () => {
  const first = await service().advance(request()); assert.equal(first.kind, 'completed');
  const fail = async () => { throw new Error('must not dispatch'); };
  const again = await createResumableSkillExecutor({ complete: fail, tool: fail }).advance(request({ state: first.state }));
  assert.equal(again.kind, 'completed'); assert.deepEqual(again.output, { ok: true });
});
test('waiting retains state and retries the same tool ordinal', async () => {
  let models = 0; const ordinals: number[] = [];
  const ports: ResumableSkillPorts = { complete: async () => { models++; return callsResponse(); }, tool: async r => { ordinals.push(r.ordinal); return ordinals.length === 1 ? { kind: 'waiting', operationId: 'operation-1', confirmationHash: hash(input) } : { kind: 'completed', result: { ok: true } }; } };
  const first = await service(ports).advance(request());
  const waiting = await service(ports).advance(request({ state: first.state })); assert.equal(waiting.kind, 'waiting'); assert.deepEqual(waiting.state, first.state);
  const done = await service(ports).advance(request({ state: waiting.state })); assert.equal(done.kind, 'checkpoint'); assert.deepEqual(ordinals, [0, 0]); assert.equal(models, 1);
});
test('resumption rejects a changed identity, input or malformed cursor before I/O', async () => {
  const state = (await service().advance(request())).state;
  const changes = [{ input: { text: 'changed' } }, { ownerUserId: 'other' }, { stepId: 'other' }, { operationId: 'other' }, { iteration: 1 }, { state: {} }, { state: { ...state, schemaVersion: 2 } }, { state: { ...state, phase: 'completed', output: { ok: 1 } } }];
  for (const change of changes) await assert.rejects(() => service({ complete: async () => { assert.fail('I/O'); } }).advance(request({ state, ...change })), /EXECUTION_|OUTPUT_SCHEMA/);
});
for (const [name, calls, code] of [
  ['unlisted', [call('a', { name: 'fake' })], 'TOOL_NOT_ALLOWED'], ['schema', [call('a', { arguments: { text: 2 } })], 'NATIVE_PARAMETERS_INVALID'],
  ['mapping', [call('a', { arguments: { text: 'other' } })], 'TOOL_MAPPING_MISMATCH'], ['duplicate', [call(), call()], 'INVALID_OR_REPEATED_TOOL_CALL'],
  ['unsafe arguments', [call('a', { arguments: JSON.parse('{"constructor":{}}') })], 'INVALID_OR_OVERSIZED_JSON'],
] as const) test(`rejects entire batch before checkpoint: ${name}`, async () => {
  await assert.rejects(() => service({ complete: async () => callsResponse(calls as any) }).advance(request()), new RegExp(code));
});
test('model metadata and output schema cannot drift', async () => {
  for (const value of [{ ...response(), model: 'Different' }, { ...response(), output: { ok: 1 } }, { ...response(), usage: { outputTokens: 0 } }])
    await assert.rejects(() => service({ complete: async () => value as any }).advance(request()), /INVALID_PROVIDER_METADATA|OUTPUT_SCHEMA_FAILED|INVALID_MODEL_USAGE/);
});
test('missing ports fail closed', async () => {
  await assert.rejects(() => createResumableSkillExecutor().advance(request()), /MODEL_PORT_UNAVAILABLE/);
  const first = await service({ complete: async () => callsResponse() }).advance(request());
  await assert.rejects(() => createResumableSkillExecutor().advance(request({ state: first.state })), /TOOL_PORT_UNAVAILABLE/);
});
test('preserves ordered ordinary tool results across batches and allocates stable ordinals', async () => {
  let models = 0; const ordinals: number[] = [];
  const ports: ResumableSkillPorts = { complete: async r => { models++; if (models === 1) return callsResponse([call('a'), call('b')]);
    assert.deepEqual(r.toolResults.map(t => [t.callId, t.toolName, t.arguments, t.result, t.simulated]), [['a', native.name, input, { ordinal: 0 }, false], ['b', native.name, input, { ordinal: 1 }, false]].concat(models === 3 ? [['c', native.name, input, { ordinal: 2 }, false]] : []));
    assert.deepEqual(r.model, (r.skill.definition.model)); return models === 2 ? callsResponse([call('c')]) : response(); },
    tool: async r => { ordinals.push(r.ordinal); return { kind: 'completed', result: { ordinal: r.ordinal } }; } };
  let state: unknown; let result;
  for (let n = 0; n < 6; n++) { result = await service(ports).advance(request({ state })); state = result.state; }
  assert.equal(result?.kind, 'completed'); assert.deepEqual(ordinals, [0, 1, 2]); assert.equal(models, 3);
});
test('rejects duplicate call IDs in later rounds', async () => {
  const ports: ResumableSkillPorts = { complete: async () => callsResponse() };
  const first = await service(ports).advance(request()); const second = await service(ports).advance(request({ state: first.state }));
  await assert.rejects(() => service(ports).advance(request({ state: second.state })), /INVALID_OR_REPEATED_TOOL_CALL/);
});
test('cursor corruption cannot redirect a persisted call or skip an effect', async () => {
  const state = (await service({ complete: async () => callsResponse() }).advance(request())).state;
  const corruptions = [{ ...state, manifestHash: hash('other') }, { ...state, surprise: true }, { ...state, nextToolIndex: 1 },
    { ...state, pendingBatch: [{ ...state.pendingBatch[0], ordinal: 5 }] }, { ...state, pendingBatch: [{ ...state.pendingBatch[0], arguments: { text: 'changed' } }] },
    { ...state, seenCallIds: [] }, { ...state, model: { ...state.model!, model: 'other' } }, { ...state, phase: 'model' }, { ...state, toolResults: [{ callId: 'a', toolName: native.name, arguments: input, result: {}, simulated: true }] }];
  for (const bad of corruptions) await assert.rejects(() => service({ tool: async () => { assert.fail('effect must not run'); } }).advance(request({ state: bad })), /EXECUTION_STATE_INVALID|TOOL_MAPPING_MISMATCH/);
});
test('bounds unsafe, oversized and deeply nested input/output/results before persistence', async () => {
  let deep: unknown = {}; for (let n = 0; n < 34; n++) deep = { nested: deep };
  for (const bad of [undefined, { text: 'x'.repeat(1048576) }, deep, JSON.parse('{"__proto__":{}}')]) {
    await assert.rejects(() => service().advance(request({ input: bad })), /INVALID_OR_OVERSIZED_JSON|EXECUTION_INPUT_MISMATCH|INPUT_SCHEMA_FAILED/);
    await assert.rejects(() => service({ complete: async () => ({ ...response(), output: bad }) }).advance(request()), /INVALID_OR_OVERSIZED_JSON|OUTPUT_SCHEMA_FAILED/);
  }
  const state = (await service({ complete: async () => callsResponse() }).advance(request())).state;
  await assert.rejects(() => service({ tool: async () => ({ kind: 'completed', result: { huge: 'x'.repeat(1048576) } }) }).advance(request({ state })), /INVALID_OR_OVERSIZED_JSON/);
});
test('whole batch safety cap prevents 61 pending effects', async () => {
  await assert.rejects(() => service({ complete: async () => callsResponse(Array.from({ length: 61 }, (_, n) => call(`c${n}`))) }).advance(request()), /TOOL_CALL_LIMIT/);
});
test('cancellation never dispatches and arbitrary port errors are redacted', async () => {
  const abort = new AbortController(); abort.abort();
  await assert.rejects(() => service({ complete: async () => { assert.fail('dispatch'); } }).advance(request({ signal: abort.signal })), /CANCELLED/);
  await assert.rejects(() => service({ complete: async () => { throw new Error('plaintext credential'); } }).advance(request()), error => error instanceof Error && error.message === 'MODEL_REQUEST_FAILED');
});
