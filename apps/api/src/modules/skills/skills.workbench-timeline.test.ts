import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createWorkflowRuntime } from '../harness/workflows.runtime-adapter';
import { manifest, path, predicate, objectSchema, hash } from '../harness/workflows.runtime.fixture';
import { buildBusinessExecutionTimeline, type BusinessTimelineInput } from './skills.workbench-timeline';

const root = '00000000-0000-4000-8000-000000000001', session = '00000000-0000-4000-8000-000000000002', time = new Date('2026-11-04T01:00:00Z');
function fixture(repeated = false) {
 const m = manifest(d => {
  d.steps = [{ id: 'u', name: '补充材料', type: 'userInput', prompt: '补充依据', inputSchema: objectSchema({}),
   outputSchema: objectSchema({ n: { type: 'integer' } }), inputMapping: [], onFailure: 'fail',
   ...(repeated ? { repeat: { while: [predicate('$.steps.u.output.n', 'lt', 2)], maxIterations: 2, onLimit: 'fail' } } : {}) },
   { id: 'c', name: '范围确认', type: 'confirmation', prompt: '确认范围', inputSchema: objectSchema({}), inputMapping: [], onFailure: 'fail' }];
  d.outputSchema = objectSchema({ n: { type: 'integer' } }); d.outputMapping = [path('n', '$.steps.u.output.n')];
 });
 const runtime = createWorkflowRuntime(m, root); let decision = runtime.next();
 const input: BusinessTimelineInput = { manifest: m, runId: root, rootRunId: root, ownerUserId: m.caller.id,
  sessionId: session, state: { schemaVersion: 1, kind: 'workflow', workflow: decision.state }, runEvents: [], toolEvents: [], receiptOrigins: [] };
 const settle = (output: unknown, physicalRunId = root) => {
  if (decision.kind !== 'ready' || !['userInput', 'confirmation'].includes(decision.command.type)) assert.fail();
  const c = decision.command as Extract<typeof decision.command, { type: 'userInput' | 'confirmation' }>;
  const contentHash = hash({ prompt: c.prompt, displayInput: c.input });
  const actionId = hash({ runId: physicalRunId, ownerUserId: m.caller.id, sessionId: session, manifestHash: m.manifestHash,
   operationId: c.operationId, kind: c.type, stepId: c.stepId, contractHash: hash(c.outputSchema), contentHash });
  const waiting = { harnessRunEventId: randomUUID(), harnessRunId: physicalRunId, sequence: input.runEvents.length + 1,
   eventType: c.type === 'userInput' ? 'workflow.awaiting_input' : 'workflow.awaiting_confirmation', createdAt: time,
   payload: { actionId, kind: c.type, stepId: c.stepId, contentHash, prompt: c.prompt, outputSchema: c.outputSchema, displayInput: c.input } };
  const answer = { harnessRunEventId: randomUUID(), harnessRunId: physicalRunId, sequence: waiting.sequence + 1,
   eventType: 'workflow.answer_recorded', createdAt: time, payload: { actionId, kind: c.type, stepId: c.stepId,
    contentHash, requestedBy: m.caller.id, valueHash: hash(output), ...(c.type === 'confirmation' ? { approved: (output as any).approved } : {}) } };
  input.runEvents.push(waiting, answer); input.receiptOrigins.push({ operationId: c.operationId, runId: physicalRunId });
  decision = runtime.settle(decision.state, { operationId: c.operationId, output }); input.state!.workflow = decision.state;
  return { waiting, answer };
 };
 return { input, settle, decision: () => decision };
}

