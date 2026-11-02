import type { ExecutionManifest } from '../skills/skills.module';
import type { WorkflowSchema, WorkflowToolContract } from '../workflows/workflows.module';
export type WorkflowFailureCode = 'execution_failed' | 'invalid_output' | 'rejected';
export type WorkflowReceipt = { operationId: string } & (
  { status: 'succeeded'; output: unknown } | { status: 'succeeded'; opaqueResult: unknown } |
  { status: 'failed'; code: WorkflowFailureCode }
);
/** Internal server checkpoint data; validating it does not authorize a caller or sign its contents. */
export type WorkflowRuntimeState = { schemaVersion: 1; executionId: string; manifestHash: string; receipts: WorkflowReceipt[] };
type CommandBase = { operationId: string; stepId: string; iteration: number; input: Record<string, unknown>; inputSchema: WorkflowSchema };
export type WorkflowCommand = CommandBase & (
  { type: 'skill'; skillId: string; skillVersionId: string; dependency: ExecutionManifest['skills'][number]; outputSchema: WorkflowSchema } |
  { type: 'userInput'; prompt: string; outputSchema: WorkflowSchema } |
  { type: 'confirmation'; prompt: string; outputSchema: WorkflowSchema } |
  { type: 'tool'; toolName: string; contract: WorkflowToolContract; requiresConfirmation: boolean }
);
export type WorkflowDecision = { state: WorkflowRuntimeState } & (
  { kind: 'ready'; command: WorkflowCommand } |
  { kind: 'waiting' | 'failed'; stepId: string; code: WorkflowFailureCode | 'repeat_limit' } |
  { kind: 'completed'; output: Record<string, unknown> }
);
export interface WorkflowRuntime {
  next(state?: unknown): WorkflowDecision;
  settle(state: unknown, receipt: { operationId: string; output: unknown }): WorkflowDecision;
  fail(state: unknown, receipt: { operationId: string; code: WorkflowFailureCode }): WorkflowDecision;
}
