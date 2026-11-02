import { randomUUID } from 'node:crypto';
import type { SkillRepository } from './skills.repository';
import { SkillError, type SkillActor, type SkillRecord } from './skills.types';
import { validateSkillDefinition, type SkillToolDefinition } from './skills.validation';
import { skillDefinitionHash } from './skills.hash';

export type SkillAction = 'checkout' | 'checkin' | 'undo-checkout' | 'force-unlock' | 'promote' | 'publish';
function revisionOf(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new SkillError('SKILL_REVISION_REQUIRED', '请重新读取当前版本后再操作', 400, [{ field: 'revision', reason: 'positive_integer_required' }]);
  return Number(value);
}
function current(record: SkillRecord) {
  const version = record.versions.find(item => item.skillVersionId === record.currentVersionId);
  if (!version) throw new SkillError('SKILL_STORE_INTERNAL', 'Skill 版本数据不完整', 500);
  return version;
}
function nextLetter(value: string): string {
  let carry = 1; let result = '';
  for (let i = value.length - 1; i >= 0; i--) { const n = value.charCodeAt(i) - 65 + carry; result = String.fromCharCode(65 + n % 26) + result; carry = Math.floor(n / 26); }
  return (carry ? 'A' : '') + result;
}
export function createSkillUsecase(repo: SkillRepository, getTools: () => Promise<SkillToolDefinition[]>) {
  const read = async (id: string) => {
    const record = await repo.get(id);
    if (!record) throw new SkillError('SKILL_NOT_FOUND', 'Skill 不存在', 404);
    return record;
  };
  return {
    get: read,
    async list(includeArchived = false) { return (await repo.list()).filter(item => includeArchived || !item.archived); },
    async create(value: unknown, actor: SkillActor) { return repo.create(validateSkillDefinition(value, await getTools()), actor); },
    async validate(value: unknown) { validateSkillDefinition(value, await getTools()); return { valid: true, releaseReady: false, reason: 'SKILL_RELEASE_GATE_PENDING' }; },
    async save(id: string, revision: unknown, actor: SkillActor, value: unknown) {
      const expected = revisionOf(revision);
      const definition = validateSkillDefinition(value, await getTools());
      return repo.mutate(id, expected, actor, 'save-draft', record => {
        const version = current(record);
        if (version.status === 'published') throw new SkillError('SKILL_PUBLISHED_IMMUTABLE', '已发布版本只读，请升版', 409);
        if (version.checkoutStatus !== 'checked_out') throw new SkillError('SKILL_CHECKOUT_REQUIRED', '请先检出编辑', 409);
        if (version.checkedOutBy !== actor.id) throw new SkillError('SKILL_LOCKED', '当前版本由其他管理员检出', 409);
        version.definition = definition; version.hash = skillDefinitionHash(definition); version.status = 'draft';
      });
    },
    async action(id: string, revision: unknown, actor: SkillActor, action: SkillAction) {
      const expected = revisionOf(revision);
      if (action === 'publish') {
        const record = await read(id);
        if (record.revision !== expected) throw new SkillError('SKILL_REVISION_CONFLICT', 'Skill 已更新，请重新读取', 409);
        throw new SkillError('SKILL_RELEASE_GATE_PENDING', '正式发布尚未开放：需接通同版本测试和审核门槛', 409, [{ field: 'publish', reason: 'testing_and_review_gate_pending' }]);
      }
      if (action === 'checkin') validateSkillDefinition(current(await read(id)).definition, await getTools());
      return repo.mutate(id, expected, actor, action, (record, now) => {
        const version = current(record);
        if (action === 'promote') {
          if (version.checkoutStatus !== 'checked_in') throw new SkillError('SKILL_CHECKIN_REQUIRED', '请先检入再升版', 409);
          const majorLetter = nextLetter(version.majorLetter); const id = randomUUID();
          record.versions.push({ ...structuredClone(version), skillVersionId: id, majorLetter, minorNumber: 0, versionCode: `SK-${record.skillId.slice(0, 8)}-V${majorLetter}.0`, status: 'draft', checkoutStatus: 'checked_in', checkedOutBy: null, lastCheckinDefinition: structuredClone(version.definition), createdAt: now, updatedAt: now });
          record.currentVersionId = id; return;
        }
        if (version.status === 'published') throw new SkillError('SKILL_PUBLISHED_IMMUTABLE', '已发布版本只读，请升版', 409);
        if (action === 'checkout') {
          if (version.checkoutStatus === 'checked_out') throw new SkillError('SKILL_LOCKED', '当前版本已被检出', 409);
          version.checkoutStatus = 'checked_out'; version.checkedOutBy = actor.id; return;
        }
        if (version.checkoutStatus !== 'checked_out') throw new SkillError('SKILL_CHECKOUT_REQUIRED', '当前版本尚未检出', 409);
        if (version.checkedOutBy !== actor.id && action !== 'force-unlock') throw new SkillError('SKILL_LOCKED', '当前版本由其他管理员检出', 409);
        if (action === 'checkin') {
          version.minorNumber++; version.versionCode = `SK-${record.skillId.slice(0, 8)}-V${version.majorLetter}.${version.minorNumber}`;
          version.lastCheckinDefinition = structuredClone(version.definition);
        } else if (action === 'undo-checkout' || action === 'force-unlock') {
          version.definition = structuredClone(version.lastCheckinDefinition); version.hash = skillDefinitionHash(version.definition); version.status = 'draft';
        } else throw new SkillError('SKILL_INVALID_ACTION', '不支持的版本操作');
        version.checkoutStatus = 'checked_in'; version.checkedOutBy = null;
      });
    },
    async setStatus(id: string, revision: unknown, actor: SkillActor, input: unknown) {
      const value = input as Record<string, unknown> | null;
      if (!value || typeof value !== 'object' || !Object.keys(value).length || Object.keys(value).some(key => !['enabled', 'archived'].includes(key) || typeof value[key] !== 'boolean')) throw new SkillError('SKILL_INVALID_STATUS', '启停和归档状态必须是布尔值');
      return repo.mutate(id, revisionOf(revision), actor, 'set-status', record => {
        if (typeof value.enabled === 'boolean') record.enabled = value.enabled;
        if (typeof value.archived === 'boolean') record.archived = value.archived;
        if (record.archived) record.enabled = false;
      });
    },
  };
}