test('real wait/answer facts retain every repeated occurrence and actual answer; false confirmation is rejected', () => {
 const f = fixture(true); f.settle({ n: 1 }); f.settle({ n: 2 }); f.settle({ approved: false });
 const timeline = buildBusinessExecutionTimeline(f.input);
 assert.equal(timeline.version, 1); assert.equal(timeline.rootRunId, root); assert.equal(timeline.coverage, 'complete');
 const answers = timeline.entries.filter(e => e.kind === 'answer');
 assert.deepEqual(answers.map(e => e.content), [{ n: 1 }, { n: 2 }]);
 assert.deepEqual(answers.map(e => e.iteration), [1, 2]); assert.equal(new Set(timeline.entries.map(e => e.id)).size, timeline.entries.length);
 const decision = timeline.entries.find(e => e.kind === 'decision');
 assert.equal(decision?.status, 'rejected'); assert.deepEqual(decision?.content, { approved: false });
 assert.equal(decision?.id, f.input.runEvents[f.input.runEvents.length - 1].harnessRunEventId);
 assert.deepEqual(timeline, buildBusinessExecutionTimeline(f.input));
 assert.ok(timeline.entries.filter(e => e.kind === 'stage').every(e => !e.occurredAt));
});

test('retry keeps inherited entry identity and physical run attribution from origins, never current-run guesses', () => {
 const f = fixture(); f.settle({ n: 1 }); const first = buildBusinessExecutionTimeline(f.input);
 f.input.runId = '00000000-0000-4000-8000-000000000003'; const retried = buildBusinessExecutionTimeline(f.input);
 assert.deepEqual(retried.entries.filter(e => e.kind === 'answer'), first.entries.filter(e => e.kind === 'answer'));
 assert.equal(retried.entries.find(e => e.kind === 'answer')?.runId, root);
 f.input.receiptOrigins = []; const missing = buildBusinessExecutionTimeline(f.input);
 assert.equal(missing.coverage, 'partial'); assert.ok(missing.unavailable.includes('receipt_origin_missing'));
 assert.equal(missing.entries.some(e => e.kind === 'answer'), false);
});

test('missing legacy history is explicit; mismatched answer value, content binding and wait prompt fail closed', () => {
 const f = fixture(); const records = f.settle({ n: 1 });
 for (const corrupt of [() => { records.answer.payload.valueHash = hash({ n: 9 }); },
  () => { records.answer.payload.contentHash = hash('other'); }, () => { records.waiting.payload.prompt = 'different'; }]) {
  const before = structuredClone(f.input); corrupt(); assert.throws(() => buildBusinessExecutionTimeline(f.input), /BUSINESS_TIMELINE_FACT_INVALID/);
  Object.assign(f.input, before); // Restore real contracts before each independent corruption.
  records.waiting = f.input.runEvents[0] as any; records.answer = f.input.runEvents[1] as any;
 }
 f.input.runEvents = []; const legacy = buildBusinessExecutionTimeline(f.input);
 assert.equal(legacy.coverage, 'partial'); assert.ok(legacy.unavailable.includes('wait_history_missing'));
 assert.equal(legacy.entries.some(e => e.kind === 'answer'), false);
});

