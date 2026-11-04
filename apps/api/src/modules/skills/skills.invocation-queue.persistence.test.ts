import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../db/schema';
import { resolveExecutionTestDatabaseUrl } from '../../test-helpers/execution-database-guard';
import { createHarnessRuntimeRepository } from '../harness/harness.module';

const target = resolveExecutionTestDatabaseUrl(process.env);
const pool = new Pool({ connectionString: target, max: 1, connectionTimeoutMillis: 500 });
const database = drizzle(pool, { schema });
const repo = createHarnessRuntimeRepository(database);
const owner = randomUUID();
after(async () => { await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, owner)); await pool.end(); });
function input(overrides: Record<string, unknown> = {}) {
  return { ownerUserId: owner, ownerUsername: 'queue-test', aiSessionId: randomUUID(), submissionKey: randomUUID(),
    title: 'atomic queue', workflowId: 'business_skills_v1', workflowVersion: '1.0.0',
    userMessageFact: () => ({ content: 'user text' }), ...overrides };
}
async function rows(key: string) {
  return database.select().from(schema.harnessRuns).where(and(eq(schema.harnessRuns.ownerUserId, owner), eq(schema.harnessRuns.submissionKey, key)));
}
test('trusted resolver shares the queue connection and commits manifest with both first events', async () => {
  let calls = 0;
  const queued = await repo.createQueuedRun(input({ resolveExecutionConfig: async (tx: any) => {
    calls++; await tx.select().from(schema.harnessRuns).limit(1);
    return { executionManifest: { frozen: 'old version' } };
  } }));
  assert.equal(calls, 1);
  assert.deepEqual(queued.run.executionConfig, { executionManifest: { frozen: 'old version' } });
  assert.equal(queued.run.runKind, 'workbench_chat');
  const events = await repo.listRunEventsAfter({ runId: queued.run.harnessRunId, afterSequence: 0, limit: 100 });
  assert.deepEqual(events.map(e => e.eventType), ['run_queued', 'user/message']);
  assert.equal(queued.run.eventSequence, 2);
});
test('resolver failure and resolved config overflow roll back the entire submission without exposing details', async () => {
  for (const resolveExecutionConfig of [async () => { throw new Error('private SQL/config detail'); }, async () => ({ content: 'x'.repeat(1024 * 1024) })]) {
    const value = input({ resolveExecutionConfig });
    await assert.rejects(repo.createQueuedRun(value), (e: any) => {
      assert.ok(['HARNESS_RUNTIME_INTERNAL', 'HARNESS_RUNTIME_PAYLOAD_TOO_LARGE'].includes(e.code));
      assert.equal(e.message.includes('private'), false); return true;
    });
    assert.equal((await rows(value.submissionKey)).length, 0);
  }
});
test('same owner/key concurrent replay resolves once and rejects changed business or legacy kind', async () => {
  let calls = 0;
  const value = input({ submissionFingerprint: 'request-a', resolveExecutionConfig: async () => { calls++; return { frozen: true }; } });
  const [a, b] = await Promise.all([repo.createQueuedRun(value), repo.createQueuedRun(value)]);
  assert.equal(calls, 1); assert.equal(a.run.harnessRunId, b.run.harnessRunId);
  assert.equal((await rows(value.submissionKey)).length, 1);
  const eventRows = await repo.listRunEventsAfter({ runId: a.run.harnessRunId, afterSequence: 0, limit: 100 });
  assert.equal(eventRows.length, 2);
  for (const submissionFingerprint of ['request-b', undefined]) {
    await assert.rejects(repo.createQueuedRun({ ...value, submissionFingerprint }), (e: any) => e.code === 'SUBMISSION_KEY_CONFLICT');
  }
  const legacy = input(); await repo.createQueuedRun(legacy);
  // Existing ordinary-chat semantics deliberately remain payload-insensitive.
  const replay = await repo.createQueuedRun({ ...legacy, title: 'changed legacy body' }); assert.equal(replay.created, false);
  await assert.rejects(repo.createQueuedRun({ ...legacy, submissionFingerprint: 'business' }), (e: any) => e.code === 'SUBMISSION_KEY_CONFLICT');
});
test('validation runs on replay, while the resolver never runs a second time', async () => {
  let valid = true; let validations = 0;
  const value = input({ submissionFingerprint: 'replay', validateSubmission: async () => { validations++; if (!valid) throw new Error('private ownership detail'); },
    resolveExecutionConfig: async () => ({ frozen: true }) });
  const first = await repo.createQueuedRun(value);
  await repo.createQueuedRun({ ...value, resolveExecutionConfig: async () => { throw new Error('must not resolve'); } });
  valid = false;
  await assert.rejects(repo.createQueuedRun(value), (e: any) => e.code === 'HARNESS_RUNTIME_INTERNAL' && !e.message.includes('private'));
  assert.equal(validations, 3); assert.equal((await rows(value.submissionKey))[0].harnessRunId, first.run.harnessRunId);
});
test('strict replay binds session and adapter identity even with an identical trusted fingerprint', async () => {
  const value = input({ submissionFingerprint: 'same-fingerprint' });
  await repo.createQueuedRun(value);
  for (const change of [{ aiSessionId: randomUUID() }, { workflowId: 'other-adapter' }, { workflowVersion: 'other-version' }]) {
    await assert.rejects(repo.createQueuedRun({ ...value, ...change }), (e: any) => e.code === 'SUBMISSION_KEY_CONFLICT');
  }
});
test('ON CONFLICT fallback rejects a different request inserted by a writer without the advisory lock', async () => {
  const legacyPool = new Pool({ connectionString: target, max: 1 });
  const legacy = drizzle(legacyPool, { schema });
  const value = input({ submissionFingerprint: 'new-request', resolveExecutionConfig: async () => {
    await legacy.insert(schema.harnessRuns).values({ harnessRunId: randomUUID(), ownerUserId: owner, ownerUsername: 'old-writer',
      aiSessionId: randomUUID(), submissionKey: value.submissionKey, title: 'other request', workflowId: 'workbench_chat_v1', workflowVersion: '1.0.0',
      mode: 'interactive', stage: 'uploaded', status: 'completed', runKind: 'workbench_chat' });
    return { manifest: 'prepared' };
  } });
  try {
    await assert.rejects(repo.createQueuedRun(value), (e: any) => e.code === 'SUBMISSION_KEY_CONFLICT');
    assert.equal((await rows(value.submissionKey)).length, 1);
  } finally { await legacyPool.end(); }
});
test('different submissions and ordinary chat still compete for one active session; failed user event rolls back', async () => {
  const value = input({ resolveExecutionConfig: async () => ({ manifest: 'frozen' }) });
  const results = await Promise.allSettled([repo.createQueuedRun(value), repo.createQueuedRun({ ...value, submissionKey: randomUUID(), resolveExecutionConfig: undefined })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejected.reason.code, 'ACTIVE_WORKBENCH_RUN_EXISTS');
  const bad = input({ resolveExecutionConfig: async () => ({ manifest: true }), userMessageFact: () => ({ content: 'x'.repeat(1024 * 1024) }) });
  await assert.rejects(repo.createQueuedRun(bad), (e: any) => e.code === 'HARNESS_RUNTIME_PAYLOAD_TOO_LARGE');
  assert.equal((await rows(bad.submissionKey)).length, 0);
});
