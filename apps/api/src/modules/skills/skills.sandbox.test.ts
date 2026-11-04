import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSkillSandbox } from './skills.sandbox';
import type { SkillDefinition } from './skills.types';

export function trialDefinition(): SkillDefinition {
  return { name: '试运行', description: '', category: 'test', instructions: '提取条目', roles: ['pre_sales'], references: [],
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'], additionalProperties: false },
    model: { scenario: 'assessment', temperature: 0, maxTokens: 100, timeoutMs: 1000 }, tools: [],
    examples: [{ title: '一个条目', input: { text: '审批' }, expected: { items: ['审批'] } }] };
}
export const nativeTools = ['read', 'write', 'send'].map(name => ({ name, description: name,
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
  mutates: name === 'write', exfiltrates: name === 'send' }));

test('sandbox only executes validated mapped reads and simulates every write and exfiltration', async () => {
  const d = trialDefinition();
  d.tools = nativeTools.map(t => ({ toolName: t.name, inputMapping: { query: '$.text' }, requiresConfirmation: t.name !== 'read' }));
  const calls: string[] = [];
  const sandbox = createSkillSandbox(d, nativeTools, async (name, params) => { calls.push(name); assert.deepEqual(params, { query: '审批' }); return { count: 1 }; });
  const signal = new AbortController().signal;
  for (const name of ['read', 'write', 'send']) {
    const result = await sandbox.runTool({ id: name, name, arguments: { query: '审批' } }, { text: '审批' }, signal);
    assert.equal(result.simulated, name !== 'read');
    if (name !== 'read') assert.deepEqual(result.result, { dryRun: true, executed: false, reason: name === 'write' ? 'mutation_isolated' : 'exfiltration_isolated' });
  }
  assert.deepEqual(calls, ['read']);
  for (const call of [{ id: '1', name: 'invented', arguments: {} }, { id: '2', name: 'read', arguments: { query: 1 } }, { id: '3', name: 'read', arguments: { query: 'fabricated' } }]) {
    await assert.rejects(() => sandbox.runTool(call, { text: '审批' }, signal));
  }
  assert.deepEqual(calls, ['read']);
});

test('sandbox rejects unavailable tools, unsafe paths and invalid input before execution', () => {
  for (const path of ['$.constructor', '$.__proto__.x', '$.text[0]', '$.text..x']) {
    const d = trialDefinition(); d.tools = [{ toolName: 'read', inputMapping: { query: path }, requiresConfirmation: false }];
    assert.throws(() => createSkillSandbox(d, nativeTools));
  }
  const d = trialDefinition(); d.tools = [{ toolName: 'read', inputMapping: { query: '$.text' }, requiresConfirmation: false }];
  assert.throws(() => createSkillSandbox(d, []));
  assert.throws(() => createSkillSandbox(trialDefinition(), []).validateInput({ text: 7 }));
});
