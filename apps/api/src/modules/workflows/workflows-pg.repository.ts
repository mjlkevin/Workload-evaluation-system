import { asc, eq, inArray, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual as same } from 'node:util';
import { db, type Database } from '../../db/client';
import { readDbNow } from '../../db/now';
import { workflowDefinitions as roots, workflowVersions as versions, workflowRevisions as revisions, workflowSkillDependencies as dependencies } from '../../db/schema';
import { newWorkflowVersion } from './workflows.version';
import { verifyWorkflowMutation } from './workflows.guards';
import { WorkflowError, type WorkflowRecord, type WorkflowVersion, type WorkflowActor } from './workflows.types';
import type { WorkflowRepository, WorkflowDbExecutor } from './workflows.repository';
const clone = <T>(v: T): T => structuredClone(v);
const internal = (e: unknown) => e instanceof WorkflowError ? e : new WorkflowError('WORKFLOW_STORE_INTERNAL', '工作流存储暂不可用', 500);
async function assemble(tx: WorkflowDbExecutor, rows: typeof roots.$inferSelect[]): Promise<WorkflowRecord[]> {
    if (!rows.length)
        return [];
    const ids = rows.map(r => r.workflowId);
    const allVersions = await tx.select().from(versions).where(inArray(versions.workflowId, ids)).orderBy(asc(versions.position));
    const allAudit = await tx.select({ id: revisions.id, workflowId: revisions.workflowId, action: revisions.action, actorId: revisions.actorId, actorName: revisions.actorName,
        reason: revisions.reason, versionId: revisions.versionId, createdAt: revisions.createdAt }).from(revisions).where(inArray(revisions.workflowId, ids)).orderBy(asc(revisions.revision));
    return rows.map(({ name: _name, description: _description, category: _category, ...r }) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
        versions: allVersions.filter(v => v.workflowId === r.workflowId).map(({ workflowId: _workflowId, position: _position, ...v }) => ({ ...v, createdAt: v.createdAt.toISOString(), updatedAt: v.updatedAt.toISOString() })),
        audit: allAudit.filter(a => a.workflowId === r.workflowId).map(({ workflowId: _workflowId, ...a }) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    }));
}
function metadata(r: WorkflowRecord, now: Date) {
    const d = r.versions.find(v => v.workflowVersionId === r.currentVersionId)!.definition;
    return { name: d.name, description: d.description, category: d.category, enabled: r.enabled, archived: r.archived, currentVersionId: r.currentVersionId, activeVersionId: r.activeVersionId, revision: r.revision, updatedAt: now };
}
const versionRow = (r: WorkflowRecord, v: WorkflowVersion, position: number) => ({ ...clone(v), workflowId: r.workflowId, position, createdAt: new Date(v.createdAt), updatedAt: new Date(v.updatedAt) });
function audit(r: WorkflowRecord, actor: WorkflowActor, action: string, now: string, reason?: string) {
    const row = { id: randomUUID(), versionId: r.currentVersionId, actorId: actor.id, actorName: actor.username, action, reason: reason ?? null, createdAt: now };
    r.audit.push(row);
    const root = { workflowId: r.workflowId, enabled: r.enabled, archived: r.archived, currentVersionId: r.currentVersionId, activeVersionId: r.activeVersionId, revision: r.revision, createdAt: r.createdAt, updatedAt: r.updatedAt };
    const snapshot = { root, version: clone(r.versions.find(v => v.workflowVersionId === r.currentVersionId)!), event: clone(row) };
    return { ...row, workflowId: r.workflowId, revision: r.revision, snapshot, createdAt: new Date(now) };
}
async function indexVersion(tx: WorkflowDbExecutor, v: WorkflowVersion, replace: boolean) {
    if (replace)
        await tx.delete(dependencies).where(eq(dependencies.versionId, v.workflowVersionId));
    const bindings = v.definition.steps.flatMap(s => s.type === 'skill' ? [{ versionId: v.workflowVersionId, stepId: s.id, skillId: s.skillId, skillVersionId: s.skillVersionId }] : []);
    if (bindings.length)
        await tx.insert(dependencies).values(bindings);
}
export function createWorkflowsPgRepository(database: Database = db): WorkflowRepository {
    const repository: WorkflowRepository = {
        async list() { try {
            return clone(await database.transaction(async (tx) => assemble(tx, await tx.select().from(roots).orderBy(asc(roots.createdAt))), { isolationLevel: 'repeatable read', accessMode: 'read only' }));
        }
        catch (e) {
            throw internal(e);
        } },
        async get(id) { try {
            return clone(await database.transaction(async (tx) => (await assemble(tx, await tx.select().from(roots).where(eq(roots.workflowId, id))))[0] ?? null, { isolationLevel: 'repeatable read', accessMode: 'read only' }));
        }
        catch (e) {
            throw internal(e);
        } },
        async create(definition, actor) {
            try {
                return await database.transaction(async (tx) => {
                    const now = await readDbNow(tx);
                    const iso = now.toISOString();
                    const workflowId = randomUUID();
                    const version = newWorkflowVersion(workflowId, definition, iso);
                    const r: WorkflowRecord = { workflowId, enabled: true, archived: false, currentVersionId: version.workflowVersionId, activeVersionId: null, revision: 1, versions: [version], audit: [], createdAt: iso, updatedAt: iso };
                    await tx.insert(roots).values({ workflowId, ...metadata(r, now), createdAt: now });
                    await tx.insert(versions).values(versionRow(r, version, 0));
                    await indexVersion(tx, version, false);
                    await tx.insert(revisions).values(audit(r, actor, 'create', iso));
                    return clone(r);
                });
            }
            catch (e) {
                throw internal(e);
            }
        },
        async mutate(id, expected, actor, action, update, reason) {
            try {
                return await database.transaction(async (tx) => {
                    const rows = await tx.select().from(roots).where(eq(roots.workflowId, id)).for('update');
                    if (!rows[0])
                        throw new WorkflowError('WORKFLOW_NOT_FOUND', '工作流不存在', 404);
                    if (rows[0].revision !== expected)
                        throw new WorkflowError('WORKFLOW_REVISION_CONFLICT', '工作流已更新，请刷新后重试', 409);
                    const before = (await assemble(tx, rows))[0];
                    const candidate = clone(before);
                    const now = await readDbNow(tx);
                    const iso = now.toISOString();
                    await update(candidate, iso, tx);
                    verifyWorkflowMutation(before, candidate, actor, action);
                    const next = clone(candidate);
                    next.revision++;
                    next.updatedAt = iso;
                    await tx.update(roots).set(metadata(next, now)).where(eq(roots.workflowId, id));
                    for (const [position, v] of next.versions.entries()) {
                        const old = before.versions[position];
                        if (!old) {
                            v.createdAt = iso;
                            v.updatedAt = iso;
                            await tx.insert(versions).values(versionRow(next, v, position));
                            await indexVersion(tx, v, false);
                        }
                        else if (!same(old, v)) {
                            // Update the dependency index while this version is still editable, before setting published status.
                            if (!same(old.definition, v.definition))
                                await indexVersion(tx, v, true);
                            v.updatedAt = iso;
                            await tx.update(versions).set(versionRow(next, v, position)).where(eq(versions.workflowVersionId, v.workflowVersionId));
                        }
                    }
                    await tx.insert(revisions).values(audit(next, actor, action, iso, reason));
                    return clone(next);
                });
            }
            catch (e) {
                throw internal(e);
            }
        },
        async influences(skillId, versionId) {
            try {
                return await database.transaction(async (tx) => {
                    const rows = await tx.select({ binding: dependencies, root: roots, version: versions }).from(dependencies)
                        .innerJoin(versions, eq(versions.workflowVersionId, dependencies.versionId)).innerJoin(roots, eq(roots.workflowId, versions.workflowId))
                        .where(versionId ? and(eq(dependencies.skillId, skillId), eq(dependencies.skillVersionId, versionId)) : eq(dependencies.skillId, skillId));
                    return rows.map(({ binding: d, root: r, version: v }) => ({ workflowId: r.workflowId, workflowVersionId: v.workflowVersionId, versionCode: v.versionCode, stepId: d.stepId, skillId: d.skillId, skillVersionId: d.skillVersionId,
                        workflowName: v.definition.name, enabled: r.enabled, archived: r.archived, current: r.currentVersionId === v.workflowVersionId, active: r.activeVersionId === v.workflowVersionId,
                        history: r.currentVersionId !== v.workflowVersionId, published: v.status === 'published', binding: 'fixed' as const, upgradePath: 'promote → checkout → update exact skillVersionId → checkin → validate → review → publish' }));
                }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
            }
            catch (e) {
                throw internal(e);
            }
        },
    };
    return repository;
}
