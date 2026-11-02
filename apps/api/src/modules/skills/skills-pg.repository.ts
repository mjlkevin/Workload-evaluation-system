import { asc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { db, type Database } from '../../db/client';
import { readDbNow } from '../../db/now';
import { skillDefinitions, skillRevisions, skillVersions } from '../../db/schema';
import type { SkillRepository } from './skills.repository';
import { skillDefinitionHash } from './skills.hash';
import { SkillError, type SkillActor, type SkillAudit, type SkillRecord, type SkillVersion } from './skills.types';

export type SkillDbExecutor = Pick<Database, 'select' | 'insert' | 'update' | 'execute'>;
type DefinitionRow = typeof skillDefinitions.$inferSelect;
const clone = <T>(value: T): T => structuredClone(value);
const internal = (error: unknown): SkillError => error instanceof SkillError ? error
  : new SkillError('SKILL_STORE_INTERNAL', '技能存储暂时不可用', 500);
function immutable(): never {
  throw new SkillError('SKILL_HISTORY_IMMUTABLE', '技能身份或历史版本不可修改', 409);
}

async function assemble(executor: SkillDbExecutor, rows: DefinitionRow[]): Promise<SkillRecord[]> {
  if (!rows.length) return [];
  const ids = rows.map(row => row.skillId);
  const versions = await executor.select().from(skillVersions).where(inArray(skillVersions.skillId, ids))
    .orderBy(asc(skillVersions.position));
  const revisions = await executor.select({ id: skillRevisions.id, skillId: skillRevisions.skillId,
    action: skillRevisions.action, actorId: skillRevisions.actorId, actorName: skillRevisions.actorName,
    createdAt: skillRevisions.createdAt, versionId: skillRevisions.versionId }).from(skillRevisions)
    .where(inArray(skillRevisions.skillId, ids))
    .orderBy(asc(skillRevisions.revision));
  return rows.map(row => ({
    skillId: row.skillId, enabled: row.enabled, archived: row.archived,
    activeVersionId: row.activeVersionId, currentVersionId: row.currentVersionId, revision: row.revision,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    versions: versions.filter(version => version.skillId === row.skillId).map(({ skillId, position, ...version }) => ({
      ...version, createdAt: version.createdAt.toISOString(), updatedAt: version.updatedAt.toISOString(),
    })),
    audit: revisions.filter(revision => revision.skillId === row.skillId).map(revision => ({
      id: revision.id, action: revision.action, actorId: revision.actorId, actorName: revision.actorName,
      createdAt: revision.createdAt.toISOString(), versionId: revision.versionId,
    })),
  }));
}

function verifyMutation(before: SkillRecord, next: SkillRecord, actor: SkillActor, action: string): void {
  if (next.skillId !== before.skillId || next.createdAt !== before.createdAt || next.revision !== before.revision
    || next.updatedAt !== before.updatedAt || !isDeepStrictEqual(next.audit, before.audit)
    || !Array.isArray(next.versions) || next.versions.length < before.versions.length) immutable();
  const ids = new Set(next.versions.map(version => version.skillVersionId));
  if (ids.size !== next.versions.length || !ids.has(next.currentVersionId)
    || (next.activeVersionId !== null && !ids.has(next.activeVersionId))) immutable();
  for (const [index, version] of before.versions.entries()) {
    const candidate = next.versions[index];
    if (!candidate || candidate.skillVersionId !== version.skillVersionId || candidate.majorLetter !== version.majorLetter
      || candidate.createdAt !== version.createdAt || candidate.updatedAt !== version.updatedAt) immutable();
    // Every older/noncurrent version is history, regardless of its former release status.
    if (version.status === 'published' || version.skillVersionId !== before.currentVersionId) {
      if (!isDeepStrictEqual(candidate, version)) immutable();
      continue;
    }
    if (['save-draft', 'checkin', 'undo-checkout', 'force-unlock'].includes(action)) {
      if (version.checkoutStatus !== 'checked_out') throw new SkillError('SKILL_CHECKOUT_REQUIRED', '请先检出编辑', 409);
      if (version.checkedOutBy !== actor.id && action !== 'force-unlock') throw new SkillError('SKILL_LOCKED', '当前版本由其他管理员检出', 409);
    }
    if (action === 'checkin') {
      if (candidate.minorNumber !== version.minorNumber + 1
        || candidate.versionCode !== `SK-${before.skillId.slice(0, 8)}-V${version.majorLetter}.${candidate.minorNumber}`
        || !isDeepStrictEqual(candidate.definition, version.definition)
        || !isDeepStrictEqual(candidate.lastCheckinDefinition, candidate.definition)) immutable();
    } else if (candidate.minorNumber !== version.minorNumber || candidate.versionCode !== version.versionCode
      || !isDeepStrictEqual(candidate.lastCheckinDefinition, version.lastCheckinDefinition)) immutable();
    const contentChanged = !isDeepStrictEqual(candidate.definition, version.definition);
    if (action === 'undo-checkout' || action === 'force-unlock') {
      if (!isDeepStrictEqual(candidate.definition, version.lastCheckinDefinition) || candidate.status !== 'draft') immutable();
    } else if (contentChanged && action !== 'save-draft') immutable();
    if (action === 'save-draft' && (candidate.checkoutStatus !== 'checked_out'
      || candidate.checkedOutBy !== actor.id || candidate.status !== 'draft')) immutable();
    const lockChanged = candidate.checkoutStatus !== version.checkoutStatus || candidate.checkedOutBy !== version.checkedOutBy;
    if (action === 'checkout') {
      if (version.checkoutStatus !== 'checked_in' || candidate.checkoutStatus !== 'checked_out' || candidate.checkedOutBy !== actor.id) immutable();
    } else if (['checkin', 'undo-checkout', 'force-unlock'].includes(action)) {
      if (candidate.checkoutStatus !== 'checked_in' || candidate.checkedOutBy !== null) immutable();
    } else if (lockChanged) immutable();
  }
  if (next.versions.some(version => version.hash !== skillDefinitionHash(version.definition))) immutable();
  // Prevent invalid pointers/states even if a caller bypasses the business usecase.
  if (next.versions.some(version => !['draft', 'reviewed', 'published'].includes(version.status)
    || !['checked_in', 'checked_out'].includes(version.checkoutStatus)
    || (version.checkoutStatus === 'checked_in' ? version.checkedOutBy !== null : !version.checkedOutBy))) immutable();
  if (next.activeVersionId !== null && next.versions.find(version => version.skillVersionId === next.activeVersionId)?.status !== 'published') immutable();
}

function metadata(record: SkillRecord, now: Date) {
  const current = record.versions.find(version => version.skillVersionId === record.currentVersionId)!;
  return { name: current.definition.name, description: current.definition.description, category: current.definition.category,
    enabled: record.enabled, archived: record.archived, activeVersionId: record.activeVersionId,
    currentVersionId: record.currentVersionId, revision: record.revision, updatedAt: now };
}
function versionRow(record: SkillRecord, version: SkillVersion, position: number) {
  return { ...clone(version), skillId: record.skillId, position,
    createdAt: new Date(version.createdAt), updatedAt: new Date(version.updatedAt) };
}
function addAudit(record: SkillRecord, actor: SkillActor, action: string, now: string): SkillAudit {
  const audit = { id: randomUUID(), action, actorId: actor.id, actorName: actor.username,
    createdAt: now, versionId: record.currentVersionId };
  record.audit.push(audit);
  return audit;
}
async function insertRevision(tx: SkillDbExecutor, record: SkillRecord, audit: SkillAudit): Promise<void> {
  await tx.insert(skillRevisions).values({ ...audit, skillId: record.skillId, revision: record.revision,
    snapshot: clone(record), createdAt: new Date(audit.createdAt) });
}

export function createSkillsPgRepository(dbInstance: Database = db): SkillRepository {
  return {
    async list() {
      try {
        return clone(await dbInstance.transaction(async tx => assemble(tx,
          await tx.select().from(skillDefinitions).orderBy(asc(skillDefinitions.createdAt), asc(skillDefinitions.skillId))),
        { isolationLevel: 'repeatable read', accessMode: 'read only' }));
      } catch (error) { throw internal(error); }
    },
    async get(skillId) {
      try {
        return clone(await dbInstance.transaction(async tx => (await assemble(tx,
          await tx.select().from(skillDefinitions).where(eq(skillDefinitions.skillId, skillId))))[0] ?? null,
        { isolationLevel: 'repeatable read', accessMode: 'read only' }));
      } catch (error) { throw internal(error); }
    },
    async create(definition, actor) {
      try {
        return await dbInstance.transaction(async tx => {
          const now = await readDbNow(tx); const iso = now.toISOString();
          const skillId = randomUUID(); const skillVersionId = randomUUID();
          const version: SkillVersion = {
            skillVersionId, versionCode: `SK-${skillId.slice(0, 8)}-VA.0`, majorLetter: 'A', minorNumber: 0,
            status: 'draft', checkoutStatus: 'checked_in', checkedOutBy: null,
            definition: clone(definition), lastCheckinDefinition: clone(definition),
            hash: skillDefinitionHash(definition), createdAt: iso, updatedAt: iso,
          };
          const record: SkillRecord = { skillId, enabled: true, archived: false, activeVersionId: null,
            currentVersionId: skillVersionId, revision: 1, versions: [version], audit: [], createdAt: iso, updatedAt: iso };
          const audit = addAudit(record, actor, 'create', iso);
          await tx.insert(skillDefinitions).values({ skillId, ...metadata(record, now), createdAt: now });
          await tx.insert(skillVersions).values(versionRow(record, version, 0));
          await insertRevision(tx, record, audit);
          return clone(record);
        });
      } catch (error) { throw internal(error); }
    },
    async mutate(skillId, expectedRevision, actor, action, update) {
      return mutateSkillTransaction(dbInstance, skillId, expectedRevision, actor, action, (record, now) => update(record, now));
    },
  };
}

/** Server-only transaction boundary shared with release evidence; never expose callbacks over HTTP. */
export async function mutateSkillTransaction(dbInstance: Database, skillId: string, expectedRevision: number,
  actor: SkillActor, action: string,
  update: (record: SkillRecord, now: string, tx: SkillDbExecutor) => void | Promise<void>): Promise<SkillRecord> {
      try {
        return await dbInstance.transaction(async tx => {
          // Lock the aggregate root before reading versions: no same-revision writer can observe a partial aggregate.
          const roots = await tx.select().from(skillDefinitions).where(eq(skillDefinitions.skillId, skillId)).for('update');
          if (!roots[0]) throw new SkillError('SKILL_NOT_FOUND', '技能不存在', 404);
          if (roots[0].revision !== expectedRevision) throw new SkillError('SKILL_REVISION_CONFLICT', '技能已更新，请刷新后重试', 409);
          const before = (await assemble(tx, roots))[0]; const candidate = clone(before);
          const now = await readDbNow(tx); const iso = now.toISOString();
          await update(candidate, iso, tx);
          verifyMutation(before, candidate, actor, action);
          // Detach from references retained by the callback before the first persistence await.
          const next = clone(candidate);
          next.revision = before.revision + 1; next.updatedAt = iso;
          for (const [position, version] of next.versions.entries()) {
            const previous = before.versions[position];
            if (!previous) { version.createdAt = iso; version.updatedAt = iso; }
            else if (!isDeepStrictEqual(previous, version)) version.updatedAt = iso;
          }
          const audit = addAudit(next, actor, action, iso);
          await tx.update(skillDefinitions).set(metadata(next, now)).where(eq(skillDefinitions.skillId, skillId));
          for (const [position, version] of next.versions.entries()) {
            if (!before.versions[position]) await tx.insert(skillVersions).values(versionRow(next, version, position));
            else if (!isDeepStrictEqual(before.versions[position], version)) await tx.update(skillVersions)
              .set(versionRow(next, version, position)).where(eq(skillVersions.skillVersionId, version.skillVersionId));
          }
          await insertRevision(tx, next, audit);
          return clone(next);
        });
      } catch (error) { throw internal(error); }
}
