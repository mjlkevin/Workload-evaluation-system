import { Router } from 'express';
import { requireCapability } from '../rbac/middleware';
import { createDefaultRegistry } from '../agent/default-registry';
import { resolveActiveMcpTools } from '../agent/mcp/mcp-runtime';
import { createSkillHandlers, createSkillsPgRepository, type SkillControllerDeps } from '../modules/skills/skills.module';

export function createSkillsRouter(deps?: Partial<SkillControllerDeps>): Router {
  const router = Router();
  router.use(requireCapability('system:manage'));
  // Management is admin-only even if future capability assignments broaden.
  router.use((req, res, next) => {
    if (req.user?.role !== 'admin') { res.status(403).json({ code: 40301, message: '仅管理员可管理 Skill', data: null }); return; }
    next();
  });
  const handlers = createSkillHandlers({
    repo: deps?.repo ?? createSkillsPgRepository(),
    getTools: deps?.getTools ?? (async user => {
      const mcp = await resolveActiveMcpTools();
      const registry = createDefaultRegistry(user).cloneWithMcpTools(mcp.tools);
      return registry.allTools().map(({ name, description, parameters, mutates, exfiltrates }) => ({ name, description, parameters, mutates, exfiltrates: Boolean(exfiltrates) }));
    }),
  });
  router.get('/', handlers.list);
  router.get('/metadata', handlers.metadata);
  router.post('/validate', handlers.validate);
  router.post('/', handlers.create);
  router.get('/:skillId', handlers.detail);
  router.patch('/:skillId/save-draft', handlers.save);
  router.patch('/:skillId/status', handlers.status);
  for (const action of ['checkout', 'checkin', 'undo-checkout', 'promote', 'force-unlock', 'publish'] as const) router.post(`/:skillId/${action}`, handlers.action(action));
  return router;
}
