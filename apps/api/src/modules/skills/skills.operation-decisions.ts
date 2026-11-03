import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, type Database } from '../../db/client';
import { harnessToolEvents, systemConfigs } from '../../db/schema';
import type { AuthUser } from '../../types';
import { resolveToolPolicyEntry } from '../../agent/tool-policy';
import { readDbNow } from '../../db/now';
import type { QueueDbExecutor } from '../harness/harness.module';
import { assertRunAdmissionInTransaction } from './execution-emergency';
import { validateFrozenExecutionTools } from './execution-authority';
import { prepareSkillAuthority } from './skills.authority';
import { resolveCurrentSkillTools, skillToolContract } from './skills.context';
import { assertOperationNeedsConfirmation, readPreparedOperationInTransaction } from './skills.operations';
import { copyTrialJson } from './skills.sandbox';
import { skillDefinitionHash as hash } from './skills.hash';
import { SkillError } from './skills.types';

type Options = { database?: Database; inventory?: typeof resolveCurrentSkillTools };
type Request = { runId: string; operationId: string; confirmationHash?: string; decision?: 'approve' | 'reject' };
export type ConfirmationView = { runId: string; operationId: string; rootRunId: string; payloadHash: string; confirmationHash: string;
  toolName: string; parameters: unknown; status: 'pending' | 'approved' | 'rejected'; decisionId?: string; decision?: 'approve' | 'reject' };
