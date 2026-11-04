import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkflowRuntime } from './workflows.runtime-adapter';
import { manifest, single, path, literal, predicate, objectSchema, hash, payload } from './workflows.runtime.fixture';
import { frozenManifest, runFixture, context, checkpoint } from './business-skills.test-fixture';
import { createBusinessSkillsWorkflow } from './business-skills.workflow';
import { copyTrialJson, readPersistedExecutionManifest } from '../skills/skills.module';
const executionId = 'server-execution';
const ready = (decision: any) => { assert.equal(decision.kind, 'ready'); return decision; };
const done = (decision: any, output: unknown) => { assert.equal(decision.kind, 'completed'); assert.deepEqual(decision.output, output); return decision; };
const settle = (r: ReturnType<typeof createWorkflowRuntime>, d: any, output: unknown) => r.settle(d.state, { operationId: ready(d).command.operationId, output });
const fresh = (m = manifest(), id = executionId) => createWorkflowRuntime(m, id);
const invalid = (fn: () => unknown, code = 'WORKFLOW_RUNTIME_INVALID_STATE') => assert.throws(fn, { message: code });

test('four commands preserve exact frozen contracts and complete with original schema output', () => {
  const m = manifest(); assert.deepEqual(readPersistedExecutionManifest(m), m);
  const r = fresh(m); let d = ready(r.next()); const skill = m.skills[0];
  assert.equal(d.command.type, 'skill'); assert.equal(d.command.skillId, skill.skillId); assert.equal(d.command.skillVersionId, skill.versionId);
  assert.deepEqual(d.command.input, { text: 'original' }); assert.deepEqual(d.command.outputSchema, skill.definition.outputSchema);
  assert.deepEqual(d.command.dependency, skill); assert.equal(d.command.iteration, 1);
  assert.equal(d.command.operationId, hash({ executionId, manifestHash: m.manifestHash, stepId: 's', iteration: 1 }));
  d = ready(settle(r, d, { text: 'from skill' })); assert.equal(d.command.type, 'userInput'); assert.equal(d.command.prompt, 'Original prompt');
  assert.deepEqual(d.command.inputSchema, payload); assert.deepEqual(d.command.outputSchema, payload); assert.deepEqual(d.command.input, { text: 'from skill' });
  d = ready(settle(r, d, { text: 'from user' })); assert.equal(d.command.type, 'confirmation'); assert.equal(d.command.prompt, 'Approve?');
  assert.deepEqual(d.command.outputSchema, objectSchema({ approved: { type: 'boolean' } }));
  d = ready(settle(r, d, { approved: false })); assert.equal(d.command.type, 'tool'); assert.equal(d.command.requiresConfirmation, true);
  assert.deepEqual(d.command.contract, m.tools[0].contract); assert.deepEqual(d.command.input, { text: 'from user' });
  const result = done(settle(r, d, { opaque: ['native', 0] }), { text: 'from user' });
  assert.deepEqual(result.state.receipts[3].opaqueResult, { opaque: ['native', 0] }); assert.equal('output' in result.state.receipts[3], false);
});

