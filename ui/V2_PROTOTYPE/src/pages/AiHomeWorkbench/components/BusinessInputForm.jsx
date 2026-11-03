import { useId } from 'react'
import { resolveBusinessSchema, unavailableSchemaMessage } from './businessInputSchema.js'

const labels = { sources: '原始材料', answers: '补充回答', params: '计算参数', templateId: '评估模板', title: '名称', text: '原文', kind: '类型', id: '标识', previous: '上一版内容' }
const hasConst = schema => Object.hasOwn(schema, 'const')
const valueType = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const sameValue = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
const typeOf = schema => schema?.type || (schema?.properties ? 'object' : schema?.items ? 'array' : 'string')
export function initialBusinessInput(schema = {}) {
  try { schema = resolveBusinessSchema(schema) } catch { return {} }
  if (hasConst(schema)) return structuredClone(schema.const)
  if (schema.default !== undefined) return structuredClone(schema.default)
  if (typeOf(schema) === 'object') {
    return Object.fromEntries(Object.entries(schema.properties || {}).flatMap(([key, child]) => {
      if (hasConst(child)) return [[key, structuredClone(child.const)]]
      if (child.default !== undefined) return [[key, structuredClone(child.default)]]
      if (child.type === 'boolean' && schema.required?.includes(key)) return [[key, false]]
      return []
    }))
  }
  return typeOf(schema) === 'array' ? [] : undefined
}
export function validateBusinessInput(schema = {}, value) {
  try { schema = resolveBusinessSchema(schema) } catch { return { '': unavailableSchemaMessage } }
  const errors = {}
  function visit(rule, item, path, required = false) {
    const explicitlyAllowed = rule.enum?.some(option => sameValue(option, item)) || (hasConst(rule) && sameValue(rule.const, item))
    const empty = item === undefined || ((item === null || item === '') && !explicitlyAllowed)
    if (empty) { if (required) errors[path] = '请填写此项'; return }
    const type = !rule.type && !rule.properties && !rule.items && (rule.enum || hasConst(rule)) ? valueType(item) : typeOf(rule)
    if (rule.enum && !rule.enum.some(option => sameValue(option, item))) errors[path] = '请选择有效选项'
    if (hasConst(rule) && !sameValue(rule.const, item)) errors[path] = '此项必须使用指定值'
    if (type === 'object') {
      if (typeof item !== 'object' || Array.isArray(item)) { errors[path] = '请输入有效对象'; return }
      Object.entries(rule.properties || {}).forEach(([key, child]) => visit(child, item[key], path ? `${path}.${key}` : key, rule.required?.includes(key)))
    } else if (type === 'array') {
      if (!Array.isArray(item)) { errors[path] = '请输入列表'; return }
      if (item.length < (rule.minItems ?? 0)) errors[path] = `至少添加 ${rule.minItems} 项`
      if (rule.maxItems !== undefined && item.length > rule.maxItems) errors[path] = `最多 ${rule.maxItems} 项`
      if (rule.uniqueItems && new Set(item.map(entry => JSON.stringify(entry))).size !== item.length) errors[path] = '请移除重复项'
      item.forEach((child, index) => visit(rule.items || {}, child, `${path}.${index}`, true))
    } else if (type === 'number' || type === 'integer') {
      if (typeof item !== 'number' || !Number.isFinite(item) || (type === 'integer' && !Number.isInteger(item))) errors[path] = type === 'integer' ? '请输入整数' : '请输入数字'
      else if (rule.minimum !== undefined && item < rule.minimum) errors[path] = `不得小于 ${rule.minimum}`
      else if (rule.maximum !== undefined && item > rule.maximum) errors[path] = `不得大于 ${rule.maximum}`
    } else if (type === 'boolean') { if (typeof item !== 'boolean') errors[path] = '请选择是或否' }
    else if (type === 'null') { if (item !== null) errors[path] = '请选择空值' }
    else if (typeof item !== 'string') errors[path] = '请输入文本'
    else if (item.length < (rule.minLength ?? 0)) errors[path] = `至少输入 ${rule.minLength} 个字符`
    else if (rule.maxLength !== undefined && item.length > rule.maxLength) errors[path] = `最多输入 ${rule.maxLength} 个字符`
  }
  visit(schema, value, '', true)
  return errors
}
function Field({ schema, value, onChange, label, path, required, errors, disabled, resourceOptions }) {
  const id = useId()
  const type = typeOf(schema)
  const error = errors[path]
  const common = {
    id, 'aria-label': label, disabled, required: !!required,
    'aria-invalid': !!error, 'aria-describedby': error ? `${id}-error` : undefined,
  }
  const properties = Object.entries(schema.properties || {})
  const resources = schema.format && resourceOptions[schema.format]
  const enumValues = schema.enum || (hasConst(schema) ? [schema.const] : null)
  const heading = (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm font-medium text-ink">{label}{required ? ' *' : ''}</label>
      {schema.description && (
        <details className="text-xs text-ink-2">
          <summary aria-label={`查看${label}说明`}>?</summary>
          <p>{schema.description}</p>
        </details>
      )}
    </div>
  )
  let control
  if (!resources && !enumValues && type === 'object' && properties.length) {
    return (
      <fieldset disabled={disabled} className="m-0 grid min-w-0 gap-3 rounded-md border border-line p-3">
        <legend className="text-sm font-medium">{label}</legend>
        {error && <p role="alert" className="text-sm text-err-ink">{error}</p>}
        {properties.map(([key, child]) => (
          <Field
            key={key} schema={child} value={value?.[key]}
            label={child.title || labels[key] || key} path={path ? `${path}.${key}` : key}
            required={schema.required?.includes(key)} errors={errors} disabled={disabled}
            resourceOptions={resourceOptions}
            onChange={next => {
              const result = { ...(typeof value === 'object' ? value : {}) }
              if (next === undefined) delete result[key]
              else result[key] = next
              onChange(result)
            }}
          />
        ))}
      </fieldset>
    )
  }
  if (!resources && !enumValues && type === 'array') {
    const list = Array.isArray(value) ? value : []
    return (
      <fieldset disabled={disabled} className="m-0 grid min-w-0 gap-3 rounded-md border border-line p-3">
        <legend className="text-sm font-medium">{label}</legend>
        {list.map((entry, index) => (
          <div key={index} className="grid min-w-0 gap-2">
            <Field
              schema={schema.items || { type: 'string' }} value={entry}
              label={`${label} ${index + 1}`} path={`${path}.${index}`} required
              errors={errors} disabled={disabled} resourceOptions={resourceOptions}
              onChange={next => onChange(list.map((item, current) => current === index ? next : item))}
            />
            <button
              type="button" className="btn btn-out justify-self-start"
              aria-label={`移除${label} ${index + 1}`}
              onClick={() => onChange(list.filter((_, current) => current !== index))}
            >移除</button>
          </div>
        ))}
        <button
          type="button" className="btn btn-out justify-self-start"
          disabled={disabled || (schema.maxItems !== undefined && list.length >= schema.maxItems)}
          onClick={() => onChange([...list, initialBusinessInput(schema.items) ?? ''])}
        >添加{label}</button>
        {error && <p role="alert" className="text-sm text-err-ink">{error}</p>}
      </fieldset>
    )
  }
  if (resources || enumValues) {
    // Preserve existing text option values; non-text choices use IDs disjoint from every text choice.
    let prefix = '__wes_choice_'
    while (enumValues?.some(option => typeof option === 'string' && option.startsWith(prefix))) prefix += '_'
    const choices = resources || enumValues.map((option, index) => ({
      id: typeof option === 'string' ? option : `${prefix}${index}`,
      name: option !== null && typeof option === 'object' ? JSON.stringify(option) : String(option), value: option,
    }))
    const choiceValue = option => Object.hasOwn(option, 'value') ? option.value : option.id
    const selectedId = choices.find(option => sameValue(choiceValue(option), value))?.id ?? ''
    control = (
      <select
        {...common} className="input" value={selectedId}
        onChange={event => {
          const selected = choices.find(option => String(option.id) === event.target.value)
          onChange(selected ? choiceValue(selected) : undefined)
        }}
      >
        <option value="">请选择</option>
        {choices.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    )
  } else if (type === 'boolean') {
    control = <input {...common} type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} />
  } else if (type === 'object') {
    control = (
      <textarea
        {...common} className="input min-h-24 resize-y py-2 font-mono"
        value={typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2)}
        onChange={event => {
          try { onChange(JSON.parse(event.target.value)) }
          catch { onChange(event.target.value) }
        }}
      />
    )
  } else {
    control = (
      <input
        {...common} className="input" type={['number', 'integer'].includes(type) ? 'number' : 'text'}
        step={type === 'integer' ? 1 : type === 'number' ? 'any' : undefined}
        min={schema.minimum} max={schema.maximum} value={value ?? ''}
        onChange={event => onChange(event.target.value === '' ? undefined : ['number', 'integer'].includes(type) ? Number(event.target.value) : event.target.value)}
      />
    )
  }
  return (
    <div className="grid min-w-0 gap-1">
      {heading}{control}
      {error && <p id={`${id}-error`} role="alert" className="m-0 text-sm text-err-ink">{error}</p>}
    </div>
  )
}
export default function BusinessInputForm({ schema = {}, value, onChange, errors = {}, disabled = false, resourceOptions = {} }) {
  try { schema = resolveBusinessSchema(schema) } catch { return <p role="alert" className="text-sm text-err-ink">{unavailableSchemaMessage}</p> }
  if (typeOf(schema) === 'object' && !Object.keys(schema.properties || {}).length && schema.additionalProperties === false) {
    return <p className="text-sm text-ink-2">此项无需补充输入。</p>
  }
  return (
    <Field
      schema={schema} value={value} onChange={onChange} label={schema.title || '执行输入'}
      path="" required errors={errors} disabled={disabled} resourceOptions={resourceOptions}
    />
  )
}
