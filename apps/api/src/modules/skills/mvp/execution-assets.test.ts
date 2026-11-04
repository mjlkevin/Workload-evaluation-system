import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeExecutionAssets, validateFrozenExecutionAssets, validateFrozenSourceMaterials, assertExecutionAssetPermission } from './execution-assets';
import { assessmentCatalogDigest } from './assessment-matching';
import { skillDefinitionHash as hash } from '../skills.hash';
import type { AuthUser } from '../../../types';
const asset = () => {
  const template = { templateId: 'catalog-a', templateVersion: 'v1', templateName: 'Real owned catalog', groups: [],
    items: [{ templateItemId: 'item-a', groupId: 'g', itemName: 'Delivery point', standardDays: 2 }] };
  const ruleSet = { ruleSetId: 'rules-a', ruleVersion: 'v1', pipelineVersion: 'v1', pipeline: ['base'],
    baseRule: { userCountTiers: [{ min: 0, max: 100, factor: 1 }], difficultyFactorList: [1] }, orgIncrementRule: { enabled: false } };
  return { kind: 'assessment-catalog' as const, templateId: template.templateId, templateVersion: template.templateVersion,
    ruleSetId: ruleSet.ruleSetId, ruleVersion: ruleSet.ruleVersion, pipelineVersion: ruleSet.pipelineVersion,
    template, ruleSet, snapshotDigest: assessmentCatalogDigest({ template, ruleSet }) };
};
test('only exact server-resolvable asset references enter execution requests; empty stays optional', () => {
  assert.deepEqual(normalizeExecutionAssets(undefined), []); assert.deepEqual(normalizeExecutionAssets([]), []);
  assert.deepEqual(normalizeExecutionAssets([{ kind: 'assessment-catalog', templateId: 'catalog-a' }]), [{ kind: 'assessment-catalog', templateId: 'catalog-a' }]);
  for (const value of [null, [{ kind: 'assessment-catalog', templateId: '' }], [{ kind: 'assessment-catalog', templateId: '../secret' }],
    [{ kind: 'assessment-catalog', templateId: 'https://host' }], [{ kind: 'file', templateId: 'catalog-a' }],
    [{ kind: 'assessment-catalog', templateId: 'a', snapshotDigest: hash('fake') }],
    [{ kind: 'assessment-catalog', templateId: 'a', template: {} }], Array.from({ length: 11 }, (_, i) => ({ kind: 'assessment-catalog', templateId: `a-${i}` })),
    [{ kind: 'assessment-catalog', templateId: 'a' }, { kind: 'assessment-catalog', templateId: 'a' }]]) assert.throws(() => normalizeExecutionAssets(value));
});
test('persisted catalog stores exact template/rules and validates versions and full-content digest', () => {
  validateFrozenExecutionAssets([]); validateFrozenExecutionAssets([asset()]);
  for (const change of [(a: any) => a.template.items[0].standardDays++, (a: any) => a.ruleSet.pipeline.push('changed'),
    (a: any) => a.templateVersion = 'v2', (a: any) => a.ruleSetId = 'other', (a: any) => a.template.items = [],
    (a: any) => a.snapshot = {}, (a: any) => a.template = { templateId: 'catalog-a' }]) {
    const a = asset(); change(a); assert.throws(() => validateFrozenExecutionAssets([a]));
  }
  assert.throws(() => validateFrozenExecutionAssets([asset(), asset()]));
});
test('material digest preserves exact text/location, forbids fake snapshot/path fields and enforces bounded JSON', () => {
  const body = { id: 'message-a', kind: 'conversation' as const, text: '  exact text\n二行  ', location: 'message:message-a' };
  const source = { ...body, digest: hash(body) }; validateFrozenSourceMaterials([source]);
  for (const bad of [{ ...source, text: 'tampered' }, { ...source, filePath: '/tmp/private' }, { ...source, snapshot: {} },
    { ...source, text: 'x'.repeat(1024 * 1024) }, { ...source, kind: 'url' }, { ...source, text: '' }]) assert.throws(() => validateFrozenSourceMaterials([bad]));
  assert.throws(() => validateFrozenSourceMaterials([source, source]));
});
test('assets require current estimates:read permission and an active recognized role', () => {
  assertExecutionAssetPermission({ role: 'user', status: 'active' } as AuthUser);
  for (const user of [{ role: 'user', status: 'disabled' }, { role: 'unknown', status: 'active' }]) assert.throws(() => assertExecutionAssetPermission(user as AuthUser));
});
