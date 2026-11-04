import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkflowRuntime } from './workflows.runtime-adapter';
import { manifest, path, predicate, objectSchema, hash, payload } from './workflows.runtime.fixture';
import { runFixture } from './business-skills.test-fixture';
import { businessSkillsWaitDescriptor, businessSkillsWaitDescriptorFromValidatedManifest, businessSkillsWaitActionId } from './business-skills.wait';

test('one visitor pass handles all 500 legal receipts once without retaining large command inputs', () => {
 const executionId = 'trace-500', text = 'x'.repeat(180000), m = manifest((d, m) => {
  m.initialInput = { text }; d.steps = Array.from({ length: 50 }, (_, i) => ({ id: `u${i}`, name: `Input ${i}`, type: 'userInput', prompt: 'Answer',
   inputSchema: payload, outputSchema: objectSchema({ n: { type: 'integer' } }), inputMapping: [path('text', '$.input.text')], onFailure: 'fail',
   repeat: { while: [predicate(`$.steps.u${i}.output.n`, 'lt', 10)], maxIterations: 10, onLimit: 'fail' } }));
  d.outputMapping = [path('text', '$.input.text')];
 });
 const receipts = Array.from({ length: 500 }, (_, index) => ({ operationId: hash({ executionId, manifestHash: m.manifestHash,
  stepId: `u${Math.floor(index / 10)}`, iteration: index % 10 + 1 }), status: 'succeeded', output: { n: index % 10 + 1 } }));
 const state = { schemaVersion: 1, executionId, manifestHash: m.manifestHash, receipts }, runtime = createWorkflowRuntime(m, executionId);
 let visits = 0; const summaries: string[] = [];
 const decision = runtime.visit(state, ({ command, receipt, index }) => {
  assert.equal(index, visits++); assert.equal(command.input.text, text); assert.equal(receipt.operationId, receipts[index].operationId);
  summaries.push(command.operationId); // Store only a small projection; no command or mapped input survives this call.
 });
 assert.equal(visits, 500); assert.equal(new Set(summaries).size, 500); assert.deepEqual(decision, runtime.next(state));
});
test('visitor mutation cannot alter subsequent mappings, branching, receipts or the original state', () => {
 const m = manifest(), runtime = createWorkflowRuntime(m, 'trace-mutation'); let decision = runtime.next();
 for (const output of [{ text: 'skill' }, { text: 'owner' }, { approved: true }]) {
  if (decision.kind !== 'ready') assert.fail(); decision = runtime.settle(decision.state, { operationId: decision.command.operationId, output });
 }
 const before = structuredClone(decision.state), expected = runtime.next(before);
 const actual = runtime.visit(before, entry => {
  (entry.command.input as any).text = 'MUTATED';
  if ('output' in entry.receipt) (entry.receipt.output as any).text = 'MUTATED';
  if (entry.command.type === 'skill') (entry.command.dependency.definition as any).outputSchema = {};
 });
 assert.deepEqual(actual, expected); assert.deepEqual(before, decision.state); assert.deepEqual(runtime.next(before), expected);
});
test('prevalidated wait helpers preserve the default action/content binding and the default still validates the real Run', () => {
 const m = manifest(), run = runFixture(m), runtime = createWorkflowRuntime(m, run.harnessRunId); let decision = runtime.next();
 if (decision.kind !== 'ready') assert.fail(); decision = runtime.settle(decision.state, { operationId: decision.command.operationId, output: { text: 'skill' } });
 if (decision.kind !== 'ready' || decision.command.type !== 'userInput') assert.fail();
 const command = decision.command, expected = businessSkillsWaitDescriptor(run, command);
 assert.deepEqual(businessSkillsWaitDescriptorFromValidatedManifest(run, m.manifestHash, command), expected);
 assert.equal(businessSkillsWaitActionId(run, m.manifestHash, { operationId: command.operationId, kind: command.type, stepId: command.stepId,
  contentHash: expected.contentHash, contractHash: hash(command.outputSchema) }), expected.actionId);
 assert.throws(() => businessSkillsWaitDescriptor({ ...run, ownerUserId: 'forged' }, command));
});
