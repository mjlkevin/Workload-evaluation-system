import type { Request, RequestHandler } from 'express';
import type { AuthUser } from '../../types';
import { ok } from '../../utils/response';
import type { SkillRecord } from '../skills/skills.types';
import { WorkflowError, type WorkflowToolContract } from './workflows.types';
import type { WorkflowRepository } from './workflows.repository';
import type { WorkflowContextLoader } from './workflows.context';
import { createWorkflowService, type WorkflowAction } from './workflows.usecase';
export type WorkflowControllerDeps = {
    repo: WorkflowRepository;
    loadContext: WorkflowContextLoader;
    getTools(user: AuthUser): Promise<WorkflowToolContract[]>;
    getSkills(): Promise<SkillRecord[]>;
};
function body(req: Request, allowed: string[]) {
    const v = req.body;
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !allowed.includes(k)))
        throw new WorkflowError('WORKFLOW_INVALID_REQUEST', '请求包含不支持的字段');
    return v as Record<string, unknown>;
}
export function workflowVersionQuery(value: unknown) {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'string' || !value || value.length > 160)
        throw new WorkflowError('WORKFLOW_INVALID_REQUEST', '版本参数无效');
    return value;
}
export function createWorkflowHandlers(deps: WorkflowControllerDeps) {
    const handle = (run: (req: Request) => Promise<unknown>, status = 200): RequestHandler => async (req, res) => {
        try {
            res.status(status).json(ok(await run(req)));
        }
        catch (e) {
            const safe = e instanceof WorkflowError ? e : new WorkflowError('WORKFLOW_STORE_INTERNAL', '工作流服务暂不可用，请重试', 500);
            res.status(safe.status).json({ code: safe.status * 100 + 1, message: safe.message, data: null, errorCode: safe.code, details: safe.details });
        }
    };
    const id = (req: Request) => String(req.params.workflowId);
    const service = (req: Request) => createWorkflowService(deps.repo, deps.loadContext, req.user!);
    return {
        list: handle(async (req) => ({ items: await service(req).list(req.query.includeArchived === 'true') })),
        detail: handle(async (req) => ({ record: await service(req).get(id(req)) })),
        metadata: handle(async (req) => ({ tools: await deps.getTools(req.user!), publishedSkills: (await deps.getSkills()).flatMap(r => r.versions.filter(v => v.status === 'published').map(v => ({
                skillId: r.skillId, skillVersionId: v.skillVersionId, versionCode: v.versionCode, hash: v.hash, enabled: r.enabled, archived: r.archived, active: v.skillVersionId === r.activeVersionId,
                name: v.definition.name, description: v.definition.description, category: v.definition.category, roles: v.definition.roles, inputSchema: v.definition.inputSchema, outputSchema: v.definition.outputSchema,
            }))), viewerId: req.user!.id, roles: ['sales', 'pre_sales', 'delivery', 'pm', 'pmo', 'dev', 'admin'], features: { staticValidation: true, execution: false, fixedSkillVersions: true } })),
        create: handle(async (req) => { const b = body(req, ['definition']); return { record: await service(req).create(b.definition) }; }, 201),
        save: handle(async (req) => { const b = body(req, ['revision', 'definition']); return { record: await service(req).save(id(req), b.revision, b.definition) }; }),
        status: handle(async (req) => { const { revision, ...status } = body(req, ['revision', 'enabled', 'archived']); return { record: await service(req).status(id(req), revision, status) }; }),
        action: (action: WorkflowAction) => handle(async (req) => { const b = body(req, ['revision']); return { record: await service(req).action(id(req), b.revision, action) }; }),
        validate: handle(async (req) => { const b = body(req, ['revision']); return { record: await service(req).validate(id(req), b.revision), mode: 'static', executionPerformed: false }; }),
        review: handle(async (req) => { const b = body(req, ['revision', 'reason']); return { record: await service(req).review(id(req), b.revision, b.reason) }; }),
        publish: handle(async (req) => { const b = body(req, ['revision']); return { record: await service(req).publish(id(req), b.revision) }; }),
        rollback: handle(async (req) => { const b = body(req, ['revision', 'targetVersionId', 'reason']); return { record: await service(req).rollback(id(req), b.revision, b.targetVersionId, b.reason) }; }),
        readiness: handle(async (req) => service(req).readiness(id(req))),
        dependencies: handle(async (req) => service(req).dependencies(id(req), workflowVersionQuery(req.query.versionId))),
    };
}
