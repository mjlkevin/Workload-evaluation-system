import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { versionRecords } from '../../db/schema';
import type { VersionRecord } from '../../types';
import { asString } from '../../utils';
import { applyVersionCodeFormat, formatHasSequenceToken } from '../../utils/version-code-format';
import { readVersionCodeRules } from '../system/system-pg.repository';
import { createDefaultRules } from '../system/version-code-defaults';

export type AssessmentCodeError = { errorCode: number; message: string; field: string; reason: string };
/** The caller MUST insert before this same transaction commits. Both ordinary assessment
 * creation and Skill drafts acquire this lock before reading codes; no pool is acquired here. */
export async function allocateAssessmentCodeInTransaction(tx: Pick<Database, 'select' | 'execute'>,
 input: Pick<VersionRecord, 'ownerUserId' | 'templateId' | 'versionCode' | 'payload'>, now: Date): Promise<{ versionCode: string } | AssessmentCodeError> {
 await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`assessment-code:${input.ownerUserId}:${input.templateId}`}, 0))`);
 const rows = await tx.select({ code: versionRecords.versionCode }).from(versionRecords)
  .where(and(eq(versionRecords.ownerUserId, input.ownerUserId), eq(versionRecords.type, 'assessment'), eq(versionRecords.templateId, input.templateId)));
 const codes = new Set(rows.map(r => r.code));
 // Explicit normal version codes retain their existing behavior, including allowing inactive rules.
 if (input.versionCode) return codes.has(input.versionCode)
  ? { errorCode: 40901, message: '版本号已存在，不可覆盖（不可变版本）', field: 'versionCode', reason: 'already_exists' }
  : { versionCode: input.versionCode };
 const store = await readVersionCodeRules(tx);
 const rule = (store.rules.length ? store.rules : createDefaultRules(now)).find(r => r.moduleKey === 'implementation');
 if (!rule) return { errorCode: 40401, message: '版本号编码规则不存在', field: 'moduleKey', reason: 'rule_not_found' };
 if (rule.status !== 'active') return { errorCode: 40902, message: '当前模块编码规则未生效，请先在系统管理中生效', field: 'moduleKey', reason: 'rule_not_active' };
 const format = rule.format || '{PREFIX}-{YYYYMMDD}-{NNN}', hasSequence = formatHasSequenceToken(format);
 const globalCode = (asString(input.payload.globalVersionCode) || 'GL000').split('-V')[0] || 'GL000';
 for (let seq = 1; seq <= 9999; seq++) {
  if (!hasSequence && seq > 1) break;
  const versionCode = applyVersionCodeFormat(format, { prefix: rule.prefix, moduleCode: rule.moduleCode, globalCode, seq, now });
  if (!codes.has(versionCode)) return { versionCode };
 }
 return { errorCode: 40901, message: hasSequence ? '版本号已存在，请重试' : '编码规则缺少序号占位符，无法保证版本号唯一',
  field: 'versionCodeRule', reason: hasSequence ? 'conflict' : 'missing_sequence_placeholder' };
}
