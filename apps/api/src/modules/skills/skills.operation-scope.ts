import Ajv from 'ajv';
import { isDeepStrictEqual } from 'node:util';
import { and, desc, eq } from 'drizzle-orm';
import { harnessRunCheckpoints, type HarnessRunRow } from '../../db/schema';
import type { QueueDbExecutor } from '../harness/harness.module';
import { readBusinessSkillsCheckpoint } from '../harness/business-skills.workflow';
import { readBusinessSkillsHostState } from '../harness/business-skills.host-state';
import { createWorkflowRuntime } from '../harness/workflows.runtime-adapter';
import type { ExecutionManifest } from './execution-manifest.types';
import type { FrozenExecutionSkill } from './skills.execution-model';
import type { ToolPolicyEntry } from '../../types';
import { readSkillPath } from './skills.sandbox';
import { skillDefinitionHash as hash } from './skills.hash';
import { SkillError } from './skills.types';
export type OperationRequest = { runId: string; stepId: string; ordinal: number; toolName: string; parameters: unknown };
type Snapshot = FrozenExecutionSkill['context']['tools'][number];
export type OperationSelection = ({ kind: 'skill'; skill: FrozenExecutionSkill; binding: FrozenExecutionSkill['definition']['tools'][number] }
 | { kind: 'tool'; binding: { requiresConfirmation: boolean } }) & { snapshot: Snapshot; tools: Snapshot[] };
const fail = (code = 'OPERATION_SCOPE_INVALID', status = 409): never => { throw new SkillError(code, '待确认操作的流程节点或内容已变化', status); };
function parameters(snapshot: Snapshot, input: unknown, request: OperationRequest) {
 const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false, addUsedSchema: false }).compile(snapshot.native.parameters);
 if (!validate(request.parameters)) fail('OPERATION_PARAMETERS_INVALID', 400);
 if (!isDeepStrictEqual(input, request.parameters)) fail('OPERATION_PARAMETERS_MISMATCH');
}
export function selectSkillOperation(skill: FrozenExecutionSkill, input: unknown, request: OperationRequest): OperationSelection {
 if (request.stepId !== skill.stepId) fail();
 const binding = skill.definition.tools.find(t => t.toolName === request.toolName), snapshot = skill.context.tools.find(t => t.native.name === request.toolName);
 if (!binding || !snapshot) return fail('OPERATION_TOOL_DENIED', 403);
 const mapped: Record<string, unknown> = {};
 for (const [key, path] of Object.entries(binding.inputMapping)) { const value = readSkillPath(input, path); if (value !== undefined) mapped[key] = value; }
 parameters(snapshot, mapped, request);
 return { kind: 'skill', skill, binding, snapshot, tools: skill.context.tools };
}
/** Selection can only originate from an actual locked server checkpoint, never a supplied cursor. */
export async function readWorkflowOperationScope(tx: QueueDbExecutor, run: HarnessRunRow, rootRunId: string, manifest: ExecutionManifest,
 request: OperationRequest, anchorId?: string) {
 try {
  const [cp] = anchorId ? await tx.select().from(harnessRunCheckpoints).where(and(eq(harnessRunCheckpoints.harnessRunId, run.harnessRunId), eq(harnessRunCheckpoints.harnessRunCheckpointId, anchorId))).for('share')
   : await tx.select().from(harnessRunCheckpoints).where(eq(harnessRunCheckpoints.harnessRunId, run.harnessRunId)).orderBy(desc(harnessRunCheckpoints.sequence)).limit(1).for('share');
  if (!cp || !Number.isSafeInteger(cp.sequence) || cp.sequence < 1 || !anchorId && run.lastCheckpointId !== cp.harnessRunCheckpointId) fail();
  const state = readBusinessSkillsHostState(readBusinessSkillsCheckpoint(cp!, run, manifest), manifest, rootRunId);
  if (!anchorId && (cp!.state as any).nextStepKey !== 'execute' || !state.workflow) fail();
  const decision = createWorkflowRuntime(manifest, rootRunId).next(state.workflow);
  if (decision.kind !== 'ready' || !['skill', 'tool'].includes(decision.command.type)) return fail();
  const command = decision.command;
  if (request.stepId !== command.stepId) fail();
  let selected: OperationSelection;
  if (command.type === 'skill') {
   const cursor = state.skill, call = cursor?.pendingBatch[cursor.nextToolIndex];
   if (!cursor || cursor.phase !== 'tools' || !call || call.ordinal !== request.ordinal || call.name !== request.toolName
    || !isDeepStrictEqual(call.arguments, request.parameters)) fail();
   selected = selectSkillOperation(command.dependency as FrozenExecutionSkill, command.input, request);
  } else {
   if (command.type !== 'tool' || state.skill || request.ordinal !== 0 || request.toolName !== command.toolName || manifest.schemaVersion !== 2) return fail();
   const evidence = manifest.toolAuthority.tools.find(t => t.stepId === command.stepId); if (!evidence) return fail();
   const snapshot: Snapshot = { native: { ...command.contract, sandboxReadSafe: evidence.sandboxReadSafe } as Snapshot['native'], policy: command.contract.policy as ToolPolicyEntry };
   parameters(snapshot, command.input, request);
   selected = { kind: 'tool', binding: { requiresConfirmation: command.requiresConfirmation }, snapshot, tools: [snapshot] };
  }
  const scope = { workflowId: manifest.target.id, workflowVersionId: manifest.target.versionId, workflowHash: manifest.target.hash,
   commandId: command.operationId, iteration: command.iteration, commandInputHash: hash(command.input), stepType: command.type };
  return { selected, scope, sourceCheckpointId: cp!.harnessRunCheckpointId, sourceCheckpointSequence: cp!.sequence, sourceCheckpointHash: cp!.stateHash };
 } catch (error) { if (error instanceof SkillError) throw error; return fail(); }
}
export function operationContent(manifest: ExecutionManifest, rootRunId: string, request: OperationRequest, selected: OperationSelection,
 workflow?: Awaited<ReturnType<typeof readWorkflowOperationScope>>) {
 const common = { rootRunId, manifestHash: manifest.manifestHash,
  ...(selected.kind === 'skill' ? { skillId: selected.skill.skillId, versionId: selected.skill.versionId, definitionHash: selected.skill.hash } : {}),
  stepId: request.stepId, ordinal: request.ordinal, toolName: request.toolName, binding: selected.binding,
  native: selected.snapshot.native, policy: selected.snapshot.policy, parameters: request.parameters };
 if (!workflow) return { content: { schemaVersion: 1, ...common }, operationKey: `business-op:v1:${hash({ schemaVersion: 1, rootRunId, stepId: request.stepId, ordinal: request.ordinal })}` };
 return { content: { schemaVersion: 2, ...workflow.scope, ...common },
  operationKey: `business-op:v2:${hash({ schemaVersion: 2, rootRunId, commandId: workflow.scope.commandId, ordinal: request.ordinal })}` };
}
