import { isDeepStrictEqual } from 'node:util';
import { and, asc, desc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { harnessRunCheckpoints, harnessRunEvents, harnessToolEvents, type HarnessRunCheckpointRow } from '../../db/schema';
import type { HarnessTx } from '../harness/harness-runtime.repository';
import { readBusinessSkillHostCheckpointInTransaction } from '../harness/business-skills.operation-wait';
import { readBusinessSkillsCheckpoint } from '../harness/business-skills.workflow';
import { readBusinessSkillsHostState, type BusinessSkillsHostState } from '../harness/business-skills.host-state';
import { createWorkflowRuntime } from '../harness/workflows.runtime-adapter';
import { readPreparedOperationInTransaction } from './skills.operations';
import { validateDecision } from './skills.operation-decisions';
import { businessRetryResumeState } from './skills.retry-checkpoint';
import { skillDefinitionHash as hash } from './skills.hash';
import { compileNativeToolOutput } from './skills.validation';
import type { SkillExecutionState } from './skills.execution-state';
import type { BusinessTimelineInput, BusinessTimelineReceiptOrigin, BusinessTimelineHistoricalSkill } from './skills.workbench-timeline';

type Current = Awaited<ReturnType<typeof readBusinessSkillHostCheckpointInTransaction>>;
const invalid: () => never = () => { throw new Error('BUSINESS_TIMELINE_HISTORY_INVALID'); };
const object = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : invalid();
const digest = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
type ToolOrigin = { runId: string } | undefined;
/** All reads share the owned snapshot transaction. No inventory, admission, model, or writes. */
export async function readBusinessExecutionHistoryInTransaction(tx: HarnessTx, current: Current) {
 const { manifest, chain } = current, runs = [...chain.runs].reverse(), ids = runs.map(run => run.harnessRunId);
 const snapshots: Array<{ run: typeof runs[number]; cp?: HarnessRunCheckpointRow; state?: BusinessSkillsHostState; floor: number; inherited?: BusinessSkillsHostState; toolOrigins: string[] }> = [];
 const receiptOrigins = new Map<string, BusinessTimelineReceiptOrigin>();
 for (let index = 0; index < runs.length; index++) {
  const run = runs[index], child = runs[index + 1];
  let cp = index === runs.length - 1 ? current.cp : undefined;
  if (child) {
   const proof = object(child.metadata).retrySourceCheckpoint;
   if (proof !== undefined) {
    const p = object(proof);
    if (Object.keys(p).sort().join(',') !== 'checkpointId,runId,sequence,stateHash' || p.runId !== run.harnessRunId) invalid();
    [cp] = await tx.select().from(harnessRunCheckpoints).where(and(eq(harnessRunCheckpoints.harnessRunCheckpointId, p.checkpointId), eq(harnessRunCheckpoints.harnessRunId, run.harnessRunId))).for('share');
    if (!cp || cp.sequence !== p.sequence || cp.stateHash !== p.stateHash || run.lastCheckpointId !== cp.harnessRunCheckpointId) invalid();
   } else if (run.lastCheckpointId !== null) invalid();
  }
  const raw = cp ? readBusinessSkillsCheckpoint(cp, run, manifest) : undefined;
  const state = raw ? readBusinessSkillsHostState(raw, manifest, chain.root) : undefined;
  let floor = 0, inherited: BusinessSkillsHostState | undefined;
  if (index) {
   const previous = snapshots[index - 1];
   const previousRaw = previous.cp ? readBusinessSkillsCheckpoint(previous.cp, previous.run, manifest) : undefined;
   const resume = businessRetryResumeState(previousRaw, previous.state, manifest, chain.root);
   if (resume) {
    inherited = readBusinessSkillsHostState(resume, manifest, chain.root);
    const [copy] = await tx.select().from(harnessRunCheckpoints).where(eq(harnessRunCheckpoints.harnessRunId, run.harnessRunId)).orderBy(asc(harnessRunCheckpoints.sequence)).limit(1).for('share');
    if (!copy || copy.checkpointKey !== `retry-source:${previous.cp!.harnessRunCheckpointId}` || !cp || copy.sequence > cp.sequence
     || !isDeepStrictEqual(readBusinessSkillsCheckpoint(copy, run, manifest), resume)) invalid();
    floor = copy.sequence;
   }
  }
  const inheritedReceipts = inherited?.workflow?.receipts ?? [], receipts = state?.workflow?.receipts ?? [];
  if (!isDeepStrictEqual(receipts.slice(0, inheritedReceipts.length), inheritedReceipts)) invalid();
  // The retry transform removes a terminal failure: an equal failure in the child is a new physical event.
  for (const receipt of receipts.slice(inheritedReceipts.length)) receiptOrigins.set(receipt.operationId, { operationId: receipt.operationId, runId: run.harnessRunId });
  if (manifest.kind === 'skill' && state?.skill) {
   const old = inherited?.skill;
   if (!(old?.phase === 'completed' && isDeepStrictEqual(old, state.skill))) receiptOrigins.set(state.skill.operationId, { operationId: state.skill.operationId, runId: run.harnessRunId });
  }
  const oldSkill = inherited?.skill, skill = state?.skill;
  const priorOrigins = snapshots[index - 1]?.toolOrigins ?? [];
  const toolOrigins = skill ? originsFor(skill, oldSkill, priorOrigins, run.harnessRunId) : [];
  snapshots.push({ run, cp, state, floor, inherited, toolOrigins });
 }
 const originFor = (origins: string[]): ToolOrigin => origins.length && origins.every(id => id === origins[0]) ? { runId: origins[0] } : undefined;
 const historicalSkills: BusinessTimelineHistoricalSkill[] = [];
 if (manifest.kind === 'workflow' && current.state?.workflow) {
  const receipts = new Map(current.state.workflow.receipts.map(r => [r.operationId, r]));
  const operations: string[] = [];
  createWorkflowRuntime(manifest, chain.root).visit(current.state.workflow, ({ command, receipt }) => {
   if (command.type === 'skill' && receipt?.status === 'succeeded') operations.push(command.operationId);
  });
  if (operations.length) {
   const operation = sql<string>`${harnessRunCheckpoints.state}->'businessSkills'->'state'->'skill'->>'operationId'`;
   // Scalar hints only: load exactly one full completed candidate per occurrence, then validate its complete envelope.
   const candidates = await tx.selectDistinctOn([operation], { id: harnessRunCheckpoints.harnessRunCheckpointId, runId: harnessRunCheckpoints.harnessRunId, operation })
    .from(harnessRunCheckpoints).where(and(inArray(operation, operations),
     sql`${harnessRunCheckpoints.state}->'businessSkills'->'state'->'skill'->>'phase' = 'completed'`,
     or(...snapshots.filter(s => s.cp).map(s => and(eq(harnessRunCheckpoints.harnessRunId, s.run.harnessRunId), lte(harnessRunCheckpoints.sequence, s.cp!.sequence), sql`${harnessRunCheckpoints.sequence} > ${s.floor}`)))))
    .orderBy(operation, desc(harnessRunCheckpoints.createdAt), desc(harnessRunCheckpoints.sequence)).limit(501);
   if (candidates.length > 500) invalid();
   for (const candidate of candidates) {
    const snapshot = snapshots.find(s => s.run.harnessRunId === candidate.runId)!;
    const [cp] = await tx.select().from(harnessRunCheckpoints).where(eq(harnessRunCheckpoints.harnessRunCheckpointId, candidate.id)).for('share');
    if (!cp || cp.sequence <= snapshot.floor || cp.sequence > snapshot.cp!.sequence) invalid();
    const skill = readBusinessSkillsHostState(readBusinessSkillsCheckpoint(cp, snapshot.run, manifest), manifest, chain.root).skill;
    const receipt = receipts.get(candidate.operation);
    if (!skill || skill.phase !== 'completed' || skill.operationId !== candidate.operation || receipt?.status !== 'succeeded'
     || !('output' in receipt) || hash(skill.output) !== hash(receipt.output)) invalid();
    const previous = snapshots[snapshots.indexOf(snapshot) - 1];
    const origins = originsFor(skill, snapshot.inherited?.skill, previous?.toolOrigins ?? [], candidate.runId);
    historicalSkills.push({ state: skill, ...originFor(origins) });
   }
  }
 }
 const runEvents = await tx.select().from(harnessRunEvents).where(and(inArray(harnessRunEvents.harnessRunId, ids),
  inArray(harnessRunEvents.eventType, ['workflow.awaiting_input', 'workflow.awaiting_confirmation', 'workflow.answer_recorded'])))
  .orderBy(asc(harnessRunEvents.createdAt), asc(harnessRunEvents.sequence)).limit(4097).for('share');
 if (runEvents.length > 4096) invalid();
 const toolEvents = await tx.select().from(harnessToolEvents).where(and(eq(harnessToolEvents.harnessRunId, chain.root),
  inArray(harnessToolEvents.eventType, ['business_operation_prepared', 'business_operation_decision', 'business_operation_executed']),
  or(sql`${harnessToolEvents.input}->>'sourceRunId' IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`,
   sql`${harnessToolEvents.input}->'basis'->>'runId' IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`)))
  .orderBy(asc(harnessToolEvents.createdAt), asc(harnessToolEvents.harnessToolEventId)).limit(2049).for('share');
 if (toolEvents.length > 2048) invalid();
 const prepared = new Map<string, Awaited<ReturnType<typeof readPreparedOperationInTransaction>>>();
 for (const row of toolEvents) if (row.eventType === 'business_operation_prepared') {
  const source = object(row.input).sourceRunId;
  prepared.set(row.harnessToolEventId, await readPreparedOperationInTransaction(tx, source, row.harnessToolEventId, manifest.caller.id, manifest));
 }
 for (const row of toolEvents) if (row.eventType === 'business_operation_decision') {
  const input = object(row.input), basis = object(input.basis);
  if (!prepared.has(basis.operationId) || !ids.includes(basis.runId)) invalid();
  const pending = await readPreparedOperationInTransaction(tx, basis.runId, basis.operationId, manifest.caller.id, manifest);
  const identity = object(basis.identity), revisions = basis.configRevisions;
  if (Object.keys(identity).sort().join(',') !== 'businessRole,id,role,status' || identity.id !== manifest.caller.id
   || identity.status !== 'active' || !['admin', 'user', 'sub_admin'].includes(identity.role)
   || !(identity.businessRole === null || typeof identity.businessRole === 'string') || !digest(basis.currentToolsHash)
   || !Array.isArray(revisions) || revisions.length !== 2 || revisions.some((r: any, i: number) => r.configKey !== ['mcpConfig', 'toolPolicy'][i]
    || !(isDeepStrictEqual(r, { configKey: r.configKey, missing: true }) || Object.keys(r).sort().join(',') === 'configKey,effectiveAt,updatedAt,version'
     && Number.isSafeInteger(r.version) && r.version >= 0 && [r.updatedAt, r.effectiveAt].every(v => typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v))))) invalid();
  const expected = { schemaVersion: 1, runId: basis.runId, ownerId: manifest.caller.id, sessionId: chain.sessionId,
   operationId: pending.operationId, rootRunId: chain.root, operationKey: pending.operationKey, manifestHash: manifest.manifestHash,
   payloadHash: pending.payloadHash, executionAuthority: pending.executionAuthority, identity, currentToolsHash: basis.currentToolsHash, configRevisions: revisions };
  if (!isDeepStrictEqual(basis, expected) || hash(basis) !== input.confirmationHash) invalid();
  const value = { pending, admission: { identity, manifest, runId: basis.runId }, stamps: revisions } as Parameters<typeof validateDecision>[2];
  const key = `business-op-decision:v1:${hash({ operationId: pending.operationId, runId: basis.runId, confirmationHash: input.confirmationHash })}`;
  await validateDecision(tx, row, value, basis as Parameters<typeof validateDecision>[3], input.confirmationHash, key);
 }
 for (const row of toolEvents) if (row.eventType === 'business_operation_executed') {
  const input = object(row.input), output = object(row.output), pending = prepared.get(input.operationId);
  const decision = toolEvents.find(r => r.harnessToolEventId === input.decisionId), approval = decision && object(decision.input);
  if (!pending || !ids.includes(input.sourceRunId) || !decision || decision.eventType !== 'business_operation_decision' || decision.status !== 'approved'
   || approval!.decision !== 'approve' || approval!.confirmationHash !== input.confirmationHash || approval!.basis.runId !== input.sourceRunId
   || approval!.basis.operationId !== pending.operationId) invalid();
  const key = `business-op-execution:v1:${hash({ operationId: pending.operationId })}`;
  if (row.status !== 'succeeded' || row.toolName !== pending.request.toolName || row.actionId !== key || row.effectKey !== key
   || row.errorMessage !== null || row.riskLevel !== null || !(row.resolvedAt instanceof Date) || !Number.isFinite(row.resolvedAt.getTime())
   || row.resolvedAt < row.createdAt || !isDeepStrictEqual(output, { schemaVersion: 1, result: output.result })
   || !isDeepStrictEqual(input, { schemaVersion: 1, operationId: pending.operationId, rootRunId: chain.root, operationKey: pending.operationKey,
    payloadHash: pending.payloadHash, manifestHash: manifest.manifestHash, ownerId: manifest.caller.id, sessionId: chain.sessionId,
    toolName: pending.request.toolName, sourceRunId: input.sourceRunId, decisionId: decision.harnessToolEventId, confirmationHash: approval!.confirmationHash })) invalid();
  const validate = compileNativeToolOutput(pending.snapshot.native); if (validate && !validate(output.result)) invalid();
  const [time] = await tx.select({ valid: sql<boolean>`isfinite(${harnessToolEvents.createdAt}) AND isfinite(${harnessToolEvents.resolvedAt}) AND ${harnessToolEvents.resolvedAt} >= ${harnessToolEvents.createdAt}` })
   .from(harnessToolEvents).where(eq(harnessToolEvents.harnessToolEventId, row.harnessToolEventId));
  if (!time?.valid) invalid();
 }
 return { receiptOrigins: [...receiptOrigins.values()], runEvents, toolEvents, historicalSkills,
  skillToolOrigin: originFor(snapshots.at(-1)!.toolOrigins) } satisfies Pick<BusinessTimelineInput, 'receiptOrigins' | 'runEvents' | 'toolEvents' | 'historicalSkills' | 'skillToolOrigin'>;
}
function originsFor(skill: SkillExecutionState, inherited: SkillExecutionState | undefined, prior: string[], physicalRun: string): string[] {
 const prefix = inherited?.operationId === skill.operationId ? inherited.toolResults : [];
 if (!isDeepStrictEqual(skill.toolResults.slice(0, prefix.length), prefix)) invalid();
 return skill.toolResults.map((_result, index) => index < prefix.length ? prior[index] : physicalRun);
}
