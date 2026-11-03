import type { ExecutionManifest } from './execution-manifest.types';
import type { SkillExecutionState } from './skills.execution-state';
import type { BusinessSkillsHostState } from '../harness/business-skills.host-state';
import type { HarnessRunEventRow, HarnessToolEventRow } from '../../db/schema';
import type { WorkflowCommand, WorkflowReceipt } from '../harness/workflows.runtime.types';
import { createWorkflowRuntime } from '../harness/workflows.runtime-adapter';
import { skillDefinitionHash as hash } from './skills.hash';
import { safeBusinessJson } from './skills.workbench-view';

export type BusinessTimelineRunEvent = Pick<HarnessRunEventRow, 'harnessRunEventId' | 'harnessRunId' | 'sequence' | 'eventType' | 'payload' | 'createdAt'>;
export type BusinessTimelineToolEvent = Pick<HarnessToolEventRow, 'harnessToolEventId' | 'harnessRunId' | 'toolName' | 'eventType' | 'status' | 'input' | 'output' | 'createdAt' | 'resolvedAt'>;
/** Origins come from validated physical checkpoints, not from the retry cursor's logical executionId. */
export type BusinessTimelineReceiptOrigin = { operationId: string; runId: string; occurredAt?: Date };
/** One last completed, validated snapshot per occurrence; A2 verifies its output against the workflow receipt.
 * runId is physical provenance supplied by A2. The cursor's state.runId is a logical binding, never a substitute. */
export type BusinessTimelineHistoricalSkill = { state: SkillExecutionState; runId?: string; occurredAt?: Date };
/** Internal trusted facts only: A2 owns locks, manifest/lineage/current identity and ledger validation. */
export type BusinessTimelineInput = {
 manifest: ExecutionManifest; state?: BusinessSkillsHostState; runId: string; rootRunId: string; ownerUserId: string; sessionId: string;
 receiptOrigins: BusinessTimelineReceiptOrigin[]; runEvents: BusinessTimelineRunEvent[]; toolEvents: BusinessTimelineToolEvent[];
 runStatus?: string; historicalSkills?: BusinessTimelineHistoricalSkill[];
 /** Supplied only when every current Skill tool result is proven to share this physical source. */
 skillToolOrigin?: { runId: string; occurredAt?: Date };
};
export type BusinessTimelineEntry = {
 id: string; kind: 'stage' | 'question' | 'answer' | 'confirmation' | 'decision' | 'tool_result' | 'result' | 'failure';
 role: 'assistant' | 'user' | 'system'; title: string; status: string; runId?: string;
 stepId?: string; stepType?: 'skill' | 'tool' | 'userInput' | 'confirmation'; operationId?: string; iteration?: number; ordinal?: number; toolName?: string; content?: unknown; occurredAt?: string;
 /** Links records to their single logical stage without deriving workflow state in the browser. */
 stageId?: string;
};
export type BusinessExecutionTimeline = { version: 1; rootRunId: string; entries: BusinessTimelineEntry[];
 coverage: 'complete' | 'partial'; unavailable: Array<'receipt_origin_missing' | 'wait_history_missing' | 'unsupported_history' | 'state_missing'> };
