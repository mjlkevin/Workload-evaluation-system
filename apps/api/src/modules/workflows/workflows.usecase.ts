import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../../types';
import { skillDefinitionHash } from '../skills/skills.hash';
import { workflowShape } from './workflows.shape';
import { validateWorkflowDefinition } from './workflows.validation';
import { newWorkflowVersion } from './workflows.version';
import { WorkflowError, type WorkflowRecord, type WorkflowVersion, type WorkflowProof } from './workflows.types';
import type { WorkflowRepository } from './workflows.repository';
import type { WorkflowContextLoader } from './workflows.context';
export type WorkflowAction = 'checkout' | 'checkin' | 'undo-checkout' | 'promote' | 'force-unlock';
export const currentWorkflowVersion = (r: WorkflowRecord) => r.versions.find(v => v.workflowVersionId === r.currentVersionId)!;
function revision(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new WorkflowError('WORKFLOW_REVISION_REQUIRED', '请重新读取当前版本后操作'); return Number(value); }
function reason(value: unknown): string { if (typeof value !== 'string' || !value.trim() || value.length > 2000)
    throw new WorkflowError('WORKFLOW_REASON_REQUIRED', '请填写审核或回滚原因'); return value.trim(); }
function candidate(r: WorkflowRecord) {
    if (!r.enabled || r.archived)
        throw new WorkflowError('WORKFLOW_DISABLED', '已停用或归档的工作流不能发布或回滚', 409);
    if (currentWorkflowVersion(r).checkoutStatus !== 'checked_in')
        throw new WorkflowError('WORKFLOW_CHECKIN_REQUIRED', '请先检入再验证、审核或发布', 409);
}
function editable(v: WorkflowVersion) { if (v.status === 'published')
    throw new WorkflowError('WORKFLOW_PUBLISHED_IMMUTABLE', '已发布版本只读，请升版', 409); }
