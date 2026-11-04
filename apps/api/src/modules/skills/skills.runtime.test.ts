import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSkillSandbox } from './skills.sandbox';
import type { SkillDefinition } from './skills.types';
import { createSkillModelAdapter, resolveSkillReferences } from './skills.runtime';
import type { ChatCompletionRequest } from '../../ai/provider/model-provider';
const definition: SkillDefinition = {
  name: '模型试运行', description: '', category: 'test', instructions: 'Return structured output', roles: ['pre_sales'], references: [],
  inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] }, outputSchema: { type: 'object' },
  model: { scenario: 'assessment', temperature: 0.2, maxTokens: 80, timeoutMs: 1000 }, examples: [{ title: 'sample', input: { q: 'hello' }, expected: { secretExpected: 'NEVER_SEND_EXPECTED' } }],
  tools: [{ toolName: 'remote', inputMapping: { q: '$.q' }, requiresConfirmation: false }],
};
test('trusted simulation-only remote read never reaches executor and records its dry-run boundary', async () => {
  let calls = 0;
  const sandbox = createSkillSandbox(definition, [{ name: 'remote', description: '', parameters: definition.inputSchema, mutates: false, simulationOnly: true }], async () => { calls++; return {}; });
  const result = await sandbox.runTool({ id: 'call-1', name: 'remote', arguments: { q: 'hello' } }, { q: 'hello' }, new AbortController().signal);
  assert.equal(calls, 0); assert.equal(result.simulated, true); assert.deepEqual(result.result, { dryRun: true, executed: false, reason: 'unverified_or_remote_read_isolated' });
});
test('model adapter uses existing provider with bounded request, tool messages and no expected/reasoning persistence', async () => {
  let sent!: ChatCompletionRequest;
  const complete = createSkillModelAdapter({ scenario: { providerId: 'moonshot', providerName: 'Moonshot', baseUrl: 'https://model.test/v1', model: 'kimi-test', modelSource: 'binding', credentialScope: 'kimi' }, apiKey: 'placeholder', referenceContent: 'reference-data',
    provider: { chatCompletion: async request => { sent = request; return { content: '{"ok":true}', rawContent: '{"ok":true}', model: 'kimi-test', provider: 'kimi', attempts: 1, usage: { completionTokens: 5, promptTokens: 10, totalTokens: 15 }, reasoningContent: 'NEVER_STORE_REASONING' }; } } });
  const signal = new AbortController().signal;
  const result = await complete({ instructions: definition.instructions, input: { q: 'hello' }, outputSchema: definition.outputSchema, model: definition.model, tools: [], toolResults: [{ callId: 'call-1', toolName: 'remote', arguments: { q: 'hello' }, result: { dryRun: true }, simulated: true }], signal });
  assert.deepEqual(result.output, { ok: true }); assert.equal(result.usage.outputTokens, 5);
  assert.equal(sent.maxAttempts, 1); assert.equal(sent.maxCompletionTokens, 80); assert.equal(sent.abortSignal, signal); assert.equal(sent.thinking, 'disabled');
  assert.equal(sent.credentialsOverride!.apiKey, 'placeholder');
  assert.equal(sent.messages[2].role, 'assistant'); assert.equal(sent.messages[2].tool_calls![0].id, 'call-1');
  assert.equal(sent.messages[3].tool_call_id, 'call-1');
  assert.equal(JSON.stringify(sent.messages).includes('NEVER_SEND_EXPECTED'), false);
  assert.equal(JSON.stringify(result).includes('placeholder'), false); assert.equal(JSON.stringify(result).includes('NEVER_STORE_REASONING'), false);
  assert.equal(JSON.stringify(sent.messages).includes('reference-data'), true);
});
test('references resolve only active internal exact versions and bound content contributes digest', async () => {
  const entry = { id: 'ref-1', title: '内部知识', content: 'actual knowledge', status: 'active' as const, updatedAt: '2026-11-02T00:00:00.000Z', createdAt: '2026-11-02T00:00:00.000Z', category: 'test' };
  const get = async () => entry;
  const refs = [{ label: 'ref', uri: 'wes://knowledge/ref-1', version: entry.updatedAt }];
  const resolved = await resolveSkillReferences(refs, get);
  assert.ok(resolved.content.includes(entry.content)); assert.equal(resolved.digests.length, 1);
  assert.notDeepEqual((await resolveSkillReferences(refs, async () => ({ ...entry, content: 'changed' }))).digests, resolved.digests);
  for (const ref of [{ ...refs[0], uri: 'https://arbitrary.test' }, { ...refs[0], version: 'old' }]) await assert.rejects(resolveSkillReferences([ref], get));
  await assert.rejects(resolveSkillReferences(refs, async () => null));
  await assert.rejects(resolveSkillReferences(refs, async () => ({ ...entry, status: 'archived' })));
});

test('resolved model proof snapshot records explainable parameters but only a digest of credential-bearing endpoints', async () => {
  const { skillDependencyModelSnapshot } = await import('./skills.context');
  const scenario = { providerId: 'moonshot', providerName: 'Moonshot', baseUrl: 'https://private-user:private-password@model.test/v1?api_key=private-query-secret', model: 'kimi-test', modelSource: 'binding' as const, credentialScope: 'kimi' };
  const snapshot = skillDependencyModelSnapshot(scenario, definition.model, { capabilities: ['chat'], supportedParams: ['maxTokens'] });
  assert.equal(snapshot.providerId, 'moonshot'); assert.equal(snapshot.model, 'kimi-test'); assert.equal(snapshot.credentialScope, 'kimi');
  assert.deepEqual(snapshot.params, definition.model); assert.equal(snapshot.baseUrlDigest.length, 64);
  for (const secret of ['private-user', 'private-password', 'private-query-secret', 'https://']) assert.equal(JSON.stringify(snapshot).includes(secret), false);
  assert.notEqual(skillDependencyModelSnapshot({ ...scenario, baseUrl: 'https://different.test/v1' }, definition.model).baseUrlDigest, snapshot.baseUrlDigest);
});
