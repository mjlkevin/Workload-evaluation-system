import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { evaluateSkill, type SkillTrialDependencies, type SkillModelRequest } from './skills.evaluation';
import type { SkillDefinition } from './skills.types';
function trialDefinition(): SkillDefinition {
  return { name: '试运行', description: '', category: 'test', instructions: '提取条目', roles: ['pre_sales'], references: [],
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'], additionalProperties: false },
    model: { scenario: 'assessment', temperature: 0, maxTokens: 100, timeoutMs: 1000 }, tools: [],
    examples: [{ title: '一个条目', input: { text: '审批' }, expected: { items: ['审批'] } }] };
}
const nativeTools = ['read', 'write', 'send'].map(name => ({ name, description: name,
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
  mutates: name === 'write', exfiltrates: name === 'send' }));
import { skillDefinitionHash } from './skills.hash';
import { SkillTrialFailure } from './skills.sandbox';

function deps(complete?: SkillTrialDependencies['complete']): SkillTrialDependencies {
  return { mode: 'model', allowedTools: nativeTools, complete: complete || (async () => ({ output: { items: ['审批'] }, provider: 'test-provider', model: 'test-model', usage: { outputTokens: 10 } })) };
}
test('real output and metadata bind every case to canonical definition hash, never send expected to provider', async () => {
  const d = trialDefinition(); let request: SkillModelRequest | undefined;
  const result = await evaluateSkill(d, deps(async r => { request = r; return { output: { items: ['审批'] }, provider: 'actual', model: 'model-1', usage: { outputTokens: 9 } }; }));
  assert.equal(result.passed, true); assert.equal(result.releaseEligible, true);
  assert.equal(result.definitionHash, skillDefinitionHash(d)); assert.equal(result.cases[0].definitionHash, result.definitionHash);
  assert.deepEqual(result.cases[0].providers, [{ provider: 'actual', model: 'model-1' }]);
  assert.equal(JSON.stringify(request).includes('expected'), false); assert.equal(JSON.stringify(request).includes('examples'), false);
  assert.equal(result.usage.modelAttempts, 1); assert.equal(result.usage.outputTokens, 9);
  const reordered = Object.fromEntries(Object.entries(d).reverse());
  assert.equal((await evaluateSkill(reordered, deps())).definitionHash, result.definitionHash);
});
test('invalid definition/input and empty samples never call model or pass', async () => {
  let called = 0; const dependencies = deps(async () => { called++; throw new Error('unexpected'); });
  const d = trialDefinition(); d.examples[0].input = { text: 3 };
  const invalid = await evaluateSkill(d, dependencies);
  assert.equal(invalid.passed, false); assert.equal(invalid.definitionHash, skillDefinitionHash(d));
  const empty = trialDefinition(); empty.examples = [];
  assert.equal((await evaluateSkill(empty, dependencies)).passed, false);
  assert.equal(called, 0);
});
test('output structure and business failures are distinct; expected output is never substituted', async () => {
  for (const [output, category] of [[{ wrong: 1 }, 'structure'], [{ items: ['别的'] }, 'assertion']] as const) {
    const result = await evaluateSkill(trialDefinition(), deps(async () => ({ output, provider: 'p', model: 'm', usage: { outputTokens: 2 } })));
    assert.equal(result.passed, false); assert.equal(result.cases[0].failures[0].category, category);
    assert.deepEqual(result.cases[0].output, output);
  }
});
test('declarative assertions support safe field paths and reject malicious paths', async () => {
  const d = trialDefinition();
  d.examples[0].assertions = [{ path: '$.items', op: 'minItems', value: 1 }, { path: '$.items', op: 'contains', value: '审批' }, { path: '$.items.0', op: 'equals', value: '审批' }, { path: '$.items', op: 'exists' }];
  assert.equal((await evaluateSkill(d, deps())).passed, true);
  d.examples[0].assertions = [{ path: '$.items', op: 'contains', value: '缺失' }];
  assert.equal((await evaluateSkill(d, deps())).cases[0].failures[0].category, 'assertion');
  d.examples[0].assertions = [{ path: '$.__proto__.x', op: 'exists' }];
  assert.equal((await evaluateSkill(d, deps())).passed, false);
});
test('simulation is explicit and cannot release even when outputs pass', async () => {
  const result = await evaluateSkill(trialDefinition(), { ...deps(), mode: 'simulation' });
  assert.equal(result.passed, true); assert.equal(result.mode, 'simulation'); assert.equal(result.releaseEligible, false);
});
test('model tools are mapped and writes isolated; repeats, unknown calls and absent executors fail', async () => {
  const d = trialDefinition(); d.tools = nativeTools.map(t => ({ toolName: t.name, inputMapping: { query: '$.text' }, requiresConfirmation: t.name !== 'read' }));
  let reads = 0; let count = 0;
  const result = await evaluateSkill(d, { ...deps(async request => {
    count++;
    if (count === 1) return { toolCalls: [{ id: 'w', name: 'write', arguments: { query: '审批' } }, { id: 's', name: 'send', arguments: { query: '审批' } }, { id: 'r', name: 'read', arguments: { query: '审批' } }], provider: 'p', model: 'm', usage: { outputTokens: 5 } };
    assert.equal(request.toolResults.length, 3);
    return { output: { items: ['审批'] }, provider: 'p', model: 'm', usage: { outputTokens: 5 } };
  }), runReadTool: async () => { reads++; return { found: true }; } });
  assert.equal(result.passed, true); assert.equal(reads, 1); assert.equal(result.simulatedSteps.length, 2); assert.equal(result.releaseEligible, true); assert.equal(result.releaseReason, 'MODEL_TRIAL_PASSED_WITH_ISOLATED_TOOLS');
  const missing = await evaluateSkill(d, deps(async () => ({ toolCalls: [{ id: 'r', name: 'read', arguments: { query: '审批' } }], provider: 'p', model: 'm', usage: { outputTokens: 1 } })));
  assert.equal(missing.cases[0].failures[0].category, 'tool');
  for (const name of ['invented', 'read']) {
    const repeated = await evaluateSkill(d, { ...deps(async () => ({ toolCalls: [{ id: 'same', name, arguments: { query: '审批' } }], provider: 'p', model: 'm', usage: { outputTokens: 1 } })), runReadTool: async () => ({}) });
    assert.equal(repeated.passed, false); assert.equal(repeated.cases[0].failures[0].category, 'tool');
  }
});
test('attempt, output token, tool and wall-clock budgets bound provider loops', async t => {
  const d = trialDefinition(); d.tools = [{ toolName: 'write', inputMapping: { query: '$.text' }, requiresConfirmation: true }];
  for (const budget of [{ maxModelAttempts: 1 }, { maxOutputTokens: 1 }, { maxToolCalls: 0 }]) {
    let id = 0;
    const result = await evaluateSkill(d, deps(async () => ({ toolCalls: [{ id: String(id++), name: 'write', arguments: { query: '审批' } }], provider: 'p', model: 'm', usage: { outputTokens: 2 } })), budget);
    assert.equal(result.passed, false); assert.equal(result.cases[0].failures[0].category, 'budget');
  }
  let signal: AbortSignal | undefined; let providerEnteredAt: number | undefined; let requestedTimeout: number | undefined;
  const realNow = performance.now.bind(performance); const start = Date.now();
  // Isolate the hung-I/O budget from variable schema setup cost; timers remain real.
  const clock = t.mock.method(performance, 'now', () => providerEnteredAt === undefined ? 0 : realNow() - providerEnteredAt);
  try {
    const result = await evaluateSkill(d, deps(async r => {
      providerEnteredAt = realNow(); signal = r.signal; requestedTimeout = r.model.timeoutMs;
      return new Promise(() => {});
    }), { totalTimeoutMs: 20 });
    assert.notEqual(providerEnteredAt, undefined); assert.equal(requestedTimeout, 20);
    assert.equal(result.cases[0].failures[0].category, 'budget'); assert.equal(signal?.aborted, true); assert.ok(Date.now() - start < 500);
  } finally { clock.mock.restore(); }
});
test('setup exceeding the total deadline prevents provider entry', async t => {
  let clockReads = 0; let providerCalls = 0;
  const clock = t.mock.method(performance, 'now', () => clockReads++ === 0 ? 0 : 21);
  try {
    const result = await evaluateSkill(trialDefinition(), deps(async () => { providerCalls++; return new Promise(() => {}); }), { totalTimeoutMs: 20 });
    assert.deepEqual(result.failures, [{ category: 'budget', code: 'TOTAL_TIMEOUT' }]);
    assert.equal(result.cases.length, 0); assert.equal(result.usage.modelAttempts, 0); assert.equal(providerCalls, 0);
    assert.equal(result.modelExecuted, false); assert.equal(result.passed, false); assert.equal(result.releaseEligible, false);
  } finally { clock.mock.restore(); }
});
test('errors are safe and missing/invalid usage cannot become release evidence', async () => {
  const secret = 'sk-example-credential';
  const failed = await evaluateSkill(trialDefinition(), deps(async () => { throw new Error(secret); }));
  assert.equal(JSON.stringify(failed).includes(secret), false); assert.equal(failed.cases[0].failures[0].category, 'provider');
  const missing = await evaluateSkill(trialDefinition(), deps(async () => ({ output: { items: ['审批'] }, provider: 'p', model: 'm' } as any)));
  assert.equal(missing.passed, false);
});

