import type { RuntimeContext } from '../../../agent/context/context.types';
import { isDeepStrictEqual } from 'node:util';
import { and, eq, inArray } from 'drizzle-orm';
import { db, type Database } from '../../../db/client';
import { harnessRuns, harnessRunEvents, harnessRunCheckpoints, type HarnessRunRow } from '../../../db/schema';
import type { QueueDbExecutor } from '../../harness/harness-runtime.repository';
import type { BusinessSkillsHostState } from '../../harness/business-skills.host-state';
import { readBusinessSkillsCheckpoint } from '../../harness/business-skills.workflow';
import { readBusinessSkillHostCheckpointInTransaction } from '../../harness/business-skills.operation-wait';
import { businessSkillsWaitActionId } from '../../harness/business-skills.wait';
import { createWorkflowRuntime, type WorkflowCommand, type WorkflowRuntimeState } from '../../harness/workflows.runtime-adapter';
import { assertRunAdmissionInTransaction } from '../execution-emergency';
import { skillDefinitionHash as hash } from '../skills.hash';
import { SkillError } from '../skills.types';
import type { ExecutionManifest } from '../execution-manifest.types';
import { parseMvpContract, type RequirementSource } from './requirements';

export type MvpConfirmationProof = { actorId: string; decisionId: string; actionId: string; physicalRunId: string;
 stepId: string; displayInput: unknown };
export type MvpExecutionProof = { manifest: ExecutionManifest; rootRunId: string; run: HarnessRunRow;
 state: BusinessSkillsHostState; command: Extract<WorkflowCommand, { type: 'tool' }>; sources: RequirementSource[];
 readConfirmation(expectedDisplayInput: unknown): MvpConfirmationProof;
 readAnswerSources(): RequirementSource[];
 assertPreviousOutput(toolNames: readonly string[], expectedOutput: unknown): void };

const invalid = (code = 'MVP_EXECUTION_PROOF_INVALID'): never => { throw new SkillError(code, '当前任务、来源或确认内容已变化，请重新读取', 409); };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
type WaitSummary = { operationId: string; kind: 'userInput' | 'confirmation'; stepId: string; contractHash: string;
 contentHash: string; inputHash: string; index: number; output: unknown };
type AnswerProof = { wait: WaitSummary; actionId: string; physicalRunId: string };
const inputHash = (value: unknown) => hash(parseMvpContract({}, value));

/** Strict lineage was already validated under SHARE locks by the host checkpoint reader. */
async function physicalRuns(tx: QueueDbExecutor, run: HarnessRunRow, rootRunId: string) {
 const runs: HarnessRunRow[] = [run]; let current = run;
 while (current.retryOfRunId) {
  if (runs.length >= 64 || runs.some(r => r.harnessRunId === current.retryOfRunId)) return invalid();
  const [parent] = await tx.select().from(harnessRuns).where(and(eq(harnessRuns.harnessRunId, current.retryOfRunId), eq(harnessRuns.ownerUserId, run.ownerUserId))).for('share');
  if (!parent) return invalid(); runs.push(parent); current = parent;
 }
 if (current.harnessRunId !== rootRunId) return invalid();
 return runs;
}

