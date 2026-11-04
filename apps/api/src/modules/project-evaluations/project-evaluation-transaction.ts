import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { readDbNow } from '../../db/now';
import { users, versionRecords } from '../../db/schema';
import type { VersionRecord } from '../../types';
import { asString } from '../../utils';
import { applyVersionCodeFormat, formatHasSequenceToken } from '../../utils/version-code-format';
import { createDefaultRules } from '../system/version-code-defaults';
import { readVersionCodeRules } from '../system/system-pg.repository';
import { readActiveProductAssignments } from '../master-data/product-master-data-pg.repository';
import { buildProductMasterSnapshot } from '../master-data/product-master-data.usecase';
import { toRowValues } from '../versions/versions-pg.repository';
import { PROJECT_EVALUATION_RECORD_KIND, mapGlobalVersionToProject } from './project-evaluations.repository';

/** A caller-owned transaction only: no pool access, nested transaction or external I/O. */
type ProjectTransaction = Pick<Database, 'select' | 'insert' | 'execute'>;
export async function createProjectEvaluationInTransaction(tx: ProjectTransaction, ownerId: string, input: Record<string, unknown>) {
  // Both normal creation and explicit Skill creation share this owner allocation lock.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`project-evaluation-code:${ownerId}`}, 0))`);
  const [owner] = await tx.select({ username: users.username, status: users.status }).from(users).where(eq(users.userId, ownerId)).for('share');
  if (!owner || owner.status !== 'active') throw new Error('PROJECT_OWNER_UNAVAILABLE');
  const now = await readDbNow(tx), nowIso = now.toISOString();
  const rules = await readVersionCodeRules(tx);
  // Empty PG tables retain the normal accessor's built-in defaults without seeding rows.
  const rule = (rules.rules.length ? rules.rules : createDefaultRules(now)).find(r => r.moduleKey === 'global' && r.status === 'active');
  let versionCode: string | undefined;
  if (rule) {
    const existing = await tx.select({ versionCode: versionRecords.versionCode }).from(versionRecords)
      .where(and(eq(versionRecords.ownerUserId, ownerId), eq(versionRecords.type, 'global')));
    const codes = new Set(existing.map(r => r.versionCode));
    const format = rule.format || '{PREFIX}-{YYYYMMDD}-{NNN}';
    for (let seq = 1; seq <= 9999; seq++) {
      if (seq > 1 && !formatHasSequenceToken(format)) break;
      const candidate = applyVersionCodeFormat(format, { prefix: rule.prefix, moduleCode: rule.moduleCode, globalCode: 'GL000', seq, now });
      if (!codes.has(candidate)) { versionCode = candidate; break; }
    }
  }
  versionCode ??= `PROJECT-${randomUUID()}`;
  const productMasterSnapshot = buildProductMasterSnapshot(await readActiveProductAssignments(tx));
  const record: VersionRecord = {
    id: randomUUID(), type: 'global', versionCode, templateId: 'project-evaluation', ownerUserId: ownerId, status: 'draft',
    payload: { recordKind: PROJECT_EVALUATION_RECORD_KIND, projectName: asString(input.projectName) || '新项目评估',
      customerName: asString(input.customerName), industry: asString(input.industry), currentStage: asString(input.currentStage) || 'project_discovery',
      projectStatus: 'draft', createdFromSessionId: asString(input.createdFromSessionId), totalDays: Number(input.totalDays) || 0, productMasterSnapshot },
    createdAt: nowIso, updatedAt: nowIso, createdByUserId: ownerId, updatedByUserId: ownerId,
    createdByUsername: owner.username, updatedByUsername: owner.username, checkoutStatus: 'checked_in', versionDocStatus: 'drafting',
    majorLetter: 'A', minorNumber: 0, baseCode: versionCode, isHistoricalArchive: false, lastCheckinPayload: {},
  };
  // Creation must fail on conflict, never overwrite an existing business record.
  await tx.insert(versionRecords).values(toRowValues(record));
  return mapGlobalVersionToProject(record);
}
