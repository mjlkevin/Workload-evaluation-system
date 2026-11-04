import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { requireCapability } from '../rbac/middleware';
import { ok } from '../utils/response';
import { SkillError, createExecutionCatalogService, createBusinessSkillsWorkbenchService, createExecutionRecommendationService, createSkillConversationService } from '../modules/skills/skills.module';
import { isDurableRunsEnabledFromEnv } from '../modules/harness/harness-runtime.usecase';
type Options = { enabled?: boolean; catalog?: ReturnType<typeof createExecutionCatalogService>; business?: ReturnType<typeof createBusinessSkillsWorkbenchService>;
  recommendations?: ReturnType<typeof createExecutionRecommendationService>; conversation?: ReturnType<typeof createSkillConversationService> };
export function createAiExecutionsRouter(options: Options = {}) {
  const enabled = options.enabled ?? isDurableRunsEnabledFromEnv(), catalog = options.catalog ?? createExecutionCatalogService();
  const business = options.business ?? createBusinessSkillsWorkbenchService(), router = Router();
  const recommendations = options.recommendations ?? createExecutionRecommendationService({ catalog });
  router.use(requireCapability('estimates:read'));
  const recommendationLimit = rateLimit({ windowMs: 60000, limit: 20, standardHeaders: true, legacyHeaders: false,
    keyGenerator: req => `user:${req.user!.id}`,
    message: { code: 'EXECUTION_RECOMMENDATION_RATE_LIMIT', message: '推荐请求过于频繁，请稍后再试。', data: null } });
  const conversation = options.conversation ?? createSkillConversationService();
  router.post('/conversation', recommendationLimit, async (req,res) => {
    try {
      if (!enabled) { res.status(503).json({ code: 'ASYNC_RUNS_DISABLED', message: '后台任务尚未开启', data: null }); return; }
      const { sessionId, ...body } = req.body ?? {};
      res.json(ok(await conversation.respond(req.user!, sessionId, body),randomUUID()));
    } catch (error) {
      res.status(error instanceof SkillError ? error.status : 503).json({ code: error instanceof SkillError ? error.code : 'SKILL_CONVERSATION_UNAVAILABLE', message: error instanceof SkillError ? error.message : '技能对话暂不可用，请重试', data: null });
    }
  });
  router.post('/recommendations', recommendationLimit, async (req, res) => {
    try {
      if (!enabled) { res.status(503).json({ code: 'ASYNC_RUNS_DISABLED', message: '后台任务尚未开启', data: null }); return; }
      res.json(ok(await recommendations.recommend(req.user!, req.body), randomUUID()));
    } catch (error) {
      res.status(error instanceof SkillError ? error.status : 503).json({ code: error instanceof SkillError ? error.code : 'EXECUTION_RECOMMENDATION_UNAVAILABLE',
        message: error instanceof SkillError ? error.message : '推荐暂不可用，请手动选择 Skill 或工作流。', data: null, requestId: randomUUID() });
    }
  });
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