/** Shapes mirror operationContent(schema2), operation-wait.pending, basisFor and fixedInput. */
function operationFixture(nested?: Awaited<ReturnType<typeof nestedSkillFixture>>) {
 const m = nested?.m ?? manifest((d, m) => {
  d.steps = d.steps.slice(-1); d.steps[0].inputMapping = [path('text', '$.input.text')]; d.outputMapping = [path('text', '$.input.text')];
  Object.assign(m, { schemaVersion: 2, toolAuthority: { schemaVersion: 1, roles: ['ADMIN'], tools: [{ stepId: 't', sandboxReadSafe: false }] } });
 });
 const runtime = createWorkflowRuntime(m, root), current = runtime.next(); if (current.kind !== 'ready' || !['tool', 'skill'].includes(current.command.type)) assert.fail();
 const c = current.command as Extract<typeof current.command, { type: 'tool' | 'skill' }>, operationId = randomUUID(), rejectedId = randomUUID(), approvedId = randomUUID(), executionId = randomUUID();
 const native = c.type === 'tool' ? c.contract : c.dependency.context.tools[0].native, policy = c.type === 'tool' ? c.contract.policy : c.dependency.context.tools[0].policy, operationKey = `business-op:v2:${hash({ schemaVersion: 2, rootRunId: root, commandId: c.operationId, ordinal: 0 })}`;
 const content = { schemaVersion: 2, rootRunId: root, manifestHash: m.manifestHash, workflowId: m.target.id,
  workflowVersionId: m.target.versionId, workflowHash: m.target.hash, commandId: c.operationId, iteration: c.iteration,
  commandInputHash: hash(c.input), stepType: c.type, stepId: c.stepId, ordinal: 0, toolName: native.name,
  ...(c.type === 'skill' ? { skillId: c.skillId, versionId: c.skillVersionId, definitionHash: c.dependency.hash } : {}),
  binding: c.type === 'tool' ? { requiresConfirmation: true } : c.dependency.definition.tools[0], native, policy, parameters: c.input };
 const payloadHash = hash(content);
 const prepared = { harnessToolEventId: operationId, harnessRunId: root, toolName: native.name, eventType: 'business_operation_prepared',
  status: 'pending', input: { ...content, sourceRunId: root, sourceCheckpointId: randomUUID(), sourceCheckpointSequence: 1,
   sourceCheckpointHash: hash('checkpoint'), payloadHash }, output: null, createdAt: time, resolvedAt: null };
 const choice = (id: string, decision: 'approve' | 'reject', version: number) => {
  const basis = { schemaVersion: 1, runId: root, ownerId: m.caller.id, sessionId: session, operationId, rootRunId: root,
   operationKey, manifestHash: m.manifestHash, payloadHash, executionAuthority: [{ kind: 'workflow', id: m.target.id, epoch: 0 }],
   identity: { id: m.caller.id, role: 'admin', businessRole: 'pre_sales', status: 'active' }, currentToolsHash: hash('tools'),
   configRevisions: [{ configKey: 'mcpConfig', missing: true }, { configKey: 'toolPolicy', version, updatedAt: '1', effectiveAt: '1' }] };
  return { ...prepared, harnessToolEventId: id, eventType: 'business_operation_decision',
   status: decision === 'approve' ? 'approved' : 'rejected', resolvedAt: time,
   input: { schemaVersion: 1, basis, confirmationHash: hash(basis), decision, actorId: m.caller.id } };
 };
 const rejected = choice(rejectedId, 'reject', 1), approved = choice(approvedId, 'approve', 2);
 const executed = { ...prepared, harnessToolEventId: executionId, eventType: 'business_operation_executed', status: 'succeeded', resolvedAt: time,
  input: { schemaVersion: 1, operationId, rootRunId: root, operationKey, payloadHash, manifestHash: m.manifestHash,
   ownerId: m.caller.id, sessionId: session, toolName: native.name, sourceRunId: root, decisionId: approvedId, confirmationHash: approved.input.confirmationHash },
  output: { schemaVersion: 1, result: { projectId: 'p1', apiKey: 'PRIVATE' } } };
 const waiting = { harnessRunEventId: randomUUID(), harnessRunId: root, sequence: 1, eventType: 'workflow.awaiting_confirmation', createdAt: time,
  payload: { kind: 'operation', actionId: hash({ runId: root, manifestHash: m.manifestHash, operationId, stepId: c.stepId, ordinal: 0 }),
   operationId, stepId: c.stepId, toolName: native.name, parameters: c.input } };
 const input: BusinessTimelineInput = { manifest: m, rootRunId: root, runId: root, ownerUserId: m.caller.id, sessionId: session,
  state: nested?.state ?? { schemaVersion: 1, kind: 'workflow', workflow: current.state, pendingOperation: { operationId } },
  runStatus: 'waiting', receiptOrigins: [], runEvents: [waiting], toolEvents: [prepared, rejected, approved, executed] };
 return { input, runtime, c, waiting, prepared, rejected, approved, executed };
}

