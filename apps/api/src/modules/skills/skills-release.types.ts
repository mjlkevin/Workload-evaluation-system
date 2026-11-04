import type { SkillDbExecutor } from './skills-pg.repository';
import type { SkillTrialResult } from './skills.evaluation';
import type { SkillToolDefinition } from './skills.validation';
import type { ToolPolicyEntry } from '../../types';
import type { V2Role } from '../../rbac/roles';
import type { Capability } from '../../rbac/permissions';
import type { SkillActor, SkillDefinition, SkillRecord, SkillVersion } from './skills.types';
export type SkillDependencySnapshot = {
  schemaVersion: 1;
  references: Array<{ uri: string; version: string; digest: string }>;
  model: { providerId: string; model: string; modelSource: string; credentialScope: string; baseUrlDigest: string;
    params: SkillDefinition['model']; capabilities: string[]; supportedParams: string[] };
  tools: Array<{ native: SkillToolDefinition & { source: 'code' | 'mcp'; sandboxReadSafe: boolean; capability: Capability }; policy: ToolPolicyEntry }>;
  roles: V2Role[];
};
/** Context is absent only on legacy/pure evaluator results; production trials always persist the server snapshot. */
export type SkillPersistedTrialResult = SkillTrialResult & { dependencyContext?: SkillDependencySnapshot };
export type SkillEvaluation = {
  id: string; skillId: string; versionId: string; hash: string; contextHash: string;
  snapshotRevision: number; actorId: string; createdAt: string; result: SkillPersistedTrialResult;
};
export type SkillReleaseReview = {
  id: string; skillId: string; versionId: string; evaluationId: string; hash: string; contextHash: string;
  reason: string; acknowledgedSimulation: boolean; actorId: string; createdAt: string;
};
export type SkillReleaseEvent = {
  id: string; skillId: string; versionId: string; previousVersionId: string | null;
  kind: 'publish' | 'rollback'; reason: string; actorId: string; createdAt: string;
};
export type SkillReleaseEvidence = { evaluations: SkillEvaluation[]; reviews: SkillReleaseReview[]; events: SkillReleaseEvent[] };
export type SkillPublishedVersion = { skillId: string; enabled: boolean; archived: boolean; version: SkillVersion };
/** Exact version/hash lookups deliberately do not resolve "latest"; Workflow bindings remain stable. */
export type SkillContextResolver = string | ((record: SkillRecord, tx: SkillDbExecutor) => Promise<string>);
export interface SkillReleaseRepository {
  evidence(skillId: string): Promise<SkillReleaseEvidence>;
  getPublishedVersion(skillId: string, versionId: string, hash?: string, executor?: SkillDbExecutor): Promise<SkillPublishedVersion | null>;
  appendEvaluation(skillId: string, revision: number, actor: SkillActor,
    value: Pick<SkillEvaluation, 'versionId' | 'hash' | 'contextHash' | 'result'>): Promise<{ record: SkillRecord; evaluation: SkillEvaluation }>;
  review(skillId: string, revision: number, actor: SkillActor,
    input: { evaluationId: string; reason: string; contextHash: SkillContextResolver; acknowledgeSimulation?: boolean }): Promise<SkillRecord>;
  publish(skillId: string, revision: number, actor: SkillActor, contextHash: SkillContextResolver): Promise<SkillRecord>;
  rollback(skillId: string, revision: number, actor: SkillActor, targetVersionId: string, reason: string): Promise<SkillRecord>;
}
