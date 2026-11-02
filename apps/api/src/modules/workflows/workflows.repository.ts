import type { Database } from '../../db/client';
import type { WorkflowActor, WorkflowDefinition, WorkflowRecord } from './workflows.types';
export type WorkflowDbExecutor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;
export type WorkflowRepository = {
    list(): Promise<WorkflowRecord[]>;
    get(id: string): Promise<WorkflowRecord | null>;
    create(definition: WorkflowDefinition, actor: WorkflowActor): Promise<WorkflowRecord>;
    mutate(id: string, revision: number, actor: WorkflowActor, action: string, update: (record: WorkflowRecord, now: string, tx: WorkflowDbExecutor) => void | Promise<void>, reason?: string): Promise<WorkflowRecord>;
    influences(skillId: string, versionId?: string): Promise<Array<{
        workflowId: string;
        workflowVersionId: string;
        versionCode: string;
        stepId: string;
        skillId: string;
        skillVersionId: string;
        workflowName: string;
        enabled: boolean;
        archived: boolean;
        current: boolean;
        active: boolean;
        history: boolean;
        published: boolean;
        binding: 'fixed';
        upgradePath: string;
    }>>;
};
