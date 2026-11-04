import { db, type Database } from '../../db/client';
import type { AuthUser } from '../../types';
import { createHarnessRuntimeRepository, HarnessRuntimeError, attachWorkbenchConversationFact, buildWorkbenchUserMessageFact,
  BUSINESS_SKILLS_WORKFLOW_ID, BUSINESS_SKILLS_WORKFLOW_VERSION, type HarnessTx } from '../harness/harness.module';
import { createExecutionEmergencyRepository } from './execution-emergency';
import { createInvocationPgRepository } from './skills.invocation-pg.repository';
import { prepareBusinessRetryCheckpoint } from './skills.retry-checkpoint';
import { prepareSkillAuthority } from './skills.authority';
import { resolveCurrentSkillTools } from './skills.context';
import { validateFrozenExecutionTools } from './execution-authority';
import { prepareFrozenSkillModel } from './skills.execution-model';
import { skillDefinitionHash as hash } from './skills.hash';
import { SkillError } from './skills.types';
const invalid = (): never => { throw new SkillError('INVOCATION_INVALID_REQUEST', '重试请求无效', 400); };
const conflict = (): never => { throw new SkillError('SUBMISSION_KEY_CONFLICT', '该提交标识已用于其他请求', 409); };
type Options = { database?: Database; inventory?: typeof resolveCurrentSkillTools; prepareModel?: typeof prepareFrozenSkillModel;
  queue?: ReturnType<typeof createHarnessRuntimeRepository> };
