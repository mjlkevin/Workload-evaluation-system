import { and, desc, eq } from 'drizzle-orm';
import { db, type Database } from '../../db/client';
import { aiSessions, harnessRuns } from '../../db/schema';
import type { AuthUser } from '../../types';
import { createHarnessRuntimeRepository, HarnessRuntimeError } from '../harness/harness-runtime.repository';
import { BUSINESS_SKILLS_WORKFLOW_ID } from '../harness/business-skills.identity';
import { readBusinessSkillsRun } from '../harness/business-skills.workflow';
import { createBusinessSkillsWaitService } from '../harness/business-skills.wait';
import { createBusinessSkillOperationWaitService } from '../harness/business-skills.operation-wait';
import { createInvocationPgRepository } from './skills.invocation-pg.repository';
import { createExecutionManifestService } from './execution-manifest';
import { createExecutionEmergencyRepository } from './execution-emergency';
import { createSkillInvocationService } from './skills.invocation';
import { createSkillRetryService } from './skills.retry';
import { createExecutionAuthority } from './execution-authority';
import { createExecutionManifestPgRepository } from './execution-manifest-pg.repository';
import { createBusinessExecutionProjectionService } from './skills.workbench-projection';
import { resolveCurrentSkillTools } from './skills.context';
import { SkillError } from './skills.types';
const invalid = (): never => { throw new SkillError('INVOCATION_INVALID_REQUEST', '操作请求无效，请刷新任务后重试', 400); };
const missing = (): never => { throw new SkillError('INVOCATION_NOT_FOUND', '任务或会话不存在', 404); };
function body(value: unknown, keys: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.sort().join(',')) invalid();
  return value as Record<string, any>;
}
type Options = { database?: Database; repo?: ReturnType<typeof createHarnessRuntimeRepository>; inventory?: typeof resolveCurrentSkillTools;
  invocation?: ReturnType<typeof createSkillInvocationService>; retryService?: ReturnType<typeof createSkillRetryService> };
/** HTTP commands carry user input and hashes only. Stored execution state and operation identity stay server-owned. */
export function createBusinessSkillsWorkbenchService(options: Options = {}) {
  const database = options.database ?? db, repo = options.repo ?? createHarnessRuntimeRepository(database);
  const projection = createBusinessExecutionProjectionService(options);
  const wait = createBusinessSkillsWaitService(database), operations = createBusinessSkillOperationWaitService(options);
  const invocation = options.invocation ?? createSkillInvocationService({ queue: repo, repository: createInvocationPgRepository(database),
    authority: createExecutionEmergencyRepository(database), prepareExecution: createExecutionManifestService({ database }).prepareExecution });
  const retryService = options.retryService ?? createSkillRetryService(options);
  async function owned(user: AuthUser, runId: string) {
    if (!/^[a-f0-9-]{36}$/i.test(runId)) return missing();
    const run = await repo.findRunForOwner(runId, user.id); if (!run || run.workflowId !== BUSINESS_SKILLS_WORKFLOW_ID) return missing();
    return run;
  }
  const result = (run: Awaited<ReturnType<typeof owned>>, changed: boolean) => ({ status: changed ? 202 : 200,
    data: { runId: run.harnessRunId, sessionId: run.aiSessionId, status: run.status, eventCursor: run.eventSequence } });
  async function check(user: AuthUser, runId: string) {
    const run = await owned(user, runId), manifest = readBusinessSkillsRun(run);
    await createExecutionAuthority(database, options.inventory).check({ runId, ownerUserId: user.id, manifestHash: manifest.manifestHash, phase: 'resume' });
    return run;
  }
  return {
    submitInvocation: invocation.submitInvocation,
    read: projection.read,
    async isBusinessRun(user: AuthUser, runId: string) {
      if (!/^[a-f0-9-]{36}$/i.test(runId)) return false;
      return (await repo.findRunForOwner(runId, user.id))?.workflowId === BUSINESS_SKILLS_WORKFLOW_ID;
    },
    async inputs(user: AuthUser, runId: string, raw: unknown) {
      const data = body(raw, ['actionId', 'kind', 'stepId', 'contentHash', 'input']); if (data.kind !== 'userInput') invalid();
      const run = await check(user, runId);
      const response = await wait.answer({ runId, sessionId: run.aiSessionId!, requestedBy: user.id, actionId: data.actionId,
        kind: 'userInput', stepId: data.stepId, contentHash: data.contentHash, value: data.input }, user.role);
      return result(response.run, response.created);
    },
    async decision(user: AuthUser, runId: string, actionId: string, decision: 'approve' | 'reject', raw: unknown) {
      if (!['approve', 'reject'].includes(decision)) invalid();
      if (raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'confirmationHash')) {
        const data = body(raw, ['confirmationHash']);
        const response = await operations.answer(user, { runId, actionId, confirmationHash: data.confirmationHash, decision });
        return result(response.run, response.resumed);
      }
      const data = body(raw, ['stepId', 'contentHash']), run = await check(user, runId);
      const response = await wait.answer({ runId, sessionId: run.aiSessionId!, requestedBy: user.id, actionId,
        kind: 'confirmation', stepId: data.stepId, contentHash: data.contentHash, value: { approved: decision === 'approve' } }, user.role);
      return result(response.run, response.created);
    },
    retry: retryService.retryInvocation,
    async listSessionRuns(user: AuthUser, sessionId: string) {
      if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 160) invalid();
      try { return await database.transaction(async tx => {
        const [session] = await tx.select({ owner: aiSessions.ownerUserId }).from(aiSessions).where(eq(aiSessions.sessionId, sessionId)).for('share');
        if (!session || session.owner !== user.id) return missing();
        await createExecutionManifestPgRepository().verifyCaller(tx, user);
        const runs = await tx.select().from(harnessRuns).where(and(eq(harnessRuns.ownerUserId, user.id), eq(harnessRuns.aiSessionId, sessionId),
          eq(harnessRuns.workflowId, BUSINESS_SKILLS_WORKFLOW_ID))).orderBy(desc(harnessRuns.createdAt)).limit(20);
        return runs.map(run => { const manifest = readBusinessSkillsRun(run); return { runId: run.harnessRunId, sessionId,
          status: run.status, title: run.title, hasBusinessExecution: true, kind: manifest.kind,
          target: { id: manifest.target.id, versionId: manifest.target.versionId, name: manifest.target.definition.name },
          createdAt: run.createdAt, updatedAt: run.updatedAt }; });
      }); } catch (error) { if (error instanceof SkillError) throw error; throw new HarnessRuntimeError('BUSINESS_SKILLS_DISCOVERY_UNAVAILABLE'); }
    },
  };
}
export type BusinessSkillsWorkbenchService = ReturnType<typeof createBusinessSkillsWorkbenchService>;
