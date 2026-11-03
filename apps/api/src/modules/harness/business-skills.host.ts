import { isDeepStrictEqual } from 'node:util';
import { db, type Database } from '../../db/client';
import type { AuthUser } from '../../types';
import { legacyRoleToV2Roles } from '../../rbac/roles';
import { resolveCurrentSkillTools, skillToolContract } from '../skills/skills.context';
import { createExecutionAuthority, validateFrozenExecutionTools } from '../skills/execution-authority';
import { assertRunAdmissionInTransaction } from '../skills/execution-emergency';
import { createExecutionBudgetService } from '../skills/execution-budget';
import { prepareFrozenSkillModel } from '../skills/skills.execution-model';
import { createResumableSkillExecutor } from '../skills/skills.execution-resumable';
import { createSkillOperationService } from '../skills/skills.operations';
import { createSkillOperationDecisionService } from '../skills/skills.operation-decisions';
import { createSkillOperationExecutionService } from '../skills/skills.operation-execution';
import { createSkillLocalTransactionAdapters } from '../skills/skills.local-adapters';
import { skillDefinitionHash as hash } from '../skills/skills.hash';
import { SkillError } from '../skills/skills.types';
import { lockRunRow } from './harness-runtime.repository';
import { HarnessWorkflowCancelledError, HarnessWorkflowWaitingError } from './harness-runtime.worker';
import type { BusinessSkillsExecutor } from './business-skills.workflow';
import { businessSkillOperationId, type BusinessSkillsHostState } from './business-skills.host-state';
import { assertBusinessSkillAttemptInTransaction, createBusinessSkillOperationWaitService, readBusinessSkillHostCheckpointInTransaction } from './business-skills.operation-wait';
type Options = { database?: Database; inventory?: typeof resolveCurrentSkillTools; prepareModel?: typeof prepareFrozenSkillModel };
const fail = (code: string): never => { throw new SkillError(code, '技能执行暂不可用，请检查任务和确认内容', 409); };
/** One Worker tick advances one saved Skill cursor. Trusted ports cannot replace live authority or durable budget. */
export function createBusinessSkillHost(options: Options = {}): BusinessSkillsExecutor {
  const database = options.database ?? db, inventory = options.inventory ?? resolveCurrentSkillTools;
  const budget = createExecutionBudgetService({ database }), operations = createSkillOperationService({ database, inventory });
  const decisions = createSkillOperationDecisionService({ database, inventory });
  const execution = createSkillOperationExecutionService({ database, inventory, adapters: createSkillLocalTransactionAdapters() });
  const wait = createBusinessSkillOperationWaitService({ database, inventory });
  return async ({ manifest, state: supplied, context }) => {
    const runId = context.run.harnessRunId, ownerUserId = context.run.ownerUserId;
    const guard = () => { if (context.abortSignal.aborted) throw new HarnessWorkflowCancelledError(); }; guard();
    const locked = await database.transaction(async tx => {
      const run = await lockRunRow(tx, runId);
      if (run.ownerUserId !== ownerUserId || run.status !== 'running' || run.cancelRequestedAt) fail('BUSINESS_SKILLS_HOST_RUN_INVALID');
      await assertBusinessSkillAttemptInTransaction(tx, run, context.attempt.harnessRunAttemptId);
      const admission = await assertRunAdmissionInTransaction(tx, runId, ownerUserId);
      const current = await readBusinessSkillHostCheckpointInTransaction(tx, run);
      if (hash(admission.manifest) !== hash(manifest) || !isDeepStrictEqual(supplied, current.raw ?? {})) fail('BUSINESS_SKILLS_HOST_STATE_INVALID');
      return { ...current, identity: admission.identity };
    });
    if (manifest.kind !== 'skill' || manifest.skills.length !== 1) fail('BUSINESS_SKILLS_HOST_KIND_UNSUPPORTED');
    const authority = createExecutionAuthority(database, inventory);
    const check = (phase: 'resume' | 'model' | 'tool' | 'prepare-tool', stepId?: string, toolName?: string) => authority.check({ runId, ownerUserId,
      manifestHash: manifest.manifestHash, phase, ...(stepId ? { stepId } : {}), ...(toolName ? { toolName } : {}) });
    await check('resume'); guard();
    const user = { ...locked.identity, username: '', businessRole: manifest.caller.businessRole } as AuthUser;
    const host: BusinessSkillsHostState = locked.state ?? { schemaVersion: 1, kind: 'skill' };
    if (host.pendingOperation) {
      const view = await decisions.readForConfirmation(user, { runId, operationId: host.pendingOperation.operationId }); guard();
      if (view.status === 'rejected') fail('BUSINESS_SKILLS_OPERATION_REJECTED');
      if (view.status === 'pending') {
        await wait.pause({ runId, attemptId: context.attempt.harnessRunAttemptId });
        throw new HarnessWorkflowWaitingError();
      }
    }
    const skill = manifest.skills[0];
    const executor = createResumableSkillExecutor({
      complete: request => budget.runWithBudget({ runId, ownerUserId, kind: 'model', maxOutputTokens: request.model.maxTokens,
        timeoutMs: request.model.timeoutMs, signal: request.signal }, async limits => {
        const prepared = await (options.prepareModel ?? prepareFrozenSkillModel)(request.skill, limits.signal,
          { beforeDispatch: () => check('model', request.stepId) });
        const result = await prepared.complete({ ...request, signal: limits.signal,
          model: { ...request.model, maxTokens: limits.maxOutputTokens, timeoutMs: limits.timeoutMs } });
        return { value: result, outputTokens: result.usage?.outputTokens };
      }),
      async tool(request) {
        const native = request.snapshot.native;
        const confirmation = request.binding.requiresConfirmation || request.snapshot.policy.approvalStrategy === 'user-confirm'
          || native.mutates || native.exfiltrates || native.source === 'mcp';
        if (confirmation) {
          // A local explicit adapter is the sole supported write path; general Native dispatch stays denied.
          if (native.name !== 'create_project' || native.source !== 'code' || !native.mutates || native.exfiltrates
            || native.simulationOnly) return fail('BUSINESS_SKILLS_OPERATION_UNSUPPORTED');
          await check('prepare-tool', request.stepId, request.call.name); guard();
          const operation = await operations.prepareOperation(user, { runId, stepId: request.stepId, ordinal: request.ordinal,
            toolName: request.call.name, parameters: request.call.arguments });
          if (host.pendingOperation && operation.operationId !== host.pendingOperation.operationId) fail('BUSINESS_SKILLS_HOST_STATE_INVALID');
          const view = await decisions.readForConfirmation(user, { runId, operationId: operation.operationId }); guard();
          if (view.status === 'rejected') fail('BUSINESS_SKILLS_OPERATION_REJECTED');
          if (view.status === 'pending') return { kind: 'waiting', operationId: operation.operationId };
          const result = await budget.runWithBudget({ runId, ownerUserId, kind: 'tool', timeoutMs: skill.definition.model.timeoutMs, signal: request.signal }, async limits => {
            const receipt = await execution.executeOperation(user, { runId, operationId: operation.operationId, confirmationHash: view.confirmationHash },
              { signal: limits.signal, timeoutMs: limits.timeoutMs, deadline: limits.deadline });
            return { value: receipt.result };
          });
          return { kind: 'completed', result };
        }
        if (native.source !== 'code' || native.sandboxReadSafe !== true || native.simulationOnly || native.mutates || native.exfiltrates) return fail('BUSINESS_SKILLS_TOOL_UNSUPPORTED');
        await check('tool', request.stepId, request.call.name); guard();
        const result = await budget.runWithBudget({ runId, ownerUserId, kind: 'tool', timeoutMs: skill.definition.model.timeoutMs, signal: request.signal }, async limits => {
          const current = await inventory(user);
          validateFrozenExecutionTools(manifest, locked.identity, current, { phase: 'tool', stepId: request.stepId, toolName: request.call.name });
          const tool = current.registry.get(request.call.name);
          if (!tool || (tool.source ?? 'code') !== 'code' || tool.sandboxReadSafe !== true || tool.mutates || tool.exfiltrates
            || hash(skillToolContract(tool)) !== hash({ name: native.name, description: native.description, parameters: native.parameters,
              mutates: native.mutates, exfiltrates: Boolean(native.exfiltrates), simulationOnly: native.simulationOnly })) return fail('BUSINESS_SKILLS_TOOL_UNSUPPORTED');
          await check('tool', request.stepId, request.call.name);
          if (limits.signal.aborted) throw new HarnessWorkflowCancelledError();
          const value = await tool.execute(request.call.arguments as Record<string, unknown>, { id: ownerUserId, roles: legacyRoleToV2Roles(user.role), capabilities: [tool.capability] });
          return { value };
        });
        return { kind: 'completed', result };
      },
    });
    const advanced = await executor.advance({ runId: locked.chain.root, ownerUserId, manifest, input: manifest.initialInput, stepId: skill.stepId,
      operationId: businessSkillOperationId(locked.chain.root, manifest.manifestHash, skill.stepId), iteration: 0,
      ...(host.skill ? { state: host.skill } : {}), signal: context.abortSignal }); guard();
    const next: BusinessSkillsHostState = { schemaVersion: 1, kind: 'skill', skill: advanced.state,
      ...(advanced.pendingOperation ? { pendingOperation: { operationId: advanced.pendingOperation.operationId } } : {}) };
    return { nextStepKey: advanced.kind === 'completed' ? null : 'execute', state: next,
      checkpoint: { key: `host:${hash(next)}`, kind: 'structural', resumePolicy: 'restart_step' },
      ...(advanced.kind === 'completed' ? { output: { status: 'final' as const, content: advanced.output as Record<string, unknown>, contentHash: hash(advanced.output) } } : {}) };
  };
}