function invalidate(v: WorkflowVersion) { v.status = 'draft'; v.validation = null; v.review = null; v.dependencySnapshot = null; }
function pending(): never { throw new WorkflowError('WORKFLOW_RELEASE_GATE_PENDING', '需要绑定当前定义及依赖的静态验证与审核证明', 409); }
function matching(proof: WorkflowProof | null, v: WorkflowVersion, hash: string) { return proof && proof.mode === 'static' && proof.executionPerformed === false && proof.hash === v.hash && proof.versionId === v.workflowVersionId && proof.dependencyHash === hash; }
function nextLetter(value: string): string { let carry = 1, result = ''; for (let i = value.length - 1; i >= 0; i--) {
    const n = value.charCodeAt(i) - 65 + carry;
    result = String.fromCharCode(65 + n % 26) + result;
    carry = Math.floor(n / 26);
} return (carry ? 'A' : '') + result; }
export function createWorkflowService(repo: WorkflowRepository, load: WorkflowContextLoader, user: AuthUser) {
    const actor = { id: user.id, username: user.username };
    const read = async (id: string) => { const r = await repo.get(id); if (!r)
        throw new WorkflowError('WORKFLOW_NOT_FOUND', '工作流不存在', 404); return r; };
    const validate = async (value: unknown) => { const shape = workflowShape(value); validateWorkflowDefinition(shape, (await load(shape, user)).context); return shape; };
    const prepare = async (id: string, expected: unknown) => {
        const r = await read(id);
        if (r.revision !== revision(expected)) throw new WorkflowError('WORKFLOW_REVISION_CONFLICT', '工作流已更新，请刷新后重试', 409);
        return load.prepare ? load.prepare(currentWorkflowVersion(r).definition, user) : load;
    };
    const service = {
        get: read,
        async list(includeArchived = false) { return (await repo.list()).filter(r => includeArchived || !r.archived); },
        async create(value: unknown) { return repo.create(await validate(value), actor); },
        async save(id: string, expected: unknown, value: unknown) {
            const input = await validate(value);
            return repo.mutate(id, revision(expected), actor, 'save-draft', r => { const v = currentWorkflowVersion(r); editable(v); v.definition = structuredClone(input); v.hash = skillDefinitionHash(input); invalidate(v); });
        },
        async status(id: string, expected: unknown, input: {
            enabled?: unknown;
            archived?: unknown;
        }) {
            if (!Object.keys(input).length || Object.values(input).some(v => typeof v !== 'boolean'))
                throw new WorkflowError('WORKFLOW_INVALID_REQUEST', '状态必须为布尔值');
            return repo.mutate(id, revision(expected), actor, 'status', r => { if (input.enabled !== undefined)
                r.enabled = input.enabled as boolean; if (input.archived !== undefined)
                r.archived = input.archived as boolean; if (r.archived) r.enabled = false; });
        },
        async action(id: string, expected: unknown, action: WorkflowAction) {
            return repo.mutate(id, revision(expected), actor, action, (r, now) => {
                const v = currentWorkflowVersion(r);
                if (action === 'promote') {
                    if (v.checkoutStatus !== 'checked_in')
                        throw new WorkflowError('WORKFLOW_CHECKIN_REQUIRED', '请先检入再升版', 409);
                    const next = newWorkflowVersion(id, v.definition, now, nextLetter(v.majorLetter));
                    r.versions.push(next);
                    r.currentVersionId = next.workflowVersionId;
                    return;
                }
                editable(v);
                if (action === 'checkout') {
                    if (v.checkoutStatus !== 'checked_in')
                        throw new WorkflowError('WORKFLOW_LOCKED', '工作流已被检出', 409);
                    invalidate(v);
                    v.checkoutStatus = 'checked_out';
                    v.checkedOutBy = actor.id;
                    return;
                }
                if (v.checkoutStatus !== 'checked_out')
                    throw new WorkflowError('WORKFLOW_CHECKOUT_REQUIRED', '请先检出编辑', 409);
                if (v.checkedOutBy !== actor.id && action !== 'force-unlock')
                    throw new WorkflowError('WORKFLOW_LOCKED', '当前版本由其他管理员检出', 409);
                if (action === 'force-unlock' && user.role !== 'admin')
                    throw new WorkflowError('WORKFLOW_ADMIN_REQUIRED', '仅管理员可强制解锁', 403);
                if (action === 'checkin') {
                    v.minorNumber++;
                    v.versionCode = `WF-${id.slice(0, 8)}-V${v.majorLetter}.${v.minorNumber}`;
                    v.lastCheckinDefinition = structuredClone(v.definition);
                }
                else {
                    v.definition = structuredClone(v.lastCheckinDefinition);
                    v.hash = skillDefinitionHash(v.definition);
                }
                invalidate(v);
                v.checkoutStatus = 'checked_in';
                v.checkedOutBy = null;
            });
        },
        async validate(id: string, expected: unknown) {
            const prepared = await prepare(id, expected);
            return repo.mutate(id, revision(expected), actor, 'validate', async (r, now, tx) => {
                candidate(r);
                const v = currentWorkflowVersion(r);
                editable(v);
                const context = await prepared(v.definition, user, tx);
                validateWorkflowDefinition(v.definition, context.context);
                v.dependencySnapshot = structuredClone(context.snapshot);
                v.review = null;
                v.status = 'draft';
                v.validation = { id: randomUUID(), versionId: v.workflowVersionId, hash: v.hash, dependencyHash: context.hash, actorId: actor.id, createdAt: now, mode: 'static', executionPerformed: false };
            });
        },
        async review(id: string, expected: unknown, explanation: unknown) {
            const why = reason(explanation);
            const prepared = await prepare(id, expected);
            return repo.mutate(id, revision(expected), actor, 'review', async (r, now, tx) => {
                candidate(r);
                const v = currentWorkflowVersion(r);
                editable(v);
                const context = await prepared(v.definition, user, tx);
                validateWorkflowDefinition(v.definition, context.context);
                if (!matching(v.validation, v, context.hash))
                    pending();
                v.review = { ...v.validation!, id: randomUUID(), validationId: v.validation!.id, reason: why, actorId: actor.id, createdAt: now };
                v.status = 'reviewed';
            }, why);
        },
        async publish(id: string, expected: unknown) {
            const prepared = await prepare(id, expected);
            return repo.mutate(id, revision(expected), actor, 'publish', async (r, now, tx) => {
                candidate(r);
                const v = currentWorkflowVersion(r);
                const context = await prepared(v.definition, user, tx);
                validateWorkflowDefinition(v.definition, context.context);
                if (v.status !== 'reviewed' || !matching(v.validation, v, context.hash) || !matching(v.review, v, context.hash) || v.review!.validationId !== v.validation!.id)
                    pending();
                v.dependencySnapshot = structuredClone(context.snapshot);
                v.status = 'published';
                r.activeVersionId = v.workflowVersionId;
            });
        },
        async rollback(id: string, expected: unknown, targetId: unknown, explanation: unknown) {
            const why = reason(explanation);
            if (typeof targetId !== 'string' || !targetId || targetId.length > 160)
                throw new WorkflowError('WORKFLOW_INVALID_REQUEST', '回滚版本无效');
            const before = await read(id); const targetDefinition = before.versions.find(v => v.workflowVersionId === targetId)?.definition;
            const prepared = targetDefinition && load.prepare ? await load.prepare(targetDefinition, user) : load;
            return repo.mutate(id, revision(expected), actor, 'rollback', async (r, now, tx) => {
                if (!r.enabled || r.archived)
                    throw new WorkflowError('WORKFLOW_DISABLED', '已停用或归档的工作流不能回滚', 409);
                const target = r.versions.find(v => v.workflowVersionId === targetId && v.status === 'published');
                const active = r.versions.find(v => v.workflowVersionId === r.activeVersionId);
                if (!target || !active || !r.audit.some(a => a.action === 'publish' && a.versionId === targetId))
                    throw new WorkflowError('WORKFLOW_ROLLBACK_TARGET_INVALID', '目标必须是本工作流曾发布的版本', 409);
                if (targetId === r.activeVersionId)
                    throw new WorkflowError('WORKFLOW_ALREADY_ACTIVE', '该版本已经生效', 409);
                const { schemaFits } = await import('../skills/skills.schema-compatibility');
                if (!schemaFits(active.definition.inputSchema, target.definition.inputSchema, active.definition.inputSchema, target.definition.inputSchema) || !schemaFits(target.definition.outputSchema, active.definition.outputSchema, target.definition.outputSchema, active.definition.outputSchema)
                    || target.definition.roles.some(role => !active.definition.roles.includes(role)))
                    throw new WorkflowError('WORKFLOW_ROLLBACK_INCOMPATIBLE', '回滚版本的输入、输出或角色不兼容', 409);
                validateWorkflowDefinition(target.definition, (await prepared(target.definition, user, tx)).context);
                r.activeVersionId = targetId;
            }, why);
        },
        async dependencies(id: string, versionId?: string) {
            const r = await read(id);
            const v = r.versions.find(v => v.workflowVersionId === (versionId ?? r.currentVersionId));
            if (!v)
                throw new WorkflowError('WORKFLOW_VERSION_NOT_FOUND', '工作流版本不存在', 404);
            if (v.status === 'published')
                return { versionId: v.workflowVersionId, frozen: true, snapshot: v.dependencySnapshot, issues: [] };
            try {
                const context = await load(v.definition, user);
                validateWorkflowDefinition(v.definition, context.context);
                return { versionId: v.workflowVersionId, frozen: false, snapshot: context.snapshot, issues: [] };
            }
            catch (error) {
                return { versionId: v.workflowVersionId, frozen: false, snapshot: null, issues: [{ code: error instanceof WorkflowError ? error.code : 'WORKFLOW_DEPENDENCY_UNAVAILABLE', message: '当前固定依赖不可用或定义校验未通过' }] };
            }
        },
        async readiness(id: string) {
            const r = await read(id);
            const v = currentWorkflowVersion(r);
            const blockers: string[] = [];
            let hash: string | null = null;
            try {
                candidate(r);
            }
            catch (e) {
                blockers.push((e as WorkflowError).code);
            }
            try {
                const context = await load(v.definition, user);
                validateWorkflowDefinition(v.definition, context.context);
                hash = context.hash;
            }
            catch {
                blockers.push('WORKFLOW_DEPENDENCY_UNAVAILABLE');
            }
            if (!hash || !matching(v.validation, v, hash))
                blockers.push('WORKFLOW_STATIC_VALIDATION_REQUIRED');
            if (!hash || !matching(v.review, v, hash) || v.review?.validationId !== v.validation?.id)
                blockers.push('WORKFLOW_REVIEW_REQUIRED');
            if (v.status === 'published')
                blockers.push('WORKFLOW_ALREADY_PUBLISHED');
            return { revision: r.revision, versionId: v.workflowVersionId, hash: v.hash, dependencyHash: hash, mode: 'static', executionPerformed: false, validation: v.validation, review: v.review, blockers, publishAvailable: !blockers.length,
                rollbackVersions: r.versions.filter(x => x.status === 'published' && x.workflowVersionId !== r.activeVersionId).map(x => ({ versionId: x.workflowVersionId, versionCode: x.versionCode })) };
        },
    };
    return service;
}