for (const [name, schema, value] of [['null', { type: 'null' }, null], ['false', { type: 'boolean' }, false], ['zero', { type: 'number' }, 0], ['empty', { type: 'string' }, ''], ['nested', objectSchema({ leaf: { type: 'string' } }), { leaf: 'leaf' }]] as const) {
  test(`mapping preserves existing ${name} instead of fallback`, () => {
    const m = single((d, m) => {
      const s = objectSchema({ value: schema }); d.inputSchema = s; m.initialInput = { value }; m.skills[0].definition.inputSchema = s;
      d.steps[0].inputMapping = [path('value', '$.input.value', value)];
    });
    assert.deepEqual(ready(fresh(m).next()).command.input, { value });
  });
}
test('missing optional nested path uses copied fallback and literal objects', () => {
  const fallback = { leaf: 'fallback' }; const lit = { leaf: 'literal' };
  const m = single((d, m) => { d.inputSchema = objectSchema({ parent: objectSchema({ value: objectSchema({ leaf: { type: 'string' } }) }, []) }, []); m.initialInput = {};
    m.skills[0].definition.inputSchema = objectSchema({ value: objectSchema({ leaf: { type: 'string' } }), literal: objectSchema({ leaf: { type: 'string' } }) });
    d.steps[0].inputMapping = [path('value', '$.input.parent.value', fallback), literal('literal', lit)]; });
  const r = fresh(m); const d = ready(r.next()); d.command.input.value.leaf = 'changed'; d.command.input.literal.leaf = 'changed';
  assert.deepEqual(ready(r.next()).command.input, { value: fallback, literal: lit });
});
test('nested own-property path produces declared flat field', () => {
  const m = single((d, m) => { d.inputSchema = objectSchema({ parent: objectSchema({ text: { type: 'string' } }) }); m.initialInput = { parent: { text: 'nested' } };
    d.steps[0].inputMapping = [path('text', '$.input.parent.text')]; });
  assert.deepEqual(ready(fresh(m).next()).command.input, { text: 'nested' });
});
for (const unsafe of ['$.input.__proto__.text', '$.input.constructor', '$.input.text[0]', '$.input.*', 'eval(1)', '$.steps.future.output.text'])
  test(`rejects unsupported source ${unsafe}`, () => invalid(() => fresh(single(d => { d.steps[0].inputMapping = [path('text', unsafe)]; })), 'WORKFLOW_RUNTIME_INVALID_MANIFEST'));
test('tool result cannot be mapped even with fallback', () => invalid(() => fresh(manifest(d => { d.outputMapping = [path('text', '$.steps.t.output.text', 'fallback')]; })), 'WORKFLOW_RUNTIME_INVALID_MANIFEST'));

for (const [op, value, expected] of [['eq', { a: 1, b: [false, null] }, true], ['neq', { a: 1, b: [false, null] }, false], ['in', [{ b: [false, null], a: 1 }], true], ['neq', { a: 2, b: [false, null] }, true]] as const)
  test(`structural predicate ${op} => ${expected}`, () => {
    const m = single((d, m) => { d.inputSchema = objectSchema({ v: objectSchema({ a: { type: 'number' }, b: { type: 'array', items: {} } }) });
      m.initialInput = { v: { b: [false, null], a: 1 } }; d.steps[0].inputMapping = [literal('text', 'fixed')];
      d.steps[0].prerequisite = [predicate('$.input.v', op, value)]; d.outputMapping = [path('text', '$.steps.s.output.text', 'skipped')]; });
    const d = fresh(m).next(); assert.equal(d.kind, expected ? 'ready' : 'completed');
    if (!expected) done(d, { text: 'skipped' });
  });
for (const [op, value, expected] of [['gt', 1, true], ['gte', 2, true], ['lt', 2, false], ['lte', 1, false]] as const)
  test(`finite numeric ${op} => ${expected}`, () => {
    const m = single((d, m) => { d.inputSchema = objectSchema({ n: { type: 'number' } }); m.initialInput = { n: 2 }; d.steps[0].inputMapping = [literal('text', 'n')];
      d.steps[0].prerequisite = [predicate('$.input.n', op, value)]; d.outputMapping = [path('text', '$.steps.s.output.text', 'skipped')]; });
    assert.equal(fresh(m).next().kind, expected ? 'ready' : 'completed');
  });
