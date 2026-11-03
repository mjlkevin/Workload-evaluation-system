import { db, type Database } from '../../db/client';
import type { AuthUser } from '../../types';
import type { RuntimeContext } from '../../agent/context/context.types';
import { legacyRoleToV2Roles } from '../../rbac/roles';
import { getCombinedCapabilities } from '../../rbac/permissions';
import { resolveCurrentSkillTools, skillToolContract } from '../skills/skills.context';
import { createExecutionAuthority, validateFrozenExecutionTools } from '../skills/execution-authority';
import { createExecutionBudgetService } from '../skills/execution-budget';
import type { assertRunAdmissionInTransaction } from '../skills/execution-emergency';
import { prepareFrozenSkillModel } from '../skills/skills.execution-model';
import type { ResumableSkillModelRequest, ResumableSkillToolRequest, ResumableSkillToolResult } from '../skills/skills.execution-resumable';
import type { ExecutionManifest } from '../skills/execution-manifest.types';
import { createSkillOperationService } from '../skills/skills.operations';
import { createSkillOperationDecisionService } from '../skills/skills.operation-decisions';
import { createSkillOperationExecutionService } from '../skills/skills.operation-execution';
import { createSkillLocalTransactionAdapters } from '../skills/skills.local-adapters';
import { skillDefinitionHash as hash } from '../skills/skills.hash';
import { SkillError } from '../skills/skills.types';
import { HarnessWorkflowCancelledError } from './harness-runtime.worker';
import { createBusinessSkillOperationWaitService } from './business-skills.operation-wait';
import { BUSINESS_SKILLS_WORKFLOW_ID } from './business-skills.identity';
export type BusinessSkillHostOptions = { database?: Database; inventory?: typeof resolveCurrentSkillTools; prepareModel?: typeof prepareFrozenSkillModel };
type Scope = BusinessSkillHostOptions & { manifest: ExecutionManifest; runId: string; ownerUserId: string; aiSessionId: string | null;
 identity: Awaited<ReturnType<typeof assertRunAdmissionInTransaction>>['identity']; signal: AbortSignal; pendingOperation?: { operationId: string } };
type ToolRequest = Pick<ResumableSkillToolRequest, 'stepId' | 'ordinal' | 'snapshot' | 'call' | 'signal'>
 & { binding: Pick<ResumableSkillToolRequest['binding'], 'requiresConfirmation'> };
const fail = (code: string): never => { throw new SkillError(code, '技能执行暂不可用，请检查任务和确认内容', 409); };
// Exact live-admission refusals from execution-authority / execution-emergency, including
// the unwrapped codes emitted by the confirmed local-write consumer's preparation fence.
const authorityDenials = new Set(['EXECUTION_AUTHORITY_DENIED', 'EXECUTION_AUTHORITY_CHANGED', 'EXECUTION_EMERGENCY_STOPPED',
 'EXECUTION_MANUAL_RETRY_REQUIRED', 'EXECUTION_RUN_NOT_FOUND', 'EXECUTION_RUN_NOT_ACTIVE',
 'EXECUTION_RUN_BINDING_INVALID', 'EXECUTION_CONTROL_NOT_FOUND']);
