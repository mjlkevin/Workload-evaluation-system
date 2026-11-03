import { and, eq } from 'drizzle-orm';
import { db, type Database } from '../../db/client';
import { aiSessions, harnessToolEvents } from '../../db/schema';
import type { AuthUser } from '../../types';
import { createExecutionManifestPgRepository } from './execution-manifest-pg.repository';
import { resolveCurrentSkillTools } from './skills.context';
import { createExecutionBudgetService } from './execution-budget';
import { buildBusinessExecutionView, safeBusinessJson } from './skills.workbench-view';
import { SkillError } from './skills.types';
import { HarnessRuntimeError, lockRunRow } from '../harness/harness-runtime.repository';
import { readBusinessSkillHostCheckpointInTransaction, createBusinessSkillOperationWaitService } from '../harness/business-skills.operation-wait';
import { businessSkillsWaitDescriptor, type BusinessSkillsWaitCommand } from '../harness/business-skills.wait';
import { createWorkflowRuntime } from '../harness/workflows.runtime-adapter';
const fail = (status = 409): never => { throw new SkillError('BUSINESS_SKILLS_PROJECTION_UNAVAILABLE', '任务信息暂不可用，请刷新后重试', status); };
type Options = { database?: Database; inventory?: typeof resolveCurrentSkillTools };
/** The checkpoint is the sole progress authority. Tool history is an audit-only result projection, never an approval. */
export function createBusinessExecutionProjectionService(options: Options = {}) {
  const database = options.database ?? db, identity = createExecutionManifestPgRepository();
  const operationWait = createBusinessSkillOperationWaitService({ database, inventory: options.inventory });
  return { async read(user: AuthUser, runId: string) {
    try {
      if (!/^[a-f0-9-]{36}$/i.test(runId)) fail(404);
      const current = await database.transaction(async tx => {
        const run = await lockRunRow(tx, runId);
        if (run.ownerUserId !== user.id) fail(404);
        const [session] = await tx.select({ owner: aiSessions.ownerUserId }).from(aiSessions).where(eq(aiSessions.sessionId, run.aiSessionId!)).for('share');
        if (!session || session.owner !== user.id) fail(404);
        await identity.verifyCaller(tx, user);
        const saved = await readBusinessSkillHostCheckpointInTransaction(tx, run);
        const effects = await tx.select({ toolName: harnessToolEvents.toolName, output: harnessToolEvents.output }).from(harnessToolEvents)
          .where(and(eq(harnessToolEvents.harnessRunId, saved.chain.root), eq(harnessToolEvents.eventType, 'business_operation_executed'), eq(harnessToolEvents.status, 'succeeded')));
        return { run, ...saved, effects };
      });
      const view = buildBusinessExecutionView(current.manifest, current.state);
      const budget = await createExecutionBudgetService({ database }).readBudget(user.id, runId);
      const { rootRunId: _root, ...safeBudget } = budget;
      const active = ['queued', 'running', 'waiting', 'recovering'].includes(current.run.status) && !current.run.cancelRequestedAt;
      let pendingInput: ReturnType<typeof businessSkillsWaitDescriptor> | undefined;
      let pendingOperation: { actionId: string; operationId: string; stepId: string; toolName: string; parameters: unknown; confirmationHash: string; status: string } | undefined;
      if (active && current.state?.pendingOperation) {
        const operation = await operationWait.read(user, runId);
        pendingOperation = { actionId: operation.actionId, operationId: operation.operationId, stepId: operation.stepId,
          toolName: operation.toolName, parameters: safeBusinessJson(operation.parameters), confirmationHash: operation.confirmationHash, status: operation.status };
      } else if (active && current.manifest.kind === 'workflow') {
        const decision = createWorkflowRuntime(current.manifest, current.chain.root).next(current.state?.workflow);
        if (current.run.status === 'waiting' && decision.kind === 'ready' && ['userInput', 'confirmation'].includes(decision.command.type))
          pendingInput = safeBusinessJson(businessSkillsWaitDescriptor(current.run, decision.command as BusinessSkillsWaitCommand));
      }
      for (const effect of current.effects) {
        const output = effect.output as Record<string, unknown> | null;
        if (!output || output.schemaVersion !== 1 || !Object.prototype.hasOwnProperty.call(output, 'result') || Object.keys(output).length !== 2) fail();
        const result = safeBusinessJson(output!.result);
        if (!view.results.effects.some(item => item.toolName === effect.toolName && JSON.stringify(item.result) === JSON.stringify(result)))
          view.results.effects.push({ toolName: effect.toolName, result });
      }
      if (current.run.status === 'waiting' && view.currentStep) view.currentStep.status = 'waiting';
      return { ...view, budget: safeBudget, ...(pendingInput ? { pendingInput } : {}), ...(pendingOperation ? { pendingOperation } : {}) };
    } catch (error) {
      if (error instanceof SkillError) throw error;
      if (error instanceof HarnessRuntimeError && error.code === 'HARNESS_RUN_NOT_FOUND') return fail(404);
      return fail();
    }
  } };
}
