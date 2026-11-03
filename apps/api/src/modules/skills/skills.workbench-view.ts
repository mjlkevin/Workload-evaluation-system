import type { ExecutionManifest } from './execution-manifest.types';
import type { WorkflowDefinition } from '../workflows/workflows.types';
import type { BusinessSkillsHostState } from '../harness/business-skills.host-state';
import { createWorkflowRuntime } from '../harness/workflows.runtime-adapter';
import { copyTrialJson } from './skills.sandbox';

/** Public business payloads are bounded JSON. Configuration and authority proofs never cross this boundary. */
export function safeBusinessJson(value: unknown): any {
  const visit = (item: any): any => Array.isArray(item) ? item.map(visit) : item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).filter(([key]) => !/^(credentialScope|executionAuthority|executionManifest|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|password|passwordHash|private[_-]?key|secret|ciphertext|encryptedValue)$/i.test(key)).map(([key, child]) => [key, visit(child)])) : item;
  return visit(copyTrialJson(value, 'definition'));
}
export type BusinessExecutionView = {
  kind: 'skill' | 'workflow'; target: { id: string; versionId: string; name: string; description: string };
  input: unknown; steps: Array<{ id: string; name: string; type: string; versionId?: string }>;
  currentStep?: { id: string; status: string };
  results: { steps: Array<{ stepId: string; status: string; output?: unknown; result?: unknown; code?: string }>;
    effects: Array<{ toolName: string; parameters?: unknown; result: unknown }>; output?: unknown };
};
/** Only validated server-owned state enters this projector; it is never a cursor parser or an authority source. */
export function buildBusinessExecutionView(manifest: ExecutionManifest, state?: BusinessSkillsHostState): BusinessExecutionView {
  const definition = manifest.target.definition;
  const steps = manifest.kind === 'skill' ? [{ id: '$skill', name: definition.name, type: 'skill', versionId: manifest.target.versionId }]
    : (definition as WorkflowDefinition).steps.map(step => ({ id: step.id, name: step.name, type: step.type,
      ...(step.type === 'skill' ? { versionId: step.skillVersionId } : {}) }));
  const view: BusinessExecutionView = { kind: manifest.kind,
    target: { id: manifest.target.id, versionId: manifest.target.versionId, name: definition.name, description: definition.description },
    input: safeBusinessJson(manifest.initialInput ?? {}), steps, results: { steps: [], effects: [] } };
  if (state?.workflow) {
    const runtime = createWorkflowRuntime(manifest, state.workflow.executionId);
    const decision = runtime.next(state.workflow);
    for (let index = 0; index < state.workflow.receipts.length; index++) {
      const before = runtime.next({ ...state.workflow, receipts: state.workflow.receipts.slice(0, index) });
      if (before.kind !== 'ready') throw new Error('BUSINESS_SKILLS_PROJECTION_INVALID');
      const receipt = state.workflow.receipts[index];
      view.results.steps.push({ stepId: before.command.stepId, status: receipt.status,
        ...(receipt.status === 'failed' ? { code: receipt.code } : 'output' in receipt ? { output: safeBusinessJson(receipt.output) }
          : { result: safeBusinessJson(receipt.opaqueResult) }) });
    }
    if (decision.kind === 'ready') view.currentStep = { id: decision.command.stepId, status: 'running' };
    else if (decision.kind === 'completed') view.results.output = safeBusinessJson(decision.output);
    else view.currentStep = { id: decision.stepId, status: decision.kind };
  }
  if (state?.skill) {
    const skill = state.skill;
    view.currentStep = { id: skill.stepId, status: skill.phase === 'completed' ? 'completed' : 'running' };
    view.results.effects = skill.toolResults.map(tool => ({ toolName: tool.toolName, parameters: safeBusinessJson(tool.arguments), result: safeBusinessJson(tool.result) }));
    if (skill.phase === 'completed') {
      if (manifest.kind === 'skill') view.results.output = safeBusinessJson(skill.output);
      view.results.steps.push({ stepId: skill.stepId, status: 'succeeded', output: safeBusinessJson(skill.output) });
    }
  }
  return view;
}
export function sanitizeBusinessRunSnapshot(snapshot: any): any {
  const pick = (value: any, fields: string[]) => value == null ? null : Object.fromEntries(fields.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
  return {
    run: pick(snapshot.run, ['harnessRunId', 'aiSessionId', 'ownerUserId', 'title', 'status', 'runKind', 'workflowId', 'workflowVersion', 'retryOfRunId', 'eventSequence', 'createdAt', 'updatedAt', 'startedAt', 'completedAt', 'cancelRequestedAt']),
    attempt: pick(snapshot.attempt, ['harnessRunAttemptId', 'attemptNo', 'status', 'createdAt', 'startedAt', 'completedAt']),
    checkpoint: pick(snapshot.checkpoint, ['harnessRunCheckpointId', 'sequence', 'checkpointKind', 'stepKey', 'createdAt']),
    output: snapshot.output ? { ...pick(snapshot.output, ['harnessRunOutputId', 'status', 'createdAt', 'updatedAt']), content: safeBusinessJson(snapshot.output.content) } : null,
  };
}
