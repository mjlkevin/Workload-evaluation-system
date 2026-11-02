import { boolean, integer, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import type { SkillDefinition, SkillRecord, SkillVersion } from '../../modules/skills/skills.types';

// Identity/metadata, version content and append-only audit snapshots have distinct ownership.
export const skillDefinitions = pgTable('skill_definitions', {
  skillId: text('skill_id').primaryKey(),
  name: text('name').notNull(), description: text('description').notNull(), category: text('category').notNull(),
  enabled: boolean('enabled').notNull(), archived: boolean('archived').notNull(),
  activeVersionId: text('active_version_id'), currentVersionId: text('current_version_id').notNull(),
  revision: integer('revision').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
export const skillVersions = pgTable('skill_versions', {
  skillVersionId: text('skill_version_id').primaryKey(),
  skillId: text('skill_id').notNull().references(() => skillDefinitions.skillId, { onDelete: 'restrict' }),
  position: integer('position').notNull(), versionCode: text('version_code').notNull(),
  majorLetter: text('major_letter').notNull(), minorNumber: integer('minor_number').notNull(),
  status: text('status').$type<SkillVersion['status']>().notNull(),
  checkoutStatus: text('checkout_status').$type<SkillVersion['checkoutStatus']>().notNull(),
  checkedOutBy: text('checked_out_by'), definition: jsonb('definition').$type<SkillDefinition>().notNull(),
  hash: text('hash').notNull(), lastCheckinDefinition: jsonb('last_checkin_definition').$type<SkillDefinition>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, table => ({
  codeKey: unique('skill_versions_code_key').on(table.versionCode),
  positionKey: unique('skill_versions_position_key').on(table.skillId, table.position),
}));
export const skillRevisions = pgTable('skill_revisions', {
  id: text('id').primaryKey(),
  skillId: text('skill_id').notNull().references(() => skillDefinitions.skillId, { onDelete: 'restrict' }),
  revision: integer('revision').notNull(), action: text('action').notNull(),
  actorId: text('actor_id').notNull(), actorName: text('actor_name').notNull(),
  versionId: text('version_id').notNull().references(() => skillVersions.skillVersionId, { onDelete: 'restrict' }),
  snapshot: jsonb('snapshot').$type<SkillRecord>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, table => ({ revisionKey: unique('skill_revisions_skill_revision_key').on(table.skillId, table.revision) }));
