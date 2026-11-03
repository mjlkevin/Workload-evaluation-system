import { createDefaultRegistry } from '../../agent/default-registry';
import { resolveActiveMcpTools } from '../../agent/mcp/mcp-runtime';
import { isToolDiscoverableUnderPolicy, resolveToolPolicyEntry } from '../../agent/tool-policy';
import { legacyRoleToV2Roles } from '../../rbac/roles';
import { anyRoleHasCapability } from '../../rbac/permissions';
import type { AgentTool } from '../../agent/agent.types';
import type { AuthUser, ToolPolicyConfig } from '../../types';
import { config } from '../../config/env';
import { loadRequirementSystemConfigStore, resolveActiveApiKeyForScope, resolveActiveToolPolicy } from '../system/system.repository';
import { warmCredentialScopes } from '../system/credentials.store';
import { resolveScenarioConfig, type ScenarioConfigResolution } from '../system/model-providers';
import { getUsersRepository } from '../auth/users.repository';
import { getKnowledgeRepository } from '../knowledge/knowledge.module';
import { SkillError, type SkillDefinition } from './skills.types';
import { skillDefinitionHash } from './skills.hash';
import { compileNativeToolOutput, validateSkillDefinition, type SkillToolDefinition } from './skills.validation';
import { createSkillModelAdapter, resolveSkillReferences } from './skills.runtime';
import type { SkillReadExecutor } from './skills.sandbox';
import type { SkillDependencySnapshot } from './skills-release.types';
import type { SkillTrialDependencies } from './skills.evaluation';

export function permittedSkillTools(tools: AgentTool[], user: AuthUser, policy: ToolPolicyConfig): AgentTool[] {
  const roles = legacyRoleToV2Roles(user.role);
  return tools.filter(tool => anyRoleHasCapability(roles, tool.capability) && isToolDiscoverableUnderPolicy(tool, policy, roles));
}
export function skillToolContract(tool: AgentTool): SkillToolDefinition {
  if (tool.source !== 'mcp') compileNativeToolOutput(tool);
  return { name: tool.name, description: tool.description, parameters: tool.parameters, mutates: tool.mutates,
    ...(tool.source !== 'mcp' && tool.outputSchema !== undefined ? { outputSchema: tool.outputSchema } : {}),
    exfiltrates: Boolean(tool.exfiltrates), simulationOnly: tool.source === 'mcp' || (tool.simulationOnly ?? tool.sandboxReadSafe !== true) };
}
export async function resolveCurrentSkillTools(user: AuthUser) {
  const mcp = await resolveActiveMcpTools();
  const registry = createDefaultRegistry(user).cloneWithMcpTools(mcp.tools);
  const policy = await resolveActiveToolPolicy();
  return { tools: permittedSkillTools(registry.allTools(), user, policy), policy, registry };
}
export type SkillResolvedContext = {
  hash: string; snapshot: SkillDependencySnapshot; tools: SkillToolDefinition[]; complete: SkillTrialDependencies['complete']; runReadTool: SkillReadExecutor;
};
/** Shared by Skill release and future Workflow publication. Hash includes resolved native/model/reference contracts. */
export async function resolveSkillDependencyContext(definition: SkillDefinition, user: AuthUser, options: { requireModel?: boolean; inventory?: Awaited<ReturnType<typeof resolveCurrentSkillTools>> } = {}): Promise<SkillResolvedContext> {
  const native = options.inventory ?? await resolveCurrentSkillTools(user);
  const contracts = native.tools.map(skillToolContract);
  validateSkillDefinition(definition, contracts);
  const references = await resolveSkillReferences(definition.references, id => getKnowledgeRepository().get(id));
  const active = (await loadRequirementSystemConfigStore()).active;
  const scenario = resolveScenarioConfig(active, definition.model.scenario as 'assessment' | 'fileParsing' | 'generation', { model: config.kimi.model, baseUrl: config.kimi.apiBaseUrl });
  await warmCredentialScopes([scenario.credentialScope]);
  const { apiKey } = resolveActiveApiKeyForScope(scenario.credentialScope);
  const configured = active.modelProviders?.find(p => p.id === scenario.providerId);
  const modelContract = configured?.models.find(m => m.id === scenario.model);
  if (!scenario.model || (configured && (!configured.enabled || !modelContract))) throw new SkillError('SKILL_MODEL_UNAVAILABLE', '当前场景模型未启用或未登记', 409);
  if (!apiKey && options.requireModel !== false) throw new SkillError('SKILL_MODEL_UNAVAILABLE', '当前场景模型凭据不可用', 409);
  const selected = definition.tools.map(binding => {
    const nativeTool = native.tools.find(tool => tool.name === binding.toolName)!;
    return { native: { ...contracts.find(tool => tool.name === binding.toolName)!, source: nativeTool.source ?? 'code' as const,
      sandboxReadSafe: nativeTool.sandboxReadSafe === true, capability: nativeTool.capability },
      policy: structuredClone(resolveToolPolicyEntry(native.policy, binding.toolName)) };
  });
  // No endpoint text, credentials, provider raw data or reasoning enter this explainable proof snapshot.
  const snapshot: SkillDependencySnapshot = { schemaVersion: 1, references: references.digests,
    model: skillDependencyModelSnapshot(scenario, definition.model, modelContract),
    tools: selected, roles: legacyRoleToV2Roles(user.role) };
  const hash = skillDefinitionHash(snapshot);
  const complete = createSkillModelAdapter({ scenario, apiKey, referenceContent: references.content });
  const runReadTool = createSkillReadExecutor(user, contracts);
  return { hash, snapshot, tools: contracts, complete, runReadTool };
}

