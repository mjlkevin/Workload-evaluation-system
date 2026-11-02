import type { Database } from '../../db/client';
import type { AuthUser, BusinessRole } from '../../types';
import type { SkillDefinition } from './skills.types';
import type { SkillDependencySnapshot } from './skills-release.types';
import type { WorkflowDefinition, WorkflowDependencySnapshot } from '../workflows/workflows.module';
export type ExecutionDbExecutor = Pick<Database, 'select' | 'insert' | 'update' | 'execute'>;
export type SourceReference = { kind: 'file' | 'conversation'; id: string; location?: string };
export type ExecutionRequest = ({ kind: 'skill'; skillId: string } | { kind: 'workflow'; workflowId: string }) & { input: unknown; sources?: SourceReference[] };
export type FrozenSkill = { stepId: string; skillId: string; versionId: string; hash: string; definition: SkillDefinition };
export type ExecutionSnapshot = { kind: 'skill' | 'workflow'; target: { id: string; versionId: string; hash: string; definition: SkillDefinition | WorkflowDefinition };
  skills: FrozenSkill[]; publishedDependencies?: WorkflowDependencySnapshot };
export type ReferenceMaterial = { uri: string; version: string; digest: string; title: string; content: string };
export type ExecutionManifest = ExecutionSnapshot & { schemaVersion: 1; caller: { id: string; businessRole: BusinessRole };
  skills: Array<FrozenSkill & { context: SkillDependencySnapshot; materials: ReferenceMaterial[] }>;
  tools: WorkflowDependencySnapshot['tools']; initialInput: unknown; sources: SourceReference[];
  /** Template/rule binding has no resolver yet. Empty does not claim those business assets are frozen. */
  assetBindings: []; manifestHash: string };
export interface PreparedExecution { resolveInTransaction(tx: ExecutionDbExecutor): Promise<ExecutionManifest> }
export interface ExecutionManifestRepository {
  read(tx: ExecutionDbExecutor, request: ExecutionRequest, lock: boolean): Promise<ExecutionSnapshot>;
  verifyCaller(tx: ExecutionDbExecutor, user: AuthUser): Promise<void>;
}
