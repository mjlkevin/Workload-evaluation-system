import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, type Database } from '../../db/client';
import { readDbNow } from '../../db/now';
import { aiSessions, executionEmergencyAudits as audits, harnessRuns, skillDefinitions, skillVersions, workflowDefinitions, workflowVersions, users } from '../../db/schema';
import { isBusinessRole, resolveBusinessRole } from '../../middleware/auth';
import { BUSINESS_SKILLS_WORKFLOW_ID, BUSINESS_SKILLS_WORKFLOW_VERSION, type QueueDbExecutor } from '../harness/harness.module';
import type { AuthUser } from '../../types';
import type { ExecutionManifest, ExecutionRequest } from './execution-manifest.types';
import { readPersistedExecutionManifest } from './execution-manifest';
import { createExecutionManifestPgRepository } from './execution-manifest-pg.repository';
import { skillDefinitionHash as hash } from './skills.hash';
import { SkillError } from './skills.types';
export type EmergencyKind = 'skill' | 'workflow';
export type ExecutionAuthorityBinding = { kind: EmergencyKind; id: string; epoch: number };
export interface InvocationEmergencyAuthority {
  prepare(request: ExecutionRequest, user: AuthUser): Promise<ExecutionAuthorityBinding[]>;
  capture(tx: QueueDbExecutor, manifest: ExecutionManifest, user: AuthUser, baseline: ExecutionAuthorityBinding[]): Promise<ExecutionAuthorityBinding[]>;
  verifyReplay(tx: QueueDbExecutor, user: AuthUser, sessionId: string, key: string, fingerprint: string): Promise<void>;
}
const failure = (code: string, message: string, status = 409): never => { throw new SkillError(code, message, status); };
const safe = (error: unknown): never => { throw error instanceof SkillError ? error : new SkillError('EXECUTION_AUTHORITY_UNAVAILABLE', '执行权限暂不可用', 503); };
function target(kind: EmergencyKind, id: string) {
  if (!['skill', 'workflow'].includes(kind) || typeof id !== 'string' || !id || id.length > 160) failure('EXECUTION_CONTROL_INVALID', '紧急控制请求无效', 400);
  const table = kind === 'skill' ? skillDefinitions : workflowDefinitions;
  const key = kind === 'skill' ? skillDefinitions.skillId : workflowDefinitions.workflowId;
  return { table, where: eq(key, id) };
}
async function root(tx: QueueDbExecutor, kind: EmergencyKind, id: string, lock: 'share' | 'update') {
  const { table, where } = target(kind, id);
  const [control] = await tx.select({ stopped: table.emergencyStopped, epoch: table.emergencyEpoch, revision: table.emergencyRevision, enabled: table.enabled, archived: table.archived }).from(table).where(where).for(lock);
  if (!control) return failure('EXECUTION_CONTROL_NOT_FOUND', '技能或流程不存在', 404);
  return control;
}
async function currentUser(tx: QueueDbExecutor, userId: string) {
  const [user] = await tx.select({ id: users.userId, role: users.role, businessRole: users.businessRole, status: users.status }).from(users).where(eq(users.userId, userId)).for('share');
  if (!user || user.status !== 'active') return failure('EXECUTION_AUTHORITY_CHANGED', '当前用户权限已变化', 403);
  return user;
}
async function admin(tx: QueueDbExecutor, user: AuthUser) {
  const current = await currentUser(tx, user.id);
  if (current.role !== 'admin' || user.role !== 'admin') failure('EXECUTION_CONTROL_FORBIDDEN', '仅管理员可紧急停止或解除', 403);
}
function references(manifest: ExecutionManifest): Array<Omit<ExecutionAuthorityBinding, 'epoch'>> {
  const skills = [...new Set(manifest.skills.map(s => s.skillId))].sort().map(id => ({ kind: 'skill' as const, id }));
  return manifest.kind === 'workflow' ? [{ kind: 'workflow', id: manifest.target.id }, ...skills] : skills;
}
function authorize(manifest: ExecutionManifest, current: Awaited<ReturnType<typeof currentUser>>) {
  const role = resolveBusinessRole({ role: current.role, businessRole: isBusinessRole(current.businessRole) ? current.businessRole : undefined });
  if (manifest.caller.id !== current.id || manifest.caller.businessRole !== role || !manifest.target.definition.roles.includes(role)
    || manifest.skills.some(s => !s.definition.roles.includes(role))) failure('EXECUTION_AUTHORITY_CHANGED', '当前用户权限已变化', 403);
}
async function capture(tx: QueueDbExecutor, manifest: ExecutionManifest, user: AuthUser) {
  authorize(manifest, await currentUser(tx, user.id));
  const bindings: ExecutionAuthorityBinding[] = [];
  for (const reference of references(manifest)) {
    const control = await root(tx, reference.kind, reference.id, 'share');
    if (control.stopped) failure('EXECUTION_EMERGENCY_STOPPED', '技能或流程已被管理员紧急停止');
    bindings.push({ ...reference, epoch: control.epoch });
  }
  return bindings;
}
type Run = typeof harnessRuns.$inferSelect;
async function verifyRun(tx: QueueDbExecutor, run: Run, ownerUserId: string, retry: false | 'new' | 'replay' = false) {
  if (run.ownerUserId !== ownerUserId || run.runKind !== 'workbench_chat' || run.workflowId !== BUSINESS_SKILLS_WORKFLOW_ID
    || run.workflowVersion !== BUSINESS_SKILLS_WORKFLOW_VERSION || !run.aiSessionId || !run.submissionKey
    || !/^[a-f0-9]{64}$/.test(String((run.metadata as Record<string, unknown>)?.invocationFingerprint)))
    failure('EXECUTION_RUN_BINDING_INVALID', '执行任务绑定无效');
  const current = await currentUser(tx, ownerUserId);
  const [session] = await tx.select({ owner: aiSessions.ownerUserId, status: aiSessions.status }).from(aiSessions).where(eq(aiSessions.sessionId, run.aiSessionId!)).for('share');
  if (!session || session.owner !== ownerUserId || session.status === 'archived') failure('EXECUTION_RUN_NOT_FOUND', '执行任务不存在', 404);
  const config = run.executionConfig as Record<string, unknown>;
  const manifest = readPersistedExecutionManifest(config.executionManifest); authorize(manifest, current);
  const execution = { kind: manifest.kind, [manifest.kind === 'skill' ? 'skillId' : 'workflowId']: manifest.target.id, input: manifest.initialInput, sources: manifest.sources };
  if (hash({ sessionId: run.aiSessionId, content: config.content, execution }) !== (run.metadata as Record<string, unknown>).invocationFingerprint)
    failure('EXECUTION_RUN_BINDING_INVALID', '执行任务提交绑定无效');
  const expected = references(manifest); const bindings = config.executionAuthority;
  if (!Array.isArray(bindings) || bindings.length !== expected.length || bindings.some((binding, i) => !binding || typeof binding !== 'object'
    || Object.keys(binding).sort().join(',') !== 'epoch,id,kind' || binding.kind !== expected[i].kind || binding.id !== expected[i].id
    || !Number.isSafeInteger(binding.epoch) || binding.epoch < 0)) failure('EXECUTION_RUN_BINDING_INVALID', '执行任务权限绑定无效');
  for (const [i, reference] of expected.entries()) {
    const control = await root(tx, reference.kind, reference.id, 'share');
    if (control.stopped) failure('EXECUTION_EMERGENCY_STOPPED', '技能或流程已被管理员紧急停止');
    if (retry === 'new' && (!control.enabled || control.archived)) failure('EXECUTION_REFERENCE_UNAVAILABLE', '原执行版本已不可引用');
    if (!retry && (bindings as ExecutionAuthorityBinding[])[i].epoch !== control.epoch) failure('EXECUTION_MANUAL_RETRY_REQUIRED', '任务曾被紧急停止，请手动重新发起');
  }
  if (retry === 'new') {
    const check = async (kind: EmergencyKind, id: string, versionId: string, expectedHash: string) => {
      const table = kind === 'skill' ? skillVersions : workflowVersions;
      const key = kind === 'skill' ? skillVersions.skillVersionId : workflowVersions.workflowVersionId;
      const [version] = await tx.select().from(table).where(eq(key, versionId)).for('share');
      if (!version || ('skillId' in version ? version.skillId : version.workflowId) !== id || version.status !== 'published'
        || version.hash !== expectedHash || hash(version.definition) !== expectedHash)
        failure('EXECUTION_REFERENCE_UNAVAILABLE', '原执行版本已不可引用');
    };
    await check(manifest.kind, manifest.target.id, manifest.target.versionId, manifest.target.hash);
    for (const skill of manifest.skills) await check('skill', skill.skillId, skill.versionId, skill.hash);
  }
  return { runId: run.harnessRunId, manifest, identity: current };
}
/** Separate failed-only admission: ordinary dispatch can never opt out of epoch checks. */
async function retrySource(tx: QueueDbExecutor, runId: string, ownerUserId: string, submissionKey?: string) {
  const [saved] = submissionKey ? await tx.select({ parent: harnessRuns.retryOfRunId }).from(harnessRuns)
    .where(and(eq(harnessRuns.ownerUserId, ownerUserId), eq(harnessRuns.submissionKey, submissionKey))).for('share') : [];
  const [run] = await tx.select().from(harnessRuns).where(and(eq(harnessRuns.harnessRunId, runId), eq(harnessRuns.ownerUserId, ownerUserId))).for('share');
  if (!run) return failure('EXECUTION_RUN_NOT_FOUND', '执行任务不存在', 404);
  if (run.status !== 'failed') failure('EXECUTION_RUN_NOT_FAILED', '仅失败任务可手动重试');
  return { ...await verifyRun(tx, run, ownerUserId, saved?.parent === runId ? 'replay' : 'new'), run };
}
/** Admission only. Callers must add current Registry/policy checks before each external action. */
export function createExecutionEmergencyRepository(database: Database = db) {
  return {
    async prepareRetry(runId: string, ownerUserId: string, submissionKey?: string) {
      try { return await database.transaction(async tx => {
        const source = await retrySource(tx, runId, ownerUserId, submissionKey);
        return { ...source, bindings: await capture(tx, source.manifest, { id: ownerUserId } as AuthUser) };
      }); } catch (error) { return safe(error); }
    },
    async verifyRetry(tx: QueueDbExecutor, runId: string, ownerUserId: string, submissionKey?: string) {
      try { return await retrySource(tx, runId, ownerUserId, submissionKey); } catch (error) { return safe(error); }
    },
    async read(kind: EmergencyKind, id: string, actor: AuthUser) {
      try { return await database.transaction(async tx => {
        await admin(tx, actor); const control = await root(tx, kind, id, 'share');
        const entries = await tx.select().from(audits).where(eq(kind === 'skill' ? audits.skillId : audits.workflowId, id)).orderBy(desc(audits.revision), desc(audits.id)).limit(101);
        return { control: { stopped: control.stopped, epoch: control.epoch, revision: control.revision }, hasMore: entries.length > 100, audit: entries.slice(0, 100).reverse().map(({ skillId, workflowId, ...event }) => ({ ...event, createdAt: event.createdAt.toISOString() })) };
      }); } catch (error) { return safe(error); }
    },
    async change(kind: EmergencyKind, id: string, actor: AuthUser, revision: unknown, reason: unknown, action: 'stop' | 'release') {
      try {
        if (!Number.isSafeInteger(revision) || (revision as number) < 0 || typeof reason !== 'string' || !reason.trim() || reason.trim().length > 1000
          || !['stop', 'release'].includes(action)) failure('EXECUTION_CONTROL_INVALID', '请提供有效版本号和操作原因', 400);
        return await database.transaction(async tx => {
          await admin(tx, actor); const before = await root(tx, kind, id, 'update');
          if (before.revision !== revision) failure('EXECUTION_CONTROL_CONFLICT', '紧急控制已更新，请刷新后重试');
          if (before.stopped === (action === 'stop')) failure('EXECUTION_CONTROL_CONFLICT', '紧急控制状态已变化');
          const control = { stopped: action === 'stop', epoch: before.epoch + (action === 'stop' ? 1 : 0), revision: before.revision + 1 };
          const { table, where } = target(kind, id);
          await tx.update(table).set({ emergencyStopped: control.stopped, emergencyEpoch: control.epoch, emergencyRevision: control.revision }).where(where);
          await tx.insert(audits).values({ id: randomUUID(), skillId: kind === 'skill' ? id : null, workflowId: kind === 'workflow' ? id : null,
            actorId: actor.id, action, reason: (reason as string).trim(), epoch: control.epoch, revision: control.revision, createdAt: await readDbNow(tx) });
          return { control };
        });
      } catch (error) { return safe(error); }
    },
    async prepare(request: ExecutionRequest, user: AuthUser) {
      try { return await database.transaction(async tx => {
        await currentUser(tx, user.id);
        const snapshot = await createExecutionManifestPgRepository().read(tx, request, true);
        const bindings: ExecutionAuthorityBinding[] = [];
        for (const reference of references(snapshot as ExecutionManifest)) {
          const control = await root(tx, reference.kind, reference.id, 'share');
          if (control.stopped) failure('EXECUTION_EMERGENCY_STOPPED', '技能或流程已被管理员紧急停止');
          bindings.push({ ...reference, epoch: control.epoch });
        }
        return bindings;
      }); } catch (error) { return safe(error); }
    },
    async capture(tx: QueueDbExecutor, manifest: ExecutionManifest, user: AuthUser, baseline: ExecutionAuthorityBinding[]) {
      try {
        const bindings = await capture(tx, manifest, user);
        if (hash(bindings.map(({ kind, id }) => ({ kind, id }))) !== hash(baseline.map(({ kind, id }) => ({ kind, id }))))
          failure('EXECUTION_CONTEXT_CHANGED', '准备期间执行依赖已变化，请重新读取后重试');
        if (hash(bindings) !== hash(baseline)) failure('EXECUTION_MANUAL_RETRY_REQUIRED', '准备期间发生过紧急停止，请手动重新发起');
        return bindings;
      } catch (error) { return safe(error); }
    },
    async verifyReplay(tx: QueueDbExecutor, user: AuthUser, sessionId: string, key: string, fingerprint: string) {
      try {
        const [run] = await tx.select().from(harnessRuns).where(and(eq(harnessRuns.ownerUserId, user.id), eq(harnessRuns.submissionKey, key))).for('share');
        // The queue owns mismatched/legacy submission conflicts; never substitute their config as authority.
        if (run && run.aiSessionId === sessionId && (run.metadata as Record<string, unknown>)?.invocationFingerprint === fingerprint) await verifyRun(tx, run, user.id);
      } catch (error) { safe(error); }
    },
    async assertRunAdmission(runId: string, ownerUserId: string) {
      try { return await database.transaction(async tx => {
        if (!/^[a-f0-9-]{36}$/i.test(runId)) return failure('EXECUTION_RUN_NOT_FOUND', '执行任务不存在', 404);
        const [run] = await tx.select().from(harnessRuns).where(and(eq(harnessRuns.harnessRunId, runId), eq(harnessRuns.ownerUserId, ownerUserId))).for('share');
        if (!run) return failure('EXECUTION_RUN_NOT_FOUND', '执行任务不存在', 404);
        if (!['queued', 'running', 'waiting', 'recovering'].includes(run.status)) failure('EXECUTION_RUN_NOT_ACTIVE', '执行任务已结束');
        return verifyRun(tx, run, ownerUserId);
      }); } catch (error) { return safe(error); }
    },
  };
}
