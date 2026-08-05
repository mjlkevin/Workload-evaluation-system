import CompanyLookupDialog from '../../../../components/AiWorkbench/CompanyLookupDialog.jsx'
import { pickArray } from '../../utils/harnessPayload.js'
import EvidenceViewer from './EvidenceViewer.jsx'
import ReportActions from './ReportActions.jsx'
import ReportBusinessFields from './ReportBusinessFields.jsx'
import ReportMissingEditor from './ReportMissingEditor.jsx'
import { ReportList, ReportPill } from './ReportBits.jsx'
import { extractReportCardData } from './reportData.js'
import useReportDraft from './useReportDraft.js'

/**
 * 需求解析报告卡片（原 RequirementAnalysisReportCard）：
 * 兼容 legacy 报告与 Harness v1/v2，支持字段编辑、主体检索与补充提交。
 */
export default function ReportViewer({ artifact, onAction, onSubmitSupplement, confirmingActionId }) {
  const data = extractReportCardData(artifact)
  const {
    draft,
    editingKey,
    setEditingKey,
    lookupState,
    setLookupState,
    submitState,
    updateDraftValue,
    finishDraftEdit,
    lookupCustomer,
    selectCustomerCandidate,
    supplementAnswers,
    submitStructuredSupplement,
  } = useReportDraft({
    artifact,
    content: data.content,
    project: data.project,
    understandingProject: data.understandingProject,
    editableMissingFields: data.editableMissingFields,
    artifactIdentity: data.artifactIdentity,
    onSubmitSupplement,
  })

  if (!artifact || (!data.isLegacyReport && !data.isHarnessReport)) return null

  return (
    <section style={{
      marginTop: 12,
      border: '1px solid var(--line)',
      borderRadius: 10,
      background: '#fff',
      overflow: 'hidden',
      color: 'var(--ink)',
    }}>
      {data.isHarnessReport && (
        <div style={{ padding: 14, borderBottom: '1px solid var(--line)' }}>
          <EvidenceViewer understanding={artifact.fileUnderstanding || artifact.understanding} reportContent={data.content} />
        </div>
      )}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>{data.title}</h3>
          <p style={{ margin: '4px 0 0', color: 'var(--ink-3)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {data.content.sourceFile || '需求文件'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {data.isLegacyReport && <ReportPill>历史产物，非 Harness 生成</ReportPill>}
          <ReportPill tone="warn">待补充 {pickArray(data.missingItems).length || 0} 项</ReportPill>
        </div>
      </div>
      <div style={{ padding: 14, display: 'grid', gap: 12 }}>
        <ReportBusinessFields
          draft={draft}
          editingKey={editingKey}
          setEditingKey={setEditingKey}
          updateDraftValue={updateDraftValue}
          finishDraftEdit={finishDraftEdit}
          isHarnessReport={data.isHarnessReport}
          isV2HarnessReport={data.isV2HarnessReport}
          lookupState={lookupState}
          lookupCustomer={lookupCustomer}
          productLines={data.productLines}
          sourceSheets={data.sourceSheets}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 10 }}>
          <ReportList title="需求识别" items={data.needItems} />
          <ReportList title="模块线索" items={data.moduleItems} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <ReportMissingEditor
            editableMissingFields={data.editableMissingFields}
            questions={data.questions}
            draft={draft}
            editingKey={editingKey}
            setEditingKey={setEditingKey}
            updateDraftValue={updateDraftValue}
            finishDraftEdit={finishDraftEdit}
          />
          <ReportList title="风险假设" items={data.risks} />
        </div>
        {data.isV2HarnessReport && data.answeredQuestions.length > 0 && (
          <ReportList title="已确认信息" items={data.answeredQuestions} />
        )}
        <ReportActions
          artifact={artifact}
          nextActionItems={data.nextActionItems}
          isHarnessReport={data.isHarnessReport}
          isV2HarnessReport={data.isV2HarnessReport}
          confirmingActionId={confirmingActionId}
          onAction={onAction}
          submitState={submitState}
          supplementAnswers={supplementAnswers}
          submitStructuredSupplement={submitStructuredSupplement}
        />
      </div>
      <CompanyLookupDialog
        open={lookupState.dialogOpen}
        loading={lookupState.loading}
        candidates={lookupState.candidates}
        error={lookupState.error}
        onClose={() => setLookupState((prev) => ({ ...prev, dialogOpen: false, candidates: [], error: '' }))}
        onSelect={selectCustomerCandidate}
      />
    </section>
  )
}
