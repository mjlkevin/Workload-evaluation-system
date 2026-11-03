import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createSkillInvocationService } from './skills.invocation';
import { HarnessRuntimeError, type CreateQueuedHarnessRunInput } from '../harness/harness.module';
import { SkillError } from './skills.types';
import { skillDefinitionHash as hash } from './skills.hash';
import type { AuthUser } from '../../types';
const user = { id: 'owner', username: 'owner', role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const body = () => ({ submissionKey: randomUUID(), content: ' Start \n', execution: { kind: 'skill', skillId: 'skill-a', input: { text: 'a' }, sources: [] } });
const trustedAuthority = { prepare: async () => [], capture: async () => [], verifyReplay: async () => {} };
function fixture() {
  const tx = {} as any; let prepares = 0; let resolves = 0; let validations = 0; let cached: any = null; let captured: any;
  const service = createSkillInvocationService({
    authority: trustedAuthority,
    repository: { async prepare() { return { async verify(executor) { assert.equal(executor, tx); validations++; } }; } },
    prepareExecution: async () => { prepares++; return { async resolveInTransaction(executor) { assert.equal(executor, tx); resolves++; return { target: { versionId: 'old' } } as any; } }; },
    queue: { async findRunForSubmissionKey() { return cached; }, async createQueuedRun(input: CreateQueuedHarnessRunInput) {
      captured = input; await input.validateSubmission!(tx);
      if (cached) {
        if (cached.metadata.invocationFingerprint !== input.submissionFingerprint) throw Object.assign(new Error('private detail'), { code: 'SUBMISSION_KEY_CONFLICT' });
        return { run: cached, created: false };
      }
      const config = await input.resolveExecutionConfig!(tx);
      cached = { harnessRunId: 'run', aiSessionId: input.aiSessionId, status: 'queued', eventSequence: 2,
        metadata: { invocationFingerprint: input.submissionFingerprint }, executionConfig: config };
      return { run: cached, created: true };
    } } as any,
  });
  return { service, counts: () => ({ prepares, resolves, validations }), captured: () => captured, cached: () => cached };
}
test('internal invocation prepares outside queue, resolves with its executor and exposes only the public submit result', async () => {
  const f = fixture(); const result = await f.service.submitInvocation(user, 'session', body());
  assert.deepEqual(result, { status: 202, data: { runId: 'run', sessionId: 'session', status: 'queued', eventCursor: 2 } });
  assert.deepEqual(f.counts(), { prepares: 1, resolves: 1, validations: 1 });
  assert.equal(f.captured().workflowId, 'business_skills_v1');
  assert.equal(f.cached().executionConfig.executionManifest.target.versionId, 'old');
  assert.equal(f.captured().userMessageFact('run').content, 'Start');
});
test('same logical request replay excludes freshly minted message identity and never prepares again', async () => {
  const f = fixture(); const b = body(); const first = await f.service.submitInvocation(user, 'session', b);
  const second = await f.service.submitInvocation(user, 'session', { ...b, content: 'Start' });
  assert.deepEqual(second, first); assert.deepEqual(f.counts(), { prepares: 1, resolves: 1, validations: 2 });
});
test('request boundary rejects extra body/execution fields, malformed content and unsafe JSON before database work', async () => {
  for (const alter of [
    (b: any) => ({ ...b, owner: 'other' }), (b: any) => ({ ...b, manifest: {} }),
    (b: any) => ({ ...b, execution: { ...b.execution, version: 'draft' } }),
    (b: any) => ({ ...b, execution: { ...b.execution, definition: {} } }),
    (b: any) => ({ ...b, execution: { ...b.execution, sources: [{ kind: 'file', id: 'a', url: 'untrusted' }] } }),
    (b: any) => ({ ...b, content: '  ' }), (b: any) => ({ ...b, submissionKey: '' }),
    (b: any) => ({ ...b, execution: JSON.parse('{"kind":"skill","skillId":"a","input":{"__proto__":{}}}') }),
  ]) {
    const f = fixture(); await assert.rejects(f.service.submitInvocation(user, 'session', alter(body())), (e: any) => e.code === 'INVOCATION_INVALID_REQUEST');
    assert.equal(f.counts().prepares, 0);
  }
});
test('unknown resolver errors are reduced to safe code and text', async () => {
  const service = createSkillInvocationService({ repository: { prepare: async () => { throw new Error('private SQL/config text'); } } });
  await assert.rejects(service.submitInvocation(user, 'session', body()), (e: any) => e.code === 'INVOCATION_INTERNAL' && !e.message.includes('private'));
});
function publicationRace(mode: 'same' | 'none' | 'changed' | 'legacy' | 'authority' | 'source' | 'session') {
  const b = body(); const tx = {} as any;
  let row: any = null; let lookups = 0; let queueCalls = 0; let validations = 0;
  const fingerprint = hash({ sessionId: 'session', content: b.content.trim(), execution: b.execution });
  const service = createSkillInvocationService({
    authority: trustedAuthority,
    repository: { async prepare() { return { async verify(executor) {
      assert.equal(executor, tx); validations++;
      const code = ({ authority: 'INVOCATION_FORBIDDEN', source: 'INVOCATION_SOURCE_CHANGED', session: 'INVOCATION_NOT_FOUND' } as Record<string, string>)[mode];
      if (code) throw new SkillError(code, 'private authority/source details');
    } }; } },
    prepareExecution: async () => {
      // A commits between B's initial miss and B's now-unavailable publication lookup.
      if (mode !== 'none') row = { harnessRunId: 'original', aiSessionId: 'session', status: 'queued', eventSequence: 2,
        metadata: { invocationFingerprint: mode === 'legacy' ? undefined : mode === 'changed' ? 'other-request' : fingerprint } };
      throw new SkillError('EXECUTION_UNAVAILABLE', 'private publication details', 409);
    },
    queue: { async findRunForSubmissionKey() { lookups++; return row; }, async createQueuedRun(input: CreateQueuedHarnessRunInput) {
      queueCalls++; await input.validateSubmission!(tx);
      assert.notEqual(row, null);
      if (row.metadata.invocationFingerprint !== input.submissionFingerprint) throw new HarnessRuntimeError('SUBMISSION_KEY_CONFLICT');
      return { run: row, created: false };
    } } as any,
  });
  return { invoke: () => service.submitInvocation(user, 'session', b), counts: () => ({ lookups, queueCalls, validations }) };
}
test('prepare failure rechecks a concurrently committed request and uses strict queue replay', async () => {
  const f = publicationRace('same');
  assert.deepEqual(await f.invoke(), { status: 202, data: { runId: 'original', sessionId: 'session', status: 'queued', eventCursor: 2 } });
  assert.deepEqual(f.counts(), { lookups: 2, queueCalls: 1, validations: 1 });
});
test('prepare failure without a concurrent Run preserves its safe error and creates nothing', async () => {
  const f = publicationRace('none');
  await assert.rejects(f.invoke(), (e: any) => e.code === 'INVOCATION_CONTEXT_CHANGED' && !e.message.includes('private'));
  assert.deepEqual(f.counts(), { lookups: 2, queueCalls: 0, validations: 0 });
});
test('concurrent fallback cannot accept changed fingerprints or legacy chat, or bypass authority/session/source checks', async () => {
  for (const [mode, code] of [['changed', 'SUBMISSION_KEY_CONFLICT'], ['legacy', 'SUBMISSION_KEY_CONFLICT'],
    ['authority', 'INVOCATION_FORBIDDEN'], ['session', 'INVOCATION_NOT_FOUND'], ['source', 'INVOCATION_SOURCE_CHANGED']] as const) {
    const f = publicationRace(mode);
    await assert.rejects(f.invoke(), (e: any) => e.code === code && !e.message.includes('private'));
    assert.deepEqual(f.counts(), { lookups: 2, queueCalls: 1, validations: 1 });
  }
});
test('authority failure closes admission before any model/tool preparation and preserves safe unavailable status', async () => {
  let prepares = 0;
  const service = createSkillInvocationService({
    repository: { async prepare() { return { async verify() {} }; } },
    authority: { ...trustedAuthority, async prepare() { throw new SkillError('EXECUTION_AUTHORITY_UNAVAILABLE', 'private detail', 503); } },
    prepareExecution: async () => { prepares++; throw new Error('must not prepare'); },
    queue: { async findRunForSubmissionKey() { return null; } } as any,
  });
  await assert.rejects(service.submitInvocation(user, 'session', body()), (e: any) => e.code === 'EXECUTION_AUTHORITY_UNAVAILABLE' && e.status === 503 && !e.message.includes('private'));
  assert.equal(prepares, 0);
});