test('actual operation wait and ledger include rejected/approved decisions with one distinct native result', () => {
 const f = operationFixture(), timeline = buildBusinessExecutionTimeline(f.input);
 assert.equal(timeline.coverage, 'complete');
 assert.deepEqual(timeline.entries.filter(e => e.kind === 'decision').map(e => [e.id, e.status]), [[f.rejected.harnessToolEventId, 'rejected'], [f.approved.harnessToolEventId, 'approved']]);
 assert.deepEqual(timeline.entries.find(e => e.id === f.executed.harnessToolEventId)?.content, { projectId: 'p1' });
 assert.equal(timeline.entries.find(e => e.id === f.executed.harnessToolEventId)?.kind, 'tool_result');
 const question = timeline.entries.find(e => e.id === f.waiting.harnessRunEventId);
 assert.equal(question?.kind, 'confirmation'); assert.equal(question?.status, 'answered');
 assert.ok(timeline.entries.filter(e => e.kind !== 'stage').every(e => e.stageId === timeline.entries[0].id));
 assert.equal(JSON.stringify(timeline).includes('PRIVATE'), false);
 for (const field of ['basis', 'executionAuthority', 'identity', 'currentToolsHash', 'configRevisions', 'confirmationHash']) assert.equal(JSON.stringify(timeline).includes(`"${field}"`), false);
 const settled = f.runtime.settle(f.input.state!.workflow, { operationId: f.c.operationId, output: f.executed.output.result });
 f.input.state!.workflow = settled.state; delete f.input.state!.pendingOperation;
 f.input.receiptOrigins = [{ operationId: f.c.operationId, runId: root }]; f.input.runStatus = 'completed';
 assert.equal(buildBusinessExecutionTimeline(f.input).entries.filter(e => e.kind === 'tool_result').length, 1);
});

test('actual operation waiting action and business parameters cannot be rebound', () => {
 const f = operationFixture(); f.waiting.payload.parameters = { text: 'changed' };
 assert.throws(() => buildBusinessExecutionTimeline(f.input), /BUSINESS_TIMELINE_FACT_INVALID/);
});

test('current stage preserves actual queued/waiting/cancelled status without invented timestamps', () => {
 const f = fixture();
 for (const runStatus of ['queued', 'waiting', 'cancelled']) {
  const timeline = buildBusinessExecutionTimeline({ ...f.input, runStatus });
  assert.equal(timeline.entries[0].status, runStatus); assert.equal(timeline.entries[0].occurredAt, undefined);
 }
});

test('bounded actual history and standalone skill output remain read-only and exclude model/authority envelopes', async () => {
 const { frozenManifest } = await import('../harness/business-skills.test-fixture');
 const f = fixture(); const before = structuredClone(f.input);
 buildBusinessExecutionTimeline(f.input); assert.deepEqual(f.input, before);
 assert.throws(() => buildBusinessExecutionTimeline({ ...f.input, runEvents: Array(4097).fill({}) }), /BUSINESS_TIMELINE_LIMIT_EXCEEDED/);
 const input = { ...f.input, manifest: frozenManifest(), receiptOrigins: [{ operationId: 'skill-operation', runId: root }],
  state: { schemaVersion: 1, kind: 'skill', skill: { operationId: 'skill-operation', iteration: 0, stepId: '$skill', phase: 'completed',
   toolResults: [], output: { days: 3, basis: '业务依据' }, model: { credentialScope: 'PRIVATE' } } } } as any;
 const timeline = buildBusinessExecutionTimeline(input);
 assert.deepEqual(timeline.entries.find(e => e.kind === 'result')?.content, { days: 3, basis: '业务依据' });
 assert.equal(JSON.stringify(timeline).includes('PRIVATE'), false);
});

