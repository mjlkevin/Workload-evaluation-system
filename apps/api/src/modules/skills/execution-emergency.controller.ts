import type { RequestHandler } from 'express';
import { ok } from '../../utils/response';
import { createExecutionEmergencyRepository, type EmergencyKind } from './execution-emergency';
import { SkillError } from './skills.types';
export function emergencyHandler(kind: EmergencyKind, action?: 'stop' | 'release'): RequestHandler {
  return async (req, res) => {
    try {
      const id = String(req.params[kind === 'skill' ? 'skillId' : 'workflowId']);
      const repository = createExecutionEmergencyRepository();
      if (!action) { res.json(ok(await repository.read(kind, id, req.user!))); return; }
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['revision', 'reason'].includes(key)))
        throw new SkillError('EXECUTION_CONTROL_INVALID', '紧急控制请求无效');
      res.json(ok(await repository.change(kind, id, req.user!, body.revision, body.reason, action)));
    } catch (error) {
      const safe = error instanceof SkillError ? error : new SkillError('EXECUTION_AUTHORITY_UNAVAILABLE', '执行权限暂不可用', 503);
      res.status(safe.status).json({ code: safe.status * 100 + 1, message: safe.message, data: null, errorCode: safe.code });
    }
  };
}
