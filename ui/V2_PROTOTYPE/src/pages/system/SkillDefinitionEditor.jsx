import { systemInput } from '../../components/system/SystemObjectList.jsx'

export const defaultSkillDefinition = () => ({
  name: '', description: '', category: '', instructions: '', roles: ['pre_sales'], references: [],
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputSchema: { type: 'object', properties: {}, additionalProperties: false },
  model: { scenario: 'assessment', temperature: 0.1, maxTokens: 4000, timeoutMs: 60000 }, tools: [], examples: [],
})
const jsonFields = [
  ['references', '参考资料', '数组：label、uri、version'],
  ['inputSchema', '输入 Schema', '对象 Schema：type 为 object；支持本地非递归引用'],
  ['outputSchema', '输出 Schema', '对象 Schema：type 为 object；支持本地非递归引用'],
  ['tools', '工具配置', '数组：toolName、inputMapping（原生参数名 → $.输入字段）、requiresConfirmation'],
  ['examples', '样例', '数组：title、input、expected；可选 assertions（path、op、value）'],
]
export function toSkillForm(definition) {
  return { ...definition, ...Object.fromEntries(jsonFields.map(([key]) => [key, JSON.stringify(definition[key], null, 2)])) }
}
function invalid(message, field) {
  const error = new Error(message)
  error.field = field
  return error
}
export function parseSkillForm(form) {
  const definition = { ...form }
  for (const [key, label] of jsonFields) {
    try { definition[key] = JSON.parse(form[key]) }
    catch { throw invalid(`${label} JSON 格式错误，请修正后重试`, key) }
    if (['inputSchema', 'outputSchema'].includes(key)) {
      if (!definition[key] || Array.isArray(definition[key]) || definition[key].type !== 'object') throw invalid(`${label} 根类型必须为 object`, key)
    } else if (!Array.isArray(definition[key])) throw invalid(`${label}必须为数组`, key)
  }
  for (const [key, label] of [['name', '名称'], ['category', '分类'], ['instructions', '指令']]) {
    if (!definition[key].trim()) throw invalid(`${label}不能为空`, key)
  }
  return definition
}
const textarea = `${systemInput.replace('h-9', 'h-auto')} min-h-32 resize-y py-2 font-mono text-xs leading-6`
function Field({ label, children }) {
  return <label className="flex min-w-0 flex-col gap-2 text-sm font-medium leading-5 text-ink-2">{label}{children}</label>
}
export default function SkillDefinitionEditor({ form, onChange, disabled, metadata, nameRef, errorField }) {
  const invalidProps = (key) => (errorField === key || (errorField === 'model' && key.startsWith('model.'))) ? { 'aria-invalid': true, 'aria-describedby': 'skill-form-error' } : {}
  const change = (key, value) => onChange({ ...form, [key]: value })
  const modelChange = (key, value) => change('model', { ...form.model, [key]: value })
  return <div className="min-w-0 space-y-5">
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="名称"><input ref={nameRef} {...invalidProps('name')} className={systemInput} disabled={disabled} value={form.name} onChange={(e) => change('name', e.target.value)} required /></Field>
      <Field label="分类"><input className={systemInput} disabled={disabled} {...invalidProps('category')} value={form.category} onChange={(e) => change('category', e.target.value)} required /></Field>
    </div>
    <Field label="描述"><textarea className={textarea.replace('min-h-32', 'min-h-20')} disabled={disabled} {...invalidProps('description')} value={form.description} onChange={(e) => change('description', e.target.value)} /></Field>
    <fieldset {...invalidProps('roles')} disabled={disabled} className="m-0 min-w-0 rounded-md border border-solid border-line p-3"><legend className="px-1 text-sm text-ink-2">可用角色</legend><div className="flex flex-wrap gap-4">{(metadata.roles || []).map((role) => <label key={role} className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.roles.includes(role)} onChange={(e) => change('roles', e.target.checked ? [...form.roles, role] : form.roles.filter((item) => item !== role))} />{role}</label>)}</div></fieldset>
    <Field label="指令"><textarea className={textarea} disabled={disabled} {...invalidProps('instructions')} value={form.instructions} onChange={(e) => change('instructions', e.target.value)} required /></Field>
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="模型场景"><select className={systemInput} disabled={disabled} {...invalidProps('model.scenario')} value={form.model.scenario} onChange={(e) => modelChange('scenario', e.target.value)}>{(metadata.modelScenarios || []).map((scenario) => <option key={scenario} value={scenario}>{scenario}</option>)}</select></Field>
      {[['temperature', 'Temperature', 0.1], ['maxTokens', '最大 Tokens', 1], ['timeoutMs', '超时 (ms)', 1]].map(([key, label, step]) => <Field key={key} label={label}><input className={systemInput} type="number" step={step} disabled={disabled} {...invalidProps(`model.${key}`)} value={form.model[key]} onChange={(e) => modelChange(key, e.target.value === '' ? '' : Number(e.target.value))} /></Field>)}
    </div>
    {jsonFields.map(([key, label, hint]) => <div key={key} className="min-w-0 space-y-2"><Field label={`${label} (JSON)`}><textarea className={textarea} aria-invalid={errorField === key || undefined} aria-describedby={`skill-${key}-hint${errorField === key ? ' skill-form-error' : ''}`} disabled={disabled} spellCheck={false} value={form[key]} onChange={(e) => change(key, e.target.value)} /></Field><details className="text-xs leading-5 text-ink-2" id={`skill-${key}-hint`}><summary className="cursor-pointer">格式说明</summary><p className="my-2 wrap-anywhere">{hint}</p></details>{key === 'tools' && <details className="min-w-0 text-xs leading-5 text-ink-2"><summary className="cursor-pointer">查看已接入工具与原生参数（{metadata.tools?.length || 0}）</summary><div className="mt-2 space-y-3">{(metadata.tools || []).map((tool) => <div key={tool.name} className="min-w-0 rounded-md border border-solid border-line p-3"><div className="font-semibold wrap-anywhere">{tool.name}</div><p className="my-2 wrap-anywhere">{tool.description}{tool.mutates ? ' · 写入工具' : ''}{tool.exfiltrates ? ' · 外发工具' : ''}</p><pre className="m-0 max-w-full whitespace-pre-wrap font-mono wrap-anywhere">{JSON.stringify(tool.parameters, null, 2)}</pre></div>)}</div></details>}</div>)}
  </div>
}