/** Executor refreshes identity and policy immediately before every local read, independently of request-start auth. */
export function createSkillReadExecutor(initialUser: AuthUser, contracts: SkillToolDefinition[],
  resolveInventory: typeof resolveCurrentSkillTools = resolveCurrentSkillTools,
  refreshUser: (id: string) => Promise<AuthUser | null> = id => getUsersRepository().findUserById(id)): SkillReadExecutor {
  return async (name, parameters, signal) => {
    if (signal.aborted) throw new Error('SKILL_TRIAL_ABORTED');
    const user = await refreshUser(initialUser.id);
    if (!user || user.status !== 'active' || user.role !== initialUser.role) throw new Error('SKILL_TOOL_AUTHORITY_CHANGED');
    const now = await resolveInventory(user); const tool = now.tools.find(item => item.name === name);
    const before = contracts.find(item => item.name === name);
    if (!tool || !before || tool.source === 'mcp' || tool.sandboxReadSafe !== true || tool.mutates || tool.exfiltrates
      || skillDefinitionHash(skillToolContract(tool)) !== skillDefinitionHash(before)) throw new Error('SKILL_TOOL_AUTHORITY_CHANGED');
    if (signal.aborted) throw new Error('SKILL_TRIAL_ABORTED');
    const result = await now.registry.execute(name, parameters, { id: user.id, roles: legacyRoleToV2Roles(user.role), capabilities: [tool.capability] });
    const validate = compileNativeToolOutput(before);
    if (validate && !validate(result)) throw new Error('NATIVE_OUTPUT_SCHEMA_FAILED');
    return result;
  };
}

export function skillDependencyModelSnapshot(scenario: ScenarioConfigResolution, params: SkillDefinition['model'],
  contract?: { capabilities: string[]; supportedParams: string[] }): SkillDependencySnapshot['model'] {
  return { providerId: scenario.providerId, model: scenario.model, modelSource: scenario.modelSource,
    credentialScope: scenario.credentialScope, baseUrlDigest: skillDefinitionHash(scenario.baseUrl), params: structuredClone(params),
    capabilities: [...(contract?.capabilities ?? [])], supportedParams: [...(contract?.supportedParams ?? [])] };
}
