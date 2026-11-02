import { isDeepStrictEqual as same } from 'node:util';
import { skillDefinitionHash } from '../skills/skills.hash';
import { WorkflowError, type WorkflowActor, type WorkflowRecord } from './workflows.types';
export function workflowImmutable(): never { throw new WorkflowError('WORKFLOW_HISTORY_IMMUTABLE', '工作流身份或历史版本不可修改', 409); }
export function verifyWorkflowMutation(before: WorkflowRecord, next: WorkflowRecord, actor: WorkflowActor, action: string): void {
    const bad = workflowImmutable;
    if (next.workflowId !== before.workflowId || next.createdAt !== before.createdAt || next.updatedAt !== before.updatedAt || next.revision !== before.revision || !same(next.audit, before.audit)
        || next.versions.length < before.versions.length || next.versions.length > before.versions.length + 1)
        bad();
    const ids = new Set(next.versions.map(v => v.workflowVersionId));
    if (ids.size !== next.versions.length || !ids.has(next.currentVersionId) || (next.activeVersionId !== null && next.versions.find(v => v.workflowVersionId === next.activeVersionId)?.status !== 'published'))
        bad();
    if (next.currentVersionId !== before.currentVersionId && action !== 'promote')
        bad();
    if (next.activeVersionId !== before.activeVersionId && !['publish', 'rollback'].includes(action))
        bad();
    for (const [i, old] of before.versions.entries()) {
        const v = next.versions[i];
        if (!v || v.workflowVersionId !== old.workflowVersionId || v.majorLetter !== old.majorLetter || v.createdAt !== old.createdAt || v.updatedAt !== old.updatedAt)
            bad();
        if (old.status === 'published' || old.workflowVersionId !== before.currentVersionId) {
            if (!same(v, old))
                bad();
            continue;
        }
        if (['save-draft', 'checkin', 'undo-checkout', 'force-unlock'].includes(action)) {
            if (old.checkoutStatus !== 'checked_out')
                throw new WorkflowError('WORKFLOW_CHECKOUT_REQUIRED', '请先检出编辑', 409);
            if (old.checkedOutBy !== actor.id && action !== 'force-unlock')
                throw new WorkflowError('WORKFLOW_LOCKED', '当前版本由其他管理员检出', 409);
        }
        if (action === 'checkin') {
            if (v.minorNumber !== old.minorNumber + 1 || v.versionCode !== `WF-${before.workflowId.slice(0, 8)}-V${v.majorLetter}.${v.minorNumber}` || !same(v.definition, old.definition) || !same(v.lastCheckinDefinition, v.definition))
                bad();
        }
        else if (v.minorNumber !== old.minorNumber || v.versionCode !== old.versionCode || !same(v.lastCheckinDefinition, old.lastCheckinDefinition))
            bad();
        if (['undo-checkout', 'force-unlock'].includes(action)) {
            if (!same(v.definition, old.lastCheckinDefinition) || v.status !== 'draft')
                bad();
        }
        else if (!same(v.definition, old.definition) && action !== 'save-draft')
            bad();
        if (action === 'save-draft' && (v.checkoutStatus !== 'checked_out' || v.checkedOutBy !== actor.id || v.status !== 'draft'))
            bad();
        if (action === 'checkout') {
            if (old.checkoutStatus !== 'checked_in' || v.checkoutStatus !== 'checked_out' || v.checkedOutBy !== actor.id)
                bad();
        }
        else if (['checkin', 'undo-checkout', 'force-unlock'].includes(action)) {
            if (v.checkoutStatus !== 'checked_in' || v.checkedOutBy !== null)
                bad();
        }
        else if (v.checkoutStatus !== old.checkoutStatus || v.checkedOutBy !== old.checkedOutBy)
            bad();
        if (v.status !== old.status && !['checkout', 'save-draft', 'checkin', 'undo-checkout', 'force-unlock', 'validate', 'review', 'publish'].includes(action))
            bad();
        if (!same(v.dependencySnapshot, old.dependencySnapshot) && !['validate', 'review', 'publish', 'checkout', 'save-draft', 'checkin', 'undo-checkout', 'force-unlock'].includes(action))
            bad();
    }
    if (next.versions.length > before.versions.length && (action !== 'promote' || next.currentVersionId !== next.versions.at(-1)!.workflowVersionId))
        bad();
    if (next.versions.some(v => v.hash !== skillDefinitionHash(v.definition) || !['draft', 'reviewed', 'published'].includes(v.status) || !['checked_in', 'checked_out'].includes(v.checkoutStatus)
        || (v.checkoutStatus === 'checked_in' ? v.checkedOutBy !== null : !v.checkedOutBy)))
        bad();
}
