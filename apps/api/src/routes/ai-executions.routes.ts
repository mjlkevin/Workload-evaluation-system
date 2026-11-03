import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { requireCapability } from '../rbac/middleware';
import { ok } from '../utils/response';
import { SkillError, createExecutionCatalogService, createBusinessSkillsWorkbenchService } from '../modules/skills/skills.module';
import { isDurableRunsEnabledFromEnv } from '../modules/harness/harness-runtime.usecase';
type Options = { enabled?: boolean; catalog?: ReturnType<typeof createExecutionCatalogService>; business?: ReturnType<typeof createBusinessSkillsWorkbenchService> };
export function createAiExecutionsRouter(options: Options = {}) {
  const enabled = options.enabled ?? isDurableRunsEnabledFromEnv(), catalog = options.catalog ?? createExecutionCatalogService();
  const business = options.business ?? createBusinessSkillsWorkbenchService(), router = Router();
  router.use(requireCapability('estimates:read'));
  router.get(['/catalog', '/runs'], async (req, res) => {
    try {
      if (!enabled) { res.status(503).json({ code: 'ASYNC_RUNS_DISABLED', message: '后台任务尚未开启', data: null }); return; }
      const items = req.path === '/catalog' ? await catalog.list(req.user!) : await business.listSessionRuns(req.user!, typeof req.query.sessionId === 'string' ? req.query.sessionId : '');
      res.json(ok({ items }, randomUUID()));
    } catch (error) {
      res.status(error instanceof SkillError ? error.status : 503).json({ code: error instanceof SkillError ? error.code : 'BUSINESS_SKILLS_UNAVAILABLE',
        message: error instanceof SkillError ? error.message : '业务任务暂不可用', data: null, requestId: randomUUID() });
    }
  });
  return router;
}
