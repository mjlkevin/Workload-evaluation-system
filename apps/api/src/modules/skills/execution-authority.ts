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
import { readPersistedExecutionManifest } from './execution-manifest';
import type { AuthUser, ToolPolicyEntry } from '../../types';
import type { WorkflowDefinition } from '../workflows/workflows.types';
/** prepare-tool admits operation preparation/confirmation only; it never authorizes dispatch. */
export type ExecutionAction = { runId: string; ownerUserId: string; manifestHash: string; phase: 'model' | 'tool' | 'resume' | 'prepare-tool'; stepId?: string; toolName?: string };
export interface ExecutionAuthority { check(action: ExecutionAction): Promise<void> }
/** Trusted assembly dependencies. No persisted/request-supplied object is a grant. */
export function createExecutionAuthority(database: Database = db, inventory = resolveCurrentSkillTools): ExecutionAuthority {
  const admission = createExecutionEmergencyRepository(database);
  // Construct per execution/dispatch. This fence can only remove authority; every check still re-admits from DB.
  let scope: { runId: string; ownerUserId: string; identityHash: string } | undefined;
  const denied = (): never => { throw new SkillError('EXECUTION_AUTHORITY_DENIED', '当前执行权限不可用', 403); };
  return { async check(action) {
    try {
      if (!action || !action.runId || !action.ownerUserId || !['model', 'tool', 'resume', 'prepare-tool'].includes(action.phase)) denied();
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
  if (!['model', 'tool', 'resume', 'prepare-tool'].includes(action.phase)) denied();
  const frozenSkills = manifest.skills as FrozenExecutionSkill[];
  const skill = frozenSkills.find(s => s.stepId === action.stepId);
  const direct = manifest.tools.filter(t => t.stepId === action.stepId && t.contract.name === action.toolName);
  const directAction = (action.phase === 'tool' || action.phase === 'prepare-tool') && !skill;
  // Legacy direct tools have no original role evidence. Never derive it from today's user.
  if ((action.phase === 'resume' || directAction) && manifest.tools.length) {
    if (manifest.schemaVersion !== 2) denied();
    try { readPersistedExecutionManifest(manifest); } catch { denied(); }
  }
  if (action.phase === 'model' && !skill || directAction && direct.length !== 1
    || action.phase !== 'resume' && !skill && !directAction) denied();
  if (!['admin', 'user', 'sub_admin'].includes(identity.role)) denied();
  const roles = legacyRoleToV2Roles(identity.role);
  const checkTool = (original: { name: string; description: string; parameters: Record<string, unknown>; outputSchema?: Record<string, unknown>; mutates: boolean; exfiltrates?: boolean; simulationOnly?: boolean; source?: string; capability?: string }, policy: ToolPolicyEntry, originalRoles: typeof roles, requiresConfirmation: boolean, directTool = false) => {
    const current = now.registry.get(original.name);
    if (!current || !original.capability || !anyRoleHasCapability(originalRoles, original.capability as Capability)
      || !anyRoleHasCapability(roles, current.capability) || original.capability !== current.capability
      || (original.source ?? 'code') !== (current.source ?? 'code') || !policy.enabled
      || (original.source !== 'mcp' && policy.visibleRoles.length && (!originalRoles.some(r => policy.visibleRoles.includes(r)) || !roles.some(r => policy.visibleRoles.includes(r))))
      || !isToolDiscoverableUnderPolicy(current, now.policy, roles)
      || directTool && !isToolDiscoverableUnderPolicy(current, now.policy, originalRoles)) denied();
    const contract = skillToolContract(current!);
    if (hash({ name: original.name, description: original.description, parameters: original.parameters, mutates: original.mutates,
      exfiltrates: Boolean(original.exfiltrates), simulationOnly: original.simulationOnly,
      ...(original.outputSchema !== undefined ? { outputSchema: original.outputSchema } : {}) }) !== hash(contract)) denied();
    if (action.phase === 'tool' && action.toolName === original.name && (requiresConfirmation || policy.approvalStrategy === 'user-confirm'
      || resolveToolPolicyEntry(now.policy, original.name).approvalStrategy === 'user-confirm' || current!.mutates || current!.exfiltrates || current!.source === 'mcp')) denied();
  };
  const skills = action.phase === 'resume' ? frozenSkills : skill ? [skill] : [];
  for (const selected of skills) for (const snapshot of selected.context.tools) {
    const binding = selected.definition.tools.find(t => t.toolName === snapshot.native.name);
    if (!binding || snapshot.native.sandboxReadSafe !== (now.registry.get(snapshot.native.name)?.sandboxReadSafe === true)) denied();
    checkTool(snapshot.native, snapshot.policy, selected.context.roles, binding!.requiresConfirmation);
  }
  if ((action.phase === 'tool' || action.phase === 'prepare-tool') && skill
    && (!action.toolName || !skill.definition.tools.some(t => t.toolName === action.toolName))) denied();
  // Model calls only inspect the selected frozen child Skill. Direct native tools have no model phase.
  if (action.phase === 'resume' || directAction) for (const tool of action.phase === 'resume' ? manifest.tools : direct) {
    if (manifest.schemaVersion !== 2) denied();
    const evidence = manifest.toolAuthority!.tools.find(t => t.stepId === tool.stepId);
    const current = now.registry.get(tool.contract.name);
    if (!evidence || evidence.sandboxReadSafe !== (current?.sandboxReadSafe === true)) denied();
    const contract = tool.contract;
    // Persisted reader validates the complete policy and native contract before this intersection.
    checkTool(contract, contract.policy as ToolPolicyEntry, manifest.toolAuthority!.roles, contract.requiresConfirmation, true);
    const step = (manifest.target.definition as WorkflowDefinition).steps.find(s => s.id === tool.stepId);
    if (!step || step.type !== 'tool' || step.toolName !== contract.name) return denied();
    if (action.phase === 'tool' && (step.requiresConfirmation || !evidence!.sandboxReadSafe || current!.sandboxReadSafe !== true
      || (current!.source ?? 'code') !== 'code' || contract.simulationOnly || contract.mutates || contract.exfiltrates)) denied();
  }
}