test('exists sees null but absent field skips, predicate arrays use AND', () => {
  for (const [initialInput, expected] of [[{ v: null }, 'ready'], [{}, 'completed']] as const) {
    const m = single((d, m) => { d.inputSchema = objectSchema({ v: { type: 'null' } }, []); m.initialInput = initialInput;
      d.steps[0].prerequisite = [predicate('$.input.v', 'exists'), predicate('$.input.v', 'exists')]; d.outputMapping = [path('text', '$.steps.s.output.text', 'skipped')]; d.steps[0].inputMapping = [literal('text', 'yes')]; });
    assert.equal(fresh(m).next().kind, expected);
  }
});
test('rejects implicit numeric conversion and missing required comparison source', () => {
  for (const optional of [false, true]) invalid(() => fresh(single((d, m) => {
    d.inputSchema = objectSchema({ n: { type: optional ? 'number' : 'string' } }, optional ? [] : ['n']); m.initialInput = optional ? {} : { n: '2' };
    d.steps[0].inputMapping = [literal('text', 'x')]; d.steps[0].prerequisite = [predicate('$.input.n', 'gt', 1)]; d.outputMapping = [path('text', '$.steps.s.output.text', 'skipped')];
  })), 'WORKFLOW_RUNTIME_INVALID_MANIFEST');
});
test('prerequisite skip does not run branch or repeat and skipped output needs fallback', () => {
  const m = single(d => { d.steps[0].prerequisite = [predicate('$.input.text', 'eq', 'different')];
    d.steps[0].branches = [{ when: [predicate('$.input.text', 'exists')], target: '$end' }];
    d.steps[0].repeat = { while: [predicate('$.input.text', 'exists')], maxIterations: 1, onLimit: 'fail' };
    d.outputMapping = [path('text', '$.steps.s.output.text', 'skipped')]; });
  done(fresh(m).next(), { text: 'skipped' });
});
test('first matching branch skips later nodes; $end preserves fallback output', () => {
  const m = manifest(d => { d.steps[0].branches = [{ when: [predicate('$.input.text', 'exists')], target: '$end' }, { when: [predicate('$.input.text', 'exists')], target: 'c' }];
    d.steps[1].inputMapping = [path('text', '$.steps.s.output.text', 'skip')]; d.steps[2].inputMapping = [path('text', '$.steps.u.output.text', 'skip')];
    d.steps[3].inputMapping = [path('text', '$.steps.u.output.text', 'skip')]; d.outputMapping = [path('text', '$.steps.u.output.text', 'end')]; });
  const r = fresh(m); done(settle(r, r.next(), { text: 'branch' }), { text: 'end' });
});
for (const maxIterations of [1, 10]) for (const mode of ['wait', 'fail'] as const)
  test(`do-while limit ${maxIterations} ${mode} never emits an excess operation`, () => {
    const r = fresh(single(d => { d.steps[0].repeat = { while: [predicate('$.steps.s.output.text', 'eq', 'again')], maxIterations, onLimit: mode }; }));
    let d = r.next(); const ids = new Set<string>();
    for (let iteration = 1; iteration <= maxIterations; iteration++) { const command = ready(d).command; assert.equal(command.iteration, iteration); ids.add(command.operationId); d = settle(r, d, { text: 'again' }); }
    assert.equal(ids.size, maxIterations); assert.equal(d.kind, mode === 'wait' ? 'waiting' : 'failed'); assert.equal(d.code, 'repeat_limit');
    assert.deepEqual(r.next(JSON.parse(JSON.stringify(d.state))), d);
  });
test('repeat ends before max then branches with latest output', () => {
  const r = fresh(single(d => { d.steps[0].repeat = { while: [predicate('$.steps.s.output.text', 'eq', 'again')], maxIterations: 10, onLimit: 'fail' }; }));
  let d = settle(r, r.next(), { text: 'again' }); assert.equal(ready(d).command.iteration, 2);
  done(settle(r, d, { text: 'finished' }), { text: 'finished' });
});
for (const maxIterations of [0, 11]) test(`invalid repeat bound ${maxIterations} fails C1 validation`, () => invalid(() => fresh(single(d => { d.steps[0].repeat = { while: [predicate('$.input.text', 'exists')], maxIterations, onLimit: 'wait' }; })), 'WORKFLOW_RUNTIME_INVALID_MANIFEST'));
for (const mode of ['wait', 'fail'] as const) test(`failure ${mode} retains only a fixed safe code and never retries`, () => {
  const r = fresh(single(d => { d.steps[0].onFailure = mode; })); const first = ready(r.next());
  const d = r.fail(first.state, { operationId: first.command.operationId, code: 'execution_failed' });
  assert.equal(d.kind, mode === 'wait' ? 'waiting' : 'failed'); assert.equal(d.code, 'execution_failed'); assert.deepEqual(r.next(d.state), d);
  invalid(() => r.fail(first.state, { operationId: first.command.operationId, code: 'SQL private text' as any }), 'WORKFLOW_RUNTIME_INVALID_RECEIPT');
  assert.equal(JSON.stringify(d).includes('SQL'), false);
});

