import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { skillDefinitions } from './skills';
import { workflowDefinitions } from './workflows';
export const executionEmergencyAudits = pgTable('execution_emergency_audits', {
  id: text('id').primaryKey(),
  skillId: text('skill_id').references(() => skillDefinitions.skillId, { onDelete: 'restrict' }),
  workflowId: text('workflow_id').references(() => workflowDefinitions.workflowId, { onDelete: 'restrict' }),
  actorId: text('actor_id').notNull(), action: text('action').$type<'stop' | 'release'>().notNull(),
  reason: text('reason').notNull(), epoch: integer('epoch').notNull(), revision: integer('revision').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, table => ({ root: check('execution_emergency_exact_root', sql`num_nonnulls(${table.skillId}, ${table.workflowId}) = 1`),
  values: check('execution_emergency_valid_values', sql`${table.epoch} >= 0 AND ${table.revision} > 0 AND ${table.action} IN ('stop', 'release') AND length(btrim(${table.reason})) BETWEEN 1 AND 1000`) }));
