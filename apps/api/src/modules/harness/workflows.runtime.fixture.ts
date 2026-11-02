import { frozenWorkflowManifest, hash, payload } from './business-skills.test-fixture';
import type { ExecutionManifest } from '../skills/skills.module';
import type { WorkflowDefinition, WorkflowMapping, WorkflowPredicate } from '../workflows/workflows.module';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../agent/tool-policy';
export { hash, payload };
export const path = (target: string, source: string, ...fallback: unknown[]): WorkflowMapping => ({ target, source: { kind: 'path', path: source, ...(fallback.length ? { fallback: fallback[0] } : {}) } });
export const literal = (target: string, value: unknown): WorkflowMapping => ({ target, source: { kind: 'literal', value } });
export const predicate = (source: string, op: WorkflowPredicate['op'], ...value: unknown[]): WorkflowPredicate => ({ path: source, op, ...(value.length ? { value: value[0] } : {}) });
export const objectSchema = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
/** Every edited fixture is rehashed and still passes the production C1 reader. */
export function manifest(edit: (definition: WorkflowDefinition, manifest: ExecutionManifest) => void = () => {}): ExecutionManifest {
  const m = frozenWorkflowManifest(); const d = m.target.definition as WorkflowDefinition;
  d.steps.push({ id: 'u', name: 'User', type: 'userInput', prompt: 'Original prompt', inputSchema: payload, outputSchema: payload,
    inputMapping: [path('text', '$.steps.s.output.text')], onFailure: 'wait' },
    { id: 'c', name: 'Confirm', type: 'confirmation', prompt: 'Approve?', inputSchema: payload,
      inputMapping: [path('text', '$.steps.u.output.text')], onFailure: 'fail' },
    { id: 't', name: 'Tool', type: 'tool', toolName: 'native_write', requiresConfirmation: true,
      inputMapping: [path('text', '$.steps.u.output.text')], onFailure: 'fail' });
  d.outputMapping = [path('text', '$.steps.u.output.text')];
  const contract = { name: 'native_write', description: 'Frozen native contract', parameters: payload, mutates: true, exfiltrates: false,
    simulationOnly: false, source: 'code', capability: 'estimates:read', requiresConfirmation: true, policy: structuredClone(DEFAULT_TOOL_POLICY_ENTRY) } as const;
  m.tools = [{ stepId: 't', contract, hash: hash(contract) }]; edit(d, m);
  m.skills = (m.skills as Array<ExecutionManifest['skills'][number]>).filter(skill => d.steps.some(step => step.id === skill.stepId && step.type === 'skill'));
  for (const skill of m.skills) skill.hash = hash(skill.definition);
  m.tools = m.tools.filter(tool => d.steps.some(step => step.id === tool.stepId && step.type === 'tool'));
  for (const tool of m.tools) tool.hash = hash(tool.contract);
  m.publishedDependencies = { schemaVersion: 1, skills: (m.skills as Array<ExecutionManifest['skills'][number]>).map(s => ({ stepId: s.stepId, skillId: s.skillId, skillVersionId: s.versionId, hash: s.hash, context: structuredClone(s.context) })), tools: structuredClone(m.tools) };
  m.target.hash = hash(d); const { manifestHash: _, ...body } = m; m.manifestHash = hash(body); return m;
}
export function single(edit: (definition: WorkflowDefinition, manifest: ExecutionManifest) => void = () => {}) {
  return manifest((d, m) => { d.steps = d.steps.slice(0, 1); d.outputMapping = [path('text', '$.steps.s.output.text')]; edit(d, m); });
}