async function nestedSkillFixture(write = false, secondRead = false) {
 const { DEFAULT_TOOL_POLICY_ENTRY } = await import('../../agent/tool-policy');
 const { readBusinessSkillsHostState } = await import('../harness/business-skills.host-state');
 const native = { name: write ? 'write_business' : 'read_business', description: 'Read owned material', parameters: objectSchema({ text: { type: 'string' } }),
  outputSchema: objectSchema({ text: { type: 'string' } }), source: 'code' as const, mutates: write, exfiltrates: false,
  simulationOnly: false, sandboxReadSafe: !write, capability: 'estimates:read' as const };
 const m = manifest((d, m) => {
  d.steps = d.steps.slice(0, 1); d.outputMapping = [path('text', '$.steps.s.output.text')];
  m.skills[0].definition.tools = [{ toolName: native.name, inputMapping: { text: '$.text' }, requiresConfirmation: write }];
  m.skills[0].context.tools = [{ native, policy: DEFAULT_TOOL_POLICY_ENTRY }];
  if (secondRead) {
   m.skills[0].definition.tools.push({ toolName: 'read_later', inputMapping: { text: '$.text' }, requiresConfirmation: false });
   m.skills[0].context.tools.push({ native: { ...native, name: 'read_later', mutates: false, sandboxReadSafe: true }, policy: DEFAULT_TOOL_POLICY_ENTRY });
  }
 });
 const current = createWorkflowRuntime(m, root).next(); if (current.kind !== 'ready') assert.fail();
 const c = current.command;
 const state = readBusinessSkillsHostState({ schemaVersion: 1, kind: 'workflow', workflow: current.state,
  skill: { schemaVersion: 1, runId: root, ownerUserId: m.caller.id, manifestHash: m.manifestHash, stepId: c.stepId,
   operationId: c.operationId, iteration: c.iteration, inputHash: hash(c.input), phase: 'model',
   toolResults: [{ callId: 'read_1', toolName: native.name, arguments: c.input, simulated: false, result: { text: 'Actual read result' } },
    ...(secondRead ? [{ callId: 'read_2', toolName: 'read_later', arguments: c.input, simulated: false, result: { text: 'Later read' } }] : [])],
   seenCallIds: secondRead ? ['read_1', 'read_2'] : ['read_1'], pendingBatch: [], nextToolIndex: 0, usage: { modelAttempts: 1, outputTokens: 1 },
   model: { providerId: 'fixture', model: 'frozen', transportProvider: 'fixture' } } }, m, root);
 const input: BusinessTimelineInput = { manifest: m, state, runId: root, rootRunId: root, ownerUserId: m.caller.id,
  sessionId: session, runStatus: 'running', runEvents: [], toolEvents: [], receiptOrigins: [{ operationId: c.operationId, runId: root }], skillToolOrigin: { runId: root } };
 return { m, state, c, input };
}

test('live nested workflow Skill retains actual completed read tools before its final output exists', async () => {
 const { input, c } = await nestedSkillFixture(), timeline = buildBusinessExecutionTimeline(input);
 assert.equal(timeline.entries.filter(e => e.kind === 'tool_result').length, 1);
 assert.deepEqual(timeline.entries.find(e => e.kind === 'tool_result')?.content, { parameters: c.input, result: { text: 'Actual read result' } });
 assert.equal(timeline.entries.some(e => e.kind === 'result'), false);
 assert.equal(JSON.stringify(timeline).includes('transportProvider'), false);
});

test('actual failed workflow receipt remains visible even when legacy wait metadata is absent', () => {
 const f = fixture(), current = f.decision(); if (current.kind !== 'ready') assert.fail();
 const failed = createWorkflowRuntime(f.input.manifest, root).fail(current.state, { operationId: current.command.operationId, code: 'execution_failed' });
 f.input.state!.workflow = failed.state; f.input.receiptOrigins = [{ operationId: current.command.operationId, runId: root }];
 const timeline = buildBusinessExecutionTimeline({ ...f.input, runStatus: 'failed' });
 assert.equal(timeline.coverage, 'partial');
 assert.deepEqual(timeline.entries.find(e => e.kind === 'failure')?.content, { code: 'execution_failed' });
 assert.equal(timeline.entries.find(e => e.kind === 'failure')?.occurredAt, undefined);
});

