import { randomUUID } from 'node:crypto';
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

/** Trusted server assembly only. Implementations MUST use only tx for local DB work:
 * no external I/O or global pools. Arbitrary JavaScript cannot be sandboxed by this port. */
export type SkillLocalTransactionAdapter = { readonly kind: 'local-transaction';
  execute(tx: QueueDbExecutor, input: { operationId: string; ownerId: string; sessionId: string; parameters: unknown }): Promise<unknown> };
export type SkillOperationExecutionResult = { operationId: string; executionId: string; rootRunId: string; status: 'succeeded'; result: unknown };
type Options = { database?: Database; inventory?: typeof resolveCurrentSkillTools; adapters?: ReadonlyMap<string, SkillLocalTransactionAdapter> };
type Request = { runId: string; operationId: string; confirmationHash: string };
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
  return json({ operationId: value.pending.operationId, executionId: row.harnessToolEventId, rootRunId: value.pending.rootRunId, status: 'succeeded' as const, result: output.result });
}
/** Explicit internal local transaction consumer. No default registry dispatch or general ToolGate grant. */
export function createSkillOperationExecutionService(options: Options = {}) {
  const database = options.database ?? db, inventory = options.inventory ?? resolveCurrentSkillTools;
  // Snapshot both mapping and callable: caller mutation cannot replace an in-flight adapter.
  const adapters = new Map([...(options.adapters ?? [])].map(([name, adapter]) => [name,
    { kind: adapter.kind, execute: adapter.execute }] as const));
  return { async executeOperation(initialUser: AuthUser, body: unknown): Promise<SkillOperationExecutionResult> {
    try {
      const request = command(body), user = structuredClone(initialUser);
      const prepared = await prepareOperationConfirmation(database, inventory, request, user);
      return await database.transaction(async tx => {
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
          const result = json(await adapter.execute(tx, { operationId: request.operationId, ownerId: user.id,
            sessionId: current.pending.sessionId, parameters: json(current.pending.request.parameters) }));
          [row] = await tx.update(harnessToolEvents).set({ status: 'succeeded', output: json({ schemaVersion: 1, result }), resolvedAt: await readDbNow(tx) })
            .where(and(eq(harnessToolEvents.harnessToolEventId, inserted.harnessToolEventId), eq(harnessToolEvents.status, 'executing'))).returning();
        } else [row] = await tx.select().from(harnessToolEvents).where(and(eq(harnessToolEvents.harnessRunId, current.pending.rootRunId), eq(harnessToolEvents.effectKey, effectKey))).for('share');
        if (!row) fail('OPERATION_EXECUTION_INVALID');
        return await receiptResult(tx, row, current, prepared.basis, effectKey);
      });
    } catch (error) {
      if (error instanceof SkillError) throw error;
      return fail('OPERATION_EXECUTION_UNAVAILABLE', 503);
    }
  } };
}
