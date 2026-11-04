import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExecutionAuthority } from './execution-authority';
import { createBusinessSkillsWorkflow } from '../harness/business-skills.workflow';
import { context, outcome } from '../harness/business-skills.test-fixture';
test('unavailable authority database produces only fixed safe failure', async () => {
  const authority = createExecutionAuthority({ transaction: async () => { throw new Error('private SQL credentials'); } } as any);
  await assert.rejects(authority.check({ runId: 'run', ownerUserId: 'owner', manifestHash: 'hash', phase: 'resume' }),
    (e: any) => e.code === 'EXECUTION_AUTHORITY_DENIED' && !e.message.includes('private'));
});
test('every workflow executeStep checks resume permission before executor', async () => {
  let checks = 0; let executions = 0; const ctx = context();
  const workflow = createBusinessSkillsWorkflow({ createAuthority: () => ({ check: async action => { checks++; assert.equal(action.phase, 'resume');
    assert.equal(action.runId, ctx.run.harnessRunId); if (checks > 1) throw new Error('revoked'); } }), executor: async () => { executions++; return outcome('execute'); } });
  await workflow.executeStep('execute', ctx);
  await assert.rejects(workflow.executeStep('execute', ctx), /BUSINESS_SKILLS_AUTHORITY_DENIED/);
  assert.equal(checks, 2); assert.equal(executions, 1);
});
test('workflow cancelled while checker is pending cannot dispatch a late executor', async () => {
  let resolve!: () => void; let executions = 0; const controller = new AbortController(); const ctx = context(); ctx.abortSignal = controller.signal;
  const workflow = createBusinessSkillsWorkflow({ createAuthority: () => ({ check: () => new Promise<void>(r => { resolve = r; }) }), executor: async () => { executions++; return outcome(); } });
  const running = workflow.executeStep('execute', ctx); await new Promise(r => setImmediate(r)); controller.abort(); resolve();
  await assert.rejects(running); assert.equal(executions, 0);
});