/** Events alone never grant anything: the exact original wait checkpoint is replayed too. */
async function ownerAnswers(tx: QueueDbExecutor, runs: HarnessRunRow[], manifest: ExecutionManifest, workflow: WorkflowRuntimeState, waits: WaitSummary[]) {
 const proofs: AnswerProof[] = [];
 if (!waits.length) return proofs;
 // A modern cursor permits at most 500 receipts. Refuse excessive/corrupt audit candidates,
 // rather than allowing an unbounded history read while the current Run is locked.
 const events = await tx.select().from(harnessRunEvents).where(and(inArray(harnessRunEvents.harnessRunId, runs.map(r => r.harnessRunId)),
  eq(harnessRunEvents.eventType, 'workflow.answer_recorded'))).limit(1001).for('share');
 if (events.length > 1000) return invalid();
 const byAction = new Map<string, typeof events>();
 for (const event of events) if (object(event.payload) && typeof event.payload.actionId === 'string') {
  const key = `${event.harnessRunId}:${event.payload.actionId}`; byAction.set(key, [...(byAction.get(key) ?? []), event]);
 }
 for (const wait of waits) {
  for (const run of runs) {
   const actionId = businessSkillsWaitActionId(run, manifest.manifestHash, { operationId: wait.operationId, kind: wait.kind,
    stepId: wait.stepId, contractHash: wait.contractHash, contentHash: wait.contentHash });
   const candidates = byAction.get(`${run.harnessRunId}:${actionId}`) ?? [];
   if (candidates.length !== 1) continue;
   const payload = candidates[0].payload as Record<string, unknown>;
   if (payload.kind !== wait.kind || payload.stepId !== wait.stepId || payload.contentHash !== wait.contentHash
    || payload.requestedBy !== run.ownerUserId || payload.valueHash !== hash(wait.output)
    || wait.kind === 'confirmation' && (!object(wait.output) || wait.output.approved !== true || payload.approved !== true)) continue;
   const [cp] = await tx.select().from(harnessRunCheckpoints).where(and(eq(harnessRunCheckpoints.harnessRunId, run.harnessRunId),
    eq(harnessRunCheckpoints.checkpointKey, `wait:${actionId}`))).limit(1).for('share');
   if (!cp) continue;
   try {
    const raw = readBusinessSkillsCheckpoint(cp, run, manifest);
    const wrapped = raw.kind === 'workflow' && raw.schemaVersion === 1 && Object.keys(raw).sort().join(',') === 'kind,schemaVersion,workflow';
    const original = wrapped ? raw.workflow : raw;
    // Exact equality to a prefix already validated by the one-pass interpreter proves the
    // same deterministic wait command; no per-checkpoint interpreter/manifest compilation.
    if ((cp.state as Record<string, unknown>).nextStepKey !== 'execute'
     || !isDeepStrictEqual(original, { ...workflow, receipts: workflow.receipts.slice(0, wait.index) })) continue;
    proofs.push({ wait, actionId, physicalRunId: run.harnessRunId }); break;
   } catch { /* Corrupt historical data cannot become an approval or a source. */ }
  }
 }
 return proofs;
}

