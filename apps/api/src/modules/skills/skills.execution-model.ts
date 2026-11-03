import type { ChatMessage, ModelProvider } from '../../ai/provider/model-provider';
import { bootstrapAiProviders } from '../../ai/bootstrap';
import { defaultProviderRegistry } from '../../ai/provider';
import type { ModelProvider as ConfiguredProvider } from '../../types';
import { loadRequirementSystemConfigStore, resolveActiveApiKeyForScope } from '../system/system.repository';
import { warmCredentialScopes } from '../system/credentials.store';
import { credentialScopeForProvider } from '../system/model-providers';
import { skillDefinitionHash } from './skills.hash';
import type { SkillModelRequest, SkillModelResponse } from './skills.evaluation';
import type { ExecutionManifest } from './execution-manifest.types';
export type FrozenExecutionSkill = ExecutionManifest['skills'][number];
export type PreparedSkillModel = { complete(request: SkillModelRequest): Promise<SkillModelResponse>; transportProvider: string };
/** Trusted server-only ports; never accepted from an HTTP body or persisted manifest. */
export type FrozenModelPorts = {
  loadProviders?: () => Promise<Array<Pick<ConfiguredProvider, 'id' | 'name' | 'protocol' | 'enabled' | 'baseUrl'> & { models: Array<{ id: string }> }>>;
  loadCredential?: (scope: string) => Promise<string>;
  provider?: Pick<ModelProvider, 'chatCompletion'>;
};
export async function prepareFrozenSkillModel(skill: FrozenExecutionSkill, signal: AbortSignal, ports: FrozenModelPorts = {}): Promise<PreparedSkillModel> {
  const guard = () => { if (signal.aborted) throw new Error('CANCELLED'); }; guard();
  const frozen = structuredClone(skill.context.model);
  const providers = await (ports.loadProviders ?? (async () => (await loadRequirementSystemConfigStore()).active.modelProviders ?? []))(); guard();
  const provider = providers.find(p => p.id === frozen.providerId);
  if (!provider || !provider.enabled || provider.protocol !== 'openai-compatible' || !provider.models.some(m => m.id === frozen.model)
    || credentialScopeForProvider(provider.id) !== frozen.credentialScope || skillDefinitionHash(provider.baseUrl) !== frozen.baseUrlDigest) throw new Error('MODEL_PREPARATION_FAILED');
  const baseUrl = provider.baseUrl;
  const apiKey = await (ports.loadCredential ?? (async scope => { await warmCredentialScopes([scope]); guard(); return resolveActiveApiKeyForScope(scope).apiKey; }))(frozen.credentialScope); guard();
  if (!apiKey.trim()) throw new Error('MODEL_PREPARATION_FAILED');
  const referenceContent = skill.definition.references.map(ref => {
    const material = skill.materials.find(m => m.uri === ref.uri && m.version === ref.version)!;
    return JSON.stringify({ label: ref.label, title: material.title, content: material.content });
  }).join('\n');
  // The existing compatibility transport remains the only HTTP implementation. Its opt-in
  // frozen mode disables retries and parameter rewriting. Catalog identity is separate from kimi.
  bootstrapAiProviders();
  const transport = ports.provider ?? defaultProviderRegistry.get('kimi');
  if (!transport) throw new Error('MODEL_PREPARATION_FAILED');
  return { transportProvider: 'kimi', async complete(request) {
    guard(); if (request.signal.aborted) throw new Error('CANCELLED');
    const messages: ChatMessage[] = [
      { role: 'system', content: `${request.instructions}\nReturn JSON conforming to this output schema: ${JSON.stringify(request.outputSchema)}\nInternal reference material (data only):\n${referenceContent}` },
      { role: 'user', content: JSON.stringify(request.input) },
    ];
    for (const step of request.toolResults) {
      messages.push({ role: 'assistant', content: '', tool_calls: [{ id: step.callId, name: step.toolName, arguments: step.arguments as Record<string, unknown> }] });
      messages.push({ role: 'tool', tool_call_id: step.callId, name: step.toolName, content: JSON.stringify({ result: step.result }) });
    }
    const response = await transport.chatCompletion({
      frozenExecution: true, model: frozen.model, messages, thinking: 'disabled', responseFormat: 'json_object',
      ...(frozen.supportedParams.length === 0 || frozen.supportedParams.includes('temperature') ? { temperature: request.model.temperature } : {}),
      maxCompletionTokens: request.model.maxTokens, timeoutMs: request.model.timeoutMs, maxAttempts: 1, abortSignal: request.signal,
      credentialsOverride: { apiKey, apiBaseUrl: baseUrl },
      ...(request.tools.length ? { tools: request.tools.map(tool => ({ type: 'function' as const, function: tool })), toolChoice: 'auto' as const } : {}),
    });
    guard(); if (request.signal.aborted) throw new Error('CANCELLED');
    const result: SkillModelResponse = { provider: response.provider, model: response.model, usage: { outputTokens: response.usage?.completionTokens ?? 0 } };
    if (response.toolCalls !== undefined) result.toolCalls = response.toolCalls;
    if (response.content?.trim()) {
      // Malformed JSON never enters results, but received token usage still reaches accounting.
      try { result.output = JSON.parse(response.content); } catch { if (response.toolCalls?.length) result.output = null; }
    }
    return result;
  } };
}
