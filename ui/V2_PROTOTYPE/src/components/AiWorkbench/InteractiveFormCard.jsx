import React, { useEffect, useMemo, useState } from 'react'

const SUPPORTED_FIELD_TYPES = new Set(['text', 'textarea', 'number', 'boolean', 'single_select'])

function pickArray(value) {
  return Array.isArray(value) ? value : []
}

function normalizeFields(fields) {
  return pickArray(fields)
    .filter((field) => field?.id && field?.label && SUPPORTED_FIELD_TYPES.has(field.type))
    .map((field) => ({
      ...field,
      id: String(field.id),
      label: String(field.label),
      options: field.type === 'single_select'
        ? pickArray(field.options)
            .filter((option) => option?.label && option?.value)
            .map((option) => ({ label: String(option.label), value: String(option.value) }))
        : [],
    }))
    .filter((field) => field.type !== 'single_select' || field.options.length > 0)
}

function buildInitialValues(fields) {
  return fields.reduce((acc, field) => {
    acc[field.id] = field.type === 'boolean' ? false : ''
    return acc
  }, {})
}

function displayValue(field, value) {
  if (field.type === 'boolean') return value ? '是' : '否'
  if (field.type === 'single_select') {
    return field.options.find((option) => option.value === value)?.label || value || ''
  }
  return value == null ? '' : String(value).trim()
}

function renderSubmitMessage(formBlock, fields, values) {
  const labels = fields.reduce((acc, field) => {
    acc[field.id] = displayValue(field, values[field.id])
    return acc
  }, {})

  if (formBlock.submitMessageTemplate) {
    return String(formBlock.submitMessageTemplate).replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, fieldId) => labels[fieldId] || '')
  }

  const title = String(formBlock.title || '信息').trim()
  const prefix = title.startsWith('补充') ? title : `补充${title}`
  return [
    `${prefix}：`,
    ...fields.map((field) => `- ${field.label}：${labels[field.id] || '未填写'}`),
  ].join('\n')
}

export default function InteractiveFormCard({ formBlock, disabled = false, onSubmit }) {
  const fields = useMemo(() => normalizeFields(formBlock?.fields), [formBlock?.fields])
  const [values, setValues] = useState(() => buildInitialValues(fields))
  const [errors, setErrors] = useState({})

  useEffect(() => {
    setValues(buildInitialValues(fields))
    setErrors({})
  }, [fields])

  if (!formBlock?.blockId || !formBlock?.title || !fields.length) return null

  function updateValue(fieldId, value) {
    setValues((prev) => ({ ...prev, [fieldId]: value }))
    setErrors((prev) => {
      if (!prev[fieldId]) return prev
      const next = { ...prev }
      delete next[fieldId]
      return next
    })
  }

  function validate() {
    const nextErrors = {}
    fields.forEach((field) => {
      if (!field.required) return
      if (field.type === 'boolean') {
        if (!values[field.id]) nextErrors[field.id] = '请确认该项'
        return
      }
      if (!String(values[field.id] || '').trim()) {
        nextErrors[field.id] = '请填写该项'
      }
    })
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  function handleSubmit(event) {
    event.preventDefault()
    if (disabled || !validate()) return
    onSubmit?.(renderSubmitMessage(formBlock, fields, values), { values, formBlock })
  }

  return (
    <form
      className="ai-form-card"
      role="group"
      aria-label={formBlock.title}
      onSubmit={handleSubmit}
    >
      <div className="ai-form-card__head">
        <h3>{formBlock.title}</h3>
        {formBlock.description && <p>{formBlock.description}</p>}
      </div>

      <div className="ai-form-card__fields">
        {fields.map((field) => {
          const inputId = `ai-form-${formBlock.blockId}-${field.id}`
          const hasError = Boolean(errors[field.id])
          if (field.type === 'boolean') {
            return (
              <div className="ai-form-field" key={field.id}>
                <label className="ai-form-check">
                  <input
                    type="checkbox"
                    checked={Boolean(values[field.id])}
                    disabled={disabled}
                    onChange={(event) => updateValue(field.id, event.target.checked)}
                  />
                  <span>{field.label}</span>
                </label>
                {field.helperText && <small>{field.helperText}</small>}
                {hasError && <em>{errors[field.id]}</em>}
              </div>
            )
          }

          return (
            <label className="ai-form-field" key={field.id} htmlFor={inputId}>
              <span>{field.label}{field.required ? <b aria-hidden="true">*</b> : null}</span>
              {field.type === 'textarea' ? (
                <textarea
                  id={inputId}
                  aria-label={field.label}
                  rows={3}
                  value={values[field.id] || ''}
                  placeholder={field.placeholder || ''}
                  disabled={disabled}
                  onChange={(event) => updateValue(field.id, event.target.value)}
                />
              ) : field.type === 'single_select' ? (
                <select
                  id={inputId}
                  aria-label={field.label}
                  value={values[field.id] || ''}
                  disabled={disabled}
                  onChange={(event) => updateValue(field.id, event.target.value)}
                >
                  <option value="">请选择</option>
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  id={inputId}
                  aria-label={field.label}
                  type={field.type === 'number' ? 'number' : 'text'}
                  value={values[field.id] || ''}
                  placeholder={field.placeholder || ''}
                  disabled={disabled}
                  onChange={(event) => updateValue(field.id, event.target.value)}
                />
              )}
              {field.helperText && <small>{field.helperText}</small>}
              {hasError && <em>{errors[field.id]}</em>}
            </label>
          )
        })}
      </div>

      <div className="ai-form-card__foot">
        <button className="btn btn-pri" type="submit" disabled={disabled}>
          {formBlock.submitLabel || '提交'}
        </button>
      </div>
    </form>
  )
}