test('serialized intermediate and terminal recovery derive outputs without mutable cursor', () => {
  const m = manifest(); const r = fresh(m); const first = ready(r.next()); const middle = settle(r, first, { text: 's' });
  let d = fresh(m).next(JSON.parse(JSON.stringify(middle.state))); assert.deepEqual(d, middle);
  d = settle(r, d, { text: 'u' }); d = settle(r, d, { approved: true }); d = done(settle(r, d, null), { text: 'u' });
  assert.deepEqual(fresh(m).next(JSON.parse(JSON.stringify(d.state))), d);
});
test('frozen manifest, input state, commands, receipts and final outputs are independently copied', () => {
  const m = single(); const r = fresh(m); const first = ready(r.next());
  (m.initialInput as any).text = 'changed'; m.skills[0].definition.outputSchema = { type: 'object' }; (m.target.definition as any).outputMapping = [];
  first.command.dependency.definition.instructions = 'changed'; first.command.input.text = 'changed'; first.state.receipts.push({ garbage: true });
  const untouched = ready(r.next()); assert.deepEqual(untouched.command.input, { text: 'original' }); assert.equal(untouched.state.receipts.length, 0);
  const output = { text: 'original result' }; const result = done(settle(r, untouched, output), output); output.text = 'mutated';
  result.output.text = 'mutated'; done(r.next(result.state), { text: 'original result' });
  const state = structuredClone(result.state); const restored = done(r.next(state), { text: 'original result' }); state.receipts[0].output.text = 'external'; assert.equal(restored.state.receipts[0].output.text, 'original result');
});
test('duplicate receipt is idempotent but returns currently derived next action', () => {
  const r = fresh(); const a = ready(r.next()); const b = ready(settle(r, a, { text: 's' })); const c = ready(settle(r, b, { text: 'u' }));
  const duplicate = r.settle(c.state, { operationId: a.command.operationId, output: { text: 's' } }); assert.deepEqual(duplicate, c); assert.equal(duplicate.state.receipts.length, 2);
  invalid(() => r.settle(c.state, { operationId: a.command.operationId, output: { text: 'conflict' } }), 'WORKFLOW_RUNTIME_INVALID_RECEIPT');
  invalid(() => r.fail(c.state, { operationId: a.command.operationId, code: 'rejected' }), 'WORKFLOW_RUNTIME_INVALID_RECEIPT');
  invalid(() => r.settle(c.state, { operationId: 'future', output: {} }), 'WORKFLOW_RUNTIME_INVALID_RECEIPT');
});
test('failure duplicates stay terminal and success/failure collisions reject', () => {
  const r = fresh(single()); const first = ready(r.next()); const receipt = { operationId: first.command.operationId, code: 'rejected' as const };
  const d = r.fail(first.state, receipt); assert.deepEqual(r.fail(d.state, receipt), d);
  invalid(() => r.fail(d.state, { ...receipt, code: 'invalid_output' }), 'WORKFLOW_RUNTIME_INVALID_RECEIPT');
  invalid(() => r.settle(d.state, { operationId: receipt.operationId, output: { text: 'x' } }), 'WORKFLOW_RUNTIME_INVALID_RECEIPT');
});
for (const mutation of ['schema', 'execution', 'manifest', 'extra', 'receipts', 'count', 'future', 'receipt-extra', 'receipt-output', 'receipt-status', 'order', 'after-end'])
  test(`rejects invalid replay ${mutation}`, () => {
    const r = fresh(); const a = ready(r.next()); const b = ready(settle(r, a, { text: 's' })); const c = ready(settle(r, b, { text: 'u' })); const s: any = structuredClone(c.state);
    if (mutation === 'schema') s.schemaVersion = 2;
    if (mutation === 'execution') s.executionId = 'another';
    if (mutation === 'manifest') s.manifestHash = 'another';
    if (mutation === 'extra') s.cursor = 2;
    if (mutation === 'receipts') s.receipts = {};
    if (mutation === 'count') s.receipts = Array(501).fill(s.receipts[0]);
    if (mutation === 'future') s.receipts[0].operationId = c.command.operationId;
    if (mutation === 'receipt-extra') s.receipts[0].sql = 'private';
    if (mutation === 'receipt-output') s.receipts[0].output = { text: 1 };
    if (mutation === 'receipt-status') s.receipts[0].status = 'pending';
    if (mutation === 'order') s.receipts.reverse();
    if (mutation === 'after-end') { const one = fresh(single()); const first = ready(one.next()); const terminal = settle(one, first, { text: 'x' }); terminal.state.receipts.push(terminal.state.receipts[0]); return invalid(() => one.next(terminal.state)); }
    invalid(() => r.next(s));
  });
