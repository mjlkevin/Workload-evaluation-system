import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { resolveExecutionTestDatabaseUrl } from '../../test-helpers/execution-database-guard';
import { createHarnessRuntimeRepository } from './harness-runtime.repository';
import { createAiRunsUsecase } from './harness-runtime.usecase';
import { createHarnessRuntimeWorker, createHarnessWorkflowRegistry } from './harness-runtime.worker';
import { createBusinessSkillsWorkflow } from './business-skills.workflow';
import { createBusinessSkillsWaitService, createBusinessWorkflowWaitExecutor } from './business-skills.wait';
import { manifest, hash, path, predicate } from './workflows.runtime.fixture';
const pool = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 4, connectionTimeoutMillis: 2000 });
const database = drizzle(pool, { schema });
const queue = createHarnessRuntimeRepository(database);
const owner = randomUUID(); const sessions: string[] = [];
async function enqueue() {
  const m = manifest((d) => {
    d.description = 'Private workflow instructions';
    d.steps = d.steps.filter(s => s.type === 'userInput' || s.type === 'confirmation');
    d.steps[0].inputMapping = [path('text', '$.input.text')];
    d.steps[1].branches = [{ when: [predicate('$.steps.c.output.approved', 'eq', false)], target: '$end' }];
    const first = d.steps[0]; if (first.type !== 'userInput') throw new Error('fixture requires user input');
    d.steps.push({ ...structuredClone(first), id: 'after', prompt: 'Approved follow-up', inputMapping: [path('text', '$.steps.u.output.text')] });
    d.outputMapping = [path('text', '$.steps.u.output.text')];
  });
  m.caller.id = owner; const { manifestHash: _, ...body } = m; m.manifestHash = hash(body);
  const sessionId = randomUUID(); sessions.push(sessionId);
  await database.insert(schema.aiSessions).values({ sessionId, ownerUserId: owner, ownerUsername: 'wait-fixture', title: 'Wait',
    domain: 'business_evaluation', workflowKey: 'temporary_chat', status: 'temporary_chat', businessRole: 'pre_sales', createdAt: new Date(), updatedAt: new Date() });
  const content = 'Wait fixture';
  const execution = { kind: m.kind, workflowId: m.target.id, input: m.initialInput, sources: m.sources };
  const result = await queue.createQueuedRun({ ownerUserId: owner, ownerUsername: 'wait-fixture', aiSessionId: sessionId,
    submissionKey: randomUUID(), title: content, workflowId: 'business_skills_v1', workflowVersion: '1.0.0',
    executionConfig: { content, executionManifest: m }, submissionFingerprint: hash({ sessionId, content, execution }) });
  return result.run;
}
afterEach(async () => { await database.delete(schema.harnessRuns).where(eq(schema.harnessRuns.ownerUserId, owner)); });
after(async () => { for (const sessionId of sessions) await database.delete(schema.aiSessions).where(eq(schema.aiSessions.sessionId, sessionId)); await pool.end(); });
const rejectCode = (code: string) => (error: any) => error.code === code;
const invalid = (error: any) => /^BUSINESS_SKILLS_/.test(error.code ?? error.message);
const service = () => createBusinessSkillsWaitService(database);
async function execute() {
  const repository = createHarnessRuntimeRepository(database);
  const executor = createBusinessWorkflowWaitExecutor(createBusinessSkillsWaitService(database));
  const registry = createHarnessWorkflowRegistry([createBusinessSkillsWorkflow({ executor })]);
  assert.equal(await createHarnessRuntimeWorker({ repository, registry, workerId: randomUUID() }).runNextAttempt(), true);
}
async function events(runId: string) { return queue.listRunEventsAfter({ runId, afterSequence: 0, limit: 200 }); }
async function waiting(runId: string) {
  return (await events(runId)).filter(e => e.eventType.startsWith('workflow.awaiting_')).at(-1)!.payload as any;
}
const answer = (run: any, wait: any, value: any) => ({ runId: run.harnessRunId, sessionId: run.aiSessionId, requestedBy: owner,
  actionId: wait.actionId, kind: wait.kind, stepId: wait.stepId, contentHash: wait.contentHash, value });
