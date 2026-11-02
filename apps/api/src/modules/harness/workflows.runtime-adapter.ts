import { compileSkillPayloadSchema, readPersistedExecutionManifest, skillDefinitionHash as hash, type ExecutionManifest } from '../skills/skills.module';
import type { WorkflowDefinition } from '../workflows/workflows.module';
import { copy, equalJson, exact, mapValues, object, own, predicates, reject, type WorkflowValues } from './workflows.runtime-values';
import type { WorkflowCommand, WorkflowDecision, WorkflowFailureCode, WorkflowReceipt, WorkflowRuntime, WorkflowRuntimeState } from './workflows.runtime.types';
export type { WorkflowCommand, WorkflowDecision, WorkflowFailureCode, WorkflowRuntimeState } from './workflows.runtime.types';
const failureCodes: WorkflowFailureCode[] = ['execution_failed', 'invalid_output', 'rejected'];
const confirmationOutput = { type: 'object', properties: { approved: { type: 'boolean' } }, required: ['approved'], additionalProperties: false };

/** Pure internal interpreter. No provider, tool, I/O, durable wait or authorization is performed here. */
export function createWorkflowRuntime(value: ExecutionManifest, executionId: string): WorkflowRuntime {
  if (typeof executionId !== 'string' || !executionId.trim() || executionId.length > 160) reject('INVALID_EXECUTION');
  let manifest: ExecutionManifest;
  try { manifest = readPersistedExecutionManifest(value); if (manifest.kind !== 'workflow') reject('INVALID_MANIFEST'); }
  catch { return reject('INVALID_MANIFEST'); }
  const definition = manifest.target.definition as WorkflowDefinition;
  const skills = manifest.skills as Array<ExecutionManifest['skills'][number]>;
  // Compile once for this frozen instance; replay must never resolve latest definitions or dependencies.
  const contracts = definition.steps.map(step => {
    const dependency = skills.find(skill => skill.stepId === step.id);
    const tool = manifest.tools.find(tool => tool.stepId === step.id)?.contract;
    const inputSchema = step.type === 'skill' ? dependency!.definition.inputSchema : step.type === 'tool' ? tool!.parameters : step.inputSchema;
    const outputSchema = step.type === 'skill' ? dependency!.definition.outputSchema : step.type === 'userInput' ? step.outputSchema : step.type === 'confirmation' ? confirmationOutput : null;
    return { dependency, tool, inputSchema, outputSchema, input: compileSkillPayloadSchema(inputSchema, 'inputSchema'),
      output: outputSchema ? compileSkillPayloadSchema(outputSchema, 'outputSchema') : null };
  });
  const finalOutput = compileSkillPayloadSchema(definition.outputSchema, 'outputSchema');
  const operationId = (stepId: string, iteration: number) => hash({ executionId, manifestHash: manifest.manifestHash, stepId, iteration });
  const initial = (): WorkflowRuntimeState => ({ schemaVersion: 1, executionId, manifestHash: manifest.manifestHash, receipts: [] });

  function state(value: unknown): WorkflowRuntimeState {
    const s = copy(value, 'INVALID_STATE');
    if (!object(s)) return reject('INVALID_STATE');
    exact(s, ['schemaVersion', 'executionId', 'manifestHash', 'receipts'], 'INVALID_STATE');
    if (s.schemaVersion !== 1 || s.executionId !== executionId || s.manifestHash !== manifest.manifestHash || !Array.isArray(s.receipts) || s.receipts.length > 500) reject('INVALID_STATE');
    for (const receipt of s.receipts) {
      if (!object(receipt) || typeof receipt.operationId !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.operationId)) reject('INVALID_STATE');
      if (receipt.status === 'failed') {
        exact(receipt, ['operationId', 'status', 'code'], 'INVALID_STATE');
        if (!failureCodes.includes(receipt.code as WorkflowFailureCode)) reject('INVALID_STATE');
      } else if (receipt.status === 'succeeded') exact(receipt, ['operationId', 'status', own(receipt, 'output') ? 'output' : 'opaqueResult'], 'INVALID_STATE');
      else reject('INVALID_STATE');
    }
    return s as WorkflowRuntimeState;
  }
  function replay(s: WorkflowRuntimeState): WorkflowDecision {
    const values: WorkflowValues = { input: manifest.initialInput, steps: {} }; let consumed = 0; let index = 0;
    const finish = (decision: WorkflowDecision): WorkflowDecision => {
      if (consumed !== s.receipts.length) reject('INVALID_STATE');
      // Limits belong to persisted state and each complete business payload, not to
      // their repeated appearances in a transient decision envelope.
      const copiedState = copy(decision.state, 'INVALID_STATE');
      if (decision.kind === 'completed') return { ...decision, state: copiedState, output: copy(decision.output, 'INVALID_STATE') };
      if (decision.kind === 'ready') return { ...decision, state: copiedState, command: {
        // Schema/dependency metadata already crossed the bounded C1 reader.
        ...structuredClone(decision.command), input: copy(decision.command.input, 'INVALID_STATE'),
      } };
      return { ...decision, state: copiedState };
    };
    while (index < definition.steps.length) {
      const step = definition.steps[index]; const contract = contracts[index];
      if (!predicates(step.prerequisite, values)) { index++; continue; }
      let iteration = 1;
      while (true) {
        const input = copy(mapValues(step.inputMapping, values), 'INVALID_STATE');
        if (!contract.input(input)) reject('INVALID_STATE');
        const id = operationId(step.id, iteration); const receipt = s.receipts[consumed];
        if (!receipt) {
          const common = { operationId: id, stepId: step.id, iteration, input, inputSchema: contract.inputSchema };
          let command: WorkflowCommand;
          if (step.type === 'skill') command = { ...common, type: 'skill', skillId: step.skillId, skillVersionId: step.skillVersionId, dependency: contract.dependency!, outputSchema: contract.outputSchema! };
          else if (step.type === 'tool') command = { ...common, type: 'tool', toolName: step.toolName, contract: contract.tool!,
            requiresConfirmation: Boolean(step.requiresConfirmation || contract.tool!.requiresConfirmation || contract.tool!.mutates || contract.tool!.exfiltrates || (object(contract.tool!.policy) && contract.tool!.policy.approvalStrategy === 'user-confirm')) };
          else command = { ...common, type: step.type, prompt: step.prompt, outputSchema: contract.outputSchema! };
          return finish({ kind: 'ready', command, state: s });
        }
        if (receipt.operationId !== id) reject('INVALID_STATE');
        consumed++;
        if (receipt.status === 'failed') return finish({ kind: step.onFailure === 'wait' ? 'waiting' : 'failed', stepId: step.id, code: receipt.code, state: s });
        if (step.type === 'tool') { if (!own(receipt, 'opaqueResult')) reject('INVALID_STATE'); }
        else {
          if (!own(receipt, 'output') || !contract.output!((receipt as { output: unknown }).output)) reject('INVALID_STATE');
          values.steps[step.id] = { output: (receipt as { output: unknown }).output };
        }
        if (!step.repeat || !predicates(step.repeat.while, values)) break;
        if (iteration >= step.repeat.maxIterations) return finish({ kind: step.repeat.onLimit === 'wait' ? 'waiting' : 'failed', stepId: step.id, code: 'repeat_limit', state: s });
        iteration++;
      }
      const branch = (step.branches ?? []).find(branch => predicates(branch.when, values));
      index = branch ? branch.target === '$end' ? definition.steps.length : definition.steps.findIndex(s => s.id === branch.target) : index + 1;
    }
    const output = mapValues(definition.outputMapping, values);
    if (!finalOutput(output)) reject('INVALID_STATE');
    return finish({ kind: 'completed', output, state: s });
  }
  function append(raw: unknown, input: unknown, failed: boolean): WorkflowDecision {
    const s = state(raw); const decision = replay(s); const data = copy(input, 'INVALID_RECEIPT');
    if (!object(data)) return reject('INVALID_RECEIPT');
    exact(data, ['operationId', failed ? 'code' : 'output'], 'INVALID_RECEIPT');
    if (typeof data.operationId !== 'string' || (failed && !failureCodes.includes(data.code as WorkflowFailureCode))) reject('INVALID_RECEIPT');
    const previous = s.receipts.find(receipt => receipt.operationId === data.operationId);
    if (previous) {
      const candidate = failed ? { operationId: data.operationId, status: 'failed', code: data.code } : { operationId: data.operationId, status: 'succeeded', [own(previous, 'opaqueResult') ? 'opaqueResult' : 'output']: data.output };
      if (!equalJson(candidate, previous)) reject('INVALID_RECEIPT');
      return decision;
    }
    if (decision.kind !== 'ready' || data.operationId !== decision.command.operationId || s.receipts.length >= 500) reject('INVALID_RECEIPT');
    const command = decision.command;
    let receipt: WorkflowReceipt;
    if (failed) receipt = { operationId: data.operationId, status: 'failed', code: data.code as WorkflowFailureCode };
    else {
      const index = definition.steps.findIndex(step => step.id === command.stepId); const contract = contracts[index];
      if (contract.output && !contract.output(data.output)) reject('INVALID_OUTPUT');
      receipt = { operationId: data.operationId, status: 'succeeded', ...(command.type === 'tool' ? { opaqueResult: data.output } : { output: data.output }) };
    }
    s.receipts.push(receipt);
    return replay(state(s));
  }
  return {
    next: value => replay(value === undefined ? initial() : state(value)),
    settle: (state, receipt) => append(state, receipt, false),
    fail: (state, receipt) => append(state, receipt, true),
  };
}
