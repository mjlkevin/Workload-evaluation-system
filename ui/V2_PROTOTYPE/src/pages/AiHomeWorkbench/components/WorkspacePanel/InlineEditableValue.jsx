import { normalizePendingText } from '../../utils/harnessPayload.js'

function inlineEditLabel(label) {
  return /^[A-Za-z0-9_]/.test(String(label || '')) ? `编辑 ${label}` : `编辑${label}`
}

export default function InlineEditableValue({ label, fieldKey, value, placeholder = '双击补充', editingKey, onStartEdit, onChange, onFinishEdit, multiline = false, variant = 'plain' }) {
  const displayValue = normalizePendingText(value)
  const isEditing = editingKey === fieldKey
  const isFieldVariant = variant === 'field'
  const commonStyle = {
    width: '100%',
    border: '1px solid var(--accent)',
    borderRadius: 7,
    padding: '6px 8px',
    fontFamily: 'inherit',
    fontSize: 12.5,
    lineHeight: 1.45,
    outline: 'none',
    background: '#fff',
  }
  if (isEditing) {
    const InputTag = multiline ? 'textarea' : 'input'
    return (
      <InputTag
        aria-label={inlineEditLabel(label)}
        autoFocus
        rows={multiline ? 2 : undefined}
        value={displayValue}
        onChange={(event) => onChange(fieldKey, event.target.value)}
        onBlur={() => onFinishEdit(fieldKey)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            onFinishEdit(fieldKey)
          }
          if (event.key === 'Escape') onFinishEdit(fieldKey)
        }}
        style={multiline ? { ...commonStyle, resize: 'vertical', minHeight: 58 } : commonStyle}
      />
    )
  }
  return (
    <button
      type="button"
      aria-label={`${label} ${displayValue || placeholder} 双击编辑`}
      title="双击编辑"
      onClick={(event) => {
        if (event.detail >= 2) onStartEdit(fieldKey)
      }}
      onDoubleClick={() => onStartEdit(fieldKey)}
      style={{
        display: 'block',
        width: '100%',
        minHeight: isFieldVariant ? 34 : 24,
        marginTop: 4,
        padding: isFieldVariant ? '7px 9px' : 0,
        border: isFieldVariant ? '1px dashed var(--line-2, #cbd5e1)' : 0,
        borderRadius: isFieldVariant ? 8 : 0,
        background: isFieldVariant ? (displayValue ? '#fff' : 'var(--bg-soft)') : 'transparent',
        textAlign: 'left',
        color: displayValue ? 'var(--ink)' : 'var(--ink-3)',
        fontFamily: 'inherit',
        fontSize: 12.5,
        fontWeight: displayValue ? 750 : 700,
        cursor: 'text',
        lineHeight: 1.5,
      }}
    >
      {displayValue || placeholder}
    </button>
  )
}
