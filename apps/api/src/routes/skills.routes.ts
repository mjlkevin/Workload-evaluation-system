import { Router } from 'express';
import { createWorkflowsPgRepository } from '../modules/workflows/workflows.module';
import { requireCapability, requireAuthenticated } from '../rbac/middleware';
import { resolveCurrentSkillTools, resolveSkillDependencyContext, skillToolContract } from '../modules/skills/skills.context';
import { createSkillReleaseRepository } from '../modules/skills/skills-release.repository';
import { createSkillHandlers, createSkillsPgRepository, type SkillControllerDeps } from '../modules/skills/skills.module';

export function createSkillsRouter(deps?: Partial<SkillControllerDeps>): Router {
  const router = Router();
  const handlers = createSkillHandlers({
    getInfluences: deps?.getInfluences ?? ((skillId, versionId) => createWorkflowsPgRepository().influences(skillId, versionId)),
    repo: deps?.repo ?? createSkillsPgRepository(),
    releaseRepo: deps?.releaseRepo ?? createSkillReleaseRepository(),
    loadContext: deps?.loadContext ?? resolveSkillDependencyContext,
    getTools: deps?.getTools ?? (async user => (await resolveCurrentSkillTools(user)).tools.map(skillToolContract)),
  });
  // Catalog is authenticated but accessible to business users; full drafts stay behind management authorization.
  router.get('/catalog', requireAuthenticated(), handlers.catalog);
  router.use(requireCapability('system:manage'));
  router.use((req, res, next) => {
    if (req.user?.role !== 'admin') { res.status(403).json({ code: 40301, message: '仅管理员可管理 Skill', data: null }); return; }
    next();
  });
  router.get('/', handlers.list);
  router.get('/metadata', handlers.metadata);
  router.post('/validate', handlers.validate);
  router.post('/', handlers.create);
  router.get('/:skillId/influences', handlers.influences);
  router.get('/:skillId/release', handlers.readiness);
  router.post('/:skillId/trial', handlers.trial);
  router.post('/:skillId/review', handlers.review);
  router.post('/:skillId/publish', handlers.publish);
  router.post('/:skillId/rollback', handlers.rollback);
  router.get('/:skillId', handlers.detail);
  router.patch('/:skillId/save-draft', handlers.save);
  router.patch('/:skillId/status', handlers.status);
  for (const action of ['checkout', 'checkin', 'undo-checkout', 'promote', 'force-unlock'] as const) router.post(`/:skillId/${action}`, handlers.action(action));
  return router;
}