test('request mutation cannot alter definition, expected values or canonical hash', async () => {
  const d = trialDefinition(); const hash = skillDefinitionHash(d);
  const result = await evaluateSkill(d, deps(async request => {
    request.input = {}; request.outputSchema.type = 'string'; request.model.maxTokens = 99999;
    return { output: { items: ['审批'] }, provider: 'p', model: 'm', usage: { outputTokens: 1 } };
  }));
  assert.equal(result.passed, true); assert.equal(result.definitionHash, hash); assert.equal(skillDefinitionHash(d), hash);
});
test('read tools are also abortable and stale asynchronous failures do not leak', async () => {
  const d = trialDefinition(); d.tools = [{ toolName: 'read', inputMapping: { query: '$.text' }, requiresConfirmation: false }];
  let signal: AbortSignal | undefined;
  const result = await evaluateSkill(d, { ...deps(async () => ({ toolCalls: [{ id: 'r', name: 'read', arguments: { query: '审批' } }], provider: 'p', model: 'm', usage: { outputTokens: 1 } })),
    runReadTool: async (_name, _params, s) => { signal = s; return new Promise(() => {}); } }, { totalTimeoutMs: 80 });
  assert.equal(signal?.aborted, true); assert.equal(result.cases[0].failures[0].category, 'budget');
});
test('malformed provider responses, invalid tokens and unsafe output are rejected', async () => {
  for (const response of [
    { output: { items: ['审批'] }, usage: { outputTokens: 0 } },
    { output: { items: ['审批'] }, usage: { outputTokens: -1 } },
    { output: { items: ['审批'] }, usage: { outputTokens: 1.5 } },
    { output: { items: ['审批'] }, toolCalls: [{ id: 'x', name: 'write', arguments: {} }], usage: { outputTokens: 1 } },
    { output: JSON.parse('{"__proto__":{"secret":"x"}}'), usage: { outputTokens: 1 } },
    { usage: { outputTokens: 1 } },
  ]) {
    const result = await evaluateSkill(trialDefinition(), deps(async () => ({ provider: 'p', model: 'm', ...response })));
    assert.equal(result.passed, false); assert.equal(result.releaseEligible, false);
  }
});
test('budgets are shared across examples and each case retains its evidence', async () => {
  const d = trialDefinition(); d.examples.push({ ...d.examples[0], title: 'second' });
  const result = await evaluateSkill(d, deps(), { maxModelAttempts: 1 });
  assert.equal(result.cases.length, 2); assert.equal(result.cases[0].passed, true);
  assert.equal(result.cases[1].failures[0].code, 'MODEL_ATTEMPT_LIMIT'); assert.equal(result.usage.modelAttempts, 1);
});

