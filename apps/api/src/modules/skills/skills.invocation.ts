import type { FrozenSourceMaterial } from './mvp/execution-assets';
import type { AuthUser } from '../../types';
import { createHarnessRuntimeRepository, HarnessRuntimeError, attachWorkbenchConversationFact, buildWorkbenchUserMessageFact,
  BUSINESS_SKILLS_WORKFLOW_ID, BUSINESS_SKILLS_WORKFLOW_VERSION, type HarnessRuntimeRepository, type AiRunsSubmitResult, type QueueDbExecutor } from '../harness/harness.module';
import { prepareExecution, validateExecutionRequest } from './execution-manifest';
import type { PreparedExecution, SourceReference } from './execution-manifest.types';
import { skillDefinitionHash as hash } from './skills.hash';
import { copyTrialJson } from './skills.sandbox';
import { SkillError } from './skills.types';
import { createInvocationPgRepository } from './skills.invocation-pg.repository';
import { createExecutionEmergencyRepository, type InvocationEmergencyAuthority, type ExecutionAuthorityBinding } from './execution-emergency';

export interface InvocationRepository {
  prepare(user: AuthUser, sessionId: string, sources: SourceReference[]): Promise<{ sourceMaterials?: FrozenSourceMaterial[]; verify(tx: QueueDbExecutor): Promise<void> }>;
}
type Options = {
  repository?: InvocationRepository;
  queue?: Pick<HarnessRuntimeRepository, 'createQueuedRun' | 'findRunForSubmissionKey'>;
  prepareExecution?: typeof prepareExecution;
  authority?: InvocationEmergencyAuthority;
};
const errors: Record<string, [number, string]> = {
  INVOCATION_INVALID_REQUEST: [400, '调用请求无效，请检查输入'],
  INVOCATION_NOT_FOUND: [404, '资源不存在'],
  INVOCATION_FORBIDDEN: [403, '当前权限已变化，请重新读取'],
  INVOCATION_SOURCE_UNAVAILABLE: [409, '原始来源材料不可用，请重新上传或选择会话原文'],
  INVOCATION_SOURCE_CHANGED: [409, '来源材料已变化，请重新读取后重试'],
  INVOCATION_CONTEXT_CHANGED: [409, '执行定义或配置已变化，请重新读取后重试'],
  SUBMISSION_KEY_CONFLICT: [409, '该提交标识已用于其他请求'],
  ACTIVE_WORKBENCH_RUN_EXISTS: [409, '该会话存在进行中的异步任务'],
  INVOCATION_TOO_LARGE: [422, '调用内容过长，本次提交已整体回滚'],
  INVOCATION_INTERNAL: [500, '调用暂时不可用'],
  EXECUTION_EMERGENCY_STOPPED: [409, '技能或流程已被管理员紧急停止'],
  EXECUTION_MANUAL_RETRY_REQUIRED: [409, '任务曾被紧急停止，请手动重新发起'],
  EXECUTION_RUN_BINDING_INVALID: [409, '执行任务权限绑定无效'],
  EXECUTION_AUTHORITY_UNAVAILABLE: [503, '执行权限暂不可用'],
};
function fail(code: string): never {
  const [status, message] = errors[code]; throw new SkillError(code, message, status);
}
function errorCode(error: unknown): string {
  const code = error instanceof SkillError || error instanceof HarnessRuntimeError ? error.code : '';
  if (Object.prototype.hasOwnProperty.call(errors, code)) return code;
  if (code === 'HARNESS_RUNTIME_PAYLOAD_TOO_LARGE') return 'INVOCATION_TOO_LARGE';
  if (['EXECUTION_FORBIDDEN', 'EXECUTION_AUTHORITY_CHANGED'].includes(code)) return 'INVOCATION_FORBIDDEN';
  if (code === 'EXECUTION_SOURCE_UNAVAILABLE') return 'INVOCATION_SOURCE_UNAVAILABLE';
  if (['EXECUTION_UNAVAILABLE', 'EXECUTION_CONTEXT_CHANGED', 'SKILL_CONTEXT_CHANGED', 'EXECUTION_REFERENCE_UNAVAILABLE', 'EXECUTION_ASSET_UNAVAILABLE'].includes(code)) return 'INVOCATION_CONTEXT_CHANGED';
  if (['EXECUTION_INVALID_REQUEST', 'EXECUTION_INPUT_SCHEMA_FAILED'].includes(code)) return 'INVOCATION_INVALID_REQUEST';
  return 'INVOCATION_INTERNAL';
}
async function queueCheck<T>(call: () => Promise<T>): Promise<T> {
  try { return await call(); } catch (error) { throw new HarnessRuntimeError(errorCode(error)); }
}
function parse(body: unknown, sessionId: string) {
  try {
    const value = copyTrialJson(body, 'definition') as Record<string, unknown>;
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !['submissionKey', 'content', 'execution'].includes(key))
      || typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 160
      || typeof value.submissionKey !== 'string' || !value.submissionKey.trim() || value.submissionKey.length > 160
      || typeof value.content !== 'string' || !value.content.trim()) fail('INVOCATION_INVALID_REQUEST');
    return { submissionKey: value.submissionKey, content: value.content.trim(), execution: validateExecutionRequest(value.execution) };
  } catch { return fail('INVOCATION_INVALID_REQUEST'); }
}
/** Internal only. No HTTP route or Worker registration is installed by this service. */
export function createSkillInvocationService(options: Options = {}) {
  const repository = options.repository ?? createInvocationPgRepository();
  const queue = options.queue ?? createHarnessRuntimeRepository();
  const authority = options.authority ?? createExecutionEmergencyRepository();
  return { async submitInvocation(initialUser: AuthUser, sessionId: string, body: unknown): Promise<AiRunsSubmitResult> {
    try {
      const user = structuredClone(initialUser);
      const request = parse(body, sessionId);
      const execution = { ...request.execution, sources: request.execution.sources ?? [] };
      const fingerprint = hash({ sessionId, content: request.content, execution });
      const sources = await repository.prepare(user, sessionId, execution.sources);
      const existing = await queue.findRunForSubmissionKey(user.id, request.submissionKey);
      let prepared: PreparedExecution | undefined;
      let baseline: ExecutionAuthorityBinding[] | undefined;
      if (!existing) {
        try { baseline = await authority.prepare(execution, user); prepared = await (options.prepareExecution ?? prepareExecution)(execution, user, sources.sourceMaterials ? { sourceMaterials: sources.sourceMaterials } : undefined); }
        catch (error) {
          // A concurrent submit can commit after our first miss, then become unavailable to new calls.
          // Only the queue's locked replay path may reuse it; authority, sources and fingerprint still apply.
          if (!await queue.findRunForSubmissionKey(user.id, request.submissionKey)) throw error;
        }
      }
      const { fact, executionConfig } = attachWorkbenchConversationFact({ content: request.content });
      const result = await queue.createQueuedRun({ ownerUserId: user.id, ownerUsername: user.username, aiSessionId: sessionId,
        submissionKey: request.submissionKey, submissionFingerprint: fingerprint, title: request.content.slice(0, 80),
        workflowId: BUSINESS_SKILLS_WORKFLOW_ID, workflowVersion: BUSINESS_SKILLS_WORKFLOW_VERSION,
        validateSubmission: tx => queueCheck(async () => { await sources.verify(tx); await authority.verifyReplay(tx, user, sessionId, request.submissionKey, fingerprint); }),
        resolveExecutionConfig: tx => queueCheck(async () => {
          if (!prepared || !baseline) fail('INVOCATION_CONTEXT_CHANGED');
          const manifest = await prepared.resolveInTransaction(tx);
          return { ...executionConfig, executionManifest: manifest, executionAuthority: await authority.capture(tx, manifest, user, baseline) };
        }),
        userMessageFact: runId => buildWorkbenchUserMessageFact({ runId, fact, content: request.content }),
      });
      return { status: 202, data: { runId: result.run.harnessRunId, sessionId: result.run.aiSessionId!,
        status: result.run.status, eventCursor: result.run.eventSequence } };
    } catch (error) { return fail(errorCode(error)); }
  } };
}
export const submitInvocation = (user: AuthUser, sessionId: string, body: unknown) => createSkillInvocationService().submitInvocation(user, sessionId, body);