for (const dangerous of ['unsafe', 'size', 'depth']) test(`bounded JSON rejects ${dangerous} state and output`, () => {
  const r = fresh(single()); const d = ready(r.next()); let value: any = JSON.parse('{"__proto__":{}}');
  if (dangerous === 'size') value = { text: 'x'.repeat(1024 * 1024) };
  if (dangerous === 'depth') { value = {}; let child = value; for (let i = 0; i < 34; i++) child = child.next = {}; }
  invalid(() => r.next({ ...d.state, receipts: [value] }));
  invalid(() => settle(r, d, value), 'WORKFLOW_RUNTIME_INVALID_RECEIPT');
});
test('schema-invalid receipts and invalid settlement contracts reject without advancing', () => {
  const r = fresh(); const a = ready(r.next()); invalid(() => settle(r, a, { text: 3 }), 'WORKFLOW_RUNTIME_INVALID_OUTPUT');
  let d = settle(r, a, { text: 's' }); d = settle(r, d, { text: 'u' }); invalid(() => settle(r, d, { approved: 'true' }), 'WORKFLOW_RUNTIME_INVALID_OUTPUT');
  assert.deepEqual(r.next(a.state), a);
});
test('wrong kind, execution ID, corrupt manifest and frozen bad schema fail closed', () => {
  invalid(() => fresh(frozenManifest()), 'WORKFLOW_RUNTIME_INVALID_MANIFEST');
  for (const id of ['', '  ', 'x'.repeat(161)]) invalid(() => fresh(manifest(), id), 'WORKFLOW_RUNTIME_INVALID_EXECUTION');
  const m = manifest(); (m.initialInput as any).text = 3; invalid(() => fresh(m), 'WORKFLOW_RUNTIME_INVALID_MANIFEST');
  invalid(() => fresh(single((_d, m) => { m.skills[0].definition.outputSchema = { type: 'object', anyOf: [] }; })), 'WORKFLOW_RUNTIME_INVALID_MANIFEST');
});

test('trusted Harness test port saves pure state and restores intermediate and final output without duplicate commands', async () => {
  const m = manifest(); const run = runFixture(m); const requested: string[] = [];
  const adapter = createBusinessSkillsWorkflow({ createAuthority: () => ({ check: async () => {} }), executor: async ({ manifest: frozen, state }) => {
    const r = createWorkflowRuntime(frozen, run.harnessRunId); let d = r.next(Object.keys(state).length ? state : undefined);
    if (d.kind === 'ready') { requested.push(d.command.stepId); const outputs: Record<string, unknown> = { s: { text: 's' }, u: { text: 'original final' }, c: { approved: false }, t: { opaque: 'saved' } };
      d = r.settle(d.state, { operationId: d.command.operationId, output: outputs[d.command.stepId] }); }
    assert.ok(d.kind === 'ready' || d.kind === 'completed');
    return { state: d.state as any, nextStepKey: d.kind === 'completed' ? null : 'execute', checkpoint: { key: 'pure-runtime', kind: 'structural', resumePolicy: 'restart_step' },
      ...(d.kind === 'completed' ? { output: { status: 'final' as const, content: d.output, contentHash: hash(d.output) } } : {}) };
  } });
  const step = async (cp: any = null) => adapter.executeStep('execute', context(run, cp));
  const a: any = await step(); const cp = checkpoint(run, a.statePatch.businessSkills.state); const b: any = await step(cp);
  assert.deepEqual(requested, ['s', 'u']); let last: any = await step(checkpoint(run, b.statePatch.businessSkills.state));
  last = await step(checkpoint(run, last.statePatch.businessSkills.state)); assert.deepEqual(last.output.content, { text: 'original final' });
  const restored: any = await step(checkpoint(run, last.statePatch.businessSkills.state, null));
  assert.deepEqual(restored.output, last.output); assert.deepEqual(requested, ['s', 'u', 'c', 't']); assert.equal(restored.nextStepKey, null);
});