for (const method of ['input', 'confirm', 'reject']) test(`generic ${method} cannot release a business wait`, async () => {
  const run = await enqueue();
  await database.update(schema.harnessRuns).set({ status: 'waiting' }).where(eq(schema.harnessRuns.harnessRunId, run.harnessRunId));
  const action = method === 'input' ? queue.submitRunInput({ runId: run.harnessRunId, requestedBy: owner, input: { text: 'bypass' } })
    : method === 'confirm' ? queue.confirmRunAction({ runId: run.harnessRunId, confirmedBy: owner, actionId: 'bypass' })
    : queue.rejectRunAction({ runId: run.harnessRunId, rejectedBy: owner, actionId: 'bypass' });
  await assert.rejects(action, rejectCode('BUSINESS_SKILLS_WAIT_CHANNEL_REQUIRED'));
  assert.equal((await queue.findRunForOwner(run.harnessRunId, owner))!.status, 'waiting');
});
test('public business snapshot omits private execution configuration and checkpoint state', async () => {
  const run = await enqueue();
  await execute();
  const usecase = createAiRunsUsecase({ repo: queue, enabled: true } as any);
  const snapshot = await usecase.getRunSnapshot({ id: owner } as any, run.harnessRunId);
  assert.equal('executionConfig' in snapshot.run, false);
  assert.equal('state' in (snapshot.checkpoint as object), false);
  assert.equal(JSON.stringify(snapshot).includes('Original workflow material'), false);
  assert.equal(JSON.stringify(snapshot).includes('Private workflow instructions'), false);
  await assert.rejects(usecase.getRunSnapshot({ id: randomUUID() } as any, run.harnessRunId), (e: any) => e.status === 404);
});
for (const method of ['input', 'confirm', 'reject']) test(`public ${method} maps blocked business channel to conflict`, async () => {
  const run = await enqueue(); await execute();
  const usecase = createAiRunsUsecase({ repo: queue, enabled: true } as any);
  const user = { id: owner } as any;
  const operation = method === 'input' ? usecase.submitInputs(user, run.harnessRunId, { input: { text: 'bypass' } })
    : method === 'confirm' ? usecase.confirmAction(user, run.harnessRunId, 'bypass') : usecase.rejectAction(user, run.harnessRunId, 'bypass');
  await assert.rejects(operation, (e: any) => e.status === 409 && e.code === 'BUSINESS_SKILLS_WAIT_CHANNEL_REQUIRED');
});
test('real wait atomically saves checkpoint and releases attempt; fresh service and Worker restore original contracts to final', async () => {
  const run = await enqueue(); await execute();
  assert.equal((await queue.findRunForOwner(run.harnessRunId, owner))!.status, 'waiting');
  const attempts = await database.select().from(schema.harnessRunAttempts).where(eq(schema.harnessRunAttempts.harnessRunId, run.harnessRunId));
  assert.equal(attempts.length, 1); assert.equal(attempts[0].status, 'cancelled');
  const cp = (await queue.listCheckpointsForRun({ runId: run.harnessRunId }))[0]; assert.ok(cp);
  const wait = await waiting(run.harnessRunId);
  assert.equal(wait.prompt, 'Original prompt'); assert.deepEqual(wait.displayInput, { text: 'original' });
  assert.equal(JSON.stringify(wait).includes('executionManifest'), false);
  assert.equal(JSON.stringify(wait).includes('Original workflow material'), false);
  assert.equal(JSON.stringify(wait).includes('Private workflow instructions'), false);
  const first = answer(run, wait, { text: 'answer' });
  const accepted = await service().answer(first); assert.equal(accepted.created, true);
  await execute(); const confirm = await waiting(run.harnessRunId); assert.equal(confirm.kind, 'confirmation');
  assert.notEqual(confirm.actionId, wait.actionId); assert.deepEqual(confirm.displayInput, { text: 'answer' });
  const duplicate = await service().answer(first); assert.equal(duplicate.created, false);
  assert.equal(duplicate.event.harnessRunEventId, accepted.event.harnessRunEventId);
  assert.equal((await queue.findRunForOwner(run.harnessRunId, owner))!.status, 'waiting');
  await service().answer(answer(run, confirm, { approved: false })); await execute();
  assert.equal((await queue.findRunForOwner(run.harnessRunId, owner))!.status, 'completed');
  assert.deepEqual((await queue.getRunSnapshot(run.harnessRunId))!.output!.content, { text: 'answer' });
  const final = (await queue.listCheckpointsForRun({ runId: run.harnessRunId }))[0].state as any;
  assert.deepEqual(final.businessSkills.state.receipts.map((r: any) => r.output), [{ text: 'answer' }, { approved: false }]);
  assert.equal((await events(run.harnessRunId)).filter(e => e.eventType === 'workflow.awaiting_input').length, 1);
  const count = (await events(run.harnessRunId)).length;
  assert.equal((await service().answer(first)).created, false);
  assert.equal((await events(run.harnessRunId)).length, count);
});
test('invalid schema, owner/session/kind/step/action/content and cross-run answers keep original wait unchanged', async () => {
  const run = await enqueue(); await execute(); const wait = await waiting(run.harnessRunId);
  const good = answer(run, wait, { text: 'valid' }); const count = (await events(run.harnessRunId)).length;
  for (const patch of [{ requestedBy: randomUUID() }, { sessionId: randomUUID() }, { kind: 'confirmation' }, { stepId: 'c' },
    { actionId: hash('other') }, { contentHash: hash('changed') }, { value: { text: 3 } }, { value: { text: 'valid', extra: true } },
    { value: { text: 'x', constructor: 'unsafe' } }]) {
    await assert.rejects(service().answer({ ...good, ...patch } as any), invalid);
    assert.equal((await queue.findRunForOwner(run.harnessRunId, owner))!.status, 'waiting');
    assert.equal((await events(run.harnessRunId)).length, count);
  }
  const other = await enqueue(); await execute();
  await assert.rejects(service().answer({ ...good, runId: other.harnessRunId, sessionId: other.aiSessionId! }), invalid);
  await service().answer(good); await execute(); const confirm = await waiting(run.harnessRunId);
  for (const value of [{ approved: 'true' }, { approved: true, extra: true }, {}]) await assert.rejects(service().answer(answer(run, confirm, value)), invalid);
});
test('separate connections serialize identical and conflicting concurrent answers exactly once', async () => {
  const run = await enqueue(); await execute(); const wait = await waiting(run.harnessRunId); const good = answer(run, wait, { text: 'same' });
  const same = await Promise.all([service().answer(good), service().answer(good)]);
  assert.deepEqual(same.map(r => r.created).sort(), [false, true]);
  assert.equal(same[0].event.harnessRunEventId, same[1].event.harnessRunEventId);
  await assert.rejects(service().answer({ ...good, value: { text: 'conflict' } }), invalid);
  await execute(); const confirm = await waiting(run.harnessRunId);
  const conflict = await Promise.allSettled([service().answer(answer(run, confirm, { approved: true })), service().answer(answer(run, confirm, { approved: false }))]);
  assert.equal(conflict.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await events(run.harnessRunId)).filter(e => e.eventType === 'workflow.answer_recorded').length, 2);
  assert.equal((await queue.listCheckpointsForRun({ runId: run.harnessRunId })).length, 4);
});
test('stale/wrong attempt and expired lease cannot persist a wait', async () => {
  const run = await enqueue(); const claimed = (await queue.claimNextQueuedRun({ workerId: randomUUID(), leaseMs: 10000 }))!;
  await assert.rejects(service().pause({ runId: run.harnessRunId, attemptId: randomUUID() }), invalid);
  await database.update(schema.harnessRunAttempts).set({ leaseExpiresAt: new Date(0) }).where(eq(schema.harnessRunAttempts.harnessRunAttemptId, claimed.attempt.harnessRunAttemptId));
  await assert.rejects(service().pause({ runId: run.harnessRunId, attemptId: claimed.attempt.harnessRunAttemptId }), invalid);
  assert.equal((await queue.listCheckpointsForRun({ runId: run.harnessRunId })).length, 0);
  assert.equal((await events(run.harnessRunId)).some(e => e.eventType.startsWith('workflow.')), false);
});
test('cancellation before wait is terminal; cancel racing response never resurrects cancelled run', async () => {
  const run = await enqueue(); const claimed = (await queue.claimNextQueuedRun({ workerId: randomUUID(), leaseMs: 10000 }))!;
  await queue.requestRunCancel({ runId: run.harnessRunId, requestedBy: owner });
  const paused = await service().pause({ runId: run.harnessRunId, attemptId: claimed.attempt.harnessRunAttemptId });
  assert.equal(paused.paused, false); assert.equal((await queue.findRunForOwner(run.harnessRunId, owner))!.status, 'cancelled');
  const next = await enqueue(); await execute(); const wait = await waiting(next.harnessRunId);
  await Promise.allSettled([queue.requestRunCancel({ runId: next.harnessRunId, requestedBy: owner }), service().answer(answer(next, wait, { text: 'racing' }))]);
  const saved = (await queue.findRunForOwner(next.harnessRunId, owner))!;
  assert.ok(saved.cancelRequestedAt); assert.equal(saved.status, 'cancelled');
  await assert.rejects(service().answer(answer(next, wait, { text: 'new answer' })), invalid);
});
test('single-connection service pauses and answers without obtaining a second connection in transaction', async () => {
  const singlePool = new Pool({ connectionString: resolveExecutionTestDatabaseUrl(process.env), max: 1, connectionTimeoutMillis: 500 });
  try {
    const run = await enqueue(); const claimed = (await queue.claimNextQueuedRun({ workerId: randomUUID(), leaseMs: 10000 }))!;
    const waits = createBusinessSkillsWaitService(drizzle(singlePool, { schema }));
    assert.equal((await waits.pause({ runId: run.harnessRunId, attemptId: claimed.attempt.harnessRunAttemptId })).paused, true);
    assert.equal((await waits.answer(answer(run, await waiting(run.harnessRunId), { text: 'single' }))).created, true);
  } finally { await singlePool.end(); }
});
test('accepted large answer completes without counting checkpoint/output aliases twice', async () => {
  const run = await enqueue(); await execute(); const value = { text: 'x'.repeat(600000) };
  await service().answer(answer(run, await waiting(run.harnessRunId), value)); await execute();
  await service().answer(answer(run, await waiting(run.harnessRunId), { approved: false })); await execute();
  assert.equal((await queue.findRunForOwner(run.harnessRunId, owner))!.status, 'completed');
  assert.deepEqual((await queue.getRunSnapshot(run.harnessRunId))!.output!.content, value);
});
test('pause rejects caller supplied state/schema/display metadata before writing', async () => {
  const run = await enqueue(); const claimed = (await queue.claimNextQueuedRun({ workerId: randomUUID(), leaseMs: 10000 }))!;
  await assert.rejects(service().pause({ runId: run.harnessRunId, attemptId: claimed.attempt.harnessRunAttemptId,
    state: {}, outputSchema: {}, displayInput: { private: 'forged' } } as any), invalid);
  assert.equal((await queue.listCheckpointsForRun({ runId: run.harnessRunId })).length, 0);
});
for (const corruption of ['hash', 'policy', 'next', 'unsafe', 'manifest', 'pointer']) test(`saved ${corruption} corruption cannot accept an answer or resume`, async () => {
  const run = await enqueue(); await execute(); const wait = await waiting(run.harnessRunId);
  const cp = (await queue.listCheckpointsForRun({ runId: run.harnessRunId }))[0];
  const state = structuredClone(cp.state) as any;
  if (corruption === 'hash') await database.update(schema.harnessRunCheckpoints).set({ stateHash: hash('bad') }).where(eq(schema.harnessRunCheckpoints.harnessRunCheckpointId, cp.harnessRunCheckpointId));
  if (corruption === 'policy') await database.update(schema.harnessRunCheckpoints).set({ resumePolicy: 'resume_next' }).where(eq(schema.harnessRunCheckpoints.harnessRunCheckpointId, cp.harnessRunCheckpointId));
  if (corruption === 'next' || corruption === 'unsafe') {
    if (corruption === 'next') state.nextStepKey = 'foreign';
    else state.businessSkills.state = JSON.parse('{"constructor":{"private":true}}');
    await database.update(schema.harnessRunCheckpoints).set({ state, stateHash: hash(state) }).where(eq(schema.harnessRunCheckpoints.harnessRunCheckpointId, cp.harnessRunCheckpointId));
  }
  if (corruption === 'manifest') {
    const config = structuredClone(run.executionConfig) as any; config.executionManifest.target.definition.description = 'changed';
    await database.update(schema.harnessRuns).set({ executionConfig: config }).where(eq(schema.harnessRuns.harnessRunId, run.harnessRunId));
  }
  if (corruption === 'pointer') await database.update(schema.harnessRuns).set({ lastCheckpointId: randomUUID() }).where(eq(schema.harnessRuns.harnessRunId, run.harnessRunId));
  await assert.rejects(service().answer(answer(run, wait, { text: 'valid' })), invalid);
  assert.equal((await queue.findRunForOwner(run.harnessRunId, owner))!.status, 'waiting');
  assert.equal((await events(run.harnessRunId)).filter(e => e.eventType === 'workflow.answer_recorded').length, 0);
});
test('failure after actual checkpoint insert rolls back checkpoint/event/attempt changes together', async () => {
  const run = await enqueue(); const claimed = (await queue.claimNextQueuedRun({ workerId: randomUUID(), leaseMs: 10000 }))!;
  let insertedCheckpoint = false;
  const failingDatabase = new Proxy(database, { get(target, key) {
    if (key !== 'transaction') return Reflect.get(target, key);
    return (callback: any) => target.transaction(tx => callback(new Proxy(tx, { get(inner, operation) {
      if (operation !== 'insert') { const member = Reflect.get(inner, operation); return typeof member === 'function' ? member.bind(inner) : member; }
      return (table: any) => {
        const insert = inner.insert(table);
        return new Proxy(insert, { get(builder, method) {
          if (method !== 'values') return Reflect.get(builder, method);
          return (row: any) => {
            if (table === schema.harnessRunCheckpoints) insertedCheckpoint = true;
            if (table === schema.harnessRunEvents && row.eventType.startsWith('workflow.awaiting_')) throw new Error('injected wait event failure');
            return builder.values(row);
          };
        } });
      };
    } })));
  } });
  await assert.rejects(createBusinessSkillsWaitService(failingDatabase).pause({ runId: run.harnessRunId, attemptId: claimed.attempt.harnessRunAttemptId }), invalid);
  assert.equal(insertedCheckpoint, true); assert.equal((await queue.listCheckpointsForRun({ runId: run.harnessRunId })).length, 0);
  const saved = (await queue.findRunForOwner(run.harnessRunId, owner))!; assert.equal(saved.status, 'running'); assert.equal(saved.lastCheckpointId, null);
  assert.equal((await events(run.harnessRunId)).some(e => e.eventType === 'checkpoint_committed' || e.eventType.startsWith('workflow.')), false);
  const [attempt] = await database.select().from(schema.harnessRunAttempts).where(eq(schema.harnessRunAttempts.harnessRunAttemptId, claimed.attempt.harnessRunAttemptId));
  assert.equal(attempt.status, 'claimed');
});
for (const locked of ['run', 'attempt']) test(`lease expiry while blocked on ${locked} lock cannot commit a wait`, async () => {
  const run = await enqueue(); const claimed = (await queue.claimNextQueuedRun({ workerId: randomUUID(), leaseMs: 10000 }))!;
  const attemptId = claimed.attempt.harnessRunAttemptId; const holder = await pool.connect();
  let pending: Promise<{ accepted: boolean; error?: unknown }> | undefined;
  try {
    await holder.query('BEGIN');
    const holderPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    if (locked === 'run') await holder.query('SELECT harness_run_id FROM harness_runs WHERE harness_run_id=$1 FOR UPDATE', [run.harnessRunId]);
    else await holder.query('SELECT harness_run_attempt_id FROM harness_run_attempts WHERE harness_run_attempt_id=$1 FOR UPDATE', [attemptId]);
    pending = service().pause({ runId: run.harnessRunId, attemptId }).then(() => ({ accepted: true }), error => ({ accepted: false, error }));
    let blockedPid: number | undefined;
    for (let poll = 0; poll < 100 && !blockedPid; poll++) {
      blockedPid = (await pool.query('SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) LIMIT 1', [holderPid])).rows[0]?.pid;
      if (!blockedPid) await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(blockedPid, 'pause must actually wait on the held row lock before the lease is expired');
    const connection = locked === 'run' ? pool : holder;
    await connection.query('UPDATE harness_run_attempts SET lease_expires_at=clock_timestamp() WHERE harness_run_attempt_id=$1', [attemptId]);
    const [timing] = (await connection.query(`SELECT lease_expires_at > xact_start AS expired_after_transaction_started,
      lease_expires_at <= clock_timestamp() AS expired_now FROM harness_run_attempts, pg_stat_activity
      WHERE harness_run_attempt_id=$1 AND pid=$2`, [attemptId, blockedPid])).rows;
    assert.equal(timing.expired_after_transaction_started, true); assert.equal(timing.expired_now, true);
    await holder.query('COMMIT');
    const result = await pending; assert.equal(result.accepted, false); assert.ok(invalid(result.error));
    assert.equal((await queue.listCheckpointsForRun({ runId: run.harnessRunId })).length, 0);
    assert.equal((await queue.findRunForOwner(run.harnessRunId, owner))!.status, 'running');
    assert.equal((await events(run.harnessRunId)).some(e => e.eventType.startsWith('workflow.')), false);
  } finally { await holder.query('ROLLBACK'); holder.release(); await pending; }
});
