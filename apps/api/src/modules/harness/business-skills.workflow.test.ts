import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBusinessSkillsWorkflow } from './business-skills.workflow';
import { HarnessWorkflowCancelledError, hashHarnessCheckpointState } from './harness-runtime.worker';
import { checkpoint, context, frozenManifest, frozenWorkflowManifest, hash, outcome, payload, runFixture } from './business-skills.test-fixture';
const rejects = (call: () => unknown, reason = 'BUSINESS_SKILLS_INVALID_STATE') => assert.rejects(async () => call(), { message: reason });
test('fixed workflow restores only frozen definition and isolates manifest, run and state from executor mutation', async () => {
  const run = runFixture(); const cp = checkpoint(run, { cursor: 3 }); const original = structuredClone(run); const saved = structuredClone(cp);
  const workflow = createBusinessSkillsWorkflow({ createAuthority: () => ({ check: async () => {} }), executor: async input => {
    assert.equal(input.manifest.skills[0].definition.instructions, 'Original instructions'); assert.equal(input.state.cursor, 3);
    input.manifest.skills[0].definition.instructions = 'mutated'; input.context.run.ownerUserId = 'changed'; input.state.cursor = 10;
    return outcome();
  } });
  assert.equal(workflow.workflowId, 'business_skills_v1'); assert.deepEqual(workflow.stepKeys, ['execute']);
  await workflow.preflight!(run, [cp]); const result = await workflow.executeStep('execute', context(run, cp));
  assert.equal(result.nextStepKey, null); assert.deepEqual((result.statePatch as any).businessSkills.state, { cursor: 1 });
  assert.deepEqual(run, original); assert.deepEqual(cp, saved);
});
for (const field of ['missingManifest', 'manifestHash', 'manifestSchema', 'owner', 'session', 'workflow', 'version', 'kind', 'fingerprint', 'content', 'target', 'input', 'sources']) test(`preflight rejects ${field} before executor`, async () => {
  const run = runFixture(); let calls = 0;
  if (field === 'missingManifest') delete run.executionConfig.executionManifest;
  else if (field === 'manifestHash') run.executionConfig.executionManifest.manifestHash = 'bad';
  else if (field === 'manifestSchema') run.executionConfig.executionManifest.schemaVersion = 2;
  else if (field === 'owner') run.ownerUserId = 'foreign'; else if (field === 'session') run.aiSessionId = '';
  else if (field === 'workflow') run.workflowId = 'workbench_chat_v1'; else if (field === 'version') run.workflowVersion = '2'; else if (field === 'kind') run.runKind = 'other';
  else if (field === 'fingerprint') run.metadata.invocationFingerprint = 'bad'; else if (field === 'content') run.executionConfig.content = 'changed';
  else { const m = run.executionConfig.executionManifest; if (field === 'target') { m.target.id = 'changed'; m.skills[0].skillId = 'changed'; }
    if (field === 'input') m.initialInput.text = 'changed'; if (field === 'sources') m.sources.push({ kind: 'file', id: 'changed' }); const { manifestHash, ...body } = m; m.manifestHash = hash(body); }
  const workflow = createBusinessSkillsWorkflow({ createAuthority: () => ({ check: async () => {} }), executor: async () => { calls++; return outcome(); } });
  await rejects(() => workflow.preflight!(run, []), 'BUSINESS_SKILLS_INVALID_RUN'); assert.equal(calls, 0);
});
for (const field of ['envelope', 'run', 'hash', 'schema', 'step', 'next', 'stateHash', 'effect', 'workflow', 'cpRun']) test(`rejects corrupt ${field} checkpoint including terminal candidate`, async () => {
  const run = runFixture(); const cp = checkpoint(run, {}, null); let calls = 0;
  if (field === 'envelope') delete cp.state.businessSkills; if (field === 'run') cp.state.businessSkills.runId = 'other';
  if (field === 'hash') cp.state.businessSkills.manifestHash = 'other'; if (field === 'schema') cp.state.businessSkills.schemaVersion = 2;
  if (field === 'step') cp.stepKey = 'unknown'; if (field === 'next') cp.state.nextStepKey = 'unknown';
  if (field === 'effect') cp.effectKeys = ['foreign:effect']; if (field === 'workflow') cp.workflowVersion = '2'; if (field === 'cpRun') cp.harnessRunId = 'other';
  cp.stateHash = field === 'stateHash' ? 'bad' : hashHarnessCheckpointState(cp.state);
  const workflow = createBusinessSkillsWorkflow({ createAuthority: () => ({ check: async () => {} }), executor: async () => { calls++; return outcome(); } });
  await rejects(() => workflow.preflight!(run, [cp])); assert.equal(calls, 0);
});
test('direct execute checks unknown step, state correspondence and resume instead of trusting worker', async () => {
  const run = runFixture(); const workflow = createBusinessSkillsWorkflow({ createAuthority: () => ({ check: async () => {} }), executor: async () => outcome() });
  await rejects(() => workflow.executeStep('unknown', context(run)));
  const ctx = context(run, checkpoint(run, { cursor: 1 })); ctx.state.businessSkills.runId = 'other'; ctx.resumeFrom = checkpoint(run, { cursor: 1 });
  await rejects(() => workflow.executeStep('execute', ctx));
});
test('default executor fails safely before any execution, including terminal preflight', async () => {
  const run = runFixture(); const workflow = createBusinessSkillsWorkflow();
  await rejects(() => workflow.preflight!(run, []), 'BUSINESS_SKILLS_EXECUTOR_UNAVAILABLE');
  await rejects(() => workflow.executeStep('execute', context(run)), 'BUSINESS_SKILLS_EXECUTOR_UNAVAILABLE');
});
for (const field of ['checkpoint', 'output', 'schema', 'hash', 'partialFinal', 'next', 'state', 'checkpointPolicy']) test(`invalid executor ${field} cannot commit`, async () => {
  const value = outcome(); if (field === 'checkpoint') delete value.checkpoint; if (field === 'output') delete value.output;
  if (field === 'schema') { value.output.content = { wrong: true }; value.output.contentHash = hash(value.output.content); }
  if (field === 'hash') value.output.contentHash = 'wrong'; if (field === 'partialFinal') value.output.status = 'partial';
  if (field === 'next') value.nextStepKey = 'unknown'; if (field === 'state') value.state = [];
  if (field === 'checkpointPolicy') value.checkpoint.resumePolicy = 'manual';
  await rejects(() => createBusinessSkillsWorkflow({ createAuthority: () => ({ check: async () => {} }), executor: async () => value }).executeStep('execute', context()), 'BUSINESS_SKILLS_INVALID_RESULT');
});
test('continuation may write partial output and always wraps only business state', async () => {
  const result = await createBusinessSkillsWorkflow({ createAuthority: () => ({ check: async () => {} }), executor: async () => outcome('execute') }).executeStep('execute', context());
  assert.equal(result.nextStepKey, 'execute'); assert.equal(result.output!.status, 'partial'); assert.deepEqual(Object.keys(result.statePatch!), ['businessSkills']);
});
test('unknown executor errors are redacted; framework cancellation stays cancellable', async () => {
  await rejects(() => createBusinessSkillsWorkflow({ createAuthority: () => ({ check: async () => {} }), executor: async () => { throw new Error('private SQL and credentials'); } }).executeStep('execute', context()), 'BUSINESS_SKILLS_EXECUTION_FAILED');
  const cancelled = new HarnessWorkflowCancelledError();
  await assert.rejects(createBusinessSkillsWorkflow({ createAuthority: () => ({ check: async () => {} }), executor: async () => { throw cancelled; } }).executeStep('execute', context()), error => error === cancelled);
  const ctx = context(); const controller = new AbortController(); controller.abort(); ctx.abortSignal = controller.signal;
  await assert.rejects(createBusinessSkillsWorkflow({ createAuthority: () => ({ check: async () => {} }), executor: async () => outcome() }).executeStep('execute', ctx), HarnessWorkflowCancelledError);
});
for (const attack of ['reserved', 'size', 'depth']) test(`executor state rejects ${attack} using the shared JSON boundary`, async () => {
  let state: any = attack === 'reserved' ? JSON.parse('{"constructor":{"payload":true}}') : { value: 'x'.repeat(1024 * 1024) };
  if (attack === 'depth') { state = {}; let cursor = state; for (let i = 0; i < 40; i++) cursor = cursor.child = {}; }
  const value = outcome(); value.state = state;
  await rejects(() => createBusinessSkillsWorkflow({ createAuthority: () => ({ check: async () => {} }), executor: async () => value }).executeStep('execute', context()), 'BUSINESS_SKILLS_INVALID_RESULT');
});
for (const attack of ['reserved', 'size', 'depth']) test(`saved state rejects ${attack} before executor`, async () => {
  const run = runFixture(); let state: any = attack === 'reserved' ? JSON.parse('{"prototype":{"payload":true}}') : { value: 'x'.repeat(1024 * 1024) };
  if (attack === 'depth') { state = {}; let cursor = state; for (let i = 0; i < 40; i++) cursor = cursor.child = {}; }
  const cp = checkpoint(run, state); let calls = 0;
  await rejects(() => createBusinessSkillsWorkflow({ createAuthority: () => ({ check: async () => {} }), executor: async () => { calls++; return outcome(); } }).preflight!(run, [cp])); assert.equal(calls, 0);
});
test('executor keeps original framework functions and cancellation signal while receiving cloned persisted facts', async () => {
  const ctx = context(); const workflow = createBusinessSkillsWorkflow({ createAuthority: () => ({ check: async () => {} }), executor: async input => {
    assert.equal(input.context.abortSignal, ctx.abortSignal); assert.equal(input.context.makeEffectKey, ctx.makeEffectKey);
    assert.equal(input.context.recordToolEffectOnce, ctx.recordToolEffectOnce); assert.notEqual(input.context.attempt, ctx.attempt); return outcome();
  } }); await workflow.executeStep('execute', ctx);
});
test('preflight validates older checkpoints too and rejects resume_next/manual policies', async () => {
  const run = runFixture(); const workflow = createBusinessSkillsWorkflow({ createAuthority: () => ({ check: async () => {} }), executor: async () => outcome() });
  const bad = checkpoint(run); bad.state.businessSkills.runId = 'other'; bad.stateHash = hashHarnessCheckpointState(bad.state);
  await rejects(() => workflow.preflight!(run, [checkpoint(run), bad]));
  for (const policy of ['resume_next', 'manual', 'unknown']) { const cp = checkpoint(run, {}, null); cp.resumePolicy = policy; await rejects(() => workflow.preflight!(run, [cp])); }
});
test('continuation rejects explicitly malformed optional output instead of treating it as absent', async () => {
  for (const invalid of [null, false, 0, '']) {
    const value = outcome('execute'); value.output = invalid;
    await rejects(() => createBusinessSkillsWorkflow({ createAuthority: () => ({ check: async () => {} }), executor: async () => value }).executeStep('execute', context()), 'BUSINESS_SKILLS_INVALID_RESULT');
  }
});
test('pure Workflow checkpoint restore keeps exact published Skill/context/material and validates its frozen output schema', async () => {
  const manifest = frozenWorkflowManifest(); const original = structuredClone(manifest); const run = runFixture(manifest);
  const cp = checkpoint(run, { cursor: 7, completedStep: 's' }); let calls = 0;
  let observed: any;
  const workflow = createBusinessSkillsWorkflow({ createAuthority: () => ({ check: async () => {} }), executor: async input => { calls++; observed = input; return outcome(); } });
  await workflow.preflight!(run, [cp]); const final = await workflow.executeStep('execute', context(run, cp));
  assert.equal(calls, 1); assert.equal(observed.manifest.kind, 'workflow'); assert.deepEqual(observed.manifest, original);
  assert.equal(observed.manifest.skills[0].stepId, 's'); assert.equal(observed.manifest.skills[0].versionId, 'version');
  assert.deepEqual(observed.manifest.publishedDependencies.skills[0].context, original.skills[0].context);
  assert.equal(observed.manifest.skills[0].materials[0].content, 'Original workflow material');
  assert.equal(observed.manifest.skills[0].context.model.model, 'frozen'); assert.deepEqual(observed.manifest.target.definition.outputSchema, payload);
  assert.deepEqual(observed.state, { cursor: 7, completedStep: 's' });
  assert.equal(final.output!.status, 'final'); assert.deepEqual(final.output!.content, { text: 'Frozen result' });
  const invalid = outcome(); invalid.output.content = { text: 42 }; invalid.output.contentHash = hash(invalid.output.content);
  await rejects(() => createBusinessSkillsWorkflow({ createAuthority: () => ({ check: async () => {} }), executor: async () => invalid }).executeStep('execute', context(run, cp)), 'BUSINESS_SKILLS_INVALID_RESULT');
  assert.deepEqual(run.executionConfig.executionManifest, original);
});
