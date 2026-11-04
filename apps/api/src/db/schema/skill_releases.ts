import { boolean, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { skillDefinitions, skillVersions } from './skills';
import type { SkillPersistedTrialResult } from '../../modules/skills/skills-release.types';
const common = () => ({
  id: text('id').primaryKey(),
  skillId: text('skill_id').notNull().references(() => skillDefinitions.skillId, { onDelete: 'restrict' }),
  versionId: text('version_id').notNull().references(() => skillVersions.skillVersionId, { onDelete: 'restrict' }),
  actorId: text('actor_id').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
export const skillEvaluations = pgTable('skill_evaluations', {
  ...common(), hash: text('hash').notNull(), contextHash: text('context_hash').notNull(),
  snapshotRevision: integer('snapshot_revision').notNull(), result: jsonb('result').$type<SkillPersistedTrialResult>().notNull(),
});
export const skillReleaseReviews = pgTable('skill_release_reviews', {
  ...common(), evaluationId: text('evaluation_id').notNull().references(() => skillEvaluations.id, { onDelete: 'restrict' }),
  hash: text('hash').notNull(), contextHash: text('context_hash').notNull(), reason: text('reason').notNull(),
  acknowledgedSimulation: boolean('acknowledged_simulation').notNull(),
});
export const skillReleaseEvents = pgTable('skill_release_events', {
  ...common(), kind: text('kind').$type<'publish' | 'rollback'>().notNull(), reason: text('reason').notNull(),
  previousVersionId: text('previous_version_id').references(() => skillVersions.skillVersionId, { onDelete: 'restrict' }),
});