/** Internal manual command only. Ports are trusted assembly dependencies, never request fields. */
export function createSkillRetryService(options: Options = {}) {
  const database = options.database ?? db, queue = options.queue ?? createHarnessRuntimeRepository(database);
  const authority = createExecutionEmergencyRepository(database);
  return { async retryInvocation(initialUser: AuthUser, sourceRunId: string, body: unknown) {
    try {
      if (!body || typeof body !== 'object' || Array.isArray(body)) invalid();
      const request = body as Record<string, unknown>;
      if (Object.keys(request).some(k => !['submissionKey', 'reason'].includes(k)) || typeof request.submissionKey !== 'string'
        || !request.submissionKey.trim() || request.submissionKey.length > 160 || typeof request.reason !== 'string'
        || !request.reason.trim() || request.reason.trim().length > 1000 || !/^[a-f0-9-]{36}$/i.test(sourceRunId)) invalid();
      sourceRunId = sourceRunId.toLowerCase();
      const user = structuredClone(initialUser), submissionKey = request.submissionKey as string, reason = (request.reason as string).trim();
      const source = await authority.prepareRetry(sourceRunId, user.id, submissionKey);
      if (source.identity.role !== user.role || user.status !== 'active') throw new SkillError('INVOCATION_FORBIDDEN', '当前权限已变化', 403);
      const { run, manifest } = source, sessionId = run.aiSessionId!;
      const checkpoint = await prepareBusinessRetryCheckpoint(database, sourceRunId, user.id, manifest);
      const fingerprint = (run.metadata as Record<string, unknown>).invocationFingerprint as string;
      const retryRequestHash = hash({ sourceRunId, sessionId, fingerprint, reason });
      const existing = await queue.findRunForSubmissionKey(user.id, submissionKey);
      const assertIntent = (saved: typeof run) => {
        if (saved.retryOfRunId !== sourceRunId || saved.aiSessionId !== sessionId || (saved.metadata as Record<string, unknown>)?.retryRequestHash !== retryRequestHash) conflict();
      };
      if (existing) assertIntent(existing);
      const sources = await createInvocationPgRepository(database).prepare(user, sessionId, manifest.sources);
      // No connection is retained across inventory/model preparation; current configuration is fenced afterwards.
      const prepared = !existing ? await prepareSkillAuthority([], async () => {
        const inventory = await (options.inventory ?? resolveCurrentSkillTools)({ ...user, ...source.identity, businessRole: manifest.caller.businessRole } as AuthUser);
        validateFrozenExecutionTools(manifest, source.identity, inventory);
        for (const skill of manifest.skills) await (options.prepareModel ?? prepareFrozenSkillModel)(skill, new AbortController().signal);
      }, database) : undefined;
      const { fact, executionConfig } = attachWorkbenchConversationFact({ content: (run.executionConfig as Record<string, unknown>).content });
      const check = async <T>(work: () => Promise<T>): Promise<T> => {
        try { return await work(); } catch (e) {
          const code = e instanceof SkillError ? e.code : 'INVOCATION_INTERNAL';
          throw new HarnessRuntimeError(['SKILL_CONTEXT_CHANGED', 'EXECUTION_REFERENCE_UNAVAILABLE'].includes(code) ? 'INVOCATION_CONTEXT_CHANGED' : code);
        }
      };
      const created = await queue.createQueuedRun({ ownerUserId: user.id, ownerUsername: user.username, aiSessionId: sessionId,
        submissionKey, submissionFingerprint: fingerprint, workflowId: BUSINESS_SKILLS_WORKFLOW_ID, workflowVersion: BUSINESS_SKILLS_WORKFLOW_VERSION,
        title: run.title, retryOfRunId: sourceRunId, metadata: { retryRequestHash, retryActorId: user.id, retryReason: reason, ...(checkpoint.proof ? { retrySourceCheckpoint: checkpoint.proof } : {}) },
        validateSubmission: tx => check(async () => {
          await sources.verify(tx);
          await checkpoint.verify(tx as HarnessTx);
          const current = await authority.verifyRetry(tx, sourceRunId, user.id, submissionKey);
          if (hash(current) !== hash({ runId: source.runId, manifest, identity: source.identity, run }))
            throw new SkillError('INVOCATION_CONTEXT_CHANGED', '准备期间原任务或权限已变化', 409);
          // The locked queue replay checks the saved epoch without ever refreshing it.
          await authority.verifyReplay(tx, user, sessionId, submissionKey, fingerprint);
        }),
        resolveExecutionConfig: tx => check(async () => {
          if (!prepared) conflict();
          await prepared!.verify(tx);
          return { ...executionConfig, executionManifest: manifest, executionAuthority: await authority.capture(tx, manifest, user, source.bindings) };
        }),
        initializeRun: (tx, newRun) => check(() => checkpoint.initialize(tx, newRun)),
        userMessageFact: runId => buildWorkbenchUserMessageFact({ runId, fact, content: String(executionConfig.content) }),
      });
      return { status: 202 as const, data: { runId: created.run.harnessRunId, sessionId, status: created.run.status, eventCursor: created.run.eventSequence, retryOfRunId: sourceRunId } };
    } catch (e) {
      if (e instanceof SkillError) throw e;
      const code = e instanceof HarnessRuntimeError ? e.code : 'INVOCATION_INTERNAL';
      const allowed = ['SUBMISSION_KEY_CONFLICT', 'ACTIVE_WORKBENCH_RUN_EXISTS', 'EXECUTION_EMERGENCY_STOPPED', 'EXECUTION_MANUAL_RETRY_REQUIRED', 'EXECUTION_RUN_BINDING_INVALID', 'INVOCATION_CONTEXT_CHANGED', 'INVOCATION_SOURCE_CHANGED', 'INVOCATION_FORBIDDEN', 'INVOCATION_NOT_FOUND'];
      throw new SkillError(allowed.includes(code) ? code : 'INVOCATION_INTERNAL', '重试暂不可用，请检查权限和任务状态', code === 'INVOCATION_NOT_FOUND' ? 404 : code === 'INVOCATION_FORBIDDEN' ? 403 : allowed.includes(code) ? 409 : 500);
    }
  } };
}
export const retryInvocation = (user: AuthUser, sourceRunId: string, body: unknown) => createSkillRetryService().retryInvocation(user, sourceRunId, body);
