import { asc, eq, inArray } from 'drizzle-orm';
import { skillDefinitions, skillVersions, workflowDefinitions, workflowVersions, users } from '../../db/schema';
import { isBusinessRole, resolveBusinessRole } from '../../middleware/auth';
import { skillDefinitionHash } from './skills.hash';
import { SkillError } from './skills.types';
import type { ExecutionManifestRepository, ExecutionDbExecutor, FrozenSkill } from './execution-manifest.types';
const unavailable = (): never => { throw new SkillError('EXECUTION_UNAVAILABLE', '技能或流程未发布、已停用或不可用', 409); };
/** All reads use the caller's connection. Workflow root -> sorted Skill roots is the publication lock order. */
export function createExecutionManifestPgRepository(): ExecutionManifestRepository {
  return {
    async verifyCaller(tx, user) {
      const [current] = await tx.select({ role: users.role, businessRole: users.businessRole, status: users.status })
        .from(users).where(eq(users.userId, user.id)).for('share');
      if (!current || current.status !== 'active' || current.role !== user.role
        || resolveBusinessRole({ role: current.role, businessRole: isBusinessRole(current.businessRole) ? current.businessRole : undefined }) !== resolveBusinessRole(user))
        throw new SkillError('EXECUTION_AUTHORITY_CHANGED', '当前用户权限已变化，请重新读取', 403);
    },
    async read(tx, request, lock) {
      try {
        if (request.kind === 'skill') {
          const query = tx.select().from(skillDefinitions).where(eq(skillDefinitions.skillId, request.skillId));
          const [root] = await (lock ? query.for('share') : query);
          if (!root || !root.enabled || root.archived || !root.activeVersionId) return unavailable();
          const skill = await readSkill(tx, root.skillId, root.activeVersionId, '$skill');
          return { kind: 'skill', target: { id: root.skillId, versionId: skill.versionId, hash: skill.hash, definition: skill.definition }, skills: [skill] };
        }
        const query = tx.select().from(workflowDefinitions).where(eq(workflowDefinitions.workflowId, request.workflowId));
        const [root] = await (lock ? query.for('share') : query);
        if (!root || !root.enabled || root.archived || !root.activeVersionId) return unavailable();
        const [version] = await tx.select().from(workflowVersions).where(eq(workflowVersions.workflowVersionId, root.activeVersionId));
        if (!version || version.workflowId !== root.workflowId || version.status !== 'published'
          || version.hash !== skillDefinitionHash(version.definition) || !version.dependencySnapshot) return unavailable();
        const refs = version.definition.steps.filter(step => step.type === 'skill');
        const ids = [...new Set(refs.map(step => step.skillId))].sort();
        if (ids.length) {
          const query = tx.select().from(skillDefinitions).where(inArray(skillDefinitions.skillId, ids)).orderBy(asc(skillDefinitions.skillId));
          const roots = await (lock ? query.for('share') : query);
          if (roots.length !== ids.length || roots.some(root => !root.enabled || root.archived)) return unavailable();
        }
        const skills: FrozenSkill[] = [];
        if (version.dependencySnapshot.skills.length !== refs.length) return unavailable();
        for (const ref of refs) {
          const skill = await readSkill(tx, ref.skillId, ref.skillVersionId, ref.id);
          const binding = version.dependencySnapshot.skills.find(item => item.stepId === ref.id);
          if (!binding || binding.skillId !== skill.skillId || binding.skillVersionId !== skill.versionId || binding.hash !== skill.hash) return unavailable();
          skills.push(skill);
        }
        return { kind: 'workflow', target: { id: root.workflowId, versionId: version.workflowVersionId, hash: version.hash, definition: version.definition },
          skills, publishedDependencies: version.dependencySnapshot };
      } catch (error) {
        if (error instanceof SkillError) throw error;
        throw new SkillError('EXECUTION_STORE_INTERNAL', '执行定义暂时不可用', 500);
      }
    },
  };
}
async function readSkill(tx: ExecutionDbExecutor, skillId: string, versionId: string, stepId: string): Promise<FrozenSkill> {
  const [version] = await tx.select().from(skillVersions).where(eq(skillVersions.skillVersionId, versionId));
  if (!version || version.skillId !== skillId || version.status !== 'published' || version.hash !== skillDefinitionHash(version.definition)) return unavailable();
  return { stepId, skillId, versionId, hash: version.hash, definition: version.definition };
}
