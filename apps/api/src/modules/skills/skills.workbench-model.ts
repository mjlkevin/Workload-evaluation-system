import type { RequirementSystemConfig } from '../../types';
import type { ModelProvider } from '../../ai/provider/model-provider';
import { resolveScenarioConfig } from '../system/model-providers';
import { createSkillModelAdapter } from './skills.runtime';
export type WorkbenchModelPorts = { loadSettings?: () => Promise<RequirementSystemConfig>; loadCredential?: (scope: string) => Promise<string>; provider?: Pick<ModelProvider, 'chatCompletion'> };
export async function prepareWorkbenchModel(ports: WorkbenchModelPorts, guard: () => void, unavailable: () => Error) {
  guard();
  const active = await (ports.loadSettings ?? (async () => (await (await import('../system/system.repository')).loadRequirementSystemConfigStore()).active))();
  guard();
  const scenario = resolveScenarioConfig(active, 'generation', { model: '', baseUrl: '' });
  const configured = active.modelProviders?.find(provider => provider.id === scenario.providerId);
  // Workbench understanding uses the actual configured generation binding; never substitute another scenario or fake Skill.
  if (scenario.modelSource !== 'binding' || !configured?.enabled || configured.protocol !== 'openai-compatible'
    || !configured.models.some(model => model.id === scenario.model)) throw unavailable();
  const apiKey = await (ports.loadCredential ?? (async scope => {
    await (await import('../system/credentials.store')).warmCredentialScopes([scope]);
    guard();
    return (await import('../system/system.repository')).resolveActiveApiKeyForScope(scope).apiKey;
  }))(scenario.credentialScope);
  guard();
  if (!apiKey.trim()) throw unavailable();
  return createSkillModelAdapter({ scenario, apiKey, referenceContent: '', provider: ports.provider, strictProviderMode: true });
}
