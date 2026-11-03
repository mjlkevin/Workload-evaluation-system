import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { and, eq, sql } from 'drizzle-orm';
import { db, type Database } from '../../db/client';
import { readDbNow } from '../../db/now';
import { harnessToolEvents } from '../../db/schema';
import type { QueueDbExecutor } from '../harness/harness.module';
import type { AuthUser } from '../../types';
import { resolveCurrentSkillTools } from './skills.context';
import { prepareOperationConfirmation, readOperationApproval } from './skills.operation-decisions';
import { readPreparedOperationInTransaction } from './skills.operations';
import { copyTrialJson } from './skills.sandbox';
import { skillDefinitionHash as hash } from './skills.hash';
import { SkillError } from './skills.types';
import { compileNativeToolOutput } from './skills.validation';

/** Trusted server assembly only. Implementations MUST use only tx for local DB work:
 * no external I/O or global pools. Arbitrary JavaScript cannot be sandboxed by this port. */
export type SkillLocalTransactionAdapter = { readonly kind: 'local-transaction';
  execute(tx: QueueDbExecutor, input: { operationId: string; ownerId: string; sessionId: string; parameters: unknown }): Promise<unknown> };
export type SkillOperationExecutionResult = { operationId: string; executionId: string; rootRunId: string; status: 'succeeded'; result: unknown };
type Options = { database?: Database; inventory?: typeof resolveCurrentSkillTools; adapters?: ReadonlyMap<string, SkillLocalTransactionAdapter> };
type Request = { runId: string; operationId: string; confirmationHash: string };
/** Server-only dispatch controls, never part of the three-field operation command. */
export type SkillOperationExecutionControls = { signal: AbortSignal; timeoutMs: number; deadline: number };
function controlledExecution(database: Database, inventory: typeof resolveCurrentSkillTools, controls?: SkillOperationExecutionControls) {
  if (controls === undefined) return { database, inventory, guard: () => {} };
  if (!controls || Object.keys(controls).sort().join(',') !== 'deadline,signal,timeoutMs' || !(controls.signal instanceof AbortSignal)
    || !Number.isSafeInteger(controls.timeoutMs) || controls.timeoutMs < 1 || controls.timeoutMs > 300000
    || !Number.isFinite(controls.deadline)) return fail('OPERATION_EXECUTION_CONTROLS_INVALID', 400);
  const signal = controls.signal, deadline = Math.min(controls.deadline, performance.now() + controls.timeoutMs);
  const guard = () => {
    if (performance.now() >= deadline) fail('EXECUTION_BUDGET_TIMEOUT');
    if (signal.aborted) fail('EXECUTION_BUDGET_ABORTED');
  };
  const bounded = Object.create(database) as Database;
  bounded.transaction = ((callback: any, settings: any) => {
    guard();
    return database.transaction(async tx => {
      const limits = async () => {
        guard(); const remaining = String(Math.max(1, Math.ceil(deadline - performance.now())));
        // Refresh for EACH statement, not each transaction: prior queries consume the same absolute allowance.
        await tx.execute(sql`SELECT set_config('lock_timeout', ${remaining}, true), set_config('statement_timeout', ${remaining}, true)`);
        guard();
      };
      const run = async (execute: () => PromiseLike<unknown>) => { await limits(); const value = await execute(); guard(); return value; };
      const wrap = (value: any): any => value && typeof value === 'object' ? new Proxy(value, { get(target, key) {
        const item = Reflect.get(target, key, target);
        // Drizzle builders are lazy thenables. Bound the actual SQL, after the complete chain is built.
        if (key === 'then' && typeof item === 'function') return (yes: any, no: any) => run(() => target).then(yes, no);
        if (typeof item !== 'function') return item;
        if (key === 'execute' || key === 'all') return (...args: any[]) => run(() => item.apply(target, args));
        return (...args: any[]) => { guard(); return wrap(item.apply(target, args)); };
      } }) : value;
      const checked = new Proxy(tx, { get(target, key) {
        const method = Reflect.get(target, key, target);
        return typeof method === 'function' ? (...args: any[]) => { guard(); return wrap(method.apply(target, args)); } : method;
      } });
      guard(); const result = await callback(checked);
      // Drizzle issues COMMIT after this callback; leave its SQL timeout at the remaining absolute allowance.
      await limits(); guard(); return result;
    }, settings);
  }) as Database['transaction'];
  return { database: bounded, guard, inventory: (async user => { guard(); const value = await inventory(user); guard(); return value; }) as typeof inventory };
}

