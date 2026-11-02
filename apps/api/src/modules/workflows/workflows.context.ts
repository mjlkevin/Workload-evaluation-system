import { asc, eq, inArray } from 'drizzle-orm';
import { db, type Database } from '../../db/client';
import { prepareSkillAuthority } from '../skills/skills.authority';
import { SkillError } from '../skills/skills.types';
import type { AuthUser } from '../../types';
import { skillDefinitions, skillVersions } from '../../db/schema';
import { isToolDiscoverableUnderPolicy, resolveToolPolicyEntry } from '../../agent/tool-policy';
import { anyRoleHasCapability } from '../../rbac/permissions';
import type { V2Role } from '../../rbac/roles';
import { resolveWorkbenchToolDecisionSlot } from '../../services/ai/workbench-tool-approval';
import { createSkillReleaseRepository } from '../skills/skills-release.repository';
import { resolveCurrentSkillTools, resolveSkillDependencyContext, skillToolContract } from '../skills/skills.context';
import { skillDefinitionHash } from '../skills/skills.hash';
import { WorkflowError, type WorkflowDefinition, type WorkflowDependencySnapshot, type WorkflowValidationContext } from './workflows.types';
import type { WorkflowDbExecutor } from './workflows.repository';
export type WorkflowResolvedContext = {
    context: WorkflowValidationContext;
    snapshot: WorkflowDependencySnapshot;
    hash: string;
};
export type WorkflowContextLoader = ((definition: WorkflowDefinition, user: AuthUser, tx?: WorkflowDbExecutor) => Promise<WorkflowResolvedContext>) & { prepare?(definition: WorkflowDefinition, user: AuthUser): Promise<WorkflowContextLoader> };
const roles: Record<string, V2Role> = { sales: 'SALES', pre_sales: 'PRE_SALES', delivery: 'IMPL', pm: 'PM', pmo: 'PMO', dev: 'DEV', admin: 'ADMIN' };
export async function workflowToolMetadata(user: AuthUser) {
    const native = await resolveCurrentSkillTools(user);
    return native.tools.map(tool => ({ ...skillToolContract(tool), source: tool.source ?? 'code', capability: tool.capability,
        requiresConfirmation: resolveWorkbenchToolDecisionSlot(tool, resolveToolPolicyEntry(native.policy, tool.name)) === 'ask',
        policy: structuredClone(resolveToolPolicyEntry(native.policy, tool.name)),
        allowedRoles: Object.entries(roles).filter(([, role]) => anyRoleHasCapability([role], tool.capability) && isToolDiscoverableUnderPolicy(tool, native.policy, [role])).map(([name]) => name) }));
}
/** Root SHARE locks prevent Skill enable/archive/default changes while exact immutable versions are resolved and published. */
export async function lockWorkflowSkillDependencies(definition: WorkflowDefinition, tx: WorkflowDbExecutor): Promise<void> {
    const refs = definition.steps.filter(s => s.type === 'skill');
    const ids = [...new Set(refs.map(s => s.skillId))].sort();
    if (!ids.length)
        return;
    const roots = await tx.select().from(skillDefinitions).where(inArray(skillDefinitions.skillId, ids)).orderBy(asc(skillDefinitions.skillId)).for('share');
    for (const ref of refs) {
        const root = roots.find(r => r.skillId === ref.skillId);
        const [version] = await tx.select().from(skillVersions).where(eq(skillVersions.skillVersionId, ref.skillVersionId));
        if (!root || !root.enabled || root.archived || !version || version.skillId !== ref.skillId || version.status !== 'published')
            throw new WorkflowError('WORKFLOW_DEPENDENCY_UNAVAILABLE', '固定的已发布 Skill 版本不可用', 409);
    }
}
export function createWorkflowContextLoader(options: {
    database?: Database;
    releases?: ReturnType<typeof createSkillReleaseRepository>;
    getTools?: typeof workflowToolMetadata;
    loadSkillContext?: typeof resolveSkillDependencyContext;
} = {}): WorkflowContextLoader {
    const loader: WorkflowContextLoader = async (definition, user, tx) => {
        if (tx && (!options.getTools || !options.loadSkillContext)) throw new WorkflowError('WORKFLOW_CONTEXT_PREPARATION_REQUIRED', '依赖上下文必须先在事务外解析', 409);
        if (tx)
            await lockWorkflowSkillDependencies(definition, tx);
        const native = await (options.getTools ?? workflowToolMetadata)(user);
        const allowed = native.filter(t => definition.roles.every(role => t.allowedRoles.includes(role)));
        const skills: WorkflowValidationContext['skills'] = [];
        const snapshot: WorkflowDependencySnapshot = { schemaVersion: 1, skills: [], tools: [] };
        const releases = options.releases ?? createSkillReleaseRepository();
        for (const step of definition.steps) {
            if (step.type === 'skill') {
                const ref = await releases.getPublishedVersion(step.skillId, step.skillVersionId, undefined, tx);
                if (!ref || !ref.enabled || ref.archived)
                    throw new WorkflowError('WORKFLOW_DEPENDENCY_UNAVAILABLE', '固定的已发布 Skill 版本不可用', 409);
                if (ref.version.definition.tools.some(t => !allowed.some(a => a.name === t.toolName)))
                    throw new WorkflowError('WORKFLOW_DEPENDENCY_UNAVAILABLE', '工作流角色无权使用依赖 Skill 的当前原生工具', 409);
                // Resolves contracts and digests only. Never call complete/runReadTool or a model provider here.
                const context = await (options.loadSkillContext ?? resolveSkillDependencyContext)(ref.version.definition, user, { requireModel: false });
                skills.push({ stepId: step.id, skillId: step.skillId, skillVersionId: step.skillVersionId, hash: ref.version.hash, enabled: ref.enabled, archived: ref.archived, status: ref.version.status, definition: ref.version.definition, context: context.snapshot });
                snapshot.skills.push({ stepId: step.id, skillId: step.skillId, skillVersionId: step.skillVersionId, hash: ref.version.hash, context: context.snapshot });
            }
            else if (step.type === 'tool') {
                const tool = allowed.find(t => t.name === step.toolName);
                if (!tool)
                    throw new WorkflowError('WORKFLOW_DEPENDENCY_UNAVAILABLE', '原生工具当前未获角色或策略授权', 409);
                const contract = { name: tool.name, description: tool.description, parameters: tool.parameters, mutates: tool.mutates, exfiltrates: tool.exfiltrates, simulationOnly: tool.simulationOnly, source: tool.source, capability: tool.capability, requiresConfirmation: tool.requiresConfirmation, policy: tool.policy };
                snapshot.tools.push({ stepId: step.id, contract, hash: skillDefinitionHash(contract) });
            }
        }
        return { context: { skills, tools: allowed }, snapshot, hash: skillDefinitionHash(snapshot) };
    };
    loader.prepare = async (definition, user) => {
        const releases = options.releases ?? createSkillReleaseRepository(options.database ?? db);
        const references: string[] = [];
        for (const step of definition.steps) if (step.type === 'skill') {
            const ref = await releases.getPublishedVersion(step.skillId, step.skillVersionId);
            if (!ref) throw new WorkflowError('WORKFLOW_DEPENDENCY_UNAVAILABLE', '固定的已发布 Skill 版本不可用', 409);
            references.push(...ref.version.definition.references.map(r => r.uri));
        }
        const context = await prepareSkillAuthority(references, () => loader(definition, user), options.database ?? db).catch(error => {
            if (error instanceof SkillError && error.code === 'SKILL_CONTEXT_CHANGED') throw new WorkflowError('WORKFLOW_CONTEXT_CHANGED', '依赖配置已变化，请重新验证', 409);
            throw error;
        });
        const definitionHash = skillDefinitionHash(definition);
        return async (candidate, _user, tx) => {
            if (!tx || skillDefinitionHash(candidate) !== definitionHash) throw new WorkflowError('WORKFLOW_REVISION_CONFLICT', '定义已变化，请重新读取', 409);
            await lockWorkflowSkillDependencies(candidate, tx);
            try { await context.verify(tx); } catch (error) {
                if (error instanceof SkillError && error.code === 'SKILL_CONTEXT_CHANGED') throw new WorkflowError('WORKFLOW_CONTEXT_CHANGED', '依赖配置已变化，请重新验证', 409);
                throw error;
            }
            // Re-read exact immutable versions with the same executor. No resolver or pool acquisition here.
            for (const binding of context.value.snapshot.skills) {
                if (!await releases.getPublishedVersion(binding.skillId, binding.skillVersionId, binding.hash, tx)) throw new WorkflowError('WORKFLOW_DEPENDENCY_UNAVAILABLE', '固定的已发布 Skill 版本不可用', 409);
            }
            return structuredClone(context.value);
        };
    };
    return loader;
}
export const resolveWorkflowDependencyContext = createWorkflowContextLoader();
