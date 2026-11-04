import type { SkillDefinition } from '../skills/skills.types';
import type { SkillDependencySnapshot } from '../skills/skills-release.types';
import type { SkillToolDefinition } from '../skills/skills.validation';
export type WorkflowSchema = Record<string, unknown>;
export type WorkflowMapping = {
    target: string;
    source: {
        kind: 'literal';
        value: unknown;
    } | {
        kind: 'path';
        path: string;
        fallback?: unknown;
    };
};
export type WorkflowPredicate = {
    path: string;
    op: 'exists' | 'eq' | 'neq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte';
    value?: unknown;
};
type StepBase = {
    id: string;
    name: string;
    inputMapping: WorkflowMapping[];
    prerequisite?: WorkflowPredicate[];
    branches?: Array<{
        when: WorkflowPredicate[];
        target: string;
    }>;
    onFailure: 'wait' | 'fail';
    repeat?: {
        while: WorkflowPredicate[];
        maxIterations: number;
        onLimit: 'wait' | 'fail';
    };
};
export type WorkflowStep = StepBase & ({
    type: 'skill';
    skillId: string;
    skillVersionId: string;
} | {
    type: 'userInput';
    prompt: string;
    inputSchema: WorkflowSchema;
    outputSchema: WorkflowSchema;
} | {
    type: 'confirmation';
    prompt: string;
    inputSchema: WorkflowSchema;
} | {
    type: 'tool';
    toolName: string;
    requiresConfirmation: boolean;
});
export type WorkflowDefinition = {
    name: string;
    description: string;
    category: string;
    roles: string[];
    inputSchema: WorkflowSchema;
    outputSchema: WorkflowSchema;
    steps: WorkflowStep[];
    outputMapping: WorkflowMapping[];
};
export type WorkflowSkillContract = {
    stepId: string;
    skillId: string;
    skillVersionId: string;
    hash: string;
    enabled: boolean;
    archived: boolean;
    status: string;
    definition: Pick<SkillDefinition, 'roles' | 'inputSchema' | 'outputSchema'>;
    context?: SkillDependencySnapshot;
};
export type WorkflowToolContract = SkillToolDefinition & {
    requiresConfirmation: boolean;
    capability?: string;
    source?: string;
    policy?: unknown;
};
export type WorkflowValidationContext = {
    skills: WorkflowSkillContract[];
    tools: WorkflowToolContract[];
};
export type WorkflowDependencySnapshot = {
    schemaVersion: 1;
    skills: Array<{
        stepId: string;
        skillId: string;
        skillVersionId: string;
        hash: string;
        context: SkillDependencySnapshot;
    }>;
    tools: Array<{
        stepId: string;
        contract: WorkflowToolContract;
        hash: string;
    }>;
};
export type WorkflowProof = {
    id: string;
    versionId: string;
    hash: string;
    dependencyHash: string;
    actorId: string;
    createdAt: string;
    mode: 'static';
    executionPerformed: false;
};
export type WorkflowVersion = {
    workflowVersionId: string;
    versionCode: string;
    majorLetter: string;
    minorNumber: number;
    status: 'draft' | 'reviewed' | 'published';
    checkoutStatus: 'checked_in' | 'checked_out';
    checkedOutBy: string | null;
    definition: WorkflowDefinition;
    lastCheckinDefinition: WorkflowDefinition;
    hash: string;
    dependencySnapshot: WorkflowDependencySnapshot | null;
    validation: WorkflowProof | null;
    review: (WorkflowProof & {
        validationId: string;
        reason: string;
    }) | null;
    createdAt: string;
    updatedAt: string;
};
export type WorkflowAudit = {
    id: string;
    action: string;
    actorId: string;
    actorName: string;
    versionId: string;
    reason: string | null;
    createdAt: string;
};
export type WorkflowRecord = {
    workflowId: string;
    enabled: boolean;
    archived: boolean;
    currentVersionId: string;
    activeVersionId: string | null;
    revision: number;
    versions: WorkflowVersion[];
    audit: WorkflowAudit[];
    createdAt: string;
    updatedAt: string;
};
export type WorkflowActor = {
    id: string;
    username: string;
};
export class WorkflowError extends Error {
    constructor(public code: string, message: string, public status = 400, public details: Array<{
        field: string;
        reason: string;
    }> = []) { super(message); this.name = 'WorkflowError'; }
}
export function workflowInvalid(field: string, reason: string): never { throw new WorkflowError('WORKFLOW_INVALID_DEFINITION', '工作流定义不合法，请检查标记字段', 400, [{ field, reason }]); }
export type WorkflowRevisionSnapshot = {
    root: Omit<WorkflowRecord, 'versions' | 'audit'>;
    version: WorkflowVersion;
    event: WorkflowAudit;
};
