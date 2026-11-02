import type { AuthUser } from '../../types';
import { resolveBusinessRole } from '../../middleware/auth';
import { evaluateSkill } from './skills.evaluation';
import { resolveCurrentSkillTools, skillToolContract, type SkillResolvedContext } from './skills.context';
import type { SkillToolDefinition } from './skills.validation';
import { currentSkillVersion, releaseReason, requireReleaseCandidate } from './skills-release.repository';
import type { SkillReleaseRepository } from './skills-release.types';
import type { SkillRepository } from './skills.repository';
import { SkillError, type SkillDefinition, type SkillRecord } from './skills.types';

export type SkillContextLoader = (definition: SkillDefinition, user: AuthUser, options?: { requireModel?: boolean }) => Promise<SkillResolvedContext>;
export function skillRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new SkillError('SKILL_REVISION_REQUIRED', '请重新读取当前版本后再操作');
  return Number(value);
}
export function createSkillReleaseService(roots: SkillRepository, release: SkillReleaseRepository, loadContext: SkillContextLoader, user: AuthUser, loadCatalogTools: () => Promise<SkillToolDefinition[]> = async () => (await resolveCurrentSkillTools(user)).tools.map(skillToolContract)) {
  const actor = { id: user.id, username: user.username };
  const read = async (id: string, revision?: number) => {
    const record = await roots.get(id);
    if (!record) throw new SkillError('SKILL_NOT_FOUND', 'Skill 不存在', 404);
    if (revision !== undefined && record.revision !== revision) throw new SkillError('SKILL_REVISION_CONFLICT', 'Skill 已更新，请刷新后重试', 409);
    return record;
  };
  const contextHash = async (record: SkillRecord) => (await loadContext(currentSkillVersion(record).definition, user)).hash;
  return {
    async readiness(id: string) {
      const record = await read(id); const version = currentSkillVersion(record);
      const evidence = await release.evidence(id); const blockers: string[] = []; let hash: string | null = null;
      try { requireReleaseCandidate(record); } catch (error) { blockers.push((error as SkillError).code); }
      try { hash = await contextHash(record); } catch (error) { blockers.push(error instanceof SkillError ? error.code : 'SKILL_CONTEXT_UNAVAILABLE'); }
      const trials = evidence.evaluations.filter(e => e.versionId === version.skillVersionId).map(e => ({
        id: e.id, hash: e.hash, contextHash: e.contextHash, snapshotRevision: e.snapshotRevision, createdAt: e.createdAt,
        current: e.hash === version.hash && e.contextHash === hash, result: e.result,
      }));
      const eligible = trials.filter(e => e.current && e.result.releaseEligible && e.result.mode === 'model' && e.result.modelExecuted && e.result.passed);
      const review = [...evidence.reviews].reverse().find(r => r.versionId === version.skillVersionId && r.hash === version.hash && r.contextHash === hash && eligible.some(e => e.id === r.evaluationId));
      if (!eligible.length) blockers.push('SKILL_MODEL_TRIAL_REQUIRED');
      if (!review) blockers.push('SKILL_REVIEW_REQUIRED');
      if (version.status === 'published') blockers.push('SKILL_ALREADY_PUBLISHED');
      return { revision: record.revision, versionId: version.skillVersionId, hash: version.hash, contextHash: hash,
        trials, review: review ?? null, blockers, publishAvailable: blockers.length === 0,
        reviewAvailable: eligible.length > 0 && version.checkoutStatus === 'checked_in' && record.enabled && !record.archived && version.status !== 'published',
        activeVersion: record.versions.find(v => v.skillVersionId === record.activeVersionId) ?? null,
        rollbackVersions: record.versions.filter(v => v.status === 'published' && v.skillVersionId !== record.activeVersionId).map(v => ({ versionId: v.skillVersionId, versionCode: v.versionCode, hash: v.hash })),
        events: evidence.events,
      };
    },
    async trial(id: string, revision: unknown, mode: unknown) {
      const expected = skillRevision(revision);
      if (mode !== 'model' && mode !== 'simulation') throw new SkillError('SKILL_INVALID_REQUEST', '试运行模式必须是 model 或 simulation');
      // Snapshot before any network; no database transaction/lock survives provider I/O.
      const record = await read(id, expected); const version = currentSkillVersion(record);
      if (version.checkoutStatus === 'checked_out' && version.checkedOutBy !== actor.id) throw new SkillError('SKILL_LOCKED', '当前版本由其他管理员检出', 409);
      const definition = structuredClone(version.definition);
      const context = await loadContext(definition, user, { requireModel: mode === 'model' });
      let index = 0;
      const complete = mode === 'model' ? context.complete : async () => ({ output: structuredClone(definition.examples[index++].expected), provider: 'simulation', model: 'expected-sample', usage: { outputTokens: 1 } });
      const result = await evaluateSkill(definition, { mode, allowedTools: context.tools, complete, runReadTool: mode === 'model' ? context.runReadTool : undefined });
      return release.appendEvaluation(id, expected, actor, { versionId: version.skillVersionId, hash: version.hash, contextHash: context.hash, result: { ...result, dependencyContext: structuredClone(context.snapshot) } });
    },
    async review(id: string, revision: unknown, evaluationId: unknown, reason: unknown, acknowledgeSimulation: unknown) {
      if (typeof evaluationId !== 'string' || !evaluationId || evaluationId.length > 160 || (acknowledgeSimulation !== undefined && typeof acknowledgeSimulation !== 'boolean')) throw new SkillError('SKILL_INVALID_REQUEST', '审核参数无效');
      return release.review(id, skillRevision(revision), actor, { evaluationId, reason: releaseReason(reason), acknowledgeSimulation: acknowledgeSimulation as boolean | undefined, contextHash });
    },
    async publish(id: string, revision: unknown) { return release.publish(id, skillRevision(revision), actor, contextHash); },
    async rollback(id: string, revision: unknown, targetVersionId: unknown, reason: unknown) {
      if (typeof targetVersionId !== 'string' || !targetVersionId || targetVersionId.length > 160) throw new SkillError('SKILL_INVALID_REQUEST', '回滚版本无效');
      return release.rollback(id, skillRevision(revision), actor, targetVersionId, releaseReason(reason));
    },
    async catalog() {
      const role = resolveBusinessRole(user);
      const candidates = (await roots.list()).flatMap(record => {
        if (!record.enabled || record.archived || !record.activeVersionId) return [];
        const version = record.versions.find(v => v.skillVersionId === record.activeVersionId && v.status === 'published');
        if (!version || !version.definition.roles.includes(role)) return [];
        // Explicit safe projection: never return prompts, references, examples, draft locks or root audit.
        return [{ skillId: record.skillId, skillVersionId: version.skillVersionId, versionCode: version.versionCode, hash: version.hash,
          name: version.definition.name, description: version.definition.description, category: version.definition.category,
          inputSchema: version.definition.inputSchema, outputSchema: version.definition.outputSchema, toolNames: version.definition.tools.map(t => t.toolName) }];
      });
      const allowed = candidates.some(item => item.toolNames.length) ? new Set((await loadCatalogTools()).map(t => t.name)) : new Set<string>();
      return candidates.filter(item => item.toolNames.every(name => allowed.has(name))).map(({ toolNames, ...safe }) => safe);
    },
  };
}