/** No pool acquisition, provider/config read or client cursor is allowed in this transaction seam. */
export async function readCurrentMvpExecutionInTransaction(tx: QueueDbExecutor, ownerUserId: string, runtime: RuntimeContext | undefined,
 toolName: string, parameters: unknown): Promise<MvpExecutionProof> {
 try {
  if (!uuid(ownerUserId) || !runtime || !uuid(runtime.harnessRunId) || runtime.actor?.userId !== ownerUserId || !uuid(runtime.aiSessionId)) return invalid();
  // Readers compose with operation consumers already holding SHARE; never upgrade the
  // Run lock while another consumer can be waiting on the same unique effect receipt.
  const [run] = await tx.select().from(harnessRuns).where(and(eq(harnessRuns.harnessRunId, runtime.harnessRunId),
   eq(harnessRuns.ownerUserId, ownerUserId))).for('share');
  if (!run || run.aiSessionId !== runtime.aiSessionId || run.status !== 'running' || run.cancelRequestedAt) return invalid();
  const admission = await assertRunAdmissionInTransaction(tx, run.harnessRunId, ownerUserId);
  const current = await readBusinessSkillHostCheckpointInTransaction(tx, run), { manifest, chain, cp, state } = current;
  if (hash(admission.manifest) !== hash(manifest) || admission.identity.id !== ownerUserId || admission.identity.status !== 'active'
   || manifest.kind !== 'workflow' || manifest.schemaVersion !== 2 || !cp || !state?.workflow || state.skill
   || (cp.state as Record<string, unknown>).nextStepKey !== 'execute') return invalid();
  const waits: WaitSummary[] = [], outputs: Array<{ name: string; output: unknown }> = [];
  const decision = createWorkflowRuntime(manifest, chain.root).visit(state.workflow, ({ command, receipt, index }) => {
   if (receipt.status !== 'succeeded' || !('output' in receipt)) return;
   if (command.type === 'tool') outputs.push({ name: command.toolName, output: receipt.output });
   else if (command.type === 'userInput' || command.type === 'confirmation') waits.push({ operationId: command.operationId, kind: command.type,
    stepId: command.stepId, index, output: receipt.output, inputHash: hash(command.input), contractHash: hash(command.outputSchema),
    contentHash: hash({ prompt: command.prompt, displayInput: command.input }) });
  });
  if (decision.kind !== 'ready' || decision.command.type !== 'tool' || decision.command.contract.source !== 'code'
   || decision.command.toolName !== toolName || !isDeepStrictEqual(decision.command.input, parameters)) return invalid();
  const answers = await ownerAnswers(tx, await physicalRuns(tx, run, chain.root), manifest, state.workflow, waits);
  const answerSources: RequirementSource[] = answers.filter(proof => proof.wait.kind === 'userInput').map(proof => ({
   id: `answer:${proof.actionId}`, kind: 'conversation',
   text: typeof proof.wait.output === 'string' ? proof.wait.output : JSON.stringify(proof.wait.output),
  }));
  const sources: RequirementSource[] = (manifest.sourceMaterials ?? []).map(({ digest: _digest, ...source }) => structuredClone(source));
  if (!object(manifest.initialInput)) return invalid();
  if (Object.prototype.hasOwnProperty.call(manifest.initialInput, 'description')) {
   const description = manifest.initialInput.description;
   if (typeof description !== 'string' || !description.trim() || description.length > 200000) return invalid();
   sources.push({ id: `input:${chain.root}`, kind: 'conversation', text: description });
  }
  sources.push(...answerSources);
  if (sources.some(s => !s.text.trim()) || new Set(sources.map(s => s.id)).size !== sources.length) return invalid();
  // Public result data are detached from the hidden proof copies. Methods are pure and remain
  // usable after this short transaction commits; they never retain or later call its tx handle.
  const confirmations = new Map(answers.filter(p => p.wait.kind === 'confirmation').map(p => [p.wait.index, { actorId: ownerUserId,
   decisionId: p.actionId, actionId: p.actionId, physicalRunId: p.physicalRunId, stepId: p.wait.stepId }]));
  const confirmationCommands = waits.filter(v => v.kind === 'confirmation').map(v => ({ index: v.index, inputHash: v.inputHash }));
  const hiddenSources = structuredClone(answerSources);
  return { ...structuredClone({ manifest, rootRunId: chain.root, run, state, command: decision.command, sources }),
   readConfirmation(expectedDisplayInput) {
    // A later rejection or unproven receipt for these exact contents must not fall back
    // to an older approval. The current durable prefix defines the newest decision.
    const digest = inputHash(expectedDisplayInput), latest = [...confirmationCommands].reverse().find(p => p.inputHash === digest);
    const proof = latest ? confirmations.get(latest.index) : undefined;
    return proof ? structuredClone({ ...proof, displayInput: expectedDisplayInput }) : invalid('MVP_CONFIRMATION_PROOF_MISSING');
   },
   readAnswerSources: () => structuredClone(hiddenSources),
   assertPreviousOutput(toolNames, expectedOutput) {
    const previous = [...outputs].reverse().find(value => toolNames.includes(value.name));
    if (!previous || !isDeepStrictEqual(previous.output, expectedOutput)) invalid('MVP_PREVIOUS_OUTPUT_MISMATCH');
   },
  };
 } catch (error) {
  if (error instanceof SkillError) throw error;
  return invalid();
 }
}
export function createMvpExecutionProofRepository(database: Database = db) {
 return { readCurrentExecution(ownerUserId: string, runtime: RuntimeContext | undefined, toolName: string, parameters: unknown) {
  return database.transaction(tx => readCurrentMvpExecutionInTransaction(tx, ownerUserId, runtime, toolName, parameters));
 } };
}
