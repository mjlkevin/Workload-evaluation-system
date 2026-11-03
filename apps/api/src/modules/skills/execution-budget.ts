import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { and, eq, or, sql } from 'drizzle-orm';
import { db, type Database } from '../../db/client';
import { aiSessions, harnessRuns, harnessToolEvents } from '../../db/schema';
import { readBusinessSkillsRun, type QueueDbExecutor } from '../harness/harness.module';
import { assertRunAdmissionInTransaction } from './execution-emergency';
import { resolveBusinessExecutionRootInTransaction as lineage } from './skills.operations';
import { skillDefinitionHash as hash } from './skills.hash';
import { copyTrialJson } from './skills.sandbox';
import { SkillError } from './skills.types';
import type { ExecutionManifest } from './execution-manifest.types';
export type ExecutionBudgetRequest = { runId: string; ownerUserId: string; kind: 'model' | 'tool'; maxOutputTokens?: number; timeoutMs: number; signal?: AbortSignal };
export type ExecutionBudgetCallbackContext = { signal: AbortSignal; maxOutputTokens: number; timeoutMs: number };
type Counts = { modelAttempts: number; toolCalls: number; outputTokens: number; activeMs: number };
export type ExecutionBudgetSnapshot = Counts & { rootRunId: string; remaining: Counts };
type Binding = { schemaVersion: 1; ownerUserId: string; rootRunId: string; manifestHash: string; manifestDigest: string; sessionId: string; fingerprint: string };
type Reservation = Binding & { sourceRunId: string; kind: 'model' | 'tool'; reservedTokens: number; reservedMs: number; startedAt: string; payloadHash: string };
type Settlement = { schemaVersion: 1; chargedTokens: number; chargedMs: number; outcome: 'succeeded' | 'failed'; code: string | null };
type Event = typeof harnessToolEvents.$inferSelect;
type Chain = Awaited<ReturnType<typeof lineage>>;
const LIMITS: Readonly<Counts> = Object.freeze({ modelAttempts: 60, toolCalls: 60, outputTokens: 128000, activeMs: 300000 });
const KEY = 'business-budget:v1', TOOL = '$business-budget';
const fail = (code: string, status = 409): never => { throw new SkillError(code, '执行预算暂不可用，请检查任务状态或重新发起', status); };
const invalid = (): never => fail('EXECUTION_BUDGET_LEDGER_INVALID');
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const integer = (n: unknown, max: number, min = 0): n is number => Number.isSafeInteger(n) && (n as number) >= min && (n as number) <= max;
function json<T>(value: unknown): T {
 try { const copied = copyTrialJson(value, 'definition'); if (!isDeepStrictEqual(value, copied)) invalid(); return copied as T; } catch { return invalid(); }
}
const exact = (value: unknown, keys: string): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.split(',').sort().join(',');
function counts(value: unknown): Counts {
 const result = json<Counts>(value);
 if (!exact(result, 'modelAttempts,toolCalls,outputTokens,activeMs') || Object.entries(LIMITS).some(([key, max]) => !integer(result[key as keyof Counts], max))) invalid();
 return result;
}
function binding(ownerUserId: string, chain: Chain, manifest: ExecutionManifest): Binding {
 return { schemaVersion: 1, ownerUserId, rootRunId: chain.root, manifestHash: manifest.manifestHash, manifestDigest: hash(manifest), sessionId: chain.sessionId, fingerprint: chain.fingerprint };
}
function request(value: ExecutionBudgetRequest): ExecutionBudgetRequest {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['runId', 'ownerUserId', 'kind', 'maxOutputTokens', 'timeoutMs', 'signal'].includes(k))
  || !uuid(value.runId) || !uuid(value.ownerUserId) || !['model', 'tool'].includes(value.kind) || !integer(value.timeoutMs, LIMITS.activeMs, 1)
  || value.maxOutputTokens !== undefined && !integer(value.maxOutputTokens, LIMITS.outputTokens, value.kind === 'model' ? 1 : 0)
  || value.kind === 'tool' && value.maxOutputTokens !== undefined && value.maxOutputTokens !== 0
  || value.signal !== undefined && !(value.signal instanceof AbortSignal)) fail('EXECUTION_BUDGET_INVALID_REQUEST', 400);
 return { runId: value.runId.toLowerCase(), ownerUserId: value.ownerUserId.toLowerCase(), kind: value.kind,
  maxOutputTokens: value.maxOutputTokens ?? (value.kind === 'model' ? LIMITS.outputTokens : 0), timeoutMs: value.timeoutMs, signal: value.signal };
}
async function now(tx: QueueDbExecutor): Promise<Date> {
 const result = await tx.execute(sql`SELECT clock_timestamp() AS budget_now`);
 const date = new Date((result.rows as Array<{ budget_now: string | Date }>)[0]?.budget_now);
 if (!Number.isFinite(date.getTime())) invalid(); return date;
}
const whereEvent = (root: string, key: string) => and(eq(harnessToolEvents.harnessRunId, root), eq(harnessToolEvents.effectKey, key));
async function lockLedger(tx: QueueDbExecutor, expected: Binding) {
 await tx.insert(harnessToolEvents).values({ harnessToolEventId: randomUUID(), harnessRunId: expected.rootRunId, effectKey: KEY, actionId: KEY,
  toolName: TOOL, eventType: 'business_budget_ledger', status: 'open', input: expected, output: { modelAttempts: 0, toolCalls: 0, outputTokens: 0, activeMs: 0 }, createdAt: await now(tx) })
  .onConflictDoNothing({ target: [harnessToolEvents.harnessRunId, harnessToolEvents.effectKey] });
 const [row] = await tx.select().from(harnessToolEvents).where(whereEvent(expected.rootRunId, KEY)).for('update');
 return checkedLedger(row, expected);
}
function checkedLedger(row: Event | undefined, expected: Binding) {
 if (!row || row.actionId !== KEY || row.toolName !== TOOL || row.eventType !== 'business_budget_ledger' || row.status !== 'open'
  || row.harnessRunId !== expected.rootRunId || row.errorMessage !== null || row.resolvedAt !== null || row.riskLevel !== null || !isDeepStrictEqual(json(row.input), expected)) invalid();
 return { row: row!, totals: counts(row!.output) };
}
function reservation(row: Event, expected: Binding): { input: Reservation; settlement: Settlement | null } {
 const input = json<Reservation>(row.input);
 if (!exact(input, 'schemaVersion,ownerUserId,rootRunId,manifestHash,manifestDigest,sessionId,fingerprint,sourceRunId,kind,reservedTokens,reservedMs,startedAt,payloadHash')) invalid();
 const { sourceRunId, kind, reservedTokens, reservedMs, startedAt, payloadHash, ...bound } = input;
 if (!isDeepStrictEqual(bound, expected) || !uuid(sourceRunId) || sourceRunId !== sourceRunId.toLowerCase() || !['model', 'tool'].includes(kind)
  || !integer(reservedTokens, LIMITS.outputTokens, kind === 'model' ? 1 : 0) || kind === 'tool' && reservedTokens !== 0
  || !integer(reservedMs, LIMITS.activeMs, 1) || typeof startedAt !== 'string' || !Number.isFinite(Date.parse(startedAt))
  || new Date(startedAt).toISOString() !== startedAt || row.createdAt.toISOString() !== startedAt
  || payloadHash !== hash({ ...bound, sourceRunId, kind, reservedTokens, reservedMs, startedAt })
  || row.actionId !== row.effectKey || row.effectKey !== `${KEY}:${row.harnessToolEventId}` || row.toolName !== TOOL
  || row.eventType !== 'business_budget_reservation' || row.harnessRunId !== expected.rootRunId || row.riskLevel !== null) invalid();
 if (row.status === 'reserved') {
  if (row.output !== null || row.resolvedAt !== null || row.errorMessage !== null) invalid();
  return { input, settlement: null };
 }
 const settled = json<Settlement>(row.output);
 if (!exact(settled, 'schemaVersion,chargedTokens,chargedMs,outcome,code') || settled.schemaVersion !== 1
  || !integer(settled.chargedTokens, reservedTokens) || !integer(settled.chargedMs, reservedMs)
  || !['succeeded', 'failed'].includes(settled.outcome) || row.status !== settled.outcome || !row.resolvedAt
  || row.resolvedAt.getTime() < row.createdAt.getTime() || row.errorMessage !== settled.code
  || settled.outcome === 'succeeded' && settled.code !== null
  || settled.outcome === 'failed' && (typeof settled.code !== 'string' || !/^EXECUTION_BUDGET_[A-Z_]+$/.test(settled.code)
    || settled.chargedTokens !== reservedTokens || settled.chargedMs !== reservedMs)) invalid();
 return { input, settlement: settled };
}
/** Recompute from durable reservations so corrupt or legacy totals can never become a fresh allowance. */
async function validateLedger(tx: QueueDbExecutor, expected: Binding, totals: Counts, manifest: ExecutionManifest, chain: Chain) {
 const entries = await tx.select().from(harnessToolEvents).where(and(eq(harnessToolEvents.harnessRunId, expected.rootRunId), eq(harnessToolEvents.eventType, 'business_budget_reservation'))).limit(121).for('share');
 if (entries.length > 120) invalid();
 const aggregate: Counts = { modelAttempts: 0, toolCalls: 0, outputTokens: 0, activeMs: 0 }, verified = new Set([chain.first.harnessRunId]);
 for (const row of entries) {
  const { input, settlement } = reservation(row, expected);
  if (!verified.has(input.sourceRunId)) {
   try { const source = await lineage(tx, input.sourceRunId, expected.ownerUserId, manifest);
    if (source.root !== chain.root || source.fingerprint !== chain.fingerprint || source.sessionId !== chain.sessionId) invalid();
   } catch { invalid(); }
   verified.add(input.sourceRunId);
  }
  aggregate[input.kind === 'model' ? 'modelAttempts' : 'toolCalls']++;
  aggregate.outputTokens += settlement?.chargedTokens ?? input.reservedTokens;
  aggregate.activeMs += settlement?.chargedMs ?? input.reservedMs;
 }
 counts(aggregate); if (!isDeepStrictEqual(aggregate, totals)) invalid();
 return entries;
}
function snapshot(rootRunId: string, totals: Counts): ExecutionBudgetSnapshot {
 return { rootRunId, ...totals, remaining: { modelAttempts: LIMITS.modelAttempts - totals.modelAttempts, toolCalls: LIMITS.toolCalls - totals.toolCalls,
  outputTokens: LIMITS.outputTokens - totals.outputTokens, activeMs: LIMITS.activeMs - totals.activeMs } };
}
async function saveTotals(tx: QueueDbExecutor, root: string, totals: Counts) {
 counts(totals); await tx.update(harnessToolEvents).set({ output: totals }).where(whereEvent(root, KEY));
}
function safe(error: unknown): never { if (error instanceof SkillError) throw error; return fail('EXECUTION_BUDGET_UNAVAILABLE', 503); }
/** Trusted server assembly only. Budget admission is never a model/tool execution grant. */
export function createExecutionBudgetService(options: { database?: Database } = {}) {
 const database = options.database ?? db;
 async function reserve(input: ExecutionBudgetRequest) {
  return database.transaction(async tx => {
   const { manifest } = await assertRunAdmissionInTransaction(tx, input.runId, input.ownerUserId);
   const chain = await lineage(tx, input.runId, input.ownerUserId, manifest), expected = binding(input.ownerUserId, chain, manifest);
   const ledger = await lockLedger(tx, expected); await validateLedger(tx, expected, ledger.totals, manifest, chain);
   if (input.signal?.aborted) fail('EXECUTION_BUDGET_ABORTED');
   const remaining = snapshot(chain.root, ledger.totals).remaining, counter = input.kind === 'model' ? 'modelAttempts' : 'toolCalls';
   const reservedTokens = Math.min(input.maxOutputTokens!, remaining.outputTokens), reservedMs = Math.min(input.timeoutMs, remaining.activeMs);
   if (remaining[counter] < 1 || reservedMs < 1 || input.kind === 'model' && reservedTokens < 1) fail('EXECUTION_BUDGET_EXHAUSTED');
   const id = randomUUID(), started = await now(tx);
   const content = { ...expected, sourceRunId: input.runId, kind: input.kind, reservedTokens, reservedMs, startedAt: started.toISOString() };
   const stored: Reservation = { ...content, payloadHash: hash(content) }, key = `${KEY}:${id}`;
   await saveTotals(tx, chain.root, { ...ledger.totals, [counter]: ledger.totals[counter] + 1,
    outputTokens: ledger.totals.outputTokens + reservedTokens, activeMs: ledger.totals.activeMs + reservedMs });
   await tx.insert(harnessToolEvents).values({ harnessToolEventId: id, harnessRunId: chain.root, effectKey: key, actionId: key,
    toolName: TOOL, eventType: 'business_budget_reservation', status: 'reserved', input: stored, createdAt: started });
   return { id, stored, manifest };
  });
 }
 async function settle(saved: Awaited<ReturnType<typeof reserve>>, success: boolean, tokens: number, code: string | null) {
  return database.transaction(async tx => {
   const { stored, manifest } = saved, chain = await lineage(tx, stored.sourceRunId, stored.ownerUserId, manifest), expected = binding(stored.ownerUserId, chain, manifest);
   const ledger = await lockLedger(tx, expected), entries = await validateLedger(tx, expected, ledger.totals, manifest, chain);
   const row = entries.find(r => r.harnessToolEventId === saved.id); if (!row) return invalid();
   const current = reservation(row, expected); if (!isDeepStrictEqual(current.input, stored)) invalid();
   if (current.settlement) {
    if (current.settlement.outcome !== (success ? 'succeeded' : 'failed') || current.settlement.code !== code || current.settlement.chargedTokens !== tokens) invalid();
    return;
   }
   const finished = await now(tx), chargedMs = success ? Math.min(stored.reservedMs, Math.max(0, Math.ceil(finished.getTime() - Date.parse(stored.startedAt)))) : stored.reservedMs;
   const result: Settlement = { schemaVersion: 1, chargedTokens: tokens, chargedMs, outcome: success ? 'succeeded' : 'failed', code };
   await tx.update(harnessToolEvents).set({ status: result.outcome, output: result, errorMessage: code, resolvedAt: finished }).where(eq(harnessToolEvents.harnessToolEventId, saved.id));
   await saveTotals(tx, stored.rootRunId, { ...ledger.totals, outputTokens: ledger.totals.outputTokens - stored.reservedTokens + tokens,
    activeMs: ledger.totals.activeMs - stored.reservedMs + chargedMs });
  });
 }
 return {
  async readBudget(ownerUserId: string, runId: string): Promise<ExecutionBudgetSnapshot> {
   try {
    if (!uuid(ownerUserId) || !uuid(runId)) fail('EXECUTION_BUDGET_INVALID_REQUEST', 400);
    return await database.transaction(async tx => {
     // Audit-only projection: terminal state or emergency stop cannot erase consumed budget.
     // This path never creates a ledger, reserves capacity, or relaxes dispatch admission.
     const [run] = await tx.select().from(harnessRuns).where(and(eq(harnessRuns.harnessRunId, runId), eq(harnessRuns.ownerUserId, ownerUserId))).for('share');
     if (!run) fail('EXECUTION_RUN_NOT_FOUND', 404);
     const manifest = readBusinessSkillsRun(run!), chain = await lineage(tx, runId, ownerUserId, manifest);
     const [session] = await tx.select({ owner: aiSessions.ownerUserId }).from(aiSessions).where(eq(aiSessions.sessionId, chain.sessionId)).for('share');
     if (!session || session.owner !== ownerUserId) fail('EXECUTION_RUN_NOT_FOUND', 404);
     const expected = binding(ownerUserId, chain, manifest);
     const [row] = await tx.select().from(harnessToolEvents).where(whereEvent(chain.root, KEY)).for('share');
     if (!row) {
      const orphan = await tx.select({ id: harnessToolEvents.harnessToolEventId }).from(harnessToolEvents).where(and(eq(harnessToolEvents.harnessRunId, chain.root),
       or(eq(harnessToolEvents.eventType, 'business_budget_reservation'), eq(harnessToolEvents.eventType, 'business_budget_ledger')))).limit(1).for('share');
      if (orphan.length) invalid();
      return snapshot(chain.root, { modelAttempts: 0, toolCalls: 0, outputTokens: 0, activeMs: 0 });
     }
     const ledger = checkedLedger(row, expected); await validateLedger(tx, expected, ledger.totals, manifest, chain);
     return snapshot(chain.root, ledger.totals);
    });
   } catch (error) { return safe(error); }
  },
  async runWithBudget<T>(initial: ExecutionBudgetRequest, callback: (context: ExecutionBudgetCallbackContext) => Promise<{ value: T; outputTokens?: number }>): Promise<T> {
   try {
    const input = request(initial); if (input.signal?.aborted) fail('EXECUTION_BUDGET_ABORTED');
    if (typeof callback !== 'function') fail('EXECUTION_BUDGET_INVALID_REQUEST', 400);
    const saved = await reserve(input), controller = new AbortController(), deadline = performance.now() + saved.stored.reservedMs;
    let timedOut = false, timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => controller.abort(), onAbort = () => fail(timedOut ? 'EXECUTION_BUDGET_TIMEOUT' : 'EXECUTION_BUDGET_ABORTED');
    // A synchronous callback can starve timers; elapsed monotonic time remains authoritative.
    const checkDeadline = () => {
     if (!controller.signal.aborted && performance.now() >= deadline) { timedOut = true; controller.abort(); }
     if (controller.signal.aborted) onAbort();
    };
    let abortListener: (() => void) | undefined, result: { value: T; outputTokens?: number } | undefined, failure: string | null = null;
    input.signal?.addEventListener('abort', abort, { once: true }); if (input.signal?.aborted) abort();
    try {
     timer = setTimeout(() => { timedOut = true; controller.abort(); }, saved.stored.reservedMs);
     const interrupted = new Promise<never>((_, reject) => {
      abortListener = () => { try { onAbort(); } catch (error) { reject(error); } };
      controller.signal.addEventListener('abort', abortListener, { once: true }); if (controller.signal.aborted) abortListener();
     });
     result = await Promise.race([Promise.resolve().then(() => {
      checkDeadline();
      return callback({ signal: controller.signal, maxOutputTokens: saved.stored.reservedTokens, timeoutMs: saved.stored.reservedMs });
     }), interrupted]);
     checkDeadline();
     if (!(exact(result, 'value') || exact(result, 'value,outputTokens'))
      || result.outputTokens !== undefined && !integer(result.outputTokens, saved.stored.reservedTokens)) fail('EXECUTION_BUDGET_USAGE_INVALID');
     const detached = copyTrialJson(result.value); if (!isDeepStrictEqual(detached, result.value)) fail('EXECUTION_BUDGET_USAGE_INVALID');
     result = { value: detached as T, ...(result.outputTokens !== undefined ? { outputTokens: result.outputTokens } : {}) };
     checkDeadline();
    } catch (error) {
     if (!controller.signal.aborted && performance.now() >= deadline) { timedOut = true; controller.abort(); }
     failure = timedOut ? 'EXECUTION_BUDGET_TIMEOUT' : controller.signal.aborted ? 'EXECUTION_BUDGET_ABORTED' : error instanceof SkillError && ['EXECUTION_BUDGET_ABORTED', 'EXECUTION_BUDGET_TIMEOUT', 'EXECUTION_BUDGET_USAGE_INVALID'].includes(error.code)
      ? error.code : 'EXECUTION_BUDGET_CALLBACK_FAILED';
    } finally {
     if (timer) clearTimeout(timer); input.signal?.removeEventListener('abort', abort);
     if (abortListener) controller.signal.removeEventListener('abort', abortListener);
    }
    await settle(saved, failure === null, failure ? saved.stored.reservedTokens : result!.outputTokens ?? saved.stored.reservedTokens, failure);
    if (failure) fail(failure); return result!.value;
   } catch (error) { return safe(error); }
  },
 };
}
