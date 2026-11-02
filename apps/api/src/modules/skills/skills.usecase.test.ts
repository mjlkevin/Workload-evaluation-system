import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { createSkillUsecase } from './skills.usecase';
import { validateSkillDefinition } from './skills.validation';
import { skillDefinitionHash } from './skills.hash';
import { SkillError, type SkillDefinition, type SkillRecord } from './skills.types';
import type { SkillRepository } from './skills.repository';
import { buildCreateProjectTool, buildExportReportTool } from '../../agent/tools/mutation.tools';
import Ajv from 'ajv';

const actor = { id: 'admin-one', username: '管理员一' };
const other = { id: 'admin-two', username: '管理员二' };
const tools = [{ name: 'lookup', description: '查询', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, mutates: false }];
export function definition(): SkillDefinition {
  return { name: '需求拆解', description: '拆解业务诉求', category: '需求', instructions: '依据原文拆解，不补造事实。', roles: ['pre_sales'], references: [], inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }, outputSchema: { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'], additionalProperties: false }, model: { scenario: 'assessment', temperature: 0.1, maxTokens: 4000, timeoutMs: 60000 }, tools: [], examples: [{ title: '简单需求', input: { text: '统一审批' }, expected: { items: ['审批配置'] } }] };
}
function fixture() {
  let record: SkillRecord | null = null;
  const now = '2026-11-02T00:00:00.000Z';
  const repo: SkillRepository = {
    async list() { return record ? [structuredClone(record)] : []; },
    async get(id) { return record?.skillId === id ? structuredClone(record) : null; },
    async create(d) {
      const hash = createHash('sha256').update(JSON.stringify(d)).digest('hex');
      record = { skillId: 'skill-1', enabled: false, archived: false, activeVersionId: null, revision: 1, currentVersionId: 'version-1', versions: [{ skillVersionId: 'version-1', versionCode: 'SK-1-VA.0', majorLetter: 'A', minorNumber: 0, status: 'draft', checkoutStatus: 'checked_in', checkedOutBy: null, definition: structuredClone(d), lastCheckinDefinition: structuredClone(d), hash, createdAt: now, updatedAt: now }], audit: [], createdAt: now, updatedAt: now };
      return structuredClone(record);
    },
    async mutate(id, revision, _actor, _action, update) {
      if (!record || record.skillId !== id) throw new SkillError('SKILL_NOT_FOUND', '不存在', 404);
      if (record.revision !== revision) throw new SkillError('SKILL_REVISION_CONFLICT', '版本已更新', 409);
      const next = structuredClone(record); update(next, now); next.revision++; record = next; return structuredClone(record);
    },
  };
  return { service: createSkillUsecase(repo, async () => tools), repo };
}
const rejectsCode = (code: string) => (error: unknown) => error instanceof SkillError && error.code === code;

test('definition hash is stable across jsonb object ordering but preserves array order', () => {
  assert.equal(skillDefinitionHash({ name: '需求', model: { scenario: 'assessment', temperature: 0.1 } }), skillDefinitionHash({ model: { temperature: 0.1, scenario: 'assessment' }, name: '需求' }));
  assert.notEqual(skillDefinitionHash({ roles: ['pm', 'pre_sales'] }), skillDefinitionHash({ roles: ['pre_sales', 'pm'] }));
});

test('definition rejects remote refs, unbounded regex and recursive schema', () => {
  for (const schema of [{ type: 'object', $ref: 'https://invalid.example/schema' }, { type: 'object', properties: { x: { type: 'string', pattern: '(a+)+' } } }, { type: 'object', $defs: { x: { $ref: '#/$defs/x' } }, properties: { x: { $ref: '#/$defs/x' } } }]) {
    const d = definition(); d.inputSchema = schema;
    assert.throws(() => validateSkillDefinition(d, tools), rejectsCode('SKILL_INVALID_DEFINITION'));
  }
});
test('definition checks schema validity, role/model bounds and example types', () => {
  const cases = [() => ({ ...definition(), inputSchema: { type: 'unknown' } }), () => ({ ...definition(), roles: ['super-admin'] }), () => ({ ...definition(), model: { ...definition().model, timeoutMs: -1 } }), () => ({ ...definition(), examples: [{ title: '错例', input: { text: 4 }, expected: { items: [] } }] })];
  for (const make of cases) assert.throws(() => validateSkillDefinition(make(), tools), rejectsCode('SKILL_INVALID_DEFINITION'));
});
test('tools must exist and mapped fields must match native parameter types', () => {
  const d = definition(); d.tools = [{ toolName: 'invented', inputMapping: {}, requiresConfirmation: false }];
  assert.throws(() => validateSkillDefinition(d, tools), rejectsCode('SKILL_INVALID_DEFINITION'));
  d.tools[0] = { toolName: 'lookup', inputMapping: { query: '$.text' }, requiresConfirmation: false };
  assert.equal(validateSkillDefinition(d, tools).name, d.name);
  d.tools[0].inputMapping = { unknown: '$.text' };
  assert.throws(() => validateSkillDefinition(d, tools), rejectsCode('SKILL_INVALID_DEFINITION'));
  d.tools[0].inputMapping = { query: '$.count' }; d.inputSchema = { type: 'object', properties: { count: { type: 'number' } } }; d.examples = [];
  assert.throws(() => validateSkillDefinition(d, tools), rejectsCode('SKILL_INVALID_DEFINITION'));
});
test('real Registry enum and mandatory source constraints cannot be weakened by a mapping', () => {
  const native = [buildCreateProjectTool(async () => ({})), buildExportReportTool(async () => ({}))];
  const d = definition(); d.examples = [];
  d.inputSchema = { type: 'object', properties: { format: { type: 'string', enum: ['zip'] } }, required: ['format'] };
  d.tools = [{ toolName: 'export_report', inputMapping: { exportType: '$.format' }, requiresConfirmation: true }];
  assert.throws(() => validateSkillDefinition(d, native), rejectsCode('SKILL_INVALID_DEFINITION'));
  d.inputSchema = { type: 'object', properties: { name: { type: 'string' } } };
  d.tools = [{ toolName: 'create_project', inputMapping: { projectName: '$.name' }, requiresConfirmation: true }];
  assert.throws(() => validateSkillDefinition(d, native), rejectsCode('SKILL_INVALID_DEFINITION'));
  d.inputSchema = { ...d.inputSchema, required: ['name'] };
  assert.equal(validateSkillDefinition(d, native).name, d.name);
});
test('nested and array native constraints need provably compatible source schemas', () => {
  const d = definition(); d.examples = [];
  const native = [{ name: 'nested', description: '', mutates: false, parameters: { type: 'object', properties: { payload: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1 } }, additionalProperties: false } }, required: ['payload'] } }];
  d.inputSchema = { type: 'object', properties: { payload: { type: 'object', properties: { name: { type: 'number' } } } }, required: ['payload'] };
  d.tools = [{ toolName: 'nested', inputMapping: { payload: '$.payload' }, requiresConfirmation: false }];
  assert.throws(() => validateSkillDefinition(d, native), rejectsCode('SKILL_INVALID_DEFINITION'));
  d.inputSchema = { type: 'object', properties: { payload: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1 } }, additionalProperties: false } }, required: ['payload'] };
  assert.equal(validateSkillDefinition(d, native).name, d.name);
});
test('mapping rejects nullable or untyped intermediate paths', () => {
  const d = definition(); d.examples = [];
  d.inputSchema = { type: 'object', required: ['container'], properties: { container: { properties: { name: { type: 'string' } }, required: ['name'] } } };
  d.tools = [{ toolName: 'create_project', inputMapping: { projectName: '$.container.name' }, requiresConfirmation: true }];
  assert.throws(() => validateSkillDefinition(d, [buildCreateProjectTool(async () => ({}))]), rejectsCode('SKILL_INVALID_DEFINITION'));
});
test('mapping rejects native arrays forbidding items', () => {
  const d = definition(); d.examples = [];
  d.inputSchema = { type: 'object', required: ['items'], properties: { items: { type: 'array', items: { type: 'string' } } } };
  d.tools = [{ toolName: 'empty-only', inputMapping: { items: '$.items' }, requiresConfirmation: false }];
  const native = [{ name: 'empty-only', description: '', mutates: false, parameters: { type: 'object', required: ['items'], properties: { items: { type: 'array', items: false } } } }];
  assert.throws(() => validateSkillDefinition(d, native), rejectsCode('SKILL_INVALID_DEFINITION'));
});
for (const [label, source, target, value] of [
  ['lower', { minimum: 1 }, { minimum: 5, exclusiveMinimum: 0 }, 1],
  ['upper', { maximum: 9 }, { maximum: 5, exclusiveMaximum: 10 }, 9],
] as const) test(`native ${label} bounds are conjunctive`, () => {
  const d = definition();
  d.inputSchema = { type: 'object', required: ['amount'], properties: { amount: { type: 'number', ...source } } };
  d.examples = [{ title: '边界输入', input: { amount: value }, expected: { items: [] } }];
  d.tools = [{ toolName: 'bounded', inputMapping: { amount: '$.amount' }, requiresConfirmation: false }];
  const native = [{ name: 'bounded', description: '', mutates: false, parameters: { type: 'object', required: ['amount'], properties: { amount: { type: 'number', ...target } } } }];
  assert.throws(() => validateSkillDefinition(d, native), rejectsCode('SKILL_INVALID_DEFINITION'));
});
test('native root-level constraints cannot disappear when fields are mapped', () => {
  const d = definition(); d.tools = [{ toolName: 'fixed-text', inputMapping: { text: '$.text' }, requiresConfirmation: false }];
  const native = [{ name: 'fixed-text', description: '', mutates: false, parameters: { type: 'object', required: ['text'], properties: { text: { type: 'string' } }, allOf: [{ properties: { text: { const: 'fixed' } } }] } }];
  assert.throws(() => validateSkillDefinition(d, native), rejectsCode('SKILL_INVALID_DEFINITION'));
});
test('repeated validation does not retain an unbounded AJV compilation cache', () => {
  const observed = new Set<Ajv>(); const compile = Ajv.prototype.compile;
  Ajv.prototype.compile = function (this: Ajv, ...args: Parameters<Ajv['compile']>) { observed.add(this); return compile.apply(this, args); } as Ajv['compile'];
  try {
    for (let i = 0; i < 10; i++) validateSkillDefinition(definition(), tools);
    assert.ok(observed.size > 0);
    assert.ok([...observed].every(instance => (instance as unknown as { _cache: Map<unknown, unknown> })._cache.size <= 4), 'temporary schemas must not accumulate in a process-global compiler');
  } finally { Ajv.prototype.compile = compile; }
});
test('unregistered fields and credential-bearing definitions cannot be persisted', () => {
  assert.throws(() => validateSkillDefinition({ ...definition(), model: { ...definition().model, apiKey: 'EXAMPLE_VALUE' } }, tools), rejectsCode('SKILL_INVALID_DEFINITION'));
  assert.throws(() => validateSkillDefinition({ ...definition(), unexpected: true }, tools), rejectsCode('SKILL_INVALID_DEFINITION'));
});
test('checkin is readonly, checkout owner edits, stale revision fails without losing data', async () => {
  const { service } = fixture(); const r = await service.create(definition(), actor); const id = r.skillId;
  await assert.rejects(service.save(id, r.revision, actor, definition()), rejectsCode('SKILL_CHECKOUT_REQUIRED'));
  const editing = await service.action(id, r.revision, actor, 'checkout');
  await assert.rejects(service.action(id, editing.revision, other, 'checkout'), rejectsCode('SKILL_LOCKED'));
  await assert.rejects(service.save(id, r.revision, actor, definition()), rejectsCode('SKILL_REVISION_CONFLICT'));
  const changed = { ...definition(), instructions: '更新后的业务方法' };
  const saved = await service.save(id, editing.revision, actor, changed);
  await assert.rejects(service.save(id, saved.revision, other, definition()), rejectsCode('SKILL_LOCKED'));
  const checked = await service.action(id, saved.revision, actor, 'checkin');
  assert.equal(checked.versions[0].checkoutStatus, 'checked_in'); assert.equal(checked.versions[0].minorNumber, 1);
  assert.equal(checked.versions[0].definition.instructions, changed.instructions);
});
test('undo restores latest checkin and force unlock has explicit operation', async () => {
  const { service } = fixture(); let r = await service.create(definition(), actor);
  r = await service.action(r.skillId, r.revision, actor, 'checkout');
  r = await service.save(r.skillId, r.revision, actor, { ...definition(), name: '未签入' });
  r = await service.action(r.skillId, r.revision, other, 'force-unlock');
  assert.equal(r.versions[0].definition.name, '需求拆解'); assert.equal(r.versions[0].checkoutStatus, 'checked_in');
  r = await service.action(r.skillId, r.revision, actor, 'checkout');
  r = await service.save(r.skillId, r.revision, actor, { ...definition(), name: '仍未签入' });
  r = await service.action(r.skillId, r.revision, actor, 'undo-checkout');
  assert.equal(r.versions[0].definition.name, '需求拆解');
});
test('promote preserves old version and production release always fails closed in A', async () => {
  const { service, repo } = fixture(); let r = await service.create(definition(), actor);
  r = await service.action(r.skillId, r.revision, actor, 'promote');
  assert.equal(r.versions.length, 2); assert.equal(r.versions[1].majorLetter, 'B');
  assert.equal(r.versions[0].majorLetter, 'A'); assert.notEqual(r.currentVersionId, r.versions[0].skillVersionId);
  await assert.rejects(service.action(r.skillId, r.revision, actor, 'publish'), rejectsCode('SKILL_RELEASE_GATE_PENDING'));
  const stored = await repo.get(r.skillId); assert.equal(stored?.activeVersionId, null); assert.equal(stored?.revision, r.revision);
});
test('enabled/archived are boolean operations and archived skills are hidden by default', async () => {
  const { service } = fixture(); const r = await service.create(definition(), actor);
  await assert.rejects(service.setStatus(r.skillId, r.revision, actor, { enabled: 'false' }), rejectsCode('SKILL_INVALID_STATUS'));
  const archived = await service.setStatus(r.skillId, r.revision, actor, { archived: true });
  assert.equal(archived.archived, true); assert.deepEqual(await service.list(), []); assert.equal((await service.list(true)).length, 1);
});