const invalid = (): never => { throw new Error('BUSINESS_TIMELINE_FACT_INVALID'); };
const limit = (): never => { throw new Error('BUSINESS_TIMELINE_LIMIT_EXCEEDED'); };
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : invalid();
const timestamp = (value: Date): string => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : invalid();
const stageId = (operationId: string, iteration: number) => `stage:${operationId}:${iteration}`;
/** Bounded, read-only projection. It never resolves tools, calls a model, grants permission or writes history. */
export function buildBusinessExecutionTimeline(input: BusinessTimelineInput): BusinessExecutionTimeline {
 try { return project(input); } catch (error) {
  if (error instanceof Error && error.message === 'BUSINESS_TIMELINE_LIMIT_EXCEEDED') throw error;
  return invalid();
 }
}
function project(input: BusinessTimelineInput): BusinessExecutionTimeline {
 if (input.ownerUserId !== input.manifest.caller.id) invalid();
 if (input.runEvents.length > 4096 || input.toolEvents.length > 2048 || input.receiptOrigins.length > 501 || (input.historicalSkills?.length ?? 0) > 500) limit();
 const timeline: BusinessExecutionTimeline = { version: 1, rootRunId: input.rootRunId, entries: [], coverage: 'complete', unavailable: [] };
 const unavailable = (reason: BusinessExecutionTimeline['unavailable'][number]) => {
  timeline.coverage = 'partial'; if (!timeline.unavailable.includes(reason)) timeline.unavailable.push(reason);
 };
 let bytes = 0;
 const ids = new Set<string>(), usedEvents = new Set<string>(), usedTools = new Set<string>();
 const emit = (entry: BusinessTimelineEntry) => {
  if (ids.has(entry.id)) invalid(); ids.add(entry.id);
  // Only selected business fields reach this point. Never serialize a host cursor or a ledger envelope.
  if (entry.content !== undefined) entry.content = safeBusinessJson(entry.content);
  bytes += Buffer.byteLength(JSON.stringify(entry));
  if (timeline.entries.length >= 4096 || bytes > 8 * 1024 * 1024) limit();
  timeline.entries.push(entry);
 };
 const origins = new Map<string, BusinessTimelineReceiptOrigin>();
 for (const origin of input.receiptOrigins) {
  if (origins.has(origin.operationId) || !origin.runId) invalid(); origins.set(origin.operationId, origin);
 }
 const historical = new Map<string, BusinessTimelineHistoricalSkill>();
 for (const snapshot of input.historicalSkills ?? []) {
  if (historical.has(snapshot.state.operationId)) invalid(); historical.set(snapshot.state.operationId, snapshot);
 }
 const waits = new Map<string, BusinessTimelineRunEvent>(), answers = new Map<string, BusinessTimelineRunEvent>();
 for (const event of input.runEvents) {
  const target = ['workflow.awaiting_input', 'workflow.awaiting_confirmation'].includes(event.eventType) ? waits
   : event.eventType === 'workflow.answer_recorded' ? answers : undefined;
  if (!target) continue;
  const payload = record(event.payload);
  if (typeof payload.actionId !== 'string' || target.has(payload.actionId)) invalid(); target.set(payload.actionId, event);
 }
 const tools = new Map(input.toolEvents.map(row => [row.harnessToolEventId, row]));
 if (tools.size !== input.toolEvents.length) invalid();
 const ledgerByCommand = new Map<string, BusinessTimelineEntry[]>(), detachedLedger: BusinessTimelineEntry[] = [];
 const successfulTools = new Map<string, unknown>(), decisionsByOperationRun = new Set<string>(), operationWaits = new Set<string>();
 const deferredWaits = new Map<string, { entry: BusinessTimelineEntry; request: Record<string, any> }>();
 const queueLedger = (entry: BusinessTimelineEntry, request: Record<string, any>) => {
  const commandId = request.commandId ?? (input.manifest.kind === 'skill' ? input.state?.skill?.operationId : undefined);
  if (typeof commandId === 'string') {
   const entries = ledgerByCommand.get(commandId) ?? []; entries.push(entry); ledgerByCommand.set(commandId, entries);
  } else detachedLedger.push(entry);
 };
 const queueWait = (key: string) => {
  const waiting = deferredWaits.get(key); if (!waiting) return;
  queueLedger(waiting.entry, waiting.request); deferredWaits.delete(key);
 };
 for (const row of input.toolEvents) if (row.eventType === 'business_operation_decision') {
  const value = record(row.input), basis = record(value.basis);
  decisionsByOperationRun.add(`${basis.operationId}:${basis.runId}`);
 }
 // Native-write waits have a different real descriptor from workflow confirmation steps.
 for (const waiting of waits.values()) {
  const descriptor = record(waiting.payload); if (descriptor.kind !== 'operation') continue;
  const prepared = tools.get(descriptor.operationId);
  if (!prepared || prepared.eventType !== 'business_operation_prepared') { unavailable('unsupported_history'); continue; }
  const request = record(prepared.input);
  if (prepared.harnessRunId !== input.rootRunId || descriptor.stepId !== request.stepId || descriptor.toolName !== prepared.toolName
   || hash(descriptor.parameters) !== hash(request.parameters)
   || descriptor.actionId !== hash({ runId: waiting.harnessRunId, manifestHash: input.manifest.manifestHash,
    operationId: prepared.harnessToolEventId, stepId: request.stepId, ordinal: request.ordinal })) invalid();
  usedEvents.add(waiting.harnessRunEventId); operationWaits.add(`${prepared.harnessToolEventId}:${waiting.harnessRunId}`);
  deferredWaits.set(`${prepared.harnessToolEventId}:${waiting.harnessRunId}`, { entry: { id: waiting.harnessRunEventId, kind: 'confirmation', role: 'assistant', title: '请确认业务操作',
   status: decisionsByOperationRun.has(`${prepared.harnessToolEventId}:${waiting.harnessRunId}`) ? 'answered'
    : waiting.harnessRunId === input.runId ? 'pending' : 'unavailable',
   runId: waiting.harnessRunId, stepId: request.stepId, operationId: prepared.harnessToolEventId, ordinal: request.ordinal,
   toolName: prepared.toolName, content: { toolName: prepared.toolName, parameters: request.parameters }, occurredAt: timestamp(waiting.createdAt) }, request });
 }
 for (const row of input.toolEvents) {
  if (row.eventType === 'business_operation_prepared') {
   if (!operationWaits.has(`${row.harnessToolEventId}:${record(row.input).sourceRunId}`)) unavailable('wait_history_missing');
   usedTools.add(row.harnessToolEventId); continue;
  }
  if (!['business_operation_decision', 'business_operation_executed'].includes(row.eventType)) continue;
  if (row.harnessRunId !== input.rootRunId) invalid();
  const value = record(row.input), basis = row.eventType === 'business_operation_decision' ? record(value.basis) : value;
  const prepared = tools.get(basis.operationId);
  if (!prepared || prepared.eventType !== 'business_operation_prepared') { unavailable('unsupported_history'); continue; }
  const request = record(prepared.input);
  if (prepared.harnessRunId !== input.rootRunId || prepared.toolName !== row.toolName || basis.rootRunId !== input.rootRunId) invalid();
  const common = { id: row.harnessToolEventId, runId: row.eventType === 'business_operation_decision' ? basis.runId : value.sourceRunId,
   stepId: request.stepId, operationId: basis.operationId, ordinal: request.ordinal, toolName: row.toolName, occurredAt: timestamp(row.resolvedAt ?? row.createdAt) };
  if (typeof common.runId !== 'string' || typeof common.stepId !== 'string') invalid();
  if (!operationWaits.has(`${basis.operationId}:${common.runId}`)) unavailable('wait_history_missing');
  let entry: BusinessTimelineEntry;
  if (row.eventType === 'business_operation_decision') {
   const decision = value.decision;
   if (!['approve', 'reject'].includes(decision) || row.status !== (decision === 'approve' ? 'approved' : 'rejected')) invalid();
   entry = { ...common, kind: 'decision', role: 'user', title: decision === 'approve' ? '已批准操作' : '已拒绝操作', status: row.status,
    content: { decision, parameters: request.parameters } };
  } else {
   const approval = tools.get(value.decisionId), approved = approval && record(approval.input);
   if (row.status !== 'succeeded' || !approval || approval.eventType !== 'business_operation_decision' || approval.status !== 'approved'
    || approved!.decision !== 'approve' || record(approved!.basis).operationId !== value.operationId
    || approved!.confirmationHash !== value.confirmationHash || record(approved!.basis).runId !== value.sourceRunId) invalid();
   const output = record(row.output); if (output.schemaVersion !== 1 || !Object.prototype.hasOwnProperty.call(output, 'result')) invalid();
   entry = { ...common, kind: 'tool_result', role: 'assistant', title: '操作执行结果', status: 'succeeded', content: output.result };
   const commandId = request.commandId ?? input.state?.skill?.operationId;
   if (commandId) successfulTools.set(`${commandId}:${request.ordinal}`, output.result);
  }
  usedTools.add(row.harnessToolEventId);
  queueWait(`${basis.operationId}:${common.runId}`); queueLedger(entry, request);
 }
 for (const key of deferredWaits.keys()) queueWait(key);
 const emittedCommands = new Set<string>();
 const ledger = (operationId: string, iteration: number) => {
  // All stage facts share one bounded queue: causal tool ordinal, actual time, then stable source order.
  const entries = ledgerByCommand.get(operationId) ?? [];
  entries.sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)
   || (a.occurredAt && b.occurredAt ? a.occurredAt.localeCompare(b.occurredAt) : 0));
  for (const entry of entries) emit({ ...entry, iteration, stageId: stageId(operationId, iteration) });
  emittedCommands.add(operationId);
 };
 const skillTools = (skill: SkillExecutionState, common: Partial<BusinessTimelineEntry>, origin?: { runId?: string; occurredAt?: Date }) => {
  const { runId: _stageRun, occurredAt: _stageTime, ...binding } = common;
  if (skill.toolResults.length && !origin?.runId) unavailable('receipt_origin_missing');
  if (skill.toolResults.length > 60) limit();
  skill.toolResults.forEach((tool, ordinal) => {
   const key = `${skill.operationId}:${ordinal}`;
   if (successfulTools.has(key)) { if (hash(successfulTools.get(key)) !== hash(tool.result)) invalid(); return; }
   queueLedger({ ...binding, ...(origin?.runId ? { runId: origin.runId } : {}), ...(origin?.occurredAt ? { occurredAt: timestamp(origin.occurredAt) } : {}),
    id: `tool:${skill.operationId}:${skill.iteration}:${tool.callId}`, kind: 'tool_result', role: 'assistant', title: '工具返回结果',
    status: 'succeeded', ordinal, toolName: tool.toolName, content: { parameters: tool.arguments, result: tool.result } }, { commandId: skill.operationId });
  });
 };
 const workflowStepNames = new Map(input.manifest.kind === 'workflow'
  ? (input.manifest.target.definition as import('../workflows/workflows.types').WorkflowDefinition).steps.map(step => [step.id, step.name]) : []);
 const visit = (command: WorkflowCommand, receipt?: WorkflowReceipt) => {
  const origin = receipt ? origins.get(command.operationId) : { operationId: command.operationId, runId: input.runId };
  if (!origin) unavailable('receipt_origin_missing');
  const common = { operationId: command.operationId, iteration: command.iteration, stepId: command.stepId, stepType: command.type,
   ...(origin ? { runId: origin.runId } : {}), stageId: stageId(command.operationId, command.iteration) };
  const rejected = command.type === 'confirmation' && receipt?.status === 'succeeded' && 'output' in receipt && record(receipt.output).approved === false;
  const status = rejected ? 'rejected' : receipt?.status ?? input.runStatus ?? 'running';
  emit({ ...common, id: common.stageId, kind: 'stage', role: 'assistant', title: workflowStepNames.get(command.stepId) ?? command.stepId, status });
  if (command.type === 'userInput' || command.type === 'confirmation') {
   const wait = () => {
    if (!origin) return;
    const contentHash = hash({ prompt: command.prompt, displayInput: command.input });
    const actionId = hash({ runId: origin.runId, ownerUserId: input.ownerUserId, sessionId: input.sessionId,
     manifestHash: input.manifest.manifestHash, operationId: command.operationId, kind: command.type, stepId: command.stepId,
     contractHash: hash(command.outputSchema), contentHash });
    const waiting = waits.get(actionId), answer = answers.get(actionId);
    if (!waiting) { if (receipt || answer) unavailable('wait_history_missing'); return; }
    const descriptor = record(waiting.payload);
    if (waiting.harnessRunId !== origin.runId || descriptor.kind !== command.type || descriptor.stepId !== command.stepId
     || descriptor.contentHash !== contentHash || descriptor.prompt !== command.prompt || hash(descriptor.displayInput) !== hash(command.input)
     || hash(descriptor.outputSchema) !== hash(command.outputSchema)
     || waiting.eventType !== (command.type === 'userInput' ? 'workflow.awaiting_input' : 'workflow.awaiting_confirmation')) invalid();
    usedEvents.add(waiting.harnessRunEventId);
    emit({ ...common, id: waiting.harnessRunEventId, kind: command.type === 'userInput' ? 'question' : 'confirmation', role: 'assistant',
     title: command.prompt, status: receipt ? receipt.status === 'failed' ? 'failed' : answer ? 'answered' : 'unavailable' : 'pending', content: { prompt: command.prompt, displayInput: command.input },
     occurredAt: timestamp(waiting.createdAt) });
    if (receipt?.status === 'succeeded') {
     if (!answer) { unavailable('wait_history_missing'); return; }
     if (!('output' in receipt)) invalid();
     const fact = record(answer.payload);
     if (answer.harnessRunId !== origin.runId || fact.kind !== command.type || fact.stepId !== command.stepId
      || fact.contentHash !== contentHash || fact.requestedBy !== input.ownerUserId || fact.valueHash !== hash(receipt.output)
      || answer.sequence <= waiting.sequence || command.type === 'confirmation' && fact.approved !== record(receipt.output).approved) invalid();
     usedEvents.add(answer.harnessRunEventId);
     const approved = command.type === 'confirmation' ? record(receipt.output).approved : undefined;
     emit({ ...common, id: answer.harnessRunEventId, kind: command.type === 'userInput' ? 'answer' : 'decision', role: 'user',
      title: command.type === 'userInput' ? '已补充材料' : approved ? '已确认' : '已拒绝',
      status: command.type === 'userInput' ? 'recorded' : approved ? 'approved' : 'rejected', content: receipt.output,
      occurredAt: timestamp(answer.createdAt) });
    } else if (answer) invalid();
   }; wait();
  } else {
   if (!receipt && command.type === 'skill' && input.state?.skill?.operationId === command.operationId) skillTools(input.state.skill, common, input.skillToolOrigin);
   if (receipt?.status === 'succeeded') {
    if (command.type === 'tool' && successfulTools.has(`${command.operationId}:0`)
     && hash(successfulTools.get(`${command.operationId}:0`)) !== hash('output' in receipt ? receipt.output : receipt.opaqueResult)) invalid();
    if (command.type === 'skill') {
     const snapshot = historical.get(command.operationId);
     if (snapshot) {
      if (snapshot.state.phase !== 'completed' || snapshot.state.stepId !== command.stepId || snapshot.state.iteration !== command.iteration
       || !('output' in receipt) || hash(snapshot.state.output) !== hash(receipt.output)) invalid();
      skillTools(snapshot.state, common, { runId: snapshot.runId, occurredAt: snapshot.occurredAt });
     } else if (command.dependency.definition.tools.length) unavailable('unsupported_history');
    }
   }
   ledger(command.operationId, command.iteration);
   if (receipt?.status === 'succeeded' && !(command.type === 'tool' && successfulTools.has(`${command.operationId}:0`))) emit({ ...common, id: `result:${command.operationId}:${command.iteration}`,
    kind: command.type === 'tool' ? 'tool_result' : 'result', role: 'assistant', title: command.type === 'tool' ? '工具返回结果' : '阶段结果',
    status: 'succeeded', content: 'output' in receipt ? receipt.output : receipt.opaqueResult,
    ...(command.type === 'tool' ? { toolName: command.toolName } : {}), ...(origin?.occurredAt ? { occurredAt: timestamp(origin.occurredAt) } : {}) });
  }
  if (receipt?.status === 'failed') emit({ ...common, id: `failure:${command.operationId}:${command.iteration}`, kind: 'failure', role: 'system',
   title: '阶段未完成', status: 'failed', content: { code: receipt.code } });
 };
 if (input.manifest.kind === 'workflow') {
  if (!input.state?.workflow) unavailable('state_missing');
  const runtime = createWorkflowRuntime(input.manifest, input.rootRunId);
  const decision = input.state?.workflow ? runtime.visit(input.state.workflow, ({ command, receipt }) => visit(command, receipt)) : runtime.next();
  if (decision.kind === 'ready') visit(decision.command);
 } else if (input.state?.skill) {
  const skill = input.state.skill, origin = origins.get(skill.operationId);
  if (skill.toolResults.length > 60) limit();
  if (!origin) unavailable('receipt_origin_missing');
  const common = { operationId: skill.operationId, stepId: skill.stepId, stepType: 'skill' as const, iteration: skill.iteration,
   ...(origin ? { runId: origin.runId } : {}), stageId: stageId(skill.operationId, skill.iteration) };
  emit({ ...common, id: common.stageId, kind: 'stage', role: 'assistant', title: input.manifest.target.definition.name,
   status: skill.phase === 'completed' ? 'succeeded' : input.runStatus ?? 'running' });
  skillTools(skill, common, input.skillToolOrigin); ledger(skill.operationId, skill.iteration);
  if (skill.phase === 'completed') emit({ ...common, id: `result:${skill.operationId}:${skill.iteration}`, kind: 'result', role: 'assistant',
   title: '执行结果', status: 'succeeded', content: skill.output, ...(origin?.occurredAt ? { occurredAt: timestamp(origin.occurredAt) } : {}) });
 } else unavailable('state_missing');
 for (const entry of detachedLedger) emit(entry);
 for (const [operationId, entries] of ledgerByCommand) if (!emittedCommands.has(operationId)) {
  unavailable('unsupported_history'); for (const entry of entries) emit(entry);
 }
 if ([...waits.values(), ...answers.values()].some(row => !usedEvents.has(row.harnessRunEventId))
  || input.toolEvents.some(row => !usedTools.has(row.harnessToolEventId))) unavailable('unsupported_history');
 return timeline;
}