test('missing workflow checkpoint remains partial even when its first queued stage is known', () => {
 const f = fixture(); delete f.input.state;
 const timeline = buildBusinessExecutionTimeline({ ...f.input, runStatus: 'queued' });
 assert.equal(timeline.coverage, 'partial'); assert.ok(timeline.unavailable.includes('state_missing'));
 assert.equal(timeline.entries[0].status, 'queued');
});

test('live inherited read tools use supplied physical origins and omit unknown attribution', async () => {
 const { input } = await nestedSkillFixture(); input.runId = randomUUID();
 let timeline = buildBusinessExecutionTimeline(input);
 assert.equal(timeline.entries.find(e => e.kind === 'stage')?.runId, input.runId);
 assert.equal(timeline.entries.find(e => e.kind === 'tool_result')?.runId, root);
 input.receiptOrigins = []; delete input.skillToolOrigin; timeline = buildBusinessExecutionTimeline(input);
 assert.equal(timeline.entries.find(e => e.kind === 'tool_result')?.runId, undefined);
 assert.equal(timeline.coverage, 'partial'); assert.ok(timeline.unavailable.includes('receipt_origin_missing'));
});

test('completed nested Skill restores real read tools from one validated historical snapshot or reports a gap', async () => {
 const { input, c, state } = await nestedSkillFixture(), runtime = createWorkflowRuntime(input.manifest, root);
 const snapshot = structuredClone(state.skill!); snapshot.phase = 'completed'; snapshot.output = { text: 'Final result' };
 input.state = { schemaVersion: 1, kind: 'workflow', workflow: runtime.settle(state.workflow, { operationId: c.operationId, output: snapshot.output }).state };
 const missing = buildBusinessExecutionTimeline(input);
 assert.equal(missing.coverage, 'partial'); assert.ok(missing.unavailable.includes('unsupported_history'));
 input.historicalSkills = [{ state: snapshot, runId: root }];
 const restored = buildBusinessExecutionTimeline(input);
 assert.equal(restored.coverage, 'complete'); assert.equal(restored.entries.filter(e => e.kind === 'tool_result').length, 1);
 assert.equal(restored.entries.find(e => e.kind === 'tool_result')?.runId, root);
 assert.equal(restored.entries.find(e => e.kind === 'tool_result')?.occurredAt, undefined);
 snapshot.output = { text: 'Different output' };
 assert.throws(() => buildBusinessExecutionTimeline(input), /BUSINESS_TIMELINE_FACT_INVALID/);
});

test('native deduplication rejects conflicting actual workflow or Skill results instead of hiding them', async () => {
 const f = operationFixture(), settled = f.runtime.settle(f.input.state!.workflow, { operationId: f.c.operationId, output: { projectId: 'different' } });
 f.input.state!.workflow = settled.state; delete f.input.state!.pendingOperation;
 f.input.receiptOrigins = [{ operationId: f.c.operationId, runId: root }];
 assert.throws(() => buildBusinessExecutionTimeline(f.input), /BUSINESS_TIMELINE_FACT_INVALID/);
 const nested = await nestedSkillFixture(true), skill = operationFixture(nested);
 assert.throws(() => buildBusinessExecutionTimeline(skill.input), /BUSINESS_TIMELINE_FACT_INVALID/);
});

test('native operation history without its actual wait stays visible and explicitly incomplete', () => {
 const f = operationFixture(); f.input.runEvents = [];
 const timeline = buildBusinessExecutionTimeline(f.input);
 assert.equal(timeline.coverage, 'partial'); assert.ok(timeline.unavailable.includes('wait_history_missing'));
 assert.equal(timeline.entries.filter(e => e.kind === 'decision').length, 2);
 assert.equal(timeline.entries.filter(e => e.kind === 'tool_result').length, 1);
});

