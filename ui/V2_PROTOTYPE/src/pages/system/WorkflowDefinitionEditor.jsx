import { systemInput } from '../../components/system/SystemObjectList.jsx'
export const workflowSchema = () => ({ type: 'object', properties: {}, additionalProperties: false })
export const defaultWorkflowStep = (id = 'step1') => ({ id, name: '人工输入', type: 'userInput', prompt: '请填写所需信息', inputSchema: workflowSchema(), outputSchema: workflowSchema(), inputMapping: [], onFailure: 'wait' })
export const defaultWorkflowDefinition = () => ({ name: '', description: '', category: '通用', roles: ['delivery'], inputSchema: workflowSchema(), outputSchema: workflowSchema(), steps: [defaultWorkflowStep()], outputMapping: [] })
const json = value => JSON.stringify(value, null, 2)
export const toWorkflowForm = definition => ({ ...definition, inputSchema: json(definition.inputSchema), outputSchema: json(definition.outputSchema), outputMapping: json(definition.outputMapping) })
export function parseWorkflowJson(value, field, label, array = false) {
  let parsed
  try { parsed = JSON.parse(value) } catch { throw Object.assign(new Error(`${label} JSON 格式错误`), { field }) }
  if (array ? !Array.isArray(parsed) : !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Object.assign(new Error(`${label}必须是${array ? '数组' : '对象'}`), { field })
  return parsed
}
export const parseWorkflowForm = form => ({ ...form, inputSchema: parseWorkflowJson(form.inputSchema, 'inputSchema', '输入 Schema'), outputSchema: parseWorkflowJson(form.outputSchema, 'outputSchema', '输出 Schema'), outputMapping: parseWorkflowJson(form.outputMapping, 'outputMapping', '输出映射', true) })
export function WorkflowField({ label, value, onChange, disabled, multiline, error, maxLength, children, errorId = 'workflow-error' }) {
  return <label className="flex min-w-0 flex-col gap-2 text-sm text-ink-2">{label}{children || (multiline ? <textarea className={`${systemInput.replace('h-9', 'h-auto')} min-h-24 py-2 font-mono`} value={value} onChange={e => onChange(e.target.value)} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} maxLength={maxLength} /> : <input className={systemInput} value={value} onChange={e => onChange(e.target.value)} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} maxLength={maxLength} />)}</label>
}
export default function WorkflowDefinitionEditor({ form, onChange, disabled, metadata, errorField }) {
  const field = (key, label, multiline, maxLength) => <WorkflowField key={key} label={label} value={form[key]} onChange={value => onChange({ ...form, [key]: value })} disabled={disabled} multiline={multiline} maxLength={maxLength} error={errorField === key} />
  return <div className="min-w-0 space-y-4">
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">{field('name', '名称', false, 120)}{field('category', '分类', false, 80)}</div>
    {field('description', '描述', true, 2000)}
    <fieldset disabled={disabled} className="m-0 min-w-0 rounded-md border border-solid border-line p-3"><legend className="px-1 text-sm text-ink-2">适用角色</legend><div className="flex flex-wrap gap-4">{(metadata.roles || []).map(role => <label key={role} className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.roles.includes(role)} onChange={e => onChange({ ...form, roles: e.target.checked ? [...form.roles, role] : form.roles.filter(v => v !== role) })} />{role}</label>)}</div></fieldset>
    <details className="min-w-0 space-y-3 text-sm text-ink-2"><summary className="cursor-pointer">Schema 与映射规则说明</summary><p>Schema 必须为对象；根级 $ref / const / enum 不支持映射，字段级约束可用。映射为数组：target 指向目标字段；source 使用 kind: literal + value，或 kind: path + path（$.input.字段 / $.steps.步骤ID.output.字段），可选 fallback。不得引用尚未完成的步骤或工具输出。</p><p>Workflow 角色不得扩大固定 Skill 的角色范围。Skill 升版不会自动改变这里的绑定。</p></details>
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">{field('inputSchema', '输入 Schema (JSON)', true)}{field('outputSchema', '输出 Schema (JSON)', true)}</div>
    {field('outputMapping', '输出映射 (JSON)', true)}
  </div>
}
