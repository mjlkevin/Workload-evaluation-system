import { and, desc, eq } from 'drizzle-orm';
import { db, type Database } from '../../db/client';
import { harnessRuns, harnessRunOutputs } from '../../db/schema';
import type { AuthUser } from '../../types';
import type { WorkbenchUnifiedView } from '../harness/workbench-view.usecase';
import { BUSINESS_SKILLS_WORKFLOW_ID } from '../harness/business-skills.identity';
import { createExecutionManifestPgRepository } from './execution-manifest-pg.repository';
import { createBusinessExecutionProjectionService } from './skills.workbench-projection';
import { resolveCurrentSkillTools } from './skills.context';
import { safeBusinessJson } from './skills.workbench-view';
import { skillDefinitionHash as hash } from './skills.hash';
import { SkillError } from './skills.types';
type Options = { database?: Database; inventory?: typeof resolveCurrentSkillTools };
/** Read-only overlay. Run checkpoints and published outputs own these tasks/artifacts; sessions are never modified. */
export function createBusinessWorkbenchViewService(options: Options = {}) {
 const database = options.database ?? db, projection = createBusinessExecutionProjectionService(options);
 return { async extend(user: AuthUser, source: WorkbenchUnifiedView): Promise<WorkbenchUnifiedView> {
  const result = structuredClone(source);
  const runs = await database.transaction(async tx => {
   await createExecutionManifestPgRepository().verifyCaller(tx, user);
   return tx.select().from(harnessRuns).where(and(eq(harnessRuns.ownerUserId, user.id), eq(harnessRuns.workflowId, BUSINESS_SKILLS_WORKFLOW_ID)))
    .orderBy(desc(harnessRuns.updatedAt)).limit(50);
  });
  for (const run of runs) {
   if (!run.aiSessionId || !result.sessions.some(session => session.sessionId === run.aiSessionId)) continue;
   const business = await projection.read(user, run.harnessRunId), sessionId = run.aiSessionId;
   const createdAt = run.createdAt.toISOString(), updatedAt = run.updatedAt.toISOString();
   const item = { runId: run.harnessRunId, sessionId, title: run.title, status: run.status, latestEventKind: `run_${run.status}`,
    hasBusinessExecution: true, businessExecution: { kind: business.kind, target: business.target }, createdAt, updatedAt };
   const index = result.runs.findIndex(row => row.runId === run.harnessRunId);
   if (index < 0) result.runs.push(item); else result.runs[index] = item;
   const input = business.pendingInput, operation = business.pendingOperation;
   if (run.status === 'waiting' && (input || operation)) {
    result.tasks.push({ actionId: (input ?? operation)!.actionId, runId: run.harnessRunId,
     actionType: operation ? 'business_operation' : input!.kind === 'confirmation' ? 'business_confirmation' : 'business_input',
     title: operation ? `确认执行 ${operation.toolName}` : input!.prompt, riskLevel: operation ? 'high' : 'normal',
     status: operation?.status ?? 'pending', sessionId, createdAt: updatedAt });
    result.sessions.find(session => session.sessionId === sessionId)!.pendingActionCount++;
   }
   const [output] = await database.select().from(harnessRunOutputs).where(eq(harnessRunOutputs.harnessRunId, run.harnessRunId));
   if (output?.status === 'final' && business.results.output !== undefined) {
    if (hash(output.content) !== output.contentHash || hash(business.results.output) !== hash(safeBusinessJson(output.content)))
     throw new SkillError('BUSINESS_SKILLS_OUTPUT_INVALID', '任务产物暂不可用，请刷新后重试', 409);
    result.artifacts.push({ artifactId: output.harnessRunOutputId, runId: run.harnessRunId, type: 'business_execution',
     title: `${business.target.name}结果`, status: 'final', sessionId, createdAt: output.createdAt.toISOString() });
    result.sessions.find(session => session.sessionId === sessionId)!.artifactCount++;
   }
   if (run.status === 'failed' && !result.failedRuns.some(row => row.runId === run.harnessRunId))
    result.failedRuns.push({ runId: run.harnessRunId, sessionId, error: '任务执行失败', retriable: run.errorCode !== 'RECOVERY_LIMIT_EXCEEDED' });
  }
  return result;
 } };
}
export type BusinessWorkbenchViewService = ReturnType<typeof createBusinessWorkbenchViewService>;