test('equal-time ledger records preserve supplied trusted source order', () => {
 const f = operationFixture();
 const timeline = buildBusinessExecutionTimeline(f.input);
 assert.deepEqual(timeline.entries.filter(e => e.kind === 'decision').map(e => e.id), [f.rejected.harnessToolEventId, f.approved.harnessToolEventId]);
});

test('same command preserves wait then decision across physical retry runs instead of grouping all waits first', () => {
 const f = operationFixture(), retry = randomUUID(); f.input.runId = retry;
 f.rejected.createdAt = f.rejected.resolvedAt = new Date(time.getTime() + 10);
 const waiting2 = { ...structuredClone(f.waiting), harnessRunEventId: randomUUID(), harnessRunId: retry,
  createdAt: new Date(time.getTime() + 20), payload: { ...f.waiting.payload,
   actionId: hash({ runId: retry, manifestHash: f.input.manifest.manifestHash, operationId: f.prepared.harnessToolEventId, stepId: f.c.stepId, ordinal: 0 }) } };
 f.approved.input.basis.runId = retry; f.approved.input.confirmationHash = hash(f.approved.input.basis);
 f.approved.createdAt = f.approved.resolvedAt = new Date(time.getTime() + 30);
 f.executed.input.sourceRunId = retry; f.executed.input.confirmationHash = f.approved.input.confirmationHash;
 f.executed.createdAt = f.executed.resolvedAt = new Date(time.getTime() + 40);
 f.input.runEvents.push(waiting2);
 const entries = buildBusinessExecutionTimeline(f.input).entries.filter(e => e.kind === 'confirmation' || e.kind === 'decision');
 assert.deepEqual(entries.map(e => e.id), [f.waiting.harnessRunEventId, f.rejected.harnessToolEventId, waiting2.harnessRunEventId, f.approved.harnessToolEventId]);
 // Millisecond equality must retain the same known wait-before-own-decision source order.
 for (const row of [f.rejected, f.approved, f.executed]) row.createdAt = row.resolvedAt = time;
 waiting2.createdAt = time;
 assert.deepEqual(buildBusinessExecutionTimeline(f.input).entries.filter(e => e.kind === 'confirmation' || e.kind === 'decision').map(e => e.id), entries.map(e => e.id));
});

test('a Skill native write result at ordinal zero precedes its later read result at ordinal one', async () => {
 const nested = await nestedSkillFixture(true, true), f = operationFixture(nested);
 f.input.skillToolOrigin = { runId: root };
 f.executed.output.result = nested.state.skill!.toolResults[0].result as typeof f.executed.output.result;
 const results = buildBusinessExecutionTimeline(f.input).entries.filter(e => e.kind === 'tool_result');
 assert.deepEqual(results.map(e => e.ordinal), [0, 1]);
 assert.equal(results[0].id, f.executed.harnessToolEventId);
 assert.deepEqual((results[1].content as any).result, { text: 'Later read' });
});

test('mixed or unknown Skill tool origins never inherit a final receipt or stage physical run', async () => {
 const { input, c, state } = await nestedSkillFixture(); delete input.skillToolOrigin;
 let timeline = buildBusinessExecutionTimeline(input);
 assert.equal(timeline.entries.find(e => e.kind === 'tool_result')?.runId, undefined);
 assert.equal(timeline.coverage, 'partial');
 const snapshot = structuredClone(state.skill!); snapshot.phase = 'completed'; snapshot.output = { text: 'Final result' };
 input.state = { schemaVersion: 1, kind: 'workflow', workflow: createWorkflowRuntime(input.manifest, root)
  .settle(state.workflow, { operationId: c.operationId, output: snapshot.output }).state };
 input.historicalSkills = [{ state: snapshot }]; timeline = buildBusinessExecutionTimeline(input);
 assert.equal(timeline.entries.find(e => e.kind === 'stage')?.runId, root);
 assert.equal(timeline.entries.find(e => e.kind === 'tool_result')?.runId, undefined);
 assert.equal(timeline.coverage, 'partial'); assert.ok(timeline.unavailable.includes('receipt_origin_missing'));
});
