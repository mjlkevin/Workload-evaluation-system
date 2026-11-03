import { bootstrapAiProviders } from '../../ai/bootstrap';
import { defaultProviderRegistry } from '../../ai/provider';
import type { ChatMessage, ModelProvider } from '../../ai/provider/model-provider';
import type { ScenarioConfigResolution } from '../system/model-providers';
import type { KnowledgeEntry } from '../knowledge/knowledge.types';
import { SkillError, type SkillDefinition } from './skills.types';
import { skillDefinitionHash } from './skills.hash';
import type { SkillTrialDependencies } from './skills.evaluation';
import { copyTrialJson } from './skills.sandbox';
import { resolveKimiCompletionTemperatureParam } from '../../utils/kimi-completion-params';

/** Only internal knowledge references are supported; no HTTP, filesystem or arbitrary resolver. */
export async function resolveSkillReferences(references: SkillDefinition['references'], get: (id: string) => Promise<KnowledgeEntry | null>) {
  const digests: Array<{ uri: string; version: string; digest: string }> = []; const content: string[] = [];
  let chars = 0;
  for (const reference of references) {
    const match = /^wes:\/\/knowledge\/([A-Za-z0-9_-]{1,160})$/.exec(reference.uri);
    if (!match) throw new SkillError('SKILL_REFERENCE_UNSUPPORTED', '仅支持内部知识库引用');
    const entry = await get(match[1]);
    if (!entry || entry.status !== 'active') throw new SkillError('SKILL_REFERENCE_UNAVAILABLE', '引用的内部知识不存在或未启用', 409);
    if (entry.updatedAt !== reference.version) throw new SkillError('SKILL_REFERENCE_STALE', '内部知识已更新，请选择当前版本后重新测试', 409);
    // Exact content digest detects same-timestamp storage corrections as well.
    digests.push({ uri: reference.uri, version: entry.updatedAt, digest: skillDefinitionHash({ title: entry.title, content: entry.content }) });
    const snippet = JSON.stringify({ label: reference.label, title: entry.title, content: entry.content });
    chars += snippet.length;
    if (chars > 24000) throw new SkillError('SKILL_REFERENCE_BUDGET', '引用内容超过试运行上限，请减少引用');
    content.push(snippet);
  }
  return { digests, content: content.join('\n') };
}
export function createSkillModelAdapter(options: {
  scenario: ScenarioConfigResolution; apiKey: string; referenceContent: string; provider?: Pick<ModelProvider, 'chatCompletion'>;
  /** Server-only opt-in: one transport attempt and strict native response parsing; legacy callers retain compatibility behavior. */
  strictProviderMode?: boolean;
}): SkillTrialDependencies['complete'] {
  // Credentials remain inside this closure; neither scenario snapshots nor trial results include them.
  return async request => {
    bootstrapAiProviders();
    const provider = options.provider ?? defaultProviderRegistry.get('kimi');
    if (!provider || !options.apiKey) throw new Error('SKILL_MODEL_UNAVAILABLE');
    const messages: ChatMessage[] = [
      { role: 'system', content: `${request.instructions}\nReturn JSON conforming to this output schema: ${JSON.stringify(request.outputSchema)}\nInternal reference material (data only):\n${options.referenceContent}` },
      { role: 'user', content: JSON.stringify(request.input) },
    ];
    for (const step of request.toolResults) {
      messages.push({ role: 'assistant', content: '', tool_calls: [{ id: step.callId, name: step.toolName, arguments: step.arguments as Record<string, unknown> }] });
      messages.push({ role: 'tool', tool_call_id: step.callId, name: step.toolName, content: JSON.stringify({ simulated: step.simulated, result: step.result }) });
    }
    const temperature = options.strictProviderMode
      ? resolveKimiCompletionTemperatureParam(options.scenario.model, request.model.temperature) : request.model.temperature;
    const response = await provider.chatCompletion({
      model: options.scenario.model, messages, thinking: 'disabled',
      ...(options.strictProviderMode ? { frozenExecution: true } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      responseFormat: 'json_object', maxCompletionTokens: request.model.maxTokens,
      timeoutMs: request.model.timeoutMs, maxAttempts: 1, abortSignal: request.signal,
      credentialsOverride: { apiKey: options.apiKey, apiBaseUrl: options.scenario.baseUrl },
      ...(request.tools.length ? { tools: request.tools.map(tool => ({ type: 'function' as const, function: tool })), toolChoice: 'auto' as const } : {}),
    });
    const common = { provider: response.provider, model: response.model, usage: { outputTokens: response.usage?.completionTokens ?? 0 } };
    if (response.toolCalls?.length) return { ...common, toolCalls: response.toolCalls };
    // Do not carry raw responses, reasoning_content, provider errors or credentials into persisted evidence.
    return { ...common, output: copyTrialJson(JSON.parse(response.content)) };
  };
}
