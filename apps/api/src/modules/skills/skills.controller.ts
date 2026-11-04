import type { Request, RequestHandler, Response } from 'express';
import type { AuthUser } from '../../types';
import { ok } from '../../utils/response';
import { createSkillUsecase, type SkillAction } from './skills.usecase';
import { SkillError } from './skills.types';
import type { SkillRepository } from './skills.repository';
import type { SkillToolDefinition } from './skills.validation';
import type { SkillReleaseRepository } from './skills-release.types';
import { createSkillReleaseService, type SkillContextLoader } from './skills.release';

export type SkillControllerDeps = { repo: SkillRepository; releaseRepo: SkillReleaseRepository; loadContext: SkillContextLoader; getTools(user: AuthUser): Promise<SkillToolDefinition[]>; getInfluences?(skillId: string, skillVersionId?: string): Promise<unknown[]> };
function body(req: Request, allowed: string[]) {
  const value = req.body;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new SkillError('SKILL_INVALID_REQUEST', '请求中包含不支持的字段');
  return value as Record<string, unknown>;
}
function failure(res: Response, error: unknown) {
  const safe = error instanceof SkillError ? error : new SkillError('SKILL_STORE_INTERNAL', 'Skill 服务暂不可用，请重试', 500);
  res.status(safe.status).json({ code: safe.status * 100 + 1, message: safe.message, data: null, errorCode: safe.code, details: safe.details });
}
export function createSkillHandlers(deps: SkillControllerDeps) {
  const handle = (run: (req: Request, res: Response) => Promise<void>): RequestHandler => async (req, res) => {
    try { await run(req, res); } catch (error) { failure(res, error); }
  };
  const service = (req: Request) => createSkillUsecase(deps.repo, () => deps.getTools(req.user!));
  const releases = (req: Request) => createSkillReleaseService(deps.repo, deps.releaseRepo, deps.loadContext, req.user!, () => deps.getTools(req.user!));
  const actor = (req: Request) => ({ id: req.user!.id, username: req.user!.username });
  const id = (req: Request) => String(req.params.skillId);
  return {
    influences: handle(async (req, res) => {
      const version = req.query.skillVersionId;
      if (version !== undefined && (typeof version !== 'string' || !version || version.length > 160)) throw new SkillError('SKILL_INVALID_REQUEST', '版本参数无效');
      res.json(ok({ items: await deps.getInfluences!(id(req), version as string | undefined) }));
    }),
    catalog: handle(async (req, res) => { res.json(ok({ items: await releases(req).catalog() })); }),
    readiness: handle(async (req, res) => { res.json(ok(await releases(req).readiness(id(req)))); }),
    trial: handle(async (req, res) => { const input = body(req, ['revision', 'mode']); res.json(ok(await releases(req).trial(id(req), input.revision, input.mode))); }),
    review: handle(async (req, res) => { const input = body(req, ['revision', 'evaluationId', 'reason', 'acknowledgeSimulation']); res.json(ok({ record: await releases(req).review(id(req), input.revision, input.evaluationId, input.reason, input.acknowledgeSimulation) })); }),
    publish: handle(async (req, res) => { const input = body(req, ['revision']); res.json(ok({ record: await releases(req).publish(id(req), input.revision) })); }),
    rollback: handle(async (req, res) => { const input = body(req, ['revision', 'targetVersionId', 'reason']); res.json(ok({ record: await releases(req).rollback(id(req), input.revision, input.targetVersionId, input.reason) })); }),
    list: handle(async (req, res) => { res.json(ok({ items: await service(req).list(req.query.includeArchived === 'true') })); }),
    detail: handle(async (req, res) => { res.json(ok({ record: await service(req).get(id(req)) })); }),
    metadata: handle(async (req, res) => { res.json(ok({ tools: await deps.getTools(req.user!), viewerId: req.user!.id, roles: ['sales', 'pre_sales', 'delivery', 'pm', 'pmo', 'dev', 'admin'], modelScenarios: ['assessment', 'fileParsing', 'generation'], publishAvailable: true })); }),
    create: handle(async (req, res) => { const input = body(req, ['definition']); res.status(201).json(ok({ record: await service(req).create(input.definition, actor(req)) })); }),
    save: handle(async (req, res) => { const input = body(req, ['definition', 'revision']); res.json(ok({ record: await service(req).save(id(req), input.revision, actor(req), input.definition) })); }),
    validate: handle(async (req, res) => { const input = body(req, ['definition']); res.json(ok(await service(req).validate(input.definition))); }),
    status: handle(async (req, res) => { const { revision, ...status } = body(req, ['revision', 'enabled', 'archived']); res.json(ok({ record: await service(req).setStatus(id(req), revision, actor(req), status) })); }),
    action: (action: SkillAction) => handle(async (req, res) => { const input = body(req, ['revision']); res.json(ok({ record: await service(req).action(id(req), input.revision, actor(req), action) })); }),
  };
}