type Context = Awaited<ReturnType<Awaited<ReturnType<typeof prepareOperationConfirmation>>['verify']>>;
type Basis = Awaited<ReturnType<typeof prepareOperationConfirmation>>['basis'];
const fail = (code: string, status = 409): never => { throw new SkillError(code, '操作执行暂不可用，请重新检查任务、确认和权限', status); };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
/** Receipt data must survive JSON without changing type or evaluating getters/toJSON. */
function json<T>(value: T): T {
  try {
    const visit = (item: unknown, depth: number) => {
      if (depth > 32) throw new Error();
      if (item && typeof item === 'object') {
        if (Array.isArray(item) ? Object.getPrototypeOf(item) !== Array.prototype : ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new Error();
        if (Reflect.ownKeys(item).some(key => typeof key !== 'string')) throw new Error();
        const descriptors = Object.getOwnPropertyDescriptors(item);
        if (Object.values(descriptors).some(d => d.get || d.set || !d.enumerable && !(Array.isArray(item) && d === descriptors.length))) throw new Error();
        if (Array.isArray(item) && (Object.keys(item).length !== item.length || Object.keys(item).some((key, i) => key !== String(i)))) throw new Error();
        for (const [key, descriptor] of Object.entries(descriptors)) if (key !== 'length' || !Array.isArray(item)) visit(descriptor.value, depth + 1);
      }
    };
    visit(value, 0);
    return copyTrialJson(value, 'definition') as T;
  } catch { return fail('OPERATION_EXECUTION_INVALID'); }
}
function command(body: unknown): Request {
  try {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'confirmationHash,operationId,runId') fail('OPERATION_INVALID_REQUEST', 400);
    const value = json(body) as Request;
    if (![value.runId, value.operationId, value.confirmationHash].every(v => typeof v === 'string')) fail('OPERATION_INVALID_REQUEST', 400);
    const request = { runId: value.runId.toLowerCase(), operationId: value.operationId.toLowerCase(), confirmationHash: value.confirmationHash.toLowerCase() };
    if (!uuid(request.runId) || !uuid(request.operationId) || !digest(request.confirmationHash)) fail('OPERATION_INVALID_REQUEST', 400);
    return request;
  } catch { return fail('OPERATION_INVALID_REQUEST', 400); }
}
function localTool(value: Context) {
  const tool = value.pending.snapshot.native;
  if ((tool.source ?? 'code') !== 'code' || tool.mutates !== true || tool.exfiltrates === true || tool.simulationOnly === true) fail('OPERATION_EXECUTION_TOOL_DENIED', 403);
}
function nativeOutput(value: Context, result: unknown) {
  const validate = compileNativeToolOutput(value.pending.snapshot.native);
  if (validate && !validate(result)) fail('OPERATION_NATIVE_OUTPUT_SCHEMA_FAILED');
}
function fixedInput(value: Context) {
  const p = value.pending;
  return { schemaVersion: 1, operationId: p.operationId, rootRunId: p.rootRunId, operationKey: p.operationKey,
    payloadHash: p.payloadHash, manifestHash: value.admission.manifest.manifestHash, ownerId: value.admission.identity.id,
    sessionId: p.sessionId, toolName: p.request.toolName };
}
/** Historical identity is evidence only. Current admission and approval have already run. */
async function originalApproval(tx: QueueDbExecutor, value: Context, currentBasis: Basis, input: Record<string, unknown>) {
  const { sourceRunId, decisionId, confirmationHash } = input;
  if (!uuid(sourceRunId) || !uuid(decisionId) || !digest(confirmationHash)) return fail('OPERATION_EXECUTION_INVALID');
  const pending = await readPreparedOperationInTransaction(tx, sourceRunId, value.pending.operationId, value.admission.identity.id, value.admission.manifest);
  const [row] = await tx.select().from(harnessToolEvents).where(eq(harnessToolEvents.harnessToolEventId, decisionId)).for('share');
  if (!row) fail('OPERATION_EXECUTION_INVALID');
  const stored = json(row.input) as { basis: Basis };
  const basis = stored?.basis, identity = basis?.identity, revisions = basis?.configRevisions;
  if (!basis || !identity || Object.keys(identity).sort().join(',') !== 'businessRole,id,role,status'
    || identity.id !== value.admission.identity.id || identity.status !== 'active' || !['admin', 'user', 'sub_admin'].includes(identity.role)
    || !(identity.businessRole === null || typeof identity.businessRole === 'string') || !digest(basis.currentToolsHash)
    || !Array.isArray(revisions) || revisions.length !== 2 || revisions.some((r: any, i: number) => r.configKey !== ['mcpConfig', 'toolPolicy'][i]
      || !(isDeepStrictEqual(r, { configKey: r.configKey, missing: true }) || Object.keys(r).sort().join(',') === 'configKey,effectiveAt,updatedAt,version'
        && Number.isSafeInteger(r.version) && r.version >= 0 && [r.updatedAt, r.effectiveAt].every(s => typeof s === 'string' && /^-?\d+(\.\d+)?$/.test(s))))) fail('OPERATION_EXECUTION_INVALID');
  const expected = { ...currentBasis, runId: sourceRunId, executionAuthority: pending.executionAuthority,
    identity, currentToolsHash: basis.currentToolsHash, configRevisions: revisions };
  if (!isDeepStrictEqual(basis, expected) || hash(basis) !== confirmationHash) fail('OPERATION_EXECUTION_INVALID');
  const source = { ...value, pending, admission: { ...value.admission, runId: sourceRunId, identity }, stamps: revisions };
  const approved = await readOperationApproval(tx, source, basis, confirmationHash);
  if (approved.harnessToolEventId !== decisionId) fail('OPERATION_EXECUTION_INVALID');
}
async function receiptResult(tx: QueueDbExecutor, row: typeof harnessToolEvents.$inferSelect, value: Context, basis: Basis, effectKey: string): Promise<SkillOperationExecutionResult> {
  const input = json(row.input) as Record<string, unknown>, output = json(row.output) as { schemaVersion: number; result: unknown };
  if (!input || !output || row.eventType !== 'business_operation_executed' || row.status !== 'succeeded'
    || row.harnessRunId !== value.pending.rootRunId || row.toolName !== value.pending.request.toolName
    || row.effectKey !== effectKey || row.actionId !== effectKey || row.errorMessage !== null || row.riskLevel !== null
    || !(row.createdAt instanceof Date) || !Number.isFinite(row.createdAt.getTime())
    || !(row.resolvedAt instanceof Date) || !Number.isFinite(row.resolvedAt.getTime())
    || !isDeepStrictEqual(input, { ...fixedInput(value), sourceRunId: input.sourceRunId, decisionId: input.decisionId, confirmationHash: input.confirmationHash })
    || !isDeepStrictEqual(output, { schemaVersion: 1, result: output.result })) fail('OPERATION_EXECUTION_INVALID');
  const [time] = await tx.select({ valid: sql<boolean>`isfinite(${harnessToolEvents.createdAt}) AND isfinite(${harnessToolEvents.resolvedAt}) AND ${harnessToolEvents.resolvedAt} >= ${harnessToolEvents.createdAt}` })
    .from(harnessToolEvents).where(eq(harnessToolEvents.harnessToolEventId, row.harnessToolEventId));
  if (!time?.valid) fail('OPERATION_EXECUTION_INVALID');
  await originalApproval(tx, value, basis, input);
  nativeOutput(value, output.result);
  return json({ operationId: value.pending.operationId, executionId: row.harnessToolEventId, rootRunId: value.pending.rootRunId, status: 'succeeded' as const, result: output.result });
}
/** Explicit internal local transaction consumer. No default registry dispatch or general ToolGate grant. */
export function createSkillOperationExecutionService(options: Options = {}) {
  const database = options.database ?? db, inventory = options.inventory ?? resolveCurrentSkillTools;
  // Snapshot both mapping and callable: caller mutation cannot replace an in-flight adapter.
  const adapters = new Map([...(options.adapters ?? [])].map(([name, adapter]) => [name,
    { kind: adapter.kind, execute: adapter.execute }] as const));
  return { async executeOperation(initialUser: AuthUser, body: unknown, controls?: SkillOperationExecutionControls): Promise<SkillOperationExecutionResult> {
    try {
      const request = command(body), user = structuredClone(initialUser);
      const controlled = controlledExecution(database, inventory, controls); controlled.guard();
      const prepared = await prepareOperationConfirmation(controlled.database, controlled.inventory, request, user);
      controlled.guard();
      return await controlled.database.transaction(async tx => {
        const current = await prepared.verify(tx);
        if (request.confirmationHash !== prepared.confirmationHash) fail('OPERATION_CONFIRMATION_CHANGED');
        localTool(current);
        const adapter = adapters.get(current.pending.request.toolName);
        if (!adapter || adapter.kind !== 'local-transaction' || typeof adapter.execute !== 'function') return fail('OPERATION_EXECUTION_TOOL_DENIED', 403);
        const approval = await readOperationApproval(tx, current, prepared.basis, prepared.confirmationHash);
        const effectKey = `business-op-execution:v1:${hash({ operationId: request.operationId })}`;
        const [inserted] = await tx.insert(harnessToolEvents).values({ harnessToolEventId: randomUUID(), harnessRunId: current.pending.rootRunId,
          effectKey, actionId: effectKey, toolName: current.pending.request.toolName, eventType: 'business_operation_executed', status: 'executing',
          createdAt: await readDbNow(tx), input: json({ ...fixedInput(current), sourceRunId: request.runId,
            decisionId: approval.harnessToolEventId, confirmationHash: prepared.confirmationHash }) })
          .onConflictDoNothing({ target: [harnessToolEvents.harnessRunId, harnessToolEvents.effectKey] }).returning();
        let row = inserted;
        if (inserted) {
          controlled.guard();
          const result = json(await adapter.execute(tx, { operationId: request.operationId, ownerId: user.id,
            sessionId: current.pending.sessionId, parameters: json(current.pending.request.parameters) }));
          // Throw inside the adapter's transaction so invalid output rolls back its business writes too.
          nativeOutput(current, result);
          controlled.guard();
          [row] = await tx.update(harnessToolEvents).set({ status: 'succeeded', output: json({ schemaVersion: 1, result }), resolvedAt: await readDbNow(tx) })
            .where(and(eq(harnessToolEvents.harnessToolEventId, inserted.harnessToolEventId), eq(harnessToolEvents.status, 'executing'))).returning();
        } else [row] = await tx.select().from(harnessToolEvents).where(and(eq(harnessToolEvents.harnessRunId, current.pending.rootRunId), eq(harnessToolEvents.effectKey, effectKey))).for('share');
        if (!row) fail('OPERATION_EXECUTION_INVALID');
        const result = await receiptResult(tx, row, current, prepared.basis, effectKey); controlled.guard(); return result;
      });
    } catch (error) {
      if (error instanceof SkillError) throw error;
      return fail('OPERATION_EXECUTION_UNAVAILABLE', 503);
    }
  } };
}
