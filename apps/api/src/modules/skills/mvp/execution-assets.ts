import type { AuthUser, Template, RuleSet } from '../../../types';
import type { ExecutionDbExecutor } from '../execution-manifest.types';
import { legacyRoleToV2Roles } from '../../../rbac/roles';
import { anyRoleHasCapability } from '../../../rbac/permissions';
import { SkillError } from '../skills.types';
import { skillDefinitionHash as hash } from '../skills.hash';
import { assessmentCatalogDigest, FROZEN_ASSESSMENT_CATALOG_SCHEMA } from './assessment-matching';
import { mvpArray, mvpObject, mvpText, parseMvpContract } from './requirements';
export type ExecutionAssetReference = { kind: 'assessment-catalog'; templateId: string };
export type FrozenExecutionAsset = ExecutionAssetReference & { template: Template; ruleSet: RuleSet; templateVersion: string;
  ruleSetId: string; ruleVersion: string; pipelineVersion: string; snapshotDigest: string };
export type FrozenSourceMaterial = { id: string; kind: 'file' | 'conversation'; text: string; location?: string; digest: string };
/** Trusted server preparation only. This envelope never belongs in an HTTP execution request. */
export type ExecutionSourceContext = { sourceMaterials: FrozenSourceMaterial[] };
export interface ExecutionAssetRepository {
  read(tx: ExecutionDbExecutor, references: ExecutionAssetReference[]): Promise<FrozenExecutionAsset[]>;
}
const id = { ...mvpText(160), pattern: '^[A-Za-z0-9_-]+$' };
const referenceShape = mvpObject({ kind: { const: 'assessment-catalog' }, templateId: id });
const referencesShape = mvpArray(referenceShape, 0, 10);
const materialShape = mvpObject({ id: mvpText(160), kind: { enum: ['file', 'conversation'] }, text: mvpText(200000),
  location: mvpText(1000), digest: { type: 'string', pattern: '^[a-f0-9]{64}$' } }, ['id', 'kind', 'text', 'digest']);
function invalid(code = 'EXECUTION_INVALID_REQUEST', status = 400): never { throw new SkillError(code, '执行资产或来源材料无效，请重新读取', status); }
function parse<T>(shape: Record<string, unknown>, value: unknown): T {
  try { return parseMvpContract<T>(shape, value); } catch { return invalid(); }
}
export function normalizeExecutionAssets(value: unknown): ExecutionAssetReference[] {
  if (value === undefined) return [];
  const references = parse<ExecutionAssetReference[]>(referencesShape, value);
  if (new Set(references.map(ref => ref.templateId)).size !== references.length) invalid();
  return references;
}
export function validateFrozenExecutionAssets(value: unknown): asserts value is FrozenExecutionAsset[] {
  if (!Array.isArray(value) || value.length > 10) invalid();
  const refs = value.map(item => ({ kind: item?.kind, templateId: item?.templateId }));
  normalizeExecutionAssets(refs);
  const assetFields = ['kind', 'templateId', 'templateVersion', 'ruleSetId', 'ruleVersion', 'pipelineVersion', 'template', 'ruleSet', 'snapshotDigest'];
  // The whole array is independently bounded, including every full catalog snapshot.
  parse(mvpArray({ type: 'object' }, 0, 10), value);
  for (const entry of value as FrozenExecutionAsset[]) {
    if (Object.keys(entry).length !== assetFields.length || Object.keys(entry).some(key => !assetFields.includes(key))) invalid();
    const catalog = parse<{ template: Template; ruleSet: RuleSet; snapshotDigest: string }>(FROZEN_ASSESSMENT_CATALOG_SCHEMA,
      { template: entry.template, ruleSet: entry.ruleSet, snapshotDigest: entry.snapshotDigest });
    if (entry.templateId !== catalog.template.templateId || entry.templateVersion !== catalog.template.templateVersion
      || entry.ruleSetId !== catalog.ruleSet.ruleSetId || entry.ruleVersion !== catalog.ruleSet.ruleVersion
      || entry.pipelineVersion !== catalog.ruleSet.pipelineVersion || entry.snapshotDigest !== assessmentCatalogDigest({ template: catalog.template, ruleSet: catalog.ruleSet })
      || new Set(catalog.template.items.map(item => item.templateItemId)).size !== catalog.template.items.length) invalid();
  }
}
export function validateFrozenSourceMaterials(value: unknown): asserts value is FrozenSourceMaterial[] {
  const materials = parse<FrozenSourceMaterial[]>(mvpArray(materialShape, 0, 100), value);
  if (new Set(materials.map(m => m.id)).size !== materials.length) invalid();
  for (const { digest, ...body } of materials) if (!body.id.trim() || !body.text.trim() || digest !== hash(body)) invalid();
}
export function assertExecutionAssetPermission(user: AuthUser): void {
  if (user.status !== 'active' || !['admin', 'user', 'sub_admin'].includes(user.role)
    || !anyRoleHasCapability(legacyRoleToV2Roles(user.role), 'estimates:read')) invalid('EXECUTION_FORBIDDEN', 403);
}
