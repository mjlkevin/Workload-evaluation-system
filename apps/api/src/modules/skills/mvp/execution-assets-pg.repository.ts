import type { RuleSet, Template } from '../../../types';
import { desc } from 'drizzle-orm';
import { ruleSets } from '../../../db/schema';
import { deriveTemplateFromProductTables } from '../../templates/product-template-derivation';
import { SkillError } from '../skills.types';
import { assessmentCatalogDigest } from './assessment-matching';
import { validateFrozenExecutionAssets, type ExecutionAssetRepository, type FrozenExecutionAsset } from './execution-assets';
/** Select-only repository: both phases use the supplied connection; no pool or nested transaction. */
export function createExecutionAssetPgRepository(): ExecutionAssetRepository {
  return { async read(tx, references) {
    if (!references.length) return [];
    try {
      const [row] = await tx.select().from(ruleSets).orderBy(desc(ruleSets.updatedAt), desc(ruleSets.ruleSetId)).limit(1);
      if (!row) throw new Error('RULE_SET_MISSING');
      const ruleSet: RuleSet = { ruleSetId: row.ruleSetId, ruleVersion: row.ruleVersion, pipelineVersion: row.pipelineVersion,
        pipeline: row.pipeline as RuleSet['pipeline'], baseRule: row.baseRule as RuleSet['baseRule'], orgIncrementRule: row.orgIncrementRule as RuleSet['orgIncrementRule'] };
      const values: FrozenExecutionAsset[] = [];
      for (const reference of references) {
        // Derived optional fields use undefined; JSON storage omits them consistently with the authoritative Template API.
        const template: Template = JSON.parse(JSON.stringify(await deriveTemplateFromProductTables(tx, reference.templateId)));
        values.push({ ...reference, template, ruleSet, templateVersion: template.templateVersion, ruleSetId: ruleSet.ruleSetId,
          ruleVersion: ruleSet.ruleVersion, pipelineVersion: ruleSet.pipelineVersion, snapshotDigest: assessmentCatalogDigest({ template, ruleSet }) });
      }
      validateFrozenExecutionAssets(values);
      return values;
    } catch { throw new SkillError('EXECUTION_ASSET_UNAVAILABLE', '所选模板或规则不可用，请重新选择', 409); }
  } };
}
