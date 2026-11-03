import { and, asc, eq } from 'drizzle-orm';
import { db, type Database } from '../../db/client';
import { skillDefinitions, workflowDefinitions } from '../../db/schema';
import { resolveBusinessRole } from '../../middleware/auth';
import type { AuthUser } from '../../types';
import type { ExecutionSnapshot, ExecutionRequest } from './execution-manifest.types';
import { safeBusinessJson } from './skills.workbench-view';
import { createExecutionManifestPgRepository } from './execution-manifest-pg.repository';
import { createExecutionEmergencyRepository } from './execution-emergency';
import { resolveCurrentSkillTools, resolveSkillDependencyContext } from './skills.context';
import { validateSkillDefinition } from './skills.validation';
import { skillDefinitionHash as hash } from './skills.hash';
import { SkillError } from './skills.types';
import { validateWorkflowDefinition } from '../workflows/workflows.validation';
import { workflowToolMetadata } from '../workflows/workflows.context';
import type { WorkflowDefinition } from '../workflows/workflows.types';

export function toExecutionCatalogEntry(snapshot: ExecutionSnapshot) {
  const { kind, target } = snapshot;
  return { kind, id: target.id, versionId: target.versionId, name: target.definition.name,
    description: target.definition.description, inputSchema: safeBusinessJson(target.definition.inputSchema) };
}
type Options = { database?: Database; inventory?: typeof resolveCurrentSkillTools;
  loadSkillContext?: typeof resolveSkillDependencyContext; loadWorkflowTools?: typeof workflowToolMetadata };
/** Public discovery resolves current identity and capability contracts; immutable invocation admission still runs on submit. */
export function createExecutionCatalogService(options: Options = {}) {
  const database = options.database ?? db, repository = createExecutionManifestPgRepository();
  const authority = createExecutionEmergencyRepository(database);
  return { async list(user: AuthUser) {
    await database.transaction(tx => repository.verifyCaller(tx, user));
    const native = await (options.inventory ?? resolveCurrentSkillTools)(user);
    const candidates = await database.transaction(async tx => {
      const skills = await tx.select({ id: skillDefinitions.skillId }).from(skillDefinitions)
        .where(and(eq(skillDefinitions.enabled, true), eq(skillDefinitions.archived, false), eq(skillDefinitions.emergencyStopped, false))).orderBy(asc(skillDefinitions.skillId));
      const workflows = await tx.select({ id: workflowDefinitions.workflowId }).from(workflowDefinitions)
        .where(and(eq(workflowDefinitions.enabled, true), eq(workflowDefinitions.archived, false), eq(workflowDefinitions.emergencyStopped, false))).orderBy(asc(workflowDefinitions.workflowId));
      return [...skills.map(s => ({ kind: 'skill' as const, skillId: s.id, input: {} })), ...workflows.map(w => ({ kind: 'workflow' as const, workflowId: w.id, input: {} }))];
    });
    const items: ReturnType<typeof toExecutionCatalogEntry>[] = [];
    for (const request of candidates as ExecutionRequest[]) {
      try {
        const snapshot = await database.transaction(tx => repository.read(tx, request, false));
        const role = resolveBusinessRole(user);
        if (!snapshot.target.definition.roles.includes(role) || snapshot.skills.some(skill => !skill.definition.roles.includes(role))) continue;
        for (const skill of snapshot.skills) {
          const context = await (options.loadSkillContext ?? resolveSkillDependencyContext)(skill.definition, user, { requireModel: false, inventory: native });
          validateSkillDefinition(skill.definition, context.tools);
        }
        if (snapshot.kind === 'workflow') {
          const definition = snapshot.target.definition as WorkflowDefinition;
          const tools = definition.steps.some(step => step.type === 'tool') ? (await (options.loadWorkflowTools ?? workflowToolMetadata)(user)).filter(tool => tool.allowedRoles.includes(role)) : [];
          for (const published of snapshot.publishedDependencies?.tools ?? []) {
            const current = tools.find(tool => tool.name === published.contract.name);
            if (!current) throw new SkillError('EXECUTION_CONTEXT_CHANGED', '工具授权已变化', 409);
            const { allowedRoles: _roles, sandboxReadSafe: _safe, ...contract } = current;
            if (hash(contract) !== published.hash) throw new SkillError('EXECUTION_CONTEXT_CHANGED', '工具契约已变化', 409);
          }
          validateWorkflowDefinition(definition, { skills: snapshot.skills.map(skill => ({ stepId: skill.stepId, skillId: skill.skillId, skillVersionId: skill.versionId,
            hash: skill.hash, enabled: true, archived: false, status: 'published', definition: skill.definition })), tools });
        }
        await authority.prepare(request, user);
        items.push(toExecutionCatalogEntry(snapshot));
      } catch (error) {
        // Ordinary unavailable/forbidden definitions do not leak through discovery. Infrastructure failure fails closed.
        if (error instanceof SkillError && error.status < 500 || error && typeof error === 'object' && 'status' in error && Number(error.status) < 500) continue;
        throw new SkillError('EXECUTION_CATALOG_UNAVAILABLE', '技能目录暂不可用', 503);
      }
    }
    await database.transaction(tx => repository.verifyCaller(tx, user));
    return items;
  } };
}
