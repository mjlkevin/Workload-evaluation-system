import { db, type Database } from '../../db/client';
import { legacyRoleToV2Roles } from '../../rbac/roles';
import { anyRoleHasCapability, type Capability } from '../../rbac/permissions';
import { isToolDiscoverableUnderPolicy, resolveToolPolicyEntry } from '../../agent/tool-policy';
import { createExecutionEmergencyRepository } from './execution-emergency';
import { resolveCurrentSkillTools, skillToolContract } from './skills.context';
import { skillDefinitionHash as hash } from './skills.hash';
import { SkillError } from './skills.types';
import type { FrozenExecutionSkill } from './skills.execution-model';
import type { ExecutionManifest } from './execution-manifest.types';
import type { AuthUser, ToolPolicyEntry } from '../../types';
export type ExecutionAction = { runId: string; ownerUserId: string; manifestHash: string; phase: 'model' | 'tool' | 'resume'; stepId?: string; toolName?: string };
export interface ExecutionAuthority { check(action: ExecutionAction): Promise<void> }
/** Trusted assembly dependencies. No persisted/request-supplied object is a grant. */
export function createExecutionAuthority(database: Database = db, inventory = resolveCurrentSkillTools): ExecutionAuthority {
  const admission = createExecutionEmergencyRepository(database);
  // Construct per execution/dispatch. This fence can only remove authority; every check still re-admits from DB.
  let scope: { runId: string; ownerUserId: string; identityHash: string } | undefined;
  const denied = (): never => { throw new SkillError('EXECUTION_AUTHORITY_DENIED', '当前执行权限不可用', 403); };
  return { async check(action) {
    try {
      if (!action || !action.runId || !action.ownerUserId || !['model', 'tool', 'resume'].includes(action.phase)) denied();
      const before = await admission.assertRunAdmission(action.runId, action.ownerUserId);
      const { manifest, identity } = before;
      const nextScope = { runId: action.runId, ownerUserId: action.ownerUserId, identityHash: hash(identity) };
      if (scope && hash(scope) !== hash(nextScope)) denied();
      if (manifest.manifestHash !== action.manifestHash) denied();
      const now = await inventory({ ...identity, username: '', businessRole: manifest.caller.businessRole } as AuthUser);
      validateFrozenExecutionTools(manifest, identity, now, action);
      // Inventory may contact MCP. Neither DB transaction spans that I/O; re-admit afterwards.
      const after = await admission.assertRunAdmission(action.runId, action.ownerUserId);
      if (hash(after.identity) !== hash(identity) || after.manifest.manifestHash !== manifest.manifestHash
        || scope && hash(scope) !== hash(nextScope)) denied();
      scope = nextScope;
    } catch { denied(); }
  } };
}

/** Shared intersection check; retry preparation does not grant execution of any tool. */
export function validateFrozenExecutionTools(manifest: ExecutionManifest, identity: { role: string }, now: Awaited<ReturnType<typeof resolveCurrentSkillTools>>,
  action: Pick<ExecutionAction, 'phase' | 'stepId' | 'toolName'> = { phase: 'resume' }) {
  const denied = (): never => { throw new SkillError('EXECUTION_AUTHORITY_DENIED', '当前执行权限不可用', 403); };
  const frozenSkills = manifest.skills as FrozenExecutionSkill[];
  const skill = frozenSkills.find(s => s.stepId === action.stepId);
  // C1 has no original V2-role evidence for direct Workflow tools. Await a versioned contract.
  if (action.phase === 'resume' && manifest.tools.length || action.phase !== 'resume' && !skill) denied();
  if (!['admin', 'user', 'sub_admin'].includes(identity.role)) denied();
  const roles = legacyRoleToV2Roles(identity.role);
  const checkTool = (original: { name: string; description: string; parameters: Record<string, unknown>; mutates: boolean; exfiltrates?: boolean; simulationOnly?: boolean; source?: string; capability?: string }, policy: ToolPolicyEntry, originalRoles: typeof roles, requiresConfirmation: boolean) => {
    const current = now.registry.get(original.name);
    if (!current || !original.capability || !anyRoleHasCapability(originalRoles, original.capability as Capability)
      || !anyRoleHasCapability(roles, current.capability) || original.capability !== current.capability
      || (original.source ?? 'code') !== (current.source ?? 'code') || !policy.enabled
      || (original.source !== 'mcp' && policy.visibleRoles.length && (!originalRoles.some(r => policy.visibleRoles.includes(r)) || !roles.some(r => policy.visibleRoles.includes(r))))
      || !isToolDiscoverableUnderPolicy(current, now.policy, roles)) denied();
    const contract = skillToolContract(current!);
    if (hash({ name: original.name, description: original.description, parameters: original.parameters, mutates: original.mutates,
      exfiltrates: Boolean(original.exfiltrates), simulationOnly: original.simulationOnly }) !== hash(contract)) denied();
    if (action.phase === 'tool' && action.toolName === original.name && (requiresConfirmation || policy.approvalStrategy === 'user-confirm'
      || resolveToolPolicyEntry(now.policy, original.name).approvalStrategy === 'user-confirm' || current!.mutates || current!.exfiltrates || current!.source === 'mcp')) denied();
  };
  const skills = action.phase === 'resume' ? frozenSkills : skill ? [skill] : [];
  for (const selected of skills) for (const snapshot of selected.context.tools) {
    const binding = selected.definition.tools.find(t => t.toolName === snapshot.native.name);
    if (!binding || snapshot.native.sandboxReadSafe !== (now.registry.get(snapshot.native.name)?.sandboxReadSafe === true)) denied();
    checkTool(snapshot.native, snapshot.policy, selected.context.roles, binding!.requiresConfirmation);
  }
  if (action.phase === 'tool' && (!action.toolName || !skill?.definition.tools.some(t => t.toolName === action.toolName))) denied();
}