for (const source of ['provider', 'read executor'] as const) test(`typed ${source} failures cannot carry secrets into evidence`, async () => {
  const secret = 'sk-review-probe-not-a-real-credential';
  const d = trialDefinition();
  if (source === 'read executor') d.tools = [{ toolName: 'read', inputMapping: { query: '$.text' }, requiresConfirmation: false }];
  const result = await evaluateSkill(d, { ...deps(async () => {
    if (source === 'provider') throw new SkillTrialFailure('provider', secret);
    return { toolCalls: [{ id: 'r', name: 'read', arguments: { query: '审批' } }], provider: 'p', model: 'm', usage: { outputTokens: 1 } };
  }), runReadTool: async () => { throw new SkillTrialFailure('tool', secret); } });
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(result.cases[0].failures, [{ category: source === 'provider' ? 'provider' : 'tool', code: source === 'provider' ? 'MODEL_REQUEST_FAILED' : 'READ_TOOL_FAILED' }]);
});

const blockFor = (milliseconds: number) => { const end = performance.now() + milliseconds; while (performance.now() < end) { /* Deliberately block the event loop. */ } };
for (const source of ['provider', 'read executor'] as const) test(`CPU-bound ${source} cannot outrun a delayed timeout timer`, async () => {
  const d = trialDefinition(); let signal: AbortSignal | undefined;
  if (source === 'read executor') d.tools = [{ toolName: 'read', inputMapping: { query: '$.text' }, requiresConfirmation: false }];
  let attempt = 0;
  const result = await evaluateSkill(d, { ...deps(async request => {
    attempt++; signal = request.signal;
    if (source === 'provider') blockFor(80);
    if (source === 'read executor' && attempt === 1) return { toolCalls: [{ id: 'r', name: 'read', arguments: { query: '审批' } }], provider: 'p', model: 'm', usage: { outputTokens: 1 } };
    return { output: { items: ['审批'] }, provider: 'p', model: 'm', usage: { outputTokens: 1 } };
  }), runReadTool: async (_name, _params, s) => { signal = s; blockFor(80); return {}; } }, { totalTimeoutMs: 50 });
  assert.equal(result.passed, false); assert.equal(result.releaseEligible, false);
  assert.equal(result.cases[0].failures[0].category, 'budget'); assert.equal(signal?.aborted, true);
});
test('output validation counts toward total deadline and aborts the completed provider signal', async () => {
  const d = trialDefinition();
  d.outputSchema = { type: 'object', properties: { items: { type: 'array', uniqueItems: true, items: { type: 'object', properties: { x: { type: 'integer' } }, required: ['x'], additionalProperties: false } } }, required: ['items'], additionalProperties: false };
  d.examples[0].expected = { items: [] }; d.examples[0].assertions = [{ path: '$.items', op: 'exists' }];
  d.model.maxTokens = 64000;
  let signal: AbortSignal | undefined;
  const result = await evaluateSkill(d, deps(async request => { signal = request.signal;
    return { output: { items: Array.from({ length: 7000 }, (_, x) => ({ x })) }, provider: 'p', model: 'm', usage: { outputTokens: 30000 } };
  }), { totalTimeoutMs: 100 });
  assert.equal(result.passed, false); assert.equal(result.releaseEligible, false);
  assert.equal(result.cases[0].failures[0].category, 'budget'); assert.equal(signal?.aborted, true);
});
test('explicit null toolCalls is a malformed response even with valid output', async () => {
  const result = await evaluateSkill(trialDefinition(), deps(async () => ({ output: { items: ['审批'] }, toolCalls: null, provider: 'p', model: 'm', usage: { outputTokens: 1 } } as any)));
  assert.equal(result.passed, false); assert.equal(result.cases[0].failures[0].code, 'INVALID_MODEL_RESPONSE');
});
test('retained dependency mutation cannot turn simulation into real model evidence', async () => {
  const d = trialDefinition(); d.tools = [{ toolName: 'write', inputMapping: { query: '$.text' }, requiresConfirmation: true }];
  let attempt = 0;
  const dependencies = { ...deps(async () => {
    dependencies.mode = 'model'; attempt++;
    return attempt === 1 ? { toolCalls: [{ id: 'w', name: 'write', arguments: { query: '审批' } }], provider: 'p', model: 'm', usage: { outputTokens: 1 } } : { output: { items: ['审批'] }, provider: 'p', model: 'm', usage: { outputTokens: 1 } };
  }), mode: 'simulation' as 'simulation' | 'model' };
  const result = await evaluateSkill(d, dependencies);
  assert.equal(result.passed, true); assert.equal(result.mode, 'simulation'); assert.equal(result.modelExecuted, false);
  assert.equal(result.releaseEligible, false); assert.equal(result.releaseReason, 'SIMULATION_ONLY');
});
