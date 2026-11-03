import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../db/schema';
import { closeDb } from '../../db/client';
import { resolveExecutionTestDatabaseUrl } from '../../test-helpers/execution-database-guard';
import { createHarnessRuntimeRepository } from './harness-runtime.repository';
import { createHarnessRuntimeWorker, createHarnessWorkflowRegistry, type HarnessWorkflow } from './harness-runtime.worker';

const pool = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 2, connectionTimeoutMillis: 2000 });
const database = drizzle(pool, { schema }), repo = createHarnessRuntimeRepository(database);
const owner = `cancel-terminal-${randomUUID()}`, runIds: string[] = [];
const workflowId = 'cancel_terminal_model_fixture', workflowVersion = 'v1';
type Hook = { outcome: string; runStatus: string };
function latch() {
 let release!: () => void;
 const promise = new Promise<void>(resolve => { release = resolve; });
 return { promise, release };
}
async function seedRun() {
 const { run } = await repo.createQueuedRun({ ownerUserId: owner, ownerUsername: 'cancel-terminal-fixture', aiSessionId: randomUUID(),
  submissionKey: randomUUID(), title: 'Ordered model terminal fixture', workflowId, workflowVersion, executionConfig: { model: 'fixture' } });
 runIds.push(run.harnessRunId); return run;
}
async function gatedModel(outcome: 'failure' | 'success') {
 const run = await seedRun(), entered = latch(), released = latch(), hooks: Hook[] = [];
 let signal!: AbortSignal;
 const provider = { async complete(current: AbortSignal) {
  signal = current; entered.release(); await released.promise;
  assert.equal(current.aborted, false, 'the real Worker heartbeat must not already know about cancellation');
  if (outcome === 'failure') throw Error('Fixture model fault after the ordered gate');
  return { text: 'Model completed' };
 } };
 const workflow: HarnessWorkflow = { workflowId, workflowVersion, firstStepKey: 'model', stepKeys: ['model'], async executeStep(_step, context) {
  assert.equal(context.run.harnessRunId, run.harnessRunId);
  const modelOutput = await provider.complete(context.abortSignal);
  return { nextStepKey: null, statePatch: { modelOutput } };
 } };
 const worker = createHarnessRuntimeWorker({ repository: repo, registry: createHarnessWorkflowRegistry([workflow]), workerId: randomUUID(),
  // The ordering is controlled by committed transactions and gates, not heartbeat timing.
  timing: { heartbeatIntervalMs: 60000, leaseMs: 120000 },
  async onRunTerminal(actual, kind) { hooks.push({ outcome: kind, runStatus: actual.status }); } });
 const done = worker.runNextAttempt();
 await Promise.race([entered.promise, done.then(() => { throw Error('Worker exited before reaching the model gate'); })]);
 return { run, signal, hooks, done, release: released.release };
}
async function summary(runId: string) {
 const run = (await repo.findRunForOwner(runId, owner))!;
 const attempts = await database.select().from(schema.harnessRunAttempts).where(eq(schema.harnessRunAttempts.harnessRunId, runId));
 assert.equal(attempts.length, 1);
 const events = await repo.listRunEventsAfter({ runId, afterSequence: 0, limit: 100 });
 return { runStatus: run.status, runError: run.errorCode, runMessage: run.errorMessage,
  attemptStatus: attempts[0].status, attemptError: attempts[0].errorCode, attemptMessage: attempts[0].errorMessage,
  terminalEvents: events.filter(e => ['run_cancelled', 'run_failed', 'run_completed'].includes(e.eventType)).map(e => e.eventType) };
}
afterEach(async () => { for (const runId of runIds.splice(0)) await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.harnessRunId, runId)); });
after(async () => { await pool.end(); await closeDb(); });

for (const outcome of ['failure', 'success'] as const) test(`committed cancellation wins over a later ${outcome} with no heartbeat foreknowledge`, { timeout: 10000 }, async () => {
 const f = await gatedModel(outcome), runId = f.run.harnessRunId;
 try {
  const cancelled = await repo.requestRunCancel({ runId, requestedBy: owner });
  assert.equal(cancelled.changed, true); assert.equal(cancelled.run.status, 'cancelling'); assert.ok(cancelled.run.cancelRequestedAt);
  assert.equal(f.signal.aborted, false); f.release(); await f.done;
  assert.deepEqual(await summary(runId), { runStatus: 'cancelled', runError: null, runMessage: null,
   attemptStatus: 'cancelled', attemptError: null, attemptMessage: null, terminalEvents: ['run_cancelled'] });
  assert.deepEqual(f.hooks, [{ outcome: 'cancelled', runStatus: 'cancelled' }]);
  const attempts = await database.select().from(schema.harnessRunAttempts).where(eq(schema.harnessRunAttempts.harnessRunId, runId));
  const duplicate = await repo.completeAttemptAndRun({ runId, attemptId: attempts[0].harnessRunAttemptId, outcome: 'failed', errorCode: 'LATE_FAILURE' });
  assert.equal(duplicate.changed, false); assert.equal(duplicate.run.status, 'cancelled');
  assert.deepEqual((await summary(runId)).terminalEvents, ['run_cancelled']);
 } finally { f.release(); await f.done; }
});
test('a committed model failure remains final when cancellation arrives afterwards', { timeout: 10000 }, async () => {
 const f = await gatedModel('failure'), runId = f.run.harnessRunId;
 try {
  f.release(); await f.done;
  const before = await summary(runId); assert.equal(before.runStatus, 'failed'); assert.equal(before.attemptStatus, 'failed');
  assert.equal(before.runError, 'WORKER_STEP_FAILED'); assert.deepEqual(before.terminalEvents, ['run_failed']);
  const cancelled = await repo.requestRunCancel({ runId, requestedBy: owner });
  assert.equal(cancelled.changed, false); assert.equal(cancelled.run.status, 'failed'); assert.deepEqual(await summary(runId), before);
  assert.deepEqual(f.hooks, [{ outcome: 'failed', runStatus: 'failed' }]);
 } finally { f.release(); await f.done; }
});
test('a Worker observing an already committed terminal result does not invoke a duplicate terminal hook', { timeout: 10000 }, async () => {
 const f = await gatedModel('failure'), runId = f.run.harnessRunId;
 try {
  const [attempt] = await database.select().from(schema.harnessRunAttempts).where(eq(schema.harnessRunAttempts.harnessRunId, runId));
  const winner = await repo.completeAttemptAndRun({ runId, attemptId: attempt.harnessRunAttemptId, outcome: 'failed', errorCode: 'FIRST_TERMINAL', errorMessage: 'The committed winner' });
  assert.equal(winner.changed, true); assert.equal(f.signal.aborted, false); f.release(); await f.done;
  const result = await summary(runId); assert.equal(result.runStatus, 'failed'); assert.equal(result.runError, 'FIRST_TERMINAL');
  assert.equal(result.attemptError, 'FIRST_TERMINAL'); assert.deepEqual(result.terminalEvents, ['run_failed']);
  assert.deepEqual(f.hooks, []);
 } finally { f.release(); await f.done; }
});