const fail = (code: string, status = 409): never => { throw new SkillError(code, '操作确认暂不可用，请重新读取任务内容和权限', status); };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function json<T>(value: T): T {
  try { return copyTrialJson(value, 'definition') as T; } catch { return fail('OPERATION_DECISION_INVALID'); }
}
function command(body: unknown, decide: boolean): Request {
  try {
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).sort().join(',') !== (decide ? 'confirmationHash,decision,operationId,runId' : 'operationId,runId')) fail('OPERATION_INVALID_REQUEST', 400);
    const value = copyTrialJson(body, 'definition') as Request;
    if (!uuid(value.runId) || !uuid(value.operationId) || decide && (typeof value.confirmationHash !== 'string'
      || !/^[a-f0-9]{64}$/i.test(value.confirmationHash) || !['approve', 'reject'].includes(value.decision!))) fail('OPERATION_INVALID_REQUEST', 400);
    return { ...value, runId: value.runId.toLowerCase(), operationId: value.operationId.toLowerCase(),
      ...(decide ? { confirmationHash: value.confirmationHash!.toLowerCase() } : {}) };
  } catch { return fail('OPERATION_INVALID_REQUEST', 400); }
}
/** Revision metadata only; PG epoch text preserves microseconds and is independent of connection timezone. */
async function stamps(tx: QueueDbExecutor) {
  const rows = await tx.select({ configKey: systemConfigs.configKey, version: systemConfigs.version,
    updatedAt: sql<string>`EXTRACT(EPOCH FROM ${systemConfigs.updatedAt})::text`,
    effectiveAt: sql<string>`EXTRACT(EPOCH FROM ${systemConfigs.effectiveAt})::text` }).from(systemConfigs)
    .where(inArray(systemConfigs.configKey, ['toolPolicy', 'mcpConfig'])).orderBy(asc(systemConfigs.configKey));
  return ['mcpConfig', 'toolPolicy'].map(configKey => rows.find(row => row.configKey === configKey) ?? { configKey, missing: true });
}
async function context(tx: QueueDbExecutor, request: Request, user: AuthUser, includeStamps = true) {
  const admission = await assertRunAdmissionInTransaction(tx, request.runId, user.id);
  if (user.status !== 'active' || user.role !== admission.identity.role) fail('EXECUTION_AUTHORITY_CHANGED', 403);
  const pending = await readPreparedOperationInTransaction(tx, request.runId, request.operationId, user.id, admission.manifest);
  return { admission, pending, stamps: includeStamps ? await stamps(tx) : [] };
}
type Context = Awaited<ReturnType<typeof context>>;
function basisFor(value: Context, currentToolsHash: string) {
  const { admission, pending } = value;
  return json({ schemaVersion: 1, runId: admission.runId, ownerId: admission.identity.id, sessionId: pending.sessionId,
    operationId: pending.operationId, rootRunId: pending.rootRunId, operationKey: pending.operationKey,
    manifestHash: admission.manifest.manifestHash, payloadHash: pending.payloadHash,
    executionAuthority: pending.executionAuthority, identity: admission.identity, currentToolsHash, configRevisions: value.stamps });
}
function currentTools(value: Context, now: Awaited<ReturnType<typeof resolveCurrentSkillTools>>) {
  validateFrozenExecutionTools(value.admission.manifest, value.admission.identity, now);
  assertOperationNeedsConfirmation(value.pending, now, value.pending.request.toolName);
  // Explicit projection excludes callbacks, MCP connection details and credential material.
  return hash(json(value.pending.skill.context.tools.map(snapshot => {
    const tool = now.registry.get(snapshot.native.name)!;
    return { contract: skillToolContract(tool), capability: tool.capability, source: tool.source ?? 'code', sandboxReadSafe: tool.sandboxReadSafe === true,
      mcpAllowedRoles: tool.source === 'mcp' ? [...(tool.mcpAllowedRoles ?? [])].sort() : [], policy: resolveToolPolicyEntry(now.policy, tool.name) };
  }).sort((a, b) => a.contract.name.localeCompare(b.contract.name))));
}
function decisionKey(request: Request, confirmationHash: string) {
  return `business-op-decision:v1:${hash({ operationId: request.operationId, runId: request.runId, confirmationHash })}`;
}
async function validateDecision(tx: QueueDbExecutor, row: typeof harnessToolEvents.$inferSelect, value: Context, basis: ReturnType<typeof basisFor>, confirmationHash: string, effectKey: string) {
  const input = json(row.input) as Record<string, unknown>;
  const choice = input?.decision;
  if (!['approve', 'reject'].includes(choice as string) || row.eventType !== 'business_operation_decision'
    || row.status !== (choice === 'approve' ? 'approved' : 'rejected') || row.harnessRunId !== value.pending.rootRunId
    || row.toolName !== value.pending.request.toolName || row.effectKey !== effectKey || row.actionId !== effectKey
    || row.output !== null || row.errorMessage !== null || row.riskLevel !== null
    || !(row.createdAt instanceof Date) || !Number.isFinite(row.createdAt.getTime()) || !(row.resolvedAt instanceof Date)
    || row.createdAt.getTime() !== row.resolvedAt.getTime()
    || !isDeepStrictEqual(input, { schemaVersion: 1, basis, confirmationHash, decision: choice, actorId: value.admission.identity.id })) fail('OPERATION_DECISION_INVALID');
  const [time] = await tx.select({ equal: sql<boolean>`${harnessToolEvents.createdAt} = ${harnessToolEvents.resolvedAt}` }).from(harnessToolEvents)
    .where(eq(harnessToolEvents.harnessToolEventId, row.harnessToolEventId));
  if (!time?.equal) fail('OPERATION_DECISION_INVALID');
  return choice as 'approve' | 'reject';
}
/** Internal explicit-human command service. Facts recorded here are never an execution grant or an AgentTool. */
export function createSkillOperationDecisionService(options: Options = {}) {
  const database = options.database ?? db;
  async function handle(initialUser: AuthUser, body: unknown, decide: boolean): Promise<ConfirmationView> {
    try {
      const request = command(body, decide), user = structuredClone(initialUser);
      const before = await database.transaction(tx => context(tx, request, user));
      const prepared = await prepareSkillAuthority([], async () => {
        const now = await (options.inventory ?? resolveCurrentSkillTools)({ ...user, ...before.admission.identity,
          businessRole: before.admission.manifest.caller.businessRole } as AuthUser);
        return currentTools(before, now);
      }, database);
      const basis = basisFor(before, prepared.value), confirmationHash = hash(basis), effectKey = decisionKey(request, confirmationHash);
      return await database.transaction(async tx => {
        const after = await context(tx, request, user, false);
        await prepared.verify(tx);
        after.stamps = await stamps(tx);
        if (hash(basisFor(after, prepared.value)) !== confirmationHash || !isDeepStrictEqual(after.pending.input, before.pending.input)) fail('OPERATION_CONFIRMATION_CHANGED');
        if (decide && request.confirmationHash !== confirmationHash) fail('OPERATION_CONFIRMATION_CHANGED');
        let [row] = await tx.select().from(harnessToolEvents).where(and(eq(harnessToolEvents.harnessRunId, after.pending.rootRunId), eq(harnessToolEvents.effectKey, effectKey))).for('share');
        if (decide && !row) {
          const now = await readDbNow(tx);
          [row] = await tx.insert(harnessToolEvents).values({ harnessToolEventId: randomUUID(), harnessRunId: after.pending.rootRunId,
            toolName: after.pending.request.toolName, effectKey, actionId: effectKey, eventType: 'business_operation_decision',
            status: request.decision === 'approve' ? 'approved' : 'rejected', createdAt: now, resolvedAt: now,
            input: json({ schemaVersion: 1, basis, confirmationHash, decision: request.decision, actorId: after.admission.identity.id }) })
            .onConflictDoNothing({ target: [harnessToolEvents.harnessRunId, harnessToolEvents.effectKey] }).returning();
          if (!row) [row] = await tx.select().from(harnessToolEvents).where(and(eq(harnessToolEvents.harnessRunId, after.pending.rootRunId), eq(harnessToolEvents.effectKey, effectKey))).for('share');
          if (!row) fail('OPERATION_DECISION_INVALID');
        }
        const choice = row ? await validateDecision(tx, row, after, basis, confirmationHash, effectKey) : undefined;
        if (decide && choice !== request.decision) fail('OPERATION_DECISION_CONFLICT');
        return { runId: request.runId, operationId: request.operationId, rootRunId: after.pending.rootRunId, payloadHash: after.pending.payloadHash,
          confirmationHash, toolName: after.pending.request.toolName, parameters: json(after.pending.request.parameters),
          status: choice === 'approve' ? 'approved' : choice === 'reject' ? 'rejected' : 'pending',
          ...(row ? { decisionId: row.harnessToolEventId, decision: choice } : {}) };
      });
    } catch (error) {
      if (error instanceof SkillError) throw error;
      return fail('OPERATION_DECISION_UNAVAILABLE', 503);
    }
  }
  return { readForConfirmation: (user: AuthUser, body: unknown) => handle(user, body, false),
    decideOperation: (user: AuthUser, body: unknown) => handle(user, body, true) };
}