test('full 50-step ten-iteration workflow accepts exactly 500 ordered receipts', () => {
  const m = manifest((d) => {
    d.outputSchema = objectSchema({ n: { type: 'integer' } }); d.outputMapping = [path('n', '$.steps.n49.output.n')];
    d.steps = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, name: `Node ${i}`, type: 'userInput' as const, prompt: 'Finite visit',
      inputSchema: payload, outputSchema: objectSchema({ n: { type: 'integer' } }), inputMapping: [path('text', '$.input.text')], onFailure: 'fail' as const,
      repeat: { while: [predicate(`$.steps.n${i}.output.n`, 'lt', 10)], maxIterations: 10, onLimit: 'fail' as const } }));
  });
  const r = fresh(m); let d = r.next();
  for (let node = 0; node < 50; node++) for (let iteration = 1; iteration <= 10; iteration++) {
    assert.equal(ready(d).command.stepId, `n${node}`); assert.equal(ready(d).command.iteration, iteration); d = settle(r, d, { n: iteration });
  }
  done(d, { n: 10 }); assert.equal(d.state.receipts.length, 500); assert.deepEqual(fresh(m).next(JSON.parse(JSON.stringify(d.state))), d);
});
test('skipped prerequisite ignores a matching branch and continues to the next node', () => {
  const m = manifest(d => {
    d.steps[0].prerequisite = [predicate('$.input.text', 'eq', 'skip me')];
    d.steps[0].branches = [{ when: [predicate('$.input.text', 'exists')], target: '$end' }];
    d.steps[1].inputMapping = [path('text', '$.steps.s.output.text', 'skipped')]; d.outputMapping = [path('text', '$.steps.u.output.text', 'end')];
  });
  const d = ready(fresh(m).next()); assert.equal(d.command.stepId, 'u'); assert.deepEqual(d.command.input, { text: 'skipped' });
});
test('forward branch takes first matching target and preserves skipped output fallback', () => {
  const m = manifest(d => {
    d.steps[0].branches = [{ when: [predicate('$.input.text', 'exists')], target: 'c' }, { when: [predicate('$.input.text', 'exists')], target: '$end' }];
    d.steps[2].inputMapping = [path('text', '$.steps.u.output.text', 'skipped user')]; d.steps[3].inputMapping = [path('text', '$.steps.u.output.text', 'skipped user')];
    d.outputMapping = [path('text', '$.steps.u.output.text', 'fallback final')];
  });
  const r = fresh(m); let d = ready(settle(r, r.next(), { text: 'skill' })); assert.equal(d.command.stepId, 'c'); assert.deepEqual(d.command.input, { text: 'skipped user' });
  d = ready(settle(r, d, { approved: false })); assert.equal(d.command.stepId, 't'); assert.equal(d.command.requiresConfirmation, true);
  done(settle(r, d, {}), { text: 'fallback final' });
});
test('frozen native user-confirm policy remains required without mutates/exfiltrates flags', () => {
  const m = manifest((d, m) => { const t = d.steps[3]; assert.equal(t.type, 'tool'); (t as any).requiresConfirmation = false;
    const contract = m.tools[0].contract; contract.mutates = false; contract.exfiltrates = false; contract.requiresConfirmation = false;
    (contract.policy as any).approvalStrategy = 'user-confirm'; });
  const r = fresh(m); let d = settle(r, r.next(), { text: 's' }); d = settle(r, d, { text: 'u' }); d = ready(settle(r, d, { approved: true }));
  const command = ready(d).command; assert.equal(command.type, 'tool'); assert.equal(command.requiresConfirmation, true);
});
test('final success duplicate returns exact terminal output and rejects appended future operation', () => {
  const r = fresh(single()); const first = ready(r.next()); const output = { text: 'final' }; const d = done(settle(r, first, output), output);
  assert.deepEqual(r.settle(d.state, { operationId: first.command.operationId, output }), d);
  invalid(() => r.settle(d.state, { operationId: 'f'.repeat(64), output }), 'WORKFLOW_RUNTIME_INVALID_RECEIPT');
});
test('state from a different valid manifest or execution instance rejects', () => {
  const original = manifest(); const d = ready(fresh(original).next());
  invalid(() => fresh(original, 'other-server-run').next(d.state));
  const different = manifest(d => { d.steps[1].name = 'Another frozen definition'; }); invalid(() => fresh(different).next(d.state));
});
test('receipt public inputs reject extra keys rather than silently stripping authority-like fields', () => {
  const r = fresh(single()); const first = ready(r.next());
  invalid(() => r.settle(first.state, { operationId: first.command.operationId, output: { text: 'x' }, authorized: true } as any), 'WORKFLOW_RUNTIME_INVALID_RECEIPT');
  invalid(() => r.fail(first.state, { operationId: first.command.operationId, code: 'rejected', message: 'private SQL text' } as any), 'WORKFLOW_RUNTIME_INVALID_RECEIPT');
  assert.deepEqual(r.next(first.state), first);
});

