import { randomUUID } from 'node:crypto';
import { skillDefinitionHash } from '../skills/skills.hash';
import type { WorkflowVersion } from './workflows.types';
const clone = <T>(v: T): T => structuredClone(v);
export function newWorkflowVersion(id: string, definition: WorkflowVersion['definition'], now: string, majorLetter = 'A'): WorkflowVersion {
    return { workflowVersionId: randomUUID(), versionCode: `WF-${id.slice(0, 8)}-V${majorLetter}.0`, majorLetter, minorNumber: 0, status: 'draft', checkoutStatus: 'checked_in', checkedOutBy: null,
        definition: clone(definition), lastCheckinDefinition: clone(definition), hash: skillDefinitionHash(definition), dependencySnapshot: null, validation: null, review: null, createdAt: now, updatedAt: now };
}
