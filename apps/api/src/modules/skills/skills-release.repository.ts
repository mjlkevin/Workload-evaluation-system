import { asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, type Database } from '../../db/client';
import { skillDefinitions, skillVersions, skillEvaluations, skillReleaseEvents, skillReleaseReviews } from '../../db/schema';
import { createSkillsPgRepository, mutateSkillTransaction, type SkillDbExecutor } from './skills-pg.repository';
import { schemaFits } from './skills.schema-compatibility';
import { SkillError, type SkillRecord } from './skills.types';
import type { SkillEvaluation, SkillReleaseRepository, SkillReleaseReview } from './skills-release.types';

export function currentSkillVersion(record: SkillRecord) { return record.versions.find(v => v.skillVersionId === record.currentVersionId)!; }
export function requireReleaseCandidate(record: SkillRecord): void {
  if (!record.enabled || record.archived) throw new SkillError('SKILL_DISABLED', '已停用或归档的 Skill 不能发布', 409);
  if (currentSkillVersion(record).checkoutStatus !== 'checked_in') throw new SkillError('SKILL_CHECKIN_REQUIRED', '请先检入再审核或发布', 409);
}
export function releasePending(): never { throw new SkillError('SKILL_RELEASE_GATE_PENDING', '需要当前定义的真实模型测试和审核证明', 409); }
export function releaseReason(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw new SkillError('SKILL_REASON_REQUIRED', '请填写审核或回滚原因');
  return value.trim();
}
function validEvaluation(evaluation: SkillEvaluation, record: SkillRecord, contextHash: string): boolean {
  const current = currentSkillVersion(record); const result = evaluation.result;
  return evaluation.skillId === record.skillId && evaluation.versionId === current.skillVersionId
    && evaluation.hash === current.hash && evaluation.contextHash === contextHash && result.definitionHash === current.hash
    && result.mode === 'model' && result.modelExecuted === true && result.passed === true && result.releaseEligible === true
    && result.cases.length > 0 && result.cases.length === current.definition.examples.length
    && result.failures.length === 0 && result.cases.every(item => item.passed && !item.failures.length && item.definitionHash === current.hash);
}
const iso = <T extends { createdAt: Date }>(row: T) => ({ ...row, createdAt: row.createdAt.toISOString() });
async function readEvidence(tx: Pick<SkillDbExecutor, 'select'>, skillId: string) {
  const evaluations = await tx.select().from(skillEvaluations).where(eq(skillEvaluations.skillId, skillId)).orderBy(asc(skillEvaluations.createdAt));
  const reviews = await tx.select().from(skillReleaseReviews).where(eq(skillReleaseReviews.skillId, skillId)).orderBy(asc(skillReleaseReviews.createdAt));
  const events = await tx.select().from(skillReleaseEvents).where(eq(skillReleaseEvents.skillId, skillId)).orderBy(asc(skillReleaseEvents.createdAt));
  return { evaluations: evaluations.map(iso), reviews: reviews.map(iso), events: events.map(iso) };
}
export function createSkillReleaseRepository(database: Database = db): SkillReleaseRepository {
  const roots = createSkillsPgRepository(database);
  return {
    async evidence(skillId) { return database.transaction(tx => readEvidence(tx, skillId), { isolationLevel: 'repeatable read', accessMode: 'read only' }); },
    async getPublishedVersion(skillId, versionId, hash, executor) {
      if (executor) {
        const [root] = await executor.select().from(skillDefinitions).where(eq(skillDefinitions.skillId, skillId));
        const [row] = await executor.select().from(skillVersions).where(eq(skillVersions.skillVersionId, versionId));
        if (!root || !row || row.skillId !== skillId || row.status !== 'published' || (hash && row.hash !== hash)) return null;
        const { skillId: _skillId, position: _position, ...version } = row;
        return { skillId, enabled: root.enabled, archived: root.archived, version: { ...version, createdAt: version.createdAt.toISOString(), updatedAt: version.updatedAt.toISOString() } };
      }
      const record = await roots.get(skillId);
      const version = record?.versions.find(v => v.skillVersionId === versionId && v.status === 'published' && (!hash || v.hash === hash));
      return record && version ? { skillId, enabled: record.enabled, archived: record.archived, version } : null;
    },
    async appendEvaluation(skillId, revision, actor, input) {
      // Copy before awaiting the transaction so no caller can change evidence while waiting for its root lock.
      const value = structuredClone(input); let evaluation!: SkillEvaluation;
      const record = await mutateSkillTransaction(database, skillId, revision, actor, 'trial', async (record, now, tx) => {
        const current = currentSkillVersion(record);
        if (current.skillVersionId !== value.versionId || current.hash !== value.hash || value.result.definitionHash !== value.hash) throw new SkillError('SKILL_REVISION_CONFLICT', '试运行期间定义已变化，请重新测试', 409);
        if (current.checkoutStatus === 'checked_out' && current.checkedOutBy !== actor.id) throw new SkillError('SKILL_LOCKED', '当前版本由其他管理员检出', 409);
        evaluation = { ...value, id: randomUUID(), skillId, snapshotRevision: revision, actorId: actor.id, createdAt: now };
        await tx.insert(skillEvaluations).values({ ...evaluation, createdAt: new Date(now) });
      });
      return { record, evaluation };
    },
    async review(skillId, revision, actor, input) {
      const value = { ...input, reason: releaseReason(input.reason) };
      return mutateSkillTransaction(database, skillId, revision, actor, 'review', async (record, now, tx) => {
        requireReleaseCandidate(record);
        if (currentSkillVersion(record).status === 'published') throw new SkillError('SKILL_PUBLISHED_IMMUTABLE', '已发布版本无需重复审核', 409);
        const contextHash = typeof value.contextHash === 'function' ? await value.contextHash(record, tx) : value.contextHash;
        const { evaluations } = await readEvidence(tx, skillId);
        const evaluation = evaluations.find(item => item.id === value.evaluationId);
        if (!evaluation || !validEvaluation(evaluation, record, contextHash)) releasePending();
        if (evaluation.result.simulatedSteps.length && value.acknowledgeSimulation !== true) throw new SkillError('SKILL_SIMULATION_ACK_REQUIRED', '请确认写入、外发或远程读取步骤仅为模拟，尚未验证正式操作', 409);
        const review: SkillReleaseReview = { id: randomUUID(), skillId, versionId: record.currentVersionId, evaluationId: evaluation.id,
          hash: currentSkillVersion(record).hash, contextHash, reason: value.reason,
          acknowledgedSimulation: value.acknowledgeSimulation === true, actorId: actor.id, createdAt: now };
        await tx.insert(skillReleaseReviews).values({ ...review, createdAt: new Date(now) });
        currentSkillVersion(record).status = 'reviewed';
      });
    },
    async publish(skillId, revision, actor, resolveContext) {
      return mutateSkillTransaction(database, skillId, revision, actor, 'publish', async (record, now, tx) => {
        requireReleaseCandidate(record);
        const current = currentSkillVersion(record);
        if (current.status !== 'reviewed') releasePending();
        const contextHash = typeof resolveContext === 'function' ? await resolveContext(record, tx) : resolveContext;
        const evidence = await readEvidence(tx, skillId);
        const review = [...evidence.reviews].reverse().find(item => item.versionId === current.skillVersionId && item.hash === current.hash && item.contextHash === contextHash);
        const evaluation = evidence.evaluations.find(item => item.id === review?.evaluationId);
        if (!review || !evaluation || !validEvaluation(evaluation, record, contextHash)
          || (evaluation.result.simulatedSteps.length > 0 && !review.acknowledgedSimulation)) releasePending();
        await tx.insert(skillReleaseEvents).values({ id: randomUUID(), skillId, versionId: current.skillVersionId,
          previousVersionId: record.activeVersionId, kind: 'publish', reason: review.reason, actorId: actor.id, createdAt: new Date(now) });
        current.status = 'published'; record.activeVersionId = current.skillVersionId;
      });
    },
    async rollback(skillId, revision, actor, targetVersionId, reason) {
      const explanation = releaseReason(reason);
      return mutateSkillTransaction(database, skillId, revision, actor, 'rollback', async (record, now, tx) => {
        requireReleaseCandidate(record);
        const target = record.versions.find(v => v.skillVersionId === targetVersionId && v.status === 'published');
        const active = record.versions.find(v => v.skillVersionId === record.activeVersionId);
        const events = (await readEvidence(tx, skillId)).events;
        if (!target || !active || !events.some(e => e.kind === 'publish' && e.versionId === targetVersionId)) throw new SkillError('SKILL_ROLLBACK_TARGET_INVALID', '目标必须是本 Skill 曾发布的版本', 409);
        if (target.skillVersionId === active.skillVersionId) throw new SkillError('SKILL_ALREADY_ACTIVE', '该版本已经生效', 409);
        // A caller accepted by the active input must remain valid on the target; target outputs satisfy the active contract.
        if (!schemaFits(active.definition.inputSchema, target.definition.inputSchema, active.definition.inputSchema, target.definition.inputSchema)
          || !schemaFits(target.definition.outputSchema, active.definition.outputSchema, target.definition.outputSchema, active.definition.outputSchema)) throw new SkillError('SKILL_ROLLBACK_INCOMPATIBLE', '目标版本的输入或输出与当前生效版本不兼容', 409);
        await tx.insert(skillReleaseEvents).values({ id: randomUUID(), skillId, versionId: targetVersionId,
          previousVersionId: record.activeVersionId, kind: 'rollback', reason: explanation, actorId: actor.id, createdAt: new Date(now) });
        record.activeVersionId = targetVersionId;
      });
    },
  };
}