test('AND predicates require every predicate and unmatched branches take the next node', () => {
  const skipped = single(d => {
    d.steps[0].prerequisite = [predicate('$.input.text', 'exists'), predicate('$.input.text', 'eq', 'different')];
    d.outputMapping = [path('text', '$.steps.s.output.text', 'AND skipped')];
  });
  done(fresh(skipped).next(), { text: 'AND skipped' });
  const m = manifest(d => {
    d.steps[0].branches = [{ when: [predicate('$.input.text', 'exists'), predicate('$.input.text', 'eq', 'different')], target: '$end' }];
    d.steps[1].inputMapping = [path('text', '$.steps.s.output.text', 'skip')];
    d.steps[2].inputMapping = [path('text', '$.steps.u.output.text', 'skip')];
    d.steps[3].inputMapping = [path('text', '$.steps.u.output.text', 'skip')];
    d.outputMapping = [path('text', '$.steps.u.output.text', 'end')];
  });
  const r = fresh(m); assert.equal(ready(settle(r, r.next(), { text: 'skill output' })).command.stepId, 'u');
});
test('native mutates/exfiltrates or declared confirmation cannot be reduced by the step', () => {
  for (const flags of [{ mutates: true }, { exfiltrates: true }, { requiresConfirmation: true }]) {
    const m = manifest((d, m) => {
      const step = d.steps[3]; assert.equal(step.type, 'tool'); (step as any).requiresConfirmation = false;
      Object.assign(m.tools[0].contract, { mutates: false, exfiltrates: false, requiresConfirmation: false }, flags);
    });
    invalid(() => fresh(m), 'WORKFLOW_RUNTIME_INVALID_MANIFEST');
  }
});

