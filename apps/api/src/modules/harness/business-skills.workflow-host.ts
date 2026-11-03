import { isDeepStrictEqual } from 'node:util';
import { db } from '../../db/client';
import { resolveCurrentSkillTools } from '../skills/skills.context';
import { assertRunAdmissionInTransaction } from '../skills/execution-emergency';
import { createResumableSkillExecutor, ResumableSkillFailure } from '../skills/skills.execution-resumable';
import { skillDefinitionHash as hash } from '../skills/skills.hash';
import { compileNativeToolOutput } from '../skills/skills.validation';
import { SkillError } from '../skills/skills.types';
import type { ResumableSkillToolRequest } from '../skills/skills.execution-resumable';
import { createBusinessSkillHost } from './business-skills.host';
import { createBusinessSkillHostPorts, type BusinessSkillHostOptions } from './business-skills.host-ports';
import type { BusinessSkillsExecutor, BusinessSkillsExecutionResult } from './business-skills.workflow';
import type { BusinessSkillsHostState } from './business-skills.host-state';
import { assertBusinessSkillAttemptInTransaction, readBusinessSkillHostCheckpointInTransaction } from './business-skills.operation-wait';
import { createBusinessSkillsWaitService } from './business-skills.wait';
import { createWorkflowRuntime } from './workflows.runtime-adapter';
import { lockRunRow, pauseRunForToolWait } from './harness-runtime.repository';
import { HarnessWorkflowCancelledError, HarnessWorkflowWaitingError } from './harness-runtime.worker';
const fail = (code: string): never => { throw new SkillError(code, '工作流执行暂不可用，请检查任务和确认内容', 409); };
/** Same Worker/Run/manifest authority as root Skill execution; the pure runtime alone owns the node cursor. */
export function createBusinessSkillsWorkflowExecutor(options: BusinessSkillHostOptions = {}): BusinessSkillsExecutor {
 const database = options.database ?? db, inventory = options.inventory ?? resolveCurrentSkillTools;
 const skillHost = createBusinessSkillHost(options), waits = createBusinessSkillsWaitService(database);
 return async input => {
  const { manifest, state: supplied, context } = input;
  if (manifest.kind === 'skill') return skillHost(input);
  const runId = context.run.harnessRunId, ownerUserId = context.run.ownerUserId;
  const guard = () => { if (context.abortSignal.aborted) throw new HarnessWorkflowCancelledError(); }; guard();
  const locked = await database.transaction(async tx => {
   const run = await lockRunRow(tx, runId);
   if (run.ownerUserId !== ownerUserId || run.status !== 'running' || run.cancelRequestedAt) fail('BUSINESS_SKILLS_HOST_RUN_INVALID');
   await assertBusinessSkillAttemptInTransaction(tx, run, context.attempt.harnessRunAttemptId);
   const admission = await assertRunAdmissionInTransaction(tx, runId, ownerUserId), current = await readBusinessSkillHostCheckpointInTransaction(tx, run);
   if (hash(admission.manifest) !== hash(manifest) || !isDeepStrictEqual(supplied, current.raw ?? {})) fail('BUSINESS_SKILLS_HOST_STATE_INVALID');
   return { ...current, identity: admission.identity };
  });
  const runtime = createWorkflowRuntime(manifest, locked.chain.root);
  const host: BusinessSkillsHostState = locked.state ?? { schemaVersion: 1, kind: 'workflow', workflow: runtime.next().state };
  const ports = createBusinessSkillHostPorts({ ...options, database, inventory, manifest, runId, ownerUserId,
   aiSessionId: context.run.aiSessionId, identity: locked.identity, signal: context.abortSignal, pendingOperation: host.pendingOperation });
  await ports.check('resume'); guard();
  function checkpoint(next: BusinessSkillsHostState): BusinessSkillsExecutionResult {
   guard(); return { nextStepKey: 'execute', state: next, checkpoint: { key: `host:${hash(next)}`, kind: 'structural', resumePolicy: 'restart_step' } };
  }
  // Persist the first command before any model, tool, user-input or confirmation dispatch.
  if (!locked.state) return checkpoint(host);
  const decision = runtime.next(host.workflow);
  if (decision.kind === 'completed') return { ...checkpoint(host), nextStepKey: null,
   checkpoint: { key: `completed:${hash(host)}`, kind: 'structural', resumePolicy: 'restart_step' },
   output: { status: 'final', content: decision.output, contentHash: hash(decision.output) } };
  if (decision.kind === 'failed') return fail('BUSINESS_SKILLS_WORKFLOW_FAILED');
  if (decision.kind === 'waiting') {
   await pauseRunForToolWait(database, { runId, attemptId: context.attempt.harnessRunAttemptId, actionId: '', payload: {}, eventType: 'workflow.awaiting_input',
    terminalMessage: 'business run is terminal', notRunningMessage: 'business run is not running', cancelReason: 'business_failure_wait_cancelled',
    async beforeWait(tx, run) {
     await assertBusinessSkillAttemptInTransaction(tx, run, context.attempt.harnessRunAttemptId);
     const current = await readBusinessSkillHostCheckpointInTransaction(tx, run), saved = runtime.next(current.state?.workflow);
     if (saved.kind !== 'waiting' || hash(saved.state) !== hash(decision.state)) return fail('BUSINESS_SKILLS_HOST_STATE_INVALID');
     return { actionId: hash({ manifestHash: manifest.manifestHash, state: saved.state }), payload: { kind: 'failure', stepId: saved.stepId, code: saved.code } };
    } });
   throw new HarnessWorkflowWaitingError();
  }
  if (decision.kind !== 'ready') return fail('BUSINESS_SKILLS_HOST_STATE_INVALID');
  const command = decision.command;
  if (command.type === 'userInput' || command.type === 'confirmation') {
   await waits.pause({ runId, attemptId: context.attempt.harnessRunAttemptId }); throw new HarnessWorkflowWaitingError();
  }
  const failed = (code: 'execution_failed' | 'invalid_output' | 'rejected') => checkpoint({ schemaVersion: 1, kind: 'workflow',
   workflow: runtime.fail(decision.state, { operationId: command.operationId, code }).state });
  if (host.pendingOperation) {
   const status = await ports.pendingStatus(); guard();
   if (status === 'rejected') return failed('rejected');
   if (status === 'pending') { await ports.pause(context.attempt.harnessRunAttemptId); throw new HarnessWorkflowWaitingError(); }
  }
  if (command.type === 'skill') {
   // A completed model response is itself saved before the pure runtime consumes it.
   if (host.skill?.phase === 'completed') return checkpoint({ schemaVersion: 1, kind: 'workflow', workflow: runtime.settle(decision.state,
    { operationId: command.operationId, output: host.skill.output }).state });
   try {
    const advanced = await createResumableSkillExecutor(ports).advance({ runId: locked.chain.root, ownerUserId, manifest,
     stepId: command.stepId, operationId: command.operationId, iteration: command.iteration, input: command.input,
     ...(host.skill ? { state: host.skill } : {}), signal: context.abortSignal }); guard();
    return checkpoint({ schemaVersion: 1, kind: 'workflow', workflow: decision.state, skill: advanced.state,
     ...(advanced.pendingOperation ? { pendingOperation: { operationId: advanced.pendingOperation.operationId } } : {}) });
   } catch (error) {
    guard(); if (error instanceof ResumableSkillFailure && error.code === 'NATIVE_OUTPUT_SCHEMA_FAILED') return failed('invalid_output');
    if (error instanceof ResumableSkillFailure && ['MODEL_REQUEST_FAILED', 'INVALID_MODEL_RESPONSE', 'INVALID_MODEL_USAGE', 'OUTPUT_SCHEMA_FAILED', 'TOOL_PORT_FAILED', 'EXECUTION_BUDGET_CALLBACK_FAILED', 'EXECUTION_BUDGET_TIMEOUT'].includes(error.code)) return failed('execution_failed');
    throw error;
   }
  }
  const tool = manifest.tools.find(t => t.stepId === command.stepId && t.contract.name === command.toolName);
  const safe = manifest.schemaVersion === 2 && manifest.toolAuthority.tools.find(t => t.stepId === command.stepId)?.sandboxReadSafe;
  if (!tool || manifest.schemaVersion !== 2) return fail('BUSINESS_SKILLS_TOOL_UNSUPPORTED');
  const contract = tool.contract;
  let result: Awaited<ReturnType<typeof ports.tool>>;
  try { result = await ports.tool({ stepId: command.stepId, ordinal: 0, binding: { requiresConfirmation: command.requiresConfirmation },
   snapshot: { native: { ...contract, sandboxReadSafe: safe === true } as ResumableSkillToolRequest['snapshot']['native'],
    policy: contract.policy as ResumableSkillToolRequest['snapshot']['policy'] },
   call: { id: command.operationId, name: command.toolName, arguments: command.input }, signal: context.abortSignal }); guard(); }
  catch (error) { guard(); if (error instanceof SkillError && ['EXECUTION_BUDGET_CALLBACK_FAILED', 'EXECUTION_BUDGET_TIMEOUT'].includes(error.code)) return failed('execution_failed'); throw error; }
  if (result.kind === 'waiting') return checkpoint({ ...host, pendingOperation: { operationId: result.operationId } });
  const validateOutput = compileNativeToolOutput(contract);
  if (validateOutput && !validateOutput(result.result)) return failed('invalid_output');
  return checkpoint({ schemaVersion: 1, kind: 'workflow', workflow: runtime.settle(decision.state,
   { operationId: command.operationId, output: result.result }).state });
 };
}
