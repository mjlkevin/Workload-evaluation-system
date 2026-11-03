import { Router } from 'express';
import { emergencyHandler } from '../modules/skills/execution-emergency.controller';
import { requireCapability } from '../rbac/middleware';
import { createSkillsPgRepository } from '../modules/skills/skills.module';
import { createWorkflowHandlers, createWorkflowsPgRepository, resolveWorkflowDependencyContext, workflowToolMetadata, type WorkflowControllerDeps } from '../modules/workflows/workflows.module';
export function createWorkflowsRouter(deps: Partial<WorkflowControllerDeps> = {}): Router {
    const router = Router();
    const handlers = createWorkflowHandlers({ repo: deps.repo ?? createWorkflowsPgRepository(), loadContext: deps.loadContext ?? resolveWorkflowDependencyContext,
        getTools: deps.getTools ?? workflowToolMetadata, getSkills: deps.getSkills ?? (() => createSkillsPgRepository().list()) });
    router.use(requireCapability('system:manage'));
    router.use((req, res, next) => { if (req.user?.role !== 'admin') {
        res.status(403).json({ code: 40301, message: '仅管理员可管理工作流', data: null });
        return;
    } next(); });
    router.get('/', handlers.list);
    router.get('/metadata', handlers.metadata);
    router.post('/', handlers.create);
    router.get('/:workflowId/release', handlers.readiness);
    router.get('/:workflowId/emergency-control', emergencyHandler('workflow'));
    router.post('/:workflowId/emergency-stop', emergencyHandler('workflow', 'stop'));
    router.post('/:workflowId/emergency-release', emergencyHandler('workflow', 'release'));
    router.get('/:workflowId/dependencies', handlers.dependencies);
    router.get('/:workflowId', handlers.detail);
    router.patch('/:workflowId/save-draft', handlers.save);
    router.patch('/:workflowId/status', handlers.status);
    for (const action of ['checkout', 'checkin', 'undo-checkout', 'promote', 'force-unlock'] as const)
        router.post(`/:workflowId/${action}`, handlers.action(action));
    router.post('/:workflowId/validate', handlers.validate);
    router.post('/:workflowId/review', handlers.review);
    router.post('/:workflowId/publish', handlers.publish);
    router.post('/:workflowId/rollback', handlers.rollback);
    return router;
}
