import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRunTerminalMemoryHook, startHarnessRuntime } from './harness-boot';
import { context, outcome, runFixture } from './business-skills.test-fixture';
test('boot installs precisely the fixed business adapter and ordinary chat identities, once', async () => {
  let starts = 0; let executions = 0;
  const runtime = startHarnessRuntime({ repo: {} as any, enabled: true, businessSkillsExecutor: async () => { executions++; return outcome(); },
    createWorker({ registry }) {
      assert.ok(registry.get('workbench_chat_v1', '1.0.0')); const business = registry.get('business_skills_v1', '1.0.0')!;
      assert.ok(business); assert.equal(registry.get('business_skills_v1', '2'), undefined); assert.equal(registry.get('skill', 'version'), undefined);
      return { async start() { starts++; await assert.rejects(business.executeStep('execute', context()), { message: 'BUSINESS_SKILLS_AUTHORITY_DENIED' }); }, async stop() {}, async runNextAttempt() { return false; }, isStopping() { return false; } };
    } });
  await runtime.stop(); assert.equal(starts, 1); assert.equal(executions, 0);
});
test('disabled boot has no worker or executor side effect', async () => {
  const forbidden = () => { throw new Error('must not run'); };
  const runtime = startHarnessRuntime({ repo: {} as any, enabled: false, createWorker: forbidden, businessSkillsExecutor: forbidden });
  await runtime.stop();
});
test('default business adapter never falls through to chat/model/tool factories', async () => {
  let factories = 0; let checked = false;
  const forbidden = () => { factories++; throw new Error('private provider'); };
  const runtime = startHarnessRuntime({ repo: {} as any, enabled: true, createModelChat: forbidden, getProvider: forbidden, resolveApiKey: forbidden, resolveScenario: forbidden,
    createWorker({ registry }) { return { async start() {
      const business = registry.get('business_skills_v1', '1.0.0')!;
      await assert.rejects(business.executeStep('execute', context()), { message: 'BUSINESS_SKILLS_EXECUTOR_UNAVAILABLE' }); checked = true;
    }, async stop() {}, async runNextAttempt() { return false; }, isStopping() { return false; } }; } });
  await runtime.stop(); assert.equal(checked, true); assert.equal(factories, 0);
});
test('completed business runs never read snapshot/key/provider or invoke memory distillation', async () => {
  let effects = 0; const forbidden = () => { effects++; throw new Error('must not read'); };
  const hook = createRunTerminalMemoryHook({ repo: { getRunSnapshot: forbidden } as any, resolveApiKey: forbidden, getProvider: forbidden,
    getMemoryRepo: forbidden, distill: forbidden, model: forbidden, apiBaseUrl: forbidden, timeoutMs: 1, onError: forbidden });
  await hook(runFixture(), 'completed'); assert.equal(effects, 0);
});
