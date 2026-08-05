import { fieldDisplayLabel, pickObject } from '../../utils/harnessPayload.js'
import InlineEditableValue from './InlineEditableValue.jsx'

/**
 * 报告卡片「缺失/模糊信息」编辑列：缺失字段与待确认问题的双击填写。
 */
export default function ReportMissingEditor({ editableMissingFields, questions, draft, editingKey, setEditingKey, updateDraftValue, finishDraftEdit }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, background: '#fff', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <b style={{ display: 'block', fontSize: 12 }}>缺失/模糊信息</b>
        <span style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>双击待填写区域维护</span>
      </div>
      {(editableMissingFields.length || questions.length) ? (
        <div style={{ display: 'grid', gap: 8, maxHeight: 420, overflowY: 'auto', paddingRight: 2 }}>
          {editableMissingFields.map((item, index) => {
            const row = pickObject(item)
            const field = row.field || `缺失信息 ${index + 1}`
            const label = fieldDisplayLabel(field)
            return (
              <div key={`missing-edit-${field}-${index}`} style={{ display: 'grid', gap: 6, color: 'var(--ink-2)', fontSize: 12, lineHeight: 1.55, border: '1px solid var(--line)', borderRadius: 8, padding: 9, background: 'var(--bg-soft)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <b style={{ color: 'var(--ink)' }}>{label}</b>
                  {field !== label && <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>{field}</span>}
                </div>
                {row.reason && <span style={{ color: 'var(--ink-3)' }}>{row.reason}</span>}
                <InlineEditableValue
                  label={label}
                  fieldKey={`missing:${field}`}
                  value={draft.missingAnswers?.[field] || ''}
                  placeholder="双击填写"
                  editingKey={editingKey}
                  onStartEdit={setEditingKey}
                  onChange={updateDraftValue}
                  onFinishEdit={finishDraftEdit}
                  multiline
                  variant="field"
                />
              </div>
            )
          })}
          {questions.map((item, index) => {
            const row = pickObject(item)
            const field = row.question || `待确认问题 ${index + 1}`
            return (
              <div key={`question-edit-${field}-${index}`} style={{ display: 'grid', gap: 6, color: 'var(--ink-2)', fontSize: 12, lineHeight: 1.55, border: '1px solid var(--line)', borderRadius: 8, padding: 9, background: 'var(--bg-soft)' }}>
                <b style={{ color: 'var(--ink)' }}>{field}</b>
                {row.reason && <span style={{ color: 'var(--ink-3)' }}>{row.reason}</span>}
                <InlineEditableValue
                  label={` ${field}`.trimStart()}
                  fieldKey={`question:${field}`}
                  value={draft.questionAnswers?.[field] || ''}
                  placeholder="双击回答"
                  editingKey={editingKey}
                  onStartEdit={setEditingKey}
                  onChange={updateDraftValue}
                  onFinishEdit={finishDraftEdit}
                  multiline
                  variant="field"
                />
              </div>
            )
          })}
        </div>
      ) : (
        <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>待补充</span>
      )}
    </div>
  )
}
