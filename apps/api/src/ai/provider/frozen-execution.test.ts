import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KimiProvider } from './kimi-provider';
import { randomUUID } from 'node:crypto';
const fixtureCredential = randomUUID();
const request = { model: 'Exact-Model', messages: [{ role: 'user' as const, content: 'task' }], temperature: 1.7, maxAttempts: 4, frozenExecution: true };
const success = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { completion_tokens: 3 } }), { status: 200 });
test('frozen execution sends exact original model and temperature without compatibility retry', async () => {
  const original = globalThis.fetch; let calls = 0; let sent: any;
  globalThis.fetch = async (_url, options) => { calls++; sent = JSON.parse(options!.body as string); return new Response('invalid temperature only 1 is allowed', { status: 400 }); };
  try { await assert.rejects(new KimiProvider({ apiKey: fixtureCredential }).chatCompletion(request)); assert.equal(calls, 1); assert.equal(sent.temperature, 1.7); assert.equal(sent.model, 'Exact-Model'); }
  finally { globalThis.fetch = original; }
});
test('frozen mode forces a single retryable HTTP attempt', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('busy', { status: 503 }); };
  try { await assert.rejects(new KimiProvider({ apiKey: fixtureCredential }).chatCompletion(request)); assert.equal(calls, 1); } finally { globalThis.fetch = original; }
});
test('legacy compatibility retry still works when frozen mode is absent', async () => {
  const original = globalThis.fetch; const temperatures: number[] = [];
  globalThis.fetch = async (_url, options) => { temperatures.push(JSON.parse(options!.body as string).temperature); return temperatures.length === 1 ? new Response('invalid temperature only 1 is allowed', { status: 400 }) : success(); };
  try { await new KimiProvider({ apiKey: fixtureCredential }).chatCompletion({ ...request, frozenExecution: false, temperature: 0.3 }); assert.deepEqual(temperatures, [0.3, 1]); } finally { globalThis.fetch = original; }
});
test('frozen mode never adds temperature that frozen capabilities omitted', async () => {
  const original = globalThis.fetch; let sent: any;
  globalThis.fetch = async (_url, options) => { sent = JSON.parse(options!.body as string); return success(); };
  try { await new KimiProvider({ apiKey: fixtureCredential }).chatCompletion({ ...request, temperature: undefined }); assert.equal(Object.prototype.hasOwnProperty.call(sent, 'temperature'), false); } finally { globalThis.fetch = original; }
});
test('frozen streaming refuses unsupported use before network', async () => {
  const original = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; return success(); };
  try { await assert.rejects(async () => { for await (const _chunk of new KimiProvider({ apiKey: fixtureCredential }).streamChatCompletion(request)) {} }); assert.equal(calls, 0); } finally { globalThis.fetch = original; }
});
for (const [name, call] of [['missing ID', { function: { name: 'zero', arguments: '{}' } }], ['bad JSON', { id: 'a', function: { name: 'zero', arguments: '{' } }], ['nonobject JSON', { id: 'a', function: { name: 'zero', arguments: '[]' } }]] as const)
  test(`frozen parser does not normalize ${name} into an executable call`, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [call] } }], usage: { completion_tokens: 3 } }), { status: 200 });
    try { const r = await new KimiProvider({ apiKey: fixtureCredential }).chatCompletion(request); assert.equal(r.usage!.completionTokens, 3); assert.ok(!r.toolCalls![0].id || r.toolCalls![0].arguments === undefined); } finally { globalThis.fetch = original; }
  });
test('frozen parser does not coerce numeric usage or numeric call identifiers into valid evidence', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 4, function: { name: 'zero', arguments: '{}' } }] } }], usage: { completion_tokens: '3' } }), { status: 200 });
  try { const r = await new KimiProvider({ apiKey: fixtureCredential }).chatCompletion(request); assert.notEqual(typeof r.toolCalls![0].id, 'string'); assert.equal(Number.isInteger(r.usage!.completionTokens), false); } finally { globalThis.fetch = original; }
});
test('frozen parser preserves malformed tool_calls for rejection even with valid content', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}', tool_calls: 'malformed' } }], usage: { completion_tokens: 3 } }), { status: 200 });
  try { const r = await new KimiProvider({ apiKey: fixtureCredential }).chatCompletion(request); assert.equal(r.toolCalls!.length, 1); assert.equal(r.toolCalls![0].id, ''); } finally { globalThis.fetch = original; }
});
