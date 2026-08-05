import InlineEditableValue from './InlineEditableValue.jsx'
import { ReportPill } from './ReportBits.jsx'

/**
 * 报告卡片业务字段区：项目/客户/行业三列可编辑字段、客户主体确认摘要与来源标签。
 */
export default function ReportBusinessFields({
  draft,
  editingKey,
  setEditingKey,
  updateDraftValue,
  finishDraftEdit,
  isHarnessReport,
  isV2HarnessReport,
  lookupState,
  lookupCustomer,
  productLines,
  sourceSheets,
}) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, background: 'var(--bg-soft)' }}>
          <span style={{ display: 'block', color: 'var(--ink-3)', fontSize: 11 }}>项目</span>
          <InlineEditableValue
            label="项目"
            fieldKey="projectName"
            value={draft.projectName}
            editingKey={editingKey}
            onStartEdit={setEditingKey}
            onChange={updateDraftValue}
            onFinishEdit={finishDraftEdit}
          />
        </div>
        <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, background: 'var(--bg-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'block', color: 'var(--ink-3)', fontSize: 11 }}>客户</span>
            {isHarnessReport && !isV2HarnessReport && (
              <button className="btn btn-out" type="button" onClick={lookupCustomer} disabled={lookupState.loading} style={{ marginLeft: 'auto', height: 28, padding: '0 12px', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {lookupState.loading && <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid var(--line)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
                {lookupState.loading ? '检索中…' : '检索主体'}
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </button>
            )}
          </div>
          <InlineEditableValue
            label="客户"
            fieldKey="customerName"
            value={draft.customerName}
            editingKey={editingKey}
            onStartEdit={setEditingKey}
            onChange={updateDraftValue}
            onFinishEdit={finishDraftEdit}
          />
        </div>
        <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, background: 'var(--bg-soft)' }}>
          <span style={{ display: 'block', color: 'var(--ink-3)', fontSize: 11 }}>行业</span>
          <InlineEditableValue
            label="行业"
            fieldKey="industry"
            value={draft.industry}
            editingKey={editingKey}
            onStartEdit={setEditingKey}
            onChange={updateDraftValue}
            onFinishEdit={finishDraftEdit}
          />
        </div>
      </div>
      {(lookupState.error || lookupState.selectedName || draft.location || draft.enterpriseProfile || draft.itStatus) && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, background: '#fff', display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <b style={{ fontSize: 12 }}>客户主体确认</b>
            {lookupState.selectedName && <ReportPill tone="warn">已选择主体：{lookupState.selectedName}</ReportPill>}
          </div>
          {lookupState.error && <div role="alert" style={{ color: 'var(--err)', fontSize: 12 }}>{lookupState.error}</div>}
          {(draft.location || draft.enterpriseProfile || draft.enterpriseRevenue || draft.itStatus) && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, color: 'var(--ink-2)', fontSize: 12 }}>
              {draft.location && <span>地区：{draft.location}</span>}
              {draft.enterpriseRevenue && <span>规模：{draft.enterpriseRevenue}</span>}
              {draft.itStatus && <span>信息化：{draft.itStatus}</span>}
              {draft.enterpriseProfile && <span style={{ gridColumn: '1 / -1' }}>画像：{draft.enterpriseProfile}</span>}
            </div>
          )}
        </div>
      )}
      {(productLines.length > 0 || sourceSheets.length > 0) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {productLines.map((item) => <ReportPill key={`line-${item}`}>{item}</ReportPill>)}
          {sourceSheets.map((item) => <ReportPill key={`sheet-${item}`}>表：{item}</ReportPill>)}
        </div>
      )}
    </>
  )
}
