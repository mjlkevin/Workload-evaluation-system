import { randomUUID } from 'node:crypto';
import { skillDefinitionHash as hash } from '../skills/skills.hash';
import type { ExecutionManifest } from '../skills/execution-manifest.types';
import type { SkillDefinition } from '../skills/skills.types';
import { hashHarnessCheckpointState } from './harness-runtime.worker';
export { hash };
export const payload = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
export const definition: SkillDefinition = { name: 'Frozen adapter fixture', description: '', category: 'test', instructions: 'Original instructions', roles: ['pre_sales'],
  inputSchema: payload, outputSchema: payload, references: [], tools: [], examples: [], model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 } };
export function frozenManifest(): ExecutionManifest {
  const body = { schemaVersion: 1 as const, kind: 'skill' as const, target: { id: 'skill', versionId: 'version', hash: hash(definition), definition: structuredClone(definition) },
    caller: { id: 'owner', businessRole: 'pre_sales' as const }, initialInput: { text: 'original' }, sources: [], assetBindings: [] as [], tools: [],
    skills: [{ stepId: '$skill', skillId: 'skill', versionId: 'version', hash: hash(definition), definition: structuredClone(definition), materials: [], context: {
      schemaVersion: 1 as const, references: [], tools: [], roles: ['ADMIN'] as any,
      model: { providerId: 'fixture', model: 'frozen', modelSource: 'binding' as const, credentialScope: 'ai', baseUrlDigest: hash('endpoint'), params: definition.model, capabilities: [], supportedParams: [] },
    } }] };
  return { ...body, manifestHash: hash(body) };
}
export function runFixture(manifest = frozenManifest()): any {
  const content = 'Start frozen task'; const sessionId = randomUUID();
  const execution = { kind: manifest.kind, [manifest.kind === 'skill' ? 'skillId' : 'workflowId']: manifest.target.id, input: manifest.initialInput, sources: manifest.sources };
  return { harnessRunId: randomUUID(), ownerUserId: manifest.caller.id, aiSessionId: sessionId, runKind: 'workbench_chat', workflowId: 'business_skills_v1', workflowVersion: '1.0.0',
    executionConfig: { content, executionManifest: manifest }, metadata: { invocationFingerprint: hash({ sessionId, content, execution }) } };
}
export function checkpoint(run: any, state: Record<string, unknown> = {}, next: string | null = 'execute'): any {
  const body = { businessSkills: { schemaVersion: 1, runId: run.harnessRunId, manifestHash: run.executionConfig.executionManifest.manifestHash, state }, nextStepKey: next };
  return { harnessRunCheckpointId: randomUUID(), harnessRunId: run.harnessRunId, workflowId: run.workflowId, workflowVersion: run.workflowVersion, stepKey: 'execute',
    resumePolicy: 'restart_step', checkpointKey: 'fixture', state: body, stateHash: hashHarnessCheckpointState(body), effectKeys: [] };
}
export function context(run = runFixture(), cp: any = null): any {
  return { run, attempt: { harnessRunAttemptId: randomUUID(), attemptNo: 1 }, stepKey: 'execute', state: cp?.state ?? {}, resumeFrom: cp,
    abortSignal: new AbortController().signal, makeEffectKey: () => '', recordToolEffectOnce: async () => ({ created: true }) };
}
export function outcome(nextStepKey: 'execute' | null = null): any {
  const content = { text: 'Frozen result' };
  return { nextStepKey, state: { cursor: 1 }, checkpoint: { key: 'result', kind: 'structural', resumePolicy: 'restart_step' },
    output: { status: nextStepKey ? 'partial' : 'final', content, contentHash: hash(content) } };
}
export function frozenWorkflowManifest(): ExecutionManifest {
  const manifest = frozenManifest();
  const material = { uri: 'wes://knowledge/frozen-workflow-source', version: '2026-11-02T00:00:00.000Z', title: 'Original title', content: 'Original workflow material' };
  const digest = hash({ title: material.title, content: material.content });
  const skill = manifest.skills[0]; skill.stepId = 's';
  skill.definition.references = [{ label: 'Source', uri: material.uri, version: material.version }]; skill.hash = hash(skill.definition);
  skill.materials = [{ ...material, digest }]; skill.context.references = [{ uri: material.uri, version: material.version, digest }];
  const workflowDefinition = { name: 'Frozen workflow', description: '', category: 'test', roles: ['pre_sales'], inputSchema: structuredClone(payload), outputSchema: structuredClone(payload),
    steps: [{ id: 's', name: 'Frozen Skill', type: 'skill', skillId: skill.skillId, skillVersionId: skill.versionId,
      inputMapping: [{ target: 'text', source: { kind: 'path', path: '$.input.text' } }], onFailure: 'fail' }],
    outputMapping: [{ target: 'text', source: { kind: 'path', path: '$.steps.s.output.text' } }] } as any;
  manifest.kind = 'workflow'; manifest.target = { id: 'workflow', versionId: 'workflow-version', hash: hash(workflowDefinition), definition: workflowDefinition };
  manifest.publishedDependencies = { schemaVersion: 1, tools: [], skills: [{ stepId: skill.stepId, skillId: skill.skillId, skillVersionId: skill.versionId, hash: skill.hash, context: structuredClone(skill.context) }] };
  const { manifestHash, ...body } = manifest; manifest.manifestHash = hash(body); return manifest;
}