test('large valid final output settles, restores and duplicates without counting the same data twice', () => {
  const output = { text: 'a'.repeat(600000) }; const r = fresh(single()); const first = ready(r.next());
  const d = done(settle(r, first, output), output);
  assert.ok(Buffer.byteLength(JSON.stringify(d.state)) < 1024 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(d)) > 1024 * 1024);
  assert.deepEqual(copyTrialJson(d.state), d.state);
  const saved = JSON.parse(JSON.stringify(d.state)); const restored = done(r.next(saved), output);
  const duplicate = done(r.settle(saved, { operationId: first.command.operationId, output }), output);
  assert.deepEqual(duplicate, restored); assert.equal(duplicate.state.receipts.length, 1);
  d.output.text = 'mutated'; d.state.receipts[0].output.text = 'mutated receipt'; output.text = 'mutated source';
  done(r.next(saved), { text: 'a'.repeat(600000) });
  saved.receipts[0].output.text = 'mutated saved state';
  assert.equal(restored.output.text.length, 600000); assert.equal(duplicate.state.receipts[0].output.text.length, 600000);
});
test('independent large-state probe remains valid for terminal next before any settle call', () => {
  const output = { text: 'p'.repeat(600000) }; const r = fresh(single()); const first = ready(r.next());
  const state = { ...first.state, receipts: [{ operationId: first.command.operationId, status: 'succeeded', output }] };
  assert.equal(Buffer.byteLength(JSON.stringify(output)), 600011);
  assert.ok(Buffer.byteLength(JSON.stringify(state)) < 1024 * 1024); assert.deepEqual(copyTrialJson(state), state);
  const d = done(r.next(JSON.parse(JSON.stringify(state))), output);
  assert.notEqual(d.output, output); assert.notEqual(d.state, state); assert.notEqual(d.output, d.state.receipts[0].output);
});
test('ready command input and state keep independent limits while an actually oversized full state rejects', () => {
  const output = { text: 'r'.repeat(600000) }; const m = manifest(); const r = fresh(m); const first = ready(r.next());
  const d = ready(settle(r, first, output)); assert.equal(d.command.stepId, 'u'); assert.deepEqual(d.command.input, output);
  assert.ok(Buffer.byteLength(JSON.stringify(d.state)) < 1024 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(d.command.input)) < 1024 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(d)) > 1024 * 1024);
  const saved = JSON.parse(JSON.stringify(d.state)); const restored = ready(fresh(m).next(saved));
  assert.deepEqual(restored, d); assert.deepEqual(r.settle(saved, { operationId: first.command.operationId, output }), d);
  invalid(() => settle(r, d, { text: 'second'.repeat(100000) }));
  d.command.input.text = 'mutated input'; assert.equal(d.state.receipts[0].output.text.length, 600000);
  d.state.receipts[0].output.text = 'mutated receipt'; output.text = 'mutated source';
  assert.equal(restored.command.input.text.length, 600000); assert.deepEqual(ready(r.next(saved)), restored);
});

test('mapping repeated bounded fields still rejects an oversized assembled node input', () => {
  const text = 'i'.repeat(600000); assert.deepEqual(copyTrialJson({ text }), { text });
  const m = single((d, m) => {
    m.initialInput = { text }; m.skills[0].definition.inputSchema = objectSchema({ first: { type: 'string' }, second: { type: 'string' } });
    d.steps[0].inputMapping = [path('first', '$.input.text'), path('second', '$.input.text')];
  });
  assert.deepEqual(readPersistedExecutionManifest(m), m); const r = fresh(m); invalid(() => r.next());
  const receipt = { operationId: hash({ executionId, manifestHash: m.manifestHash, stepId: 's', iteration: 1 }), status: 'succeeded', output: { text: 'small' } };
  invalid(() => r.next({ schemaVersion: 1, executionId, manifestHash: m.manifestHash, receipts: [receipt] }));
});
test('mapping repeated bounded fields still rejects an oversized assembled final output', () => {
  const output = { text: 'o'.repeat(600000) }; assert.deepEqual(copyTrialJson(output), output);
  const m = single(d => {
    d.outputSchema = objectSchema({ first: { type: 'string' }, second: { type: 'string' } });
    d.outputMapping = [path('first', '$.steps.s.output.text'), path('second', '$.steps.s.output.text')];
  });
  assert.deepEqual(readPersistedExecutionManifest(m), m); const r = fresh(m); const first = ready(r.next());
  const state = { ...first.state, receipts: [{ operationId: first.command.operationId, status: 'succeeded', output }] };
  assert.deepEqual(copyTrialJson(state), state); invalid(() => r.next(state)); invalid(() => settle(r, first, output));
});
