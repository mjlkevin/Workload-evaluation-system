import { useState } from 'react'
import SystemObjectDialog from '../../components/system/SystemObjectDialog.jsx'
import { systemButton, systemInput, systemPrimaryButton } from '../../components/system/SystemObjectList.jsx'
import { defaultWorkflowStep, parseWorkflowJson, WorkflowField, workflowSchema } from './WorkflowDefinitionEditor.jsx'
const stringify = value => JSON.stringify(value, null, 2)
const types = { skill: 'Skill', userInput: '人工输入', confirmation: '人工确认', tool: '原生工具' }
const toForm = step => ({ ...step, inputMapping: stringify(step.inputMapping), inputSchema: stringify(step.inputSchema || workflowSchema()), outputSchema: stringify(step.outputSchema || workflowSchema()), prerequisite: step.prerequisite ? stringify(step.prerequisite) : '', branches: step.branches ? stringify(step.branches) : '', repeat: step.repeat ? stringify(step.repeat) : '' })
export default function WorkflowStepDialog({ step, metadata, steps, index, disabled, onApply, onClose, initialError }) {
  const [form, setForm] = useState(() => toForm(step))
  const [error, setError] = useState(initialError?.message || '')
  const [showAll, setShowAll] = useState(false)
  const [fieldError, setFieldError] = useState(initialError?.field || '')
  const baseline = stringify(toForm(step))
  const skills = metadata.publishedSkills || []
  const available = skills.filter(s => showAll || s.skillVersionId === form.skillVersionId || (s.active && s.enabled && !s.archived))
  const tool = (metadata.tools || []).find(t => t.name === form.toolName)
  const floor = Boolean(tool?.mutates || tool?.exfiltrates || tool?.requiresConfirmation)
  const patch = next => { setForm({ ...form, ...next }); setError(''); setFieldError('') }
  const changeType = type => {
    const base = { id: form.id, name: form.name, inputMapping: [], onFailure: form.onFailure }
    const active = skills.find(s => s.active && s.enabled && !s.archived)
    const firstTool = metadata.tools?.[0]
    const extra = type === 'skill' ? { skillId: active?.skillId || '', skillVersionId: active?.skillVersionId || '' } : type === 'tool' ? { toolName: firstTool?.name || '', requiresConfirmation: Boolean(firstTool?.mutates || firstTool?.exfiltrates || firstTool?.requiresConfirmation) } : { prompt: '请填写所需信息', inputSchema: workflowSchema(), ...(type === 'userInput' ? { outputSchema: workflowSchema() } : {}) }
    setForm(toForm({ ...base, type, ...extra })); setError('')
  }
  const apply = () => {
    try {
      const bad = (field, message) => { throw Object.assign(new Error(message), { field }) }
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(form.id) || ['constructor', 'prototype', '__proto__'].includes(form.id) || steps.some((s, i) => i !== index && s.id === form.id)) bad('id', '步骤 ID 需唯一，使用 1–80 位字母、数字、下划线或短横线')
      if (!form.name.trim()) bad('name', '请填写步骤名称')
      const next = { id: form.id, name: form.name, type: form.type, inputMapping: parseWorkflowJson(form.inputMapping, 'inputMapping', '输入映射', true), onFailure: form.onFailure }
      for (const key of ['prerequisite', 'branches', 'repeat']) if (form[key].trim()) next[key] = parseWorkflowJson(form[key], key, key, key !== 'repeat')
      if (next.branches?.some(b => b.target !== '$end' && !steps.slice(index + 1).some(s => s.id === b.target))) bad('branches', '分支只能指向后续步骤或 $end')
      if (next.repeat && (!Number.isInteger(next.repeat.maxIterations) || next.repeat.maxIterations < 1 || next.repeat.maxIterations > 10 || !['wait', 'fail'].includes(next.repeat.onLimit))) bad('repeat', '循环次数必须为 1–10，onLimit 为 wait 或 fail')
      if (form.type === 'skill') {
        const selected = skills.find(s => s.skillVersionId === form.skillVersionId)
        if (!selected || !selected.enabled || selected.archived) bad('skillVersionId', '请选择启用且未归档的已发布 Skill 固定版本')
        Object.assign(next, { skillId: selected.skillId, skillVersionId: selected.skillVersionId })
      } else if (form.type === 'tool') {
        if (!tool) bad('toolName', '请选择原生工具')
        Object.assign(next, { toolName: tool.name, requiresConfirmation: floor || Boolean(form.requiresConfirmation) })
      } else {
        if (!form.prompt.trim()) bad('prompt', '请填写提示语')
        Object.assign(next, { prompt: form.prompt, inputSchema: parseWorkflowJson(form.inputSchema, 'inputSchema', '步骤输入 Schema') })
        if (form.type === 'userInput') next.outputSchema = parseWorkflowJson(form.outputSchema, 'outputSchema', '步骤输出 Schema')
      }
      onApply(next)
    } catch (cause) { setError(cause.message); setFieldError(cause.field) }
  }
  const field = (key, label, multiline = false) => <WorkflowField label={label} value={form[key] || ''} onChange={value => patch({ [key]: value })} disabled={disabled} multiline={multiline} error={fieldError === key} errorId="workflow-step-error" />
  return <div onKeyDown={e => { if (e.key === 'Escape' || e.key === 'Tab') e.stopPropagation() }} onCancel={e => e.stopPropagation()}><SystemObjectDialog open title={index === steps.length ? '添加步骤' : '编辑步骤'} onClose={onClose} dirty={!disabled && stringify(form) !== baseline} footer={close => <><button className={systemButton} onClick={close}>取消</button>{!disabled && <button className={systemPrimaryButton} onClick={apply}>应用步骤</button>}</>}>
    <div className="min-w-0 space-y-4">
      {error && <p id="workflow-step-error" role="alert" className="text-sm text-err-ink">{error}</p>}
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">{field('id', '步骤 ID')}{field('name', '步骤名称')}</div>
      <WorkflowField label="步骤类型"><select className={systemInput} value={form.type} disabled={disabled} onChange={e => changeType(e.target.value)}>{Object.entries(types).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></WorkflowField>
      {form.type === 'skill' && <><label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />显示历史、停用和归档版本</label><WorkflowField label="固定 Skill 版本"><select className={systemInput} value={form.skillVersionId || ''} disabled={disabled} onChange={e => patch({ skillVersionId: e.target.value })}><option value="">选择已发布版本</option>{available.map(s => <option key={s.skillVersionId} value={s.skillVersionId} disabled={!s.enabled || s.archived}>{s.name} · {s.versionCode} · {s.active ? '生效' : '历史'}{!s.enabled ? ' · 停用' : ''}{s.archived ? ' · 归档' : ''}</option>)}</select></WorkflowField>{!skills.length && <p className="text-sm text-warn-ink">没有已发布 Skill，请先在 Skill 管理发布；也可使用人工步骤配置流程。</p>}<details className="text-sm text-ink-2"><summary>查看固定版本契约</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap wrap-anywhere">{stringify(skills.find(s => s.skillVersionId === form.skillVersionId) || {})}</pre></details></>}
      {form.type === 'tool' && <><WorkflowField label="原生工具"><select className={systemInput} value={form.toolName || ''} disabled={disabled} onChange={e => { const t = metadata.tools.find(t => t.name === e.target.value); patch({ toolName: e.target.value, requiresConfirmation: Boolean(t?.mutates || t?.exfiltrates || t?.requiresConfirmation) }) }}>{metadata.tools.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}</select></WorkflowField><label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={floor || Boolean(form.requiresConfirmation)} disabled={disabled || floor} onChange={e => patch({ requiresConfirmation: e.target.checked })} />需要人工确认{floor ? '（原生策略要求）' : ''}</label><details className="text-sm text-ink-2"><summary>工具参数、角色与策略契约</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap wrap-anywhere">{stringify(tool || {})}</pre></details></>}
      {['userInput', 'confirmation'].includes(form.type) && <>{field('prompt', '提示语', true)}{field('inputSchema', '步骤输入 Schema (JSON)', true)}{form.type === 'userInput' ? field('outputSchema', '步骤输出 Schema (JSON)', true) : <p className="text-sm text-ink-2">确认输出固定为 approved: boolean，必填。</p>}</>}
      {field('inputMapping', '输入映射 (JSON)', true)}
      <WorkflowField label="失败处理"><select className={systemInput} value={form.onFailure} disabled={disabled} onChange={e => patch({ onFailure: e.target.value })}><option value="wait">等待处理</option><option value="fail">终止失败</option></select></WorkflowField>
      <details className="space-y-3 text-sm text-ink-2"><summary className="cursor-pointer">高级控制（可选）</summary><p>前置条件/分支使用 path、op、value；op 为 exists/eq/neq/in/gt/gte/lt/lte。分支为 when 条件数组 + target，仅允许后续步骤或 $end。循环为 while 条件数组、maxIterations 1–10、onLimit wait/fail；全部使用有限静态结构。</p>{field('prerequisite', '前置条件 (JSON)', true)}{field('branches', '后续分支 (JSON)', true)}{field('repeat', '有限循环 (JSON)', true)}</details>
    </div>
  </SystemObjectDialog></div>
}
export { defaultWorkflowStep }
