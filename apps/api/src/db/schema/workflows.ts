import { boolean, integer, jsonb, pgTable, text, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { skillDefinitions, skillVersions } from './skills';
import type { WorkflowDefinition, WorkflowDependencySnapshot, WorkflowProof, WorkflowRevisionSnapshot, WorkflowVersion } from '../../modules/workflows/workflows.types';
export const workflowDefinitions = pgTable('workflow_definitions', {
    workflowId: text('workflow_id').primaryKey(), name: text('name').notNull(), description: text('description').notNull(), category: text('category').notNull(),
    enabled: boolean('enabled').notNull(), archived: boolean('archived').notNull(), currentVersionId: text('current_version_id').notNull(), activeVersionId: text('active_version_id'), revision: integer('revision').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
export const workflowVersions = pgTable('workflow_versions', {
    workflowVersionId: text('workflow_version_id').primaryKey(), workflowId: text('workflow_id').notNull().references(() => workflowDefinitions.workflowId, { onDelete: 'restrict' }),
    position: integer('position').notNull(), versionCode: text('version_code').notNull(), majorLetter: text('major_letter').notNull(), minorNumber: integer('minor_number').notNull(),
    status: text('status').$type<WorkflowVersion['status']>().notNull(), checkoutStatus: text('checkout_status').$type<WorkflowVersion['checkoutStatus']>().notNull(), checkedOutBy: text('checked_out_by'),
    definition: jsonb('definition').$type<WorkflowDefinition>().notNull(), lastCheckinDefinition: jsonb('last_checkin_definition').$type<WorkflowDefinition>().notNull(), hash: text('hash').notNull(),
    dependencySnapshot: jsonb('dependency_snapshot').$type<WorkflowDependencySnapshot>(), validation: jsonb('validation').$type<WorkflowProof>(), review: jsonb('review').$type<NonNullable<WorkflowVersion['review']>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, table => ({ codeKey: unique('workflow_versions_code_key').on(table.versionCode), positionKey: unique('workflow_versions_position_key').on(table.workflowId, table.position) }));
export const workflowRevisions = pgTable('workflow_revisions', {
    id: text('id').primaryKey(), workflowId: text('workflow_id').notNull().references(() => workflowDefinitions.workflowId, { onDelete: 'restrict' }), revision: integer('revision').notNull(),
    action: text('action').notNull(), actorId: text('actor_id').notNull(), actorName: text('actor_name').notNull(), reason: text('reason'),
    versionId: text('version_id').notNull().references(() => workflowVersions.workflowVersionId, { onDelete: 'restrict' }), snapshot: jsonb('snapshot').$type<WorkflowRevisionSnapshot>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, table => ({ revisionKey: unique('workflow_revisions_revision_key').on(table.workflowId, table.revision) }));
export const workflowSkillDependencies = pgTable('workflow_skill_dependencies', {
    versionId: text('version_id').notNull().references(() => workflowVersions.workflowVersionId, { onDelete: 'restrict' }), stepId: text('step_id').notNull(),
    skillId: text('skill_id').notNull().references(() => skillDefinitions.skillId, { onDelete: 'restrict' }), skillVersionId: text('skill_version_id').notNull().references(() => skillVersions.skillVersionId, { onDelete: 'restrict' }),
}, table => ({ stepKey: unique('workflow_skill_dependencies_step_key').on(table.versionId, table.stepId), skillIndex: index('workflow_skill_dependencies_skill_idx').on(table.skillId, table.skillVersionId) }));
