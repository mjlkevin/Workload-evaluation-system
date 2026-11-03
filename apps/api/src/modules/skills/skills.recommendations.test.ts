import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExecutionRecommendationService } from './skills.recommendations';
import { SkillError } from './skills.types';
import type { AuthUser, RequirementSystemConfig } from '../../types';
import type { ChatCompletionRequest } from '../../ai/provider/model-provider';
import { KimiProvider } from '../../ai/provider/kimi-provider';

const user = { id: 'recommend-user', username: 'reader', role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const entry = (kind: 'skill' | 'workflow' = 'skill', id = 'target', versionId = 'v1') => ({
  kind, id, versionId, name: `目录名称 ${kind}`, description: '目录用途', inputSchema: { type: 'object' },
});
const settings = { modelProviders: [{ id: 'custom-provider', name: 'Configured', enabled: true, protocol: 'openai-compatible',
  baseUrl: 'https://provider.invalid/v1', models: [{ id: 'generation-model' }] }],
  scenarioBindings: { generation: { providerId: 'custom-provider', modelId: 'generation-model' } },
} as unknown as RequirementSystemConfig;
function fixture(output: unknown = { candidateKeys: ['skill:target'] }, tokens = 20) {
  const calls: ChatCompletionRequest[] = [], readers: AuthUser[] = [];
  let lists = [ [entry()], [entry()] ];
  const service = createExecutionRecommendationService({
    catalog: { list: async actor => { readers.push(structuredClone(actor)); return lists[Math.min(readers.length - 1, lists.length - 1)]; } },
    model: {
      loadSettings: async () => settings,
      loadCredential: async scope => { assert.equal(scope, 'provider:custom-provider'); return 'fixture-placeholder'; },
      provider: { chatCompletion: async request => {
        calls.push(request);
        return { content: JSON.stringify(output), rawContent: 'PRIVATE_RAW', model: 'generation-model', provider: 'fixture', attempts: 1,
          usage: { completionTokens: tokens, promptTokens: 20, totalTokens: tokens + 20 } };
      } },
    },
  });
  return { service, calls, readers, catalog: (value: ReturnType<typeof entry>[][]) => { lists = value; } };
}
const errorCode = (code: string) => (error: unknown) => error instanceof SkillError && error.code === code;

test('authorized recommendation uses real generation binding once, no tools, canonical cards and no provider text', async () => {
  const f = fixture();
  const result = await f.service.recommend(user, { goal: '拆解需求' });
  assert.deepEqual(result, { outcome: 'recommended', message: '请选择候选项，补齐输入后明确启动。', items: [
    { kind: 'skill', id: 'target', versionId: 'v1', name: '目录名称 skill', description: '目录用途' },
  ] });
  assert.equal(f.calls.length, 1); assert.equal(f.readers.length, 2);
  assert.deepEqual(f.readers, [user, user]);
  const sent = f.calls[0];
  assert.equal(sent.model, 'generation-model'); assert.equal(sent.credentialsOverride?.apiBaseUrl, 'https://provider.invalid/v1');
  assert.equal(sent.maxAttempts, 1); assert.equal(sent.maxCompletionTokens, 512); assert.ok(sent.timeoutMs! <= 30000);
  assert.equal(sent.frozenExecution, true);
  assert.equal(sent.tools, undefined); assert.equal(sent.toolChoice, undefined);
  assert.ok(sent.abortSignal); assert.equal(sent.responseFormat, 'json_object');
  const input = JSON.parse(sent.messages[1].content);
  assert.deepEqual(input, { goal: '拆解需求', catalog: [{ kind: 'skill', id: 'target', name: '目录名称 skill', description: '目录用途' }] });
  for (const text of ['PRIVATE_RAW', 'fixture-placeholder', 'https://provider.invalid', 'credentialScope', 'inputSchema']) assert.equal(JSON.stringify(result).includes(text), false);
});

for (const body of [null, [], {}, { goal: '' }, { goal: '  ' }, { goal: 7 }, { goal: 'x'.repeat(4001) },
  { goal: 'x', catalog: [] }, { goal: 'x', model: 'forged' }, { goal: 'x', sessionId: 'someone-else' }]) {
  test(`strict goal shape rejects ${JSON.stringify(body)?.slice(0, 55)} before catalog or model`, async () => {
    const f = fixture();
    await assert.rejects(f.service.recommend(user, body), errorCode('EXECUTION_RECOMMENDATION_INPUT_INVALID'));
    assert.equal(f.readers.length, 0); assert.equal(f.calls.length, 0);
  });
}
test('4000-character boundary succeeds and empty catalog avoids model and credential reads', async () => {
  const f = fixture(); await f.service.recommend(user, { goal: 'x'.repeat(4000) }); assert.equal(f.calls.length, 1);
  const empty = createExecutionRecommendationService({ catalog: { list: async () => [] }, model: {
    loadSettings: async () => { assert.fail('empty catalog cannot prepare model'); },
    loadCredential: async () => { assert.fail('empty catalog cannot access credentials'); },
  } });
  assert.deepEqual(await empty.recommend(user, { goal: '目标' }), { outcome: 'no_match', items: [], message: '请补充希望完成的业务目标，或继续普通对话。' });
});
test('catalog count and UTF-8 projection size are bounded before model; no silent truncation', async () => {
  for (const list of [Array.from({ length: 101 }, (_, i) => entry('skill', `id${i}`)), [{ ...entry(), description: '汉'.repeat(16384) }]]) {
    const f = fixture(); f.catalog([list]);
    await assert.rejects(f.service.recommend(user, { goal: '目标' }), errorCode('EXECUTION_RECOMMENDATION_CATALOG_LIMIT'));
    assert.equal(f.calls.length, 0);
  }
  const f = fixture({ candidateKeys: [] }); f.catalog([Array.from({ length: 100 }, (_, i) => entry('skill', `id${i}`))]);
  assert.equal((await f.service.recommend(user, { goal: '目标' })).outcome, 'no_match'); assert.equal(f.calls.length, 1);
});
test('48KiB catalog and 512 output tokens are accepted exactly; one extra byte fails before model', async () => {
  const item = { ...entry(), description: '' };
  const { inputSchema: _schema, versionId: _version, ...projection } = item;
  item.description = 'x'.repeat(48 * 1024 - Buffer.byteLength(JSON.stringify([projection])));
  const f = fixture({ candidateKeys: ['skill:target'] }, 512); f.catalog([[item]]);
  assert.equal((await f.service.recommend(user, { goal: '目标' })).items.length, 1); assert.equal(f.calls.length, 1);
  const oversized = fixture(); oversized.catalog([[{ ...item, description: `${item.description}x` }]]);
  await assert.rejects(oversized.service.recommend(user, { goal: '目标' }), errorCode('EXECUTION_RECOMMENDATION_CATALOG_LIMIT'));
  assert.equal(oversized.calls.length, 0);
});
for (const output of [{ candidateKeys: ['skill:unknown'] }, { candidateKeys: ['skill:target', 'skill:target'] },
  { candidateKeys: ['workflow:target'] }, { candidateKeys: [1] }, { candidateKeys: 'skill:target' },
  { candidateKeys: ['skill:target'], reason: 'PRIVATE_MODEL_TEXT' }, {}, null,
  { candidateKeys: ['skill:target', 'skill:a', 'skill:b', 'skill:c'] }]) {
  test(`rejects untrusted candidate output ${JSON.stringify(output)}`, async () => {
    const f = fixture(output);
    await assert.rejects(f.service.recommend(user, { goal: '目标' }), errorCode('EXECUTION_RECOMMENDATION_MODEL_INVALID'));
    assert.equal(f.calls.length, 1);
  });
}
test('no-match is fixed text, and current kind/id/version intersection prevents changed or revoked cards', async () => {
  const noMatch = fixture({ candidateKeys: [] });
  assert.deepEqual(await noMatch.service.recommend(user, { goal: '目标' }), { outcome: 'no_match', items: [], message: '请补充希望完成的业务目标，或继续普通对话。' });
  const f = fixture({ candidateKeys: ['skill:target', 'workflow:target', 'skill:keep'] });
  f.catalog([[entry(), entry('workflow'), entry('skill', 'keep')], [entry('skill', 'target', 'v2'), entry('skill', 'keep'), entry('workflow', 'new')]]);
  const result = await f.service.recommend(user, { goal: '目标' });
  assert.deepEqual(result.items.map(item => `${item.kind}:${item.id}:${item.versionId}`), ['skill:keep:v1']);
  assert.equal(f.calls.length, 1); assert.equal(f.readers.length, 2);
});
test('reread uses original caller role and propagates current authority denial safely', async () => {
  const f = fixture(); let reads = 0;
  const service = createExecutionRecommendationService({ catalog: { list: async actor => {
    reads++; assert.equal(actor.role, 'admin'); assert.equal(actor.businessRole, 'pre_sales');
    if (reads === 2) throw new SkillError('EXECUTION_AUTHORITY_CHANGED', '当前用户权限已变化，请重新读取', 403);
    return [entry()];
  } }, model: { loadSettings: async () => settings, loadCredential: async () => 'fixture-placeholder', provider: {
    chatCompletion: async request => { f.calls.push(request); return { content: '{"candidateKeys":["skill:target"]}', rawContent: '', model: 'fixture', provider: 'fixture', attempts: 1, usage: { completionTokens: 5, promptTokens: 5, totalTokens: 10 } }; },
  } } });
  await assert.rejects(service.recommend(user, { goal: '目标' }), errorCode('EXECUTION_AUTHORITY_CHANGED'));
  assert.equal(reads, 2); assert.equal(f.calls.length, 1);
});
test('missing or invalid generation binding never falls back to other models', async () => {
  for (const active of [{}, { ...settings, scenarioBindings: {} }, { ...settings, modelProviders: [] },
    { ...settings, modelProviders: settings.modelProviders!.map(p => ({ ...p, enabled: false })) },
    { ...settings, modelProviders: settings.modelProviders!.map(p => ({ ...p, models: [] })) }]) {
    let calls = 0;
    const service = createExecutionRecommendationService({ catalog: { list: async () => [entry()] }, model: {
      loadSettings: async () => active as RequirementSystemConfig,
      loadCredential: async () => { assert.fail('invalid binding cannot request credentials'); },
      provider: { chatCompletion: async () => { calls++; assert.fail('cannot dispatch'); } },
    } });
    await assert.rejects(service.recommend(user, { goal: '目标' }), errorCode('EXECUTION_RECOMMENDATION_UNAVAILABLE')); assert.equal(calls, 0);
  }
});
for (const mode of ['tool', 'invalid-json', 'over-tokens', 'provider-error'] as const) {
  test(`model ${mode} fails closed without leaking provider data`, async () => {
    const service = createExecutionRecommendationService({ catalog: { list: async () => [entry()] }, model: {
      loadSettings: async () => settings, loadCredential: async () => 'fixture-placeholder', provider: { chatCompletion: async () => {
        if (mode === 'provider-error') throw Error('PRIVATE_PROVIDER_DETAIL');
        return { content: mode === 'invalid-json' ? 'PRIVATE_INVALID_JSON' : '{"candidateKeys":["skill:target"]}', rawContent: 'PRIVATE_RAW', provider: 'fixture', model: 'fixture', attempts: 1,
          ...(mode === 'tool' ? { toolCalls: [{ id: 'call', name: 'write', arguments: {} }] } : {}),
          usage: { completionTokens: mode === 'over-tokens' ? 513 : 5, promptTokens: 5, totalTokens: 518 } };
      } },
    } });
    await assert.rejects(service.recommend(user, { goal: '目标' }), (error: unknown) => {
      assert.ok(error instanceof SkillError); assert.equal(error.message.includes('PRIVATE'), false); assert.ok([502, 503].includes(error.status)); return true;
    });
  });
}
test('30-second total deadline aborts a provider that ignores cancellation and ignores its late result', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let dispatched!: () => void; const started = new Promise<void>(resolve => { dispatched = resolve; });
  let signal!: AbortSignal, finish!: (value: any) => void; let reads = 0;
  const service = createExecutionRecommendationService({ catalog: { list: async () => { reads++; return [entry()]; } }, model: {
    loadSettings: async () => settings, loadCredential: async () => 'fixture-placeholder', provider: { chatCompletion: async request => {
      signal = request.abortSignal!; dispatched(); return new Promise(resolve => { finish = resolve; });
    } },
  } });
  const pending = service.recommend(user, { goal: '目标' });
  const rejected = assert.rejects(pending, errorCode('EXECUTION_RECOMMENDATION_TIMEOUT'));
  await started; context.mock.timers.tick(30000); await rejected;
  assert.equal(signal.aborted, true); assert.equal(reads, 1);
  finish({ content: '{"candidateKeys":["skill:target"]}', rawContent: '', model: 'fixture', provider: 'fixture', attempts: 1 });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(reads, 1);
});
for (const phase of ['catalog', 'settings'] as const) test(`total deadline covers ${phase} and late preparation cannot start new credential/model work`, async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let entered!: () => void, release!: (value: any) => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const delayed = () => { entered(); return new Promise<any>(resolve => { release = resolve; }); };
  let settingsReads = 0, credentialReads = 0, modelCalls = 0;
  const service = createExecutionRecommendationService({ catalog: { list: async () => phase === 'catalog' ? delayed() : [entry()] }, model: {
    loadSettings: async () => { settingsReads++; return phase === 'settings' ? delayed() : settings; },
    loadCredential: async () => { credentialReads++; return 'fixture-placeholder'; },
    provider: { chatCompletion: async () => { modelCalls++; assert.fail('late work cannot dispatch'); } },
  } });
  const pending = service.recommend(user, { goal: '目标' }); const rejected = assert.rejects(pending, errorCode('EXECUTION_RECOMMENDATION_TIMEOUT'));
  await started; context.mock.timers.tick(30000); await rejected;
  release(phase === 'catalog' ? [entry()] : settings);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settingsReads, phase === 'settings' ? 1 : 0); assert.equal(credentialReads, 0); assert.equal(modelCalls, 0);
});
function realProviderService(modelId = 'generation-model') {
  const active = structuredClone(settings);
  active.modelProviders![0].models[0].id = modelId;
  active.scenarioBindings!.generation.modelId = modelId;
  return createExecutionRecommendationService({ catalog: { list: async () => [entry()] }, model: {
    loadSettings: async () => active, loadCredential: async () => 'fixture-placeholder', provider: new KimiProvider({ apiKey: 'fixture-placeholder' }),
  } });
}
const rawSuccess = (extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ choices: [{ message: {
  content: '{"candidateKeys":["skill:target"]}', ...extra,
} }], usage: { completion_tokens: 12 } }), { status: 200 });
test('real provider performs only one fetch on temperature error; no hidden compatibility retry', async context => {
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async () => ++calls === 1
    ? new Response('invalid temperature only 1 is allowed', { status: 400 }) : rawSuccess());
  const outcome = await realProviderService().recommend(user, { goal: '目标' }).then(() => null, error => error);
  assert.equal(calls, 1); assert.ok(outcome instanceof SkillError); assert.equal(outcome.status, 503);
});
for (const rawCalls of ['malformed', null, [null], [{ id: 4, function: { name: 'write', arguments: '{}' } }],
  [{ id: 'a', type: 'other', function: { name: 'write', arguments: '[]' } }]]) {
  test(`real provider rejects malformed raw tool_calls ${JSON.stringify(rawCalls)} despite valid candidate JSON`, async context => {
    let calls = 0; context.mock.method(globalThis, 'fetch', async () => { calls++; return rawSuccess({ tool_calls: rawCalls }); });
    await assert.rejects(realProviderService().recommend(user, { goal: '目标' }), errorCode('EXECUTION_RECOMMENDATION_MODEL_INVALID'));
    assert.equal(calls, 1);
  });
}
test('real provider preserves exact K3 model while omitting incompatible temperature', async context => {
  let body: any; let calls = 0;
  context.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], options?: RequestInit) => { calls++; body = JSON.parse(options!.body as string); return rawSuccess(); });
  const result = await realProviderService('KiMi-K3').recommend(user, { goal: '目标' });
  assert.equal(result.items.length, 1); assert.equal(calls, 1); assert.equal(body.model, 'KiMi-K3');
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'temperature'), false); assert.equal(body.tools, undefined);
});
test('real provider fetch that ignores abort remains bounded by recommendation total deadline', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let entered!: () => void, finish!: (response: Response) => void, signal!: AbortSignal; let calls = 0;
  const started = new Promise<void>(resolve => { entered = resolve; });
  context.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], options?: RequestInit) => {
    calls++; signal = options!.signal as AbortSignal; entered(); return new Promise<Response>(resolve => { finish = resolve; });
  });
  const pending = realProviderService().recommend(user, { goal: '目标' });
  const rejected = assert.rejects(pending, errorCode('EXECUTION_RECOMMENDATION_TIMEOUT'));
  await started; context.mock.timers.tick(30000); await rejected;
  assert.equal(signal.aborted, true); assert.equal(calls, 1); finish(rawSuccess());
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1);
});