/** Shared production dispatch for root Skills, Workflow children and direct tools. All authority uses the physical Run. */
export function createBusinessSkillHostPorts(scope: Scope) {
 const database = scope.database ?? db, inventory = scope.inventory ?? resolveCurrentSkillTools;
 const { manifest, runId, ownerUserId, identity } = scope;
 const user = { ...identity, username: '', businessRole: manifest.caller.businessRole } as AuthUser;
 const authority = createExecutionAuthority(database, inventory), budget = createExecutionBudgetService({ database });
 const operations = createSkillOperationService({ database, inventory }), decisions = createSkillOperationDecisionService({ database, inventory });
 const execution = createSkillOperationExecutionService({ database, inventory, adapters: createSkillLocalTransactionAdapters() });
 const wait = createBusinessSkillOperationWaitService({ database, inventory });
 // Budget still settles conservative failure charges. Preserve only known live denials'
 // identity afterwards so Workflow onFailure cannot turn a revoked grant into a receipt.
 const budgeted: typeof budget.runWithBudget = async (input, callback) => {
  let denied = false;
  try { return await budget.runWithBudget(input, async limits => {
   try { return await callback(limits); }
   catch (error) { denied = error instanceof SkillError && authorityDenials.has(error.code); throw error; }
  }); } catch (error) { if (denied) return fail('EXECUTION_AUTHORITY_DENIED'); throw error; }
 };
 const guard = () => { if (scope.signal.aborted) throw new HarnessWorkflowCancelledError(); };
 const check = (phase: 'resume' | 'model' | 'tool' | 'prepare-tool', stepId?: string, toolName?: string) => authority.check({ runId, ownerUserId,
  manifestHash: manifest.manifestHash, phase, ...(stepId ? { stepId } : {}), ...(toolName ? { toolName } : {}) });
 return {
  check,
  async pendingStatus() {
   if (!scope.pendingOperation) return undefined;
   const view = await decisions.readForConfirmation(user, { runId, operationId: scope.pendingOperation.operationId }); guard(); return view.status;
  },
  pause: (attemptId: string) => wait.pause({ runId, attemptId }),
  complete: (request: ResumableSkillModelRequest) => budgeted({ runId, ownerUserId, kind: 'model', maxOutputTokens: request.model.maxTokens,
   timeoutMs: request.model.timeoutMs, signal: request.signal }, async limits => {
   const prepared = await (scope.prepareModel ?? prepareFrozenSkillModel)(request.skill, limits.signal, { beforeDispatch: () => check('model', request.stepId) });
   const result = await prepared.complete({ ...request, signal: limits.signal,
    model: { ...request.model, maxTokens: limits.maxOutputTokens, timeoutMs: limits.timeoutMs } });
   return { value: result, outputTokens: result.usage?.outputTokens };
  }),
  async tool(request: ToolRequest): Promise<ResumableSkillToolResult> {
   const native = request.snapshot.native;
   const timeoutMs = manifest.skills.find(s => s.stepId === request.stepId)?.definition.model.timeoutMs ?? 30000;
   const confirmation = request.binding.requiresConfirmation || request.snapshot.policy.approvalStrategy === 'user-confirm'
    || native.mutates || native.exfiltrates || native.source === 'mcp';
   if (confirmation) {
    if (!['create_project', 'create_assessment_draft'].includes(native.name) || native.source !== 'code' || !native.mutates || native.exfiltrates || native.simulationOnly) return fail('BUSINESS_SKILLS_OPERATION_UNSUPPORTED');
    await check('prepare-tool', request.stepId, request.call.name); guard();
    const operation = await operations.prepareOperation(user, { runId, stepId: request.stepId, ordinal: request.ordinal,
     toolName: request.call.name, parameters: request.call.arguments });
    if (scope.pendingOperation && operation.operationId !== scope.pendingOperation.operationId) fail('BUSINESS_SKILLS_HOST_STATE_INVALID');
    const view = await decisions.readForConfirmation(user, { runId, operationId: operation.operationId }); guard();
    if (view.status === 'rejected') fail('BUSINESS_SKILLS_OPERATION_REJECTED');
    if (view.status === 'pending') return { kind: 'waiting', operationId: operation.operationId };
    const result = await budgeted({ runId, ownerUserId, kind: 'tool', timeoutMs, signal: request.signal }, async limits => {
     const receipt = await execution.executeOperation(user, { runId, operationId: operation.operationId, confirmationHash: view.confirmationHash },
      { signal: limits.signal, timeoutMs: limits.timeoutMs, deadline: limits.deadline }); return { value: receipt.result };
    });
    return { kind: 'completed', result };
   }
   if (native.source !== 'code' || native.sandboxReadSafe !== true || native.simulationOnly || native.mutates || native.exfiltrates) return fail('BUSINESS_SKILLS_TOOL_UNSUPPORTED');
   await check('tool', request.stepId, request.call.name); guard();
   const result = await budgeted({ runId, ownerUserId, kind: 'tool', timeoutMs, signal: request.signal }, async limits => {
    const current = await inventory(user);
    validateFrozenExecutionTools(manifest, identity, current, { phase: 'tool', stepId: request.stepId, toolName: request.call.name });
    const tool = current.registry.get(request.call.name);
    if (!tool || (tool.source ?? 'code') !== 'code' || tool.sandboxReadSafe !== true || tool.mutates || tool.exfiltrates
     || hash(skillToolContract(tool)) !== hash({ name: native.name, description: native.description, parameters: native.parameters,
      mutates: native.mutates, exfiltrates: Boolean(native.exfiltrates), simulationOnly: native.simulationOnly,
      ...(native.outputSchema !== undefined ? { outputSchema: native.outputSchema } : {}) })) return fail('BUSINESS_SKILLS_TOOL_UNSUPPORTED');
    await check('tool', request.stepId, request.call.name);
    if (limits.signal.aborted) throw new HarnessWorkflowCancelledError();
    const roles = legacyRoleToV2Roles(user.role);
    const runtime: RuntimeContext = { requestId: `${runId}:${request.stepId}:${request.ordinal}`, traceId: runId,
     actor: { userId: ownerUserId, roles, capabilities: getCombinedCapabilities(roles) }, channel: 'api',
     workflowKey: BUSINESS_SKILLS_WORKFLOW_ID, harnessRunId: runId,
     ...(scope.aiSessionId ? { aiSessionId: scope.aiSessionId } : {}) };
    const value = await tool.execute(request.call.arguments as Record<string, unknown>, { id: ownerUserId, roles, capabilities: [tool.capability] }, runtime);
    return { value };
   });
   return { kind: 'completed', result };
  },
 };
}
